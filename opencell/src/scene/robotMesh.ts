// Shaded geometry for a 6-axis arm, built from the kinematic parameters (no vendor meshes).
// Shaped side plates, motor housings, a cast-style base, a forked wrist, a bolted flange and a cable hose,
// laid out like a small offset-arm industrial robot. Sizes scale with the upper-arm length.
import * as THREE from 'three';
import { Frame } from '../kin/math';
import { RobotModel, Joints, linkFrames, LinkFrames } from '../kin/robot';

const ARM = new THREE.MeshStandardMaterial({ color: 0xf0c419, roughness: 0.38, metalness: 0.08 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.55, metalness: 0.35 });
const MOTOR = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.45, metalness: 0.5 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0xa9b1ba, roughness: 0.3, metalness: 0.8 });
const HOSE = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.0 });

export function setFrame(o: THREE.Object3D, f: Frame) {
  const R = f.R, p = f.p;
  o.matrix.set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
  o.matrixWorldNeedsUpdate = true;
}

const shadow = <T extends THREE.Mesh>(m: T) => { m.castShadow = m.receiveShadow = true; return m; };

/** Cylinder between two local points. */
export function cyl(r: number, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, mat: THREE.Material, seg = 32, r2 = r) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return shadow(m);
}
export function box(sx: number, sy: number, sz: number, c: THREE.Vector3Tuple, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(...c);
  return shadow(m);
}

/** Convex outline around two circles (a tapered "stadium"), as 2D points. */
function hull2(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, seg = 28): THREE.Vector2[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([x0 + r0 * Math.cos(a), y0 + r0 * Math.sin(a)], [x1 + r1 * Math.cos(a), y1 + r1 * Math.sin(a)]);
  }
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)].map(([x, y]) => new THREE.Vector2(x, y));
}

/** Extruded plate from a 2D outline with rounded (bevelled) edges, centered on its thickness. */
function plate(outline: THREE.Vector2[], thick: number, mat: THREE.Material, bevel = 6) {
  const b = Math.min(bevel, thick / 3);
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: thick - 2 * b, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(thick - 2 * b) / 2);
  g.computeVertexNormals();
  return shadow(new THREE.Mesh(g, mat));
}

/** Map a plate's local axes (outline u, v; thickness w) onto link axes. */
function orient(m: THREE.Mesh, u: THREE.Vector3Tuple, v: THREE.Vector3Tuple, w: THREE.Vector3Tuple, at: THREE.Vector3Tuple = [0, 0, 0]) {
  m.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...w)).setPosition(...at));
  return m;
}

/** Rounded-corner rectangle outline. */
function roundRect(w: number, h: number, r: number): THREE.Vector2[] {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s.getPoints(6);
}

/** Motor: dark can with a yellow end cap and a connector box, along a local axis. */
function motor(r: number, a: THREE.Vector3Tuple, b: THREE.Vector3Tuple) {
  const g = new THREE.Group();
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va);
  const capA = vb.clone().sub(d.clone().multiplyScalar(0.12));
  g.add(cyl(r, a, capA.toArray() as THREE.Vector3Tuple, MOTOR, 32));
  g.add(cyl(r * 1.02, capA.toArray() as THREE.Vector3Tuple, b, ARM, 32));
  const mid = va.clone().add(d.clone().multiplyScalar(0.45));
  // connector box on the side away from the axis plane
  const side = Math.abs(d.z) > Math.abs(d.x) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const c = box(r * 0.7, r * 0.7, r * 0.7, mid.clone().add(side.multiplyScalar(r * 0.95)).toArray() as THREE.Vector3Tuple, DARK);
  g.add(c);
  return g;
}

type LinkName = keyof LinkFrames;
const LINKS: LinkName[] = ['base', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'flange'];

export class RobotMesh {
  readonly root = new THREE.Group();
  private links = new Map<LinkName, THREE.Group>();
  private hose: THREE.Mesh;
  private k: number;

  constructor(private m: RobotModel) {
    this.k = m.a2 / 330;
    for (const n of LINKS) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.name = n;
      this.links.set(n, g);
      this.root.add(g);
    }
    this.hose = shadow(new THREE.Mesh(new THREE.BufferGeometry(), HOSE));
    this.hose.frustumCulled = false;
    this.root.add(this.hose);
    this.build();
  }

  private build() {
    const m = this.m, k = this.k;
    const L = (n: LinkName) => this.links.get(n)!;
    const H = m.baseZ;
    const X: THREE.Vector3Tuple = [1, 0, 0], Y: THREE.Vector3Tuple = [0, 1, 0], Z: THREE.Vector3Tuple = [0, 0, 1];
    const nY: THREE.Vector3Tuple = [0, -1, 0];

    // ---- Fixed base (frame at the mounting surface) ----
    const foot = plate(roundRect(210 * k, 210 * k, 24 * k), 14, DARK, 3);
    foot.position.z = 7;
    L('base').add(foot);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      L('base').add(cyl(7 * k, [sx * 82 * k, sy * 82 * k, 14], [sx * 82 * k, sy * 82 * k, 22], STEEL, 6));
    }
    const prof = [[0, 14], [100 * k, 14], [100 * k, 26], [94 * k, 34], [88 * k, 0.4 * H], [84 * k, 0.43 * H], [0, 0.43 * H]].map(([r, z]) => new THREE.Vector2(r, z));
    L('base').add(shadow(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), ARM)).rotateX(Math.PI / 2));
    // J1 motor at the back of the base
    L('base').add(motor(30 * k, [-70 * k, 0, 0.12 * H], [-70 * k, 0, 0.42 * H]));

    // ---- J1 turret (frame at J2 height on the J1 axis) ----
    L('j1').add(cyl(84 * k, [0, 0, -0.58 * H], [0, 0, -0.45 * H], DARK, 48));      // J1 bearing ring
    L('j1').add(cyl(82 * k, [0, 0, -0.45 * H], [0, 0, -0.22 * H], ARM, 48, 76 * k));
    // shoulder: from the turret up and forward to the J2 axis, on the -Y side of the arm
    L('j1').add(orient(plate(hull2(0, -0.28 * H, 78 * k, m.a1, 0, 66 * k), 130 * k, ARM, 10), X, Z, nY, [0, -15 * k, 0]));
    // J2 motor sticks out of the shoulder on -Y
    L('j1').add(motor(36 * k, [m.a1, -80 * k, 0], [m.a1, -150 * k, 0]));

    // ---- Upper arm (frame at J2, arm along +Z), plate beside the shoulder on +Y ----
    const ua = orient(plate(hull2(0, 0, 60 * k, m.a2, 0, 50 * k), 70 * k, ARM, 9), Z, X, Y, [0, 90 * k, 0]);
    L('j2').add(ua);
    L('j2').add(cyl(54 * k, [0, 50 * k, 0], [0, 128 * k, 0], ARM, 40));            // J2 hub
    L('j2').add(cyl(40 * k, [0, 125 * k, 0], [0, 133 * k, 0], DARK, 40));          // reducer cover
    // stiffening rib on the outer face
    L('j2').add(orient(plate(hull2(0, 0, 22 * k, m.a2, 0, 18 * k), 8 * k, ARM, 3), Z, X, Y, [0, 128 * k, 0]));

    // ---- Forearm housing (frame at J3; J4 axis along X at height a3) ----
    L('j3').add(cyl(50 * k, [0, 55 * k, 0], [0, 128 * k, 0], ARM, 40));            // J3 hub on the upper arm side
    L('j3').add(cyl(38 * k, [0, 125 * k, 0], [0, 133 * k, 0], DARK, 40));
    L('j3').add(orient(plate(hull2(-30 * k, 0, 56 * k, 0.2 * m.d4, m.a3, 48 * k), 120 * k, ARM, 10), X, Z, nY, [0, 0, 0]));
    // J3 motor points backwards along the forearm axis
    L('j3').add(motor(30 * k, [-50 * k, 0, m.a3], [-125 * k, 0, m.a3]));
    // J4 bearing ring where the tube leaves the housing
    L('j3').add(cyl(46 * k, [0.2 * m.d4 + 40 * k, 0, m.a3], [0.2 * m.d4 + 52 * k, 0, m.a3], DARK, 40));

    // ---- Forearm tube + wrist fork (J4 frame, rotates about X) ----
    L('j4').add(cyl(40 * k, [0.2 * m.d4 + 50 * k, 0, 0], [m.d4 - 70 * k, 0, 0], ARM, 40, 34 * k));
    L('j4').add(cyl(36 * k, [m.d4 - 72 * k, 0, 0], [m.d4 - 58 * k, 0, 0], DARK, 40));
    for (const s of [-1, 1]) {
      L('j4').add(orient(plate(hull2(m.d4 - 62 * k, 0, 33 * k, m.d4, 0, 29 * k), 13 * k, ARM, 4), X, Z, nY, [0, s * 38 * k, 0]));
    }

    // ---- J5 knuckle (frame at the wrist center, flange along +X) ----
    L('j5').add(cyl(27 * k, [0, -31 * k, 0], [0, 31 * k, 0], DARK, 32));
    L('j5').add(cyl(29 * k, [0, 31 * k, 0], [0, 46 * k, 0], ARM, 32));            // J5 cover on the fork
    L('j5').add(cyl(29 * k, [0, -46 * k, 0], [0, -31 * k, 0], ARM, 32));
    L('j5').add(orient(plate(hull2(0, 0, 28 * k, m.d6 - 22, 0, 25 * k), 48 * k, ARM, 6), X, Z, nY));

    // ---- J6 flange (rotates about the flange axis) ----
    L('j6').add(cyl(24 * k, [m.d6 - 22, 0, 0], [m.d6 - 6, 0, 0], DARK, 40));
    L('j6').add(cyl(25 * k, [m.d6 - 6, 0, 0], [m.d6, 0, 0], STEEL, 40));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2, r = 15.5 * k;
      L('j6').add(cyl(2.6, [m.d6 - 0.5, r * Math.cos(a), r * Math.sin(a)], [m.d6 + 0.3, r * Math.cos(a), r * Math.sin(a)], MOTOR, 10));
    }
    L('j6').add(cyl(2.5, [m.d6, 0, 10 * k], [m.d6 + 4, 0, 10 * k], STEEL, 10));      // locating pin: shows J6 rotation
  }

  /** Group whose transform follows the faceplate (tools attach here; +Z out of the flange). */
  get flange() { return this.links.get('flange')!; }

  update(q: Joints) {
    const f = linkFrames(this.m, q);
    for (const n of LINKS) setFrame(this.links.get(n)!, f[n]);
    this.updateHose(f);
  }

  /** Cable hose from the back of the base, over the shoulder, along the upper arm to the J3 motor. */
  private updateHose(f: LinkFrames) {
    const m = this.m, k = this.k, H = m.baseZ;
    const at = (fr: Frame, x: number, y: number, z: number) => {
      const R = fr.R;
      return new THREE.Vector3(R[0] * x + R[1] * y + R[2] * z + fr.p[0], R[3] * x + R[4] * y + R[5] * z + fr.p[1], R[6] * x + R[7] * y + R[8] * z + fr.p[2]);
    };
    const pts = [
      at(f.base, -95 * k, 40 * k, 0.3 * H),
      at(f.j1, -95 * k, 45 * k, -0.2 * H),
      at(f.j1, -60 * k, 90 * k, 0.02 * H),
      at(f.j2, -62 * k, 140 * k, 0.35 * m.a2),
      at(f.j2, -58 * k, 140 * k, 0.75 * m.a2),
      at(f.j3, -95 * k, 70 * k, m.a3 + 25 * k),
      at(f.j3, -110 * k, 20 * k, m.a3 + 25 * k),
    ];
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 64, 9 * k, 10, false);
    this.hose.geometry.dispose();
    this.hose.geometry = g;
  }

  /** Tint the arm red while it collides with something. */
  hit(on: boolean) {
    ARM.emissive.setHex(on ? 0xff1a1a : 0x000000);
    ARM.emissiveIntensity = on ? 0.6 : 0;
  }

  dispose() {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}

/** RGB axis triad (X red, Y green, Z blue). */
export function triad(size = 80, lw = 1) {
  const g = new THREE.Group();
  const cols = [0xe53935, 0x43a047, 0x1e88e5];
  const dirs: THREE.Vector3Tuple[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  dirs.forEach((d, i) => {
    const mat = new THREE.LineBasicMaterial({ color: cols[i], linewidth: lw, depthTest: false });
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...d).multiplyScalar(size)]);
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 10;
    g.add(line);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size * 0.06, size * 0.18, 12), new THREE.MeshBasicMaterial({ color: cols[i], depthTest: false }));
    cone.position.set(...(d.map((v) => v * size) as THREE.Vector3Tuple));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d));
    cone.renderOrder = 10;
    g.add(cone);
  });
  return g;
}
