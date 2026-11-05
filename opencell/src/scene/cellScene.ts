// Builds three.js meshes for cell objects and keeps them in sync with the state.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CellObject, MeshFormat, UNIT_MM } from '../cell/objects';
import { getMesh } from '../cell/meshStore';
import { wprToMat } from '../kin/math';

/** Parse CAD bytes into an Object3D in file units. */
export async function parseMesh(data: ArrayBuffer, format: MeshFormat): Promise<THREE.Object3D> {
  if (format === 'stl') {
    const g = new STLLoader().parse(data);
    g.computeVertexNormals();
    const hasColor = !!g.getAttribute('color');
    return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: hasColor, roughness: 0.55, metalness: 0.2 }));
  }
  if (format === 'obj') return new OBJLoader().parse(new TextDecoder().decode(data));
  const gltf = await new GLTFLoader().parseAsync(data, '');
  return gltf.scene;
}

/** Bounding box size (file units) of a parsed mesh. */
export function meshSize(o: THREE.Object3D) {
  const b = new THREE.Box3().setFromObject(o);
  const v = new THREE.Vector3();
  b.getSize(v);
  return v;
}

export class CellScene {
  /** World objects live here; tool objects are parented to `flange`. */
  readonly world = new THREE.Group();
  private nodes = new Map<string, { group: THREE.Group; key: string }>();
  private parsed = new Map<string, Promise<THREE.Object3D | null>>();
  /** Faceplate group of each robot (tool bodies of robot i hang off flanges[i]). */
  flanges: THREE.Object3D[] = [];
  /** Gripper closed (true) / open per robot: fingers move in by their stroke when closed. */
  grip: boolean[] = [];
  onLoaded: () => void = () => {};

  /** id of the three.js group for a cell object (for picking). */
  objectOf(o: THREE.Object3D): string | null {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.cellId) return p.userData.cellId as string;
    return null;
  }
  group(id: string) { return this.nodes.get(id)?.group; }
  pickables(): THREE.Object3D[] { return [...this.nodes.values()].map((n) => n.group).filter((g) => g.visible); }

  sync(objects: CellObject[], shownTool: number[], selected: string | null, colliding: Set<string> = new Set()) {
    const seen = new Set<string>();
    for (const o of objects) {
      seen.add(o.id);
      const key = JSON.stringify([o.kind, o.size, o.color, o.mesh, o.role, o.tool, o.opacity]);
      let n = this.nodes.get(o.id);
      if (!n || n.key !== key) {
        if (n) { n.group.removeFromParent(); n.group.children.filter((c) => c.userData.cellId).forEach((c) => this.world.add(c)); }
        n = { group: this.build(o), key };
        this.nodes.set(o.id, n);
      }
    }
    for (const o of objects) {
      const n = this.nodes.get(o.id)!;
      const parent = o.parent && this.nodes.has(o.parent) ? this.nodes.get(o.parent)!.group : o.role === 'tool' ? this.flanges[o.robot ?? 0] ?? null : this.world;
      if (parent && n.group.parent !== parent) parent.add(n.group);
      // Pose is driven from the state unless the gizmo is dragging it.
      if (!n.group.userData.dragging) {
        const close = o.finger && this.grip[o.robot ?? 0] ? -o.finger * (o.stroke ?? 8) : 0;
        n.group.position.set(o.pose.x + close, o.pose.y, o.pose.z);
        n.group.quaternion.setFromRotationMatrix(rotMat(o.pose.w, o.pose.p, o.pose.r));
      }
      n.group.visible = !o.hidden && (o.role !== 'tool' || (o.tool === shownTool[o.robot ?? 0] && !!this.flanges[o.robot ?? 0]));
      highlight(n.group, o.id === selected ? 'sel' : colliding.has(o.id) ? 'hit' : '');
    }
    for (const [id, n] of this.nodes) if (!seen.has(id)) { n.group.removeFromParent(); this.nodes.delete(id); }
  }

  /** World-space bounding box of a group and its attached bodies: [minX, minY, minZ, maxX, maxY, maxZ]. */
  worldBox(g: THREE.Object3D): number[] | null {
    g.updateWorldMatrix(true, true);
    const b = new THREE.Box3();
    g.traverse((c) => { if (c instanceof THREE.Mesh && (c.material as THREE.Material).visible !== false) b.expandByObject(c, true); });
    return b.isEmpty() ? null : [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
  }

  /** Each cell body's 8 box corners in world (for envelope checks). */
  corners(objects: CellObject[]) {
    return this.bodies(objects).map((b) => {
      const out: [number, number, number][] = [];
      for (const x of [b.box.min.x, b.box.max.x]) for (const y of [b.box.min.y, b.box.max.y]) for (const z of [b.box.min.z, b.box.max.z]) {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(b.m);
        out.push([v.x, v.y, v.z]);
      }
      return { id: b.id, corners: out };
    });
  }

  /** World-space bodies of the cell (not tooling) for collision checks: each mesh with its world matrix and local box. */
  bodies(objects: CellObject[]): { id: string; box: THREE.Box3; m: THREE.Matrix4; inv: THREE.Matrix4 }[] {
    const out: { id: string; box: THREE.Box3; m: THREE.Matrix4; inv: THREE.Matrix4 }[] = [];
    for (const o of objects) {
      if (o.role === 'tool' || o.hidden || o.opacity === 0 || o.collide === false) continue;
      const g = this.group(o.id);
      if (!g || !g.visible) continue;
      g.updateWorldMatrix(true, false);
      for (const c of g.children) {
        if (!(c instanceof THREE.Mesh) || !c.geometry) continue;
        c.updateWorldMatrix(false, false);
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        out.push({ id: o.id, box: c.geometry.boundingBox!, m: c.matrixWorld.clone(), inv: c.matrixWorld.clone().invert() });
      }
      // imported CAD sits one level deeper
      g.children.filter((c) => !(c instanceof THREE.Mesh) && !c.userData.cellId).forEach((sub) => sub.traverse((c) => {
        if (!(c instanceof THREE.Mesh) || !c.geometry) return;
        c.updateWorldMatrix(true, false);
        if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
        out.push({ id: o.id, box: c.geometry.boundingBox!, m: c.matrixWorld.clone(), inv: c.matrixWorld.clone().invert() });
      }));
    }
    return out;
  }

  private build(o: CellObject): THREE.Group {
    const g = new THREE.Group();
    g.userData.cellId = o.id;
    const op = o.opacity ?? 1;
    const mat = new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.55, metalness: o.role === 'tool' ? 0.35 : 0.05, transparent: op < 1, opacity: op, depthWrite: op >= 1, visible: op > 0 });
    if (o.kind === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2]), mat);
      m.position.z = o.size[2] / 2;
      g.add(m);
    } else if (o.kind === 'cylinder') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(o.size[0] / 2, o.size[0] / 2, o.size[2], 40), mat);
      m.rotation.x = Math.PI / 2;
      m.position.z = o.size[2] / 2;
      g.add(m);
    } else if (o.mesh) {
      const mesh = o.mesh;
      const k = UNIT_MM[mesh.unit];
      if (!this.parsed.has(mesh.id)) {
        this.parsed.set(mesh.id, getMesh(mesh.id).then((d) => (d ? parseMesh(d, mesh.format) : null)).catch(() => null));
      }
      // placeholder until loaded
      const ph = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), new THREE.MeshBasicMaterial({ color: 0xaaaaaa, wireframe: true }));
      g.add(ph);
      this.parsed.get(mesh.id)!.then((tpl) => {
        g.remove(ph);
        if (!tpl) { g.add(new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true }))); return; }
        const inst = tpl.clone(true);
        inst.scale.setScalar(k);
        inst.traverse((c) => {
          if (c instanceof THREE.Mesh) {
            c.castShadow = c.receiveShadow = true;
            // STL/OBJ carry no useful color: use the object color.
            if (mesh.format !== 'glb') c.material = mat;
          }
        });
        g.add(inst);
        g.userData.sel = undefined; // re-apply the selection highlight to the loaded meshes
        this.onLoaded();
      });
    }
    g.traverse((c) => { if (c instanceof THREE.Mesh) c.castShadow = c.receiveShadow = true; });
    return g;
  }
}

function rotMat(w: number, p: number, r: number) {
  const R = wprToMat(w, p, r);
  return new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
}

function highlight(g: THREE.Group, how: '' | 'sel' | 'hit') {
  if (g.userData.sel === how) return;
  g.userData.sel = how;
  const own = (c: THREE.Object3D) => { for (let p: THREE.Object3D | null = c; p; p = p.parent) if (p.userData.cellId) return p === g; return false; };
  g.traverse((c) => {
    if (c instanceof THREE.Mesh && c.material instanceof THREE.MeshStandardMaterial && own(c)) {
      c.material.emissive.setHex(how === 'sel' ? 0x1f6fd1 : how === 'hit' ? 0xff1a1a : 0x000000);
      c.material.emissiveIntensity = how === 'sel' ? 0.35 : how === 'hit' ? 0.7 : 0;
    }
  });
}
