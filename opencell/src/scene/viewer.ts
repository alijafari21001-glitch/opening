// 3D workcell view: z-up, millimetres. Orbit (left drag), pan (right drag), zoom (wheel), Shift+drag moves the TCP.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Frame, Mat3, compose, invert, identity } from '../kin/math';
import { CellState } from '../state';
import { Jogger } from '../jog';
import { RobotMesh, triad, setFrame } from './robotMesh';
import { CellScene } from './cellScene';
import { matToWpr } from '../kin/math';
import { envelope, robotCapsules } from '../kin/envelope';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** One arm per robot in the cell; `robot` is the one the pendant works on. */
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private robots: { mesh: RobotMesh; modelId: string; root: THREE.Group }[] = [];
  private get robot() { return (this.robots[this.s.active] ?? this.robots[0]).mesh; }
  /** Called every update with the per-robot root groups (base + rail), for add-ons like the rail carriage. */
  onRobots: (roots: THREE.Group[]) => void = () => {};
  readonly cell = new CellScene();
  private objGizmo: TransformControls;
  snap = true;
  /** Called when the user picks an object in the view (null = clicked empty space). */
  onPick: (id: string | null) => void = () => {};
  /** Click on a robot arm (index), after objects. */
  onRobotPick: (i: number) => void = () => {};
  private tcpTriad = triad(70);
  private userTriad = triad(120);
  private floor = new THREE.Group();
  private floorKey = '';
  private env = new THREE.Group();
  /** Cell objects the robot or its tool currently touches (Show robot collisions). */
  colliding = new Set<string>();
  private hitKey = '';
  private envKey = '';
  private dragging = false;
  private dragPlane = new THREE.Plane();
  private dragTarget: THREE.Vector3 | null = null;
  private raycaster = new THREE.Raycaster();
  private gizmo: TransformControls;
  private proxy = new THREE.Object3D();
  private gizmoMode: 'off' | 'translate' | 'rotate' = 'translate';
  private trace: THREE.Line;
  private tracePts: number[] = [];
  traceOn = true;
  /** Set by main: true while a program runs (records the path trace). */
  isRunning = () => false;

  constructor(private host: HTMLElement, private s: CellState, private jog: Jogger) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xdfe4ea);
    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 50000);
    this.camera.position.set(1600, -1300, 900);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(250, 0, -100);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.6));
    const sun = this.sun;
    sun.position.set(1500, -800, 2500);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1500, right: 1500, top: 1500, bottom: -1500, near: 100, far: 6000 });
    this.scene.add(sun, sun.target);

    this.scene.add(this.floor, this.env, this.tcpTriad, this.userTriad);
    this.env.matrixAutoUpdate = false;
    this.tcpTriad.matrixAutoUpdate = this.userTriad.matrixAutoUpdate = false;
    const world = triad(150);
    this.scene.add(world);

    this.bindDrag();

    // Mouse jog: drag the TCP gizmo (like the robot jog tool of an offline simulator).
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.8);
    this.scene.add(this.proxy);
    this.gizmo.attach(this.proxy);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.syncProxy();
    });
    this.gizmo.addEventListener('objectChange', () => this.gizmoMoved());

    // Cell objects + their move gizmo.
    this.scene.add(this.cell.world);
    this.cell.onLoaded = () => this.update();
    this.objGizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.objGizmo.setSize(0.7);
    this.scene.add(this.objGizmo.getHelper());
    this.objGizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      const g = this.objGizmo.object;
      if (g) g.userData.dragging = e.value;
      if (!e.value) this.s.emit();
    });
    this.objGizmo.addEventListener('objectChange', () => this.objMoved());
    this.bindPick();

    // Path trace of the TCP while a program runs.
    this.trace = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd81b60 }));
    this.trace.frustumCulled = false;
    this.scene.add(this.trace);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private buildFloor(z: number) {
    this.floor.clear();
    const w = this.s.world, size = w.floorSize, step = Math.max(10, w.gridSpacing);
    const n = Math.max(1, Math.round(size / step));
    const grid = new THREE.GridHelper(n * step, n, w.gridColor, w.gridColor);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = z + 0.5;
    const gm = grid.material as THREE.Material;
    gm.transparent = true; gm.opacity = 0.7;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: w.floorColor, roughness: 0.9 }));
    plane.position.z = z;
    plane.receiveShadow = true;
    this.floor.add(plane, grid);
    // Big layouts (a whole factory floor) need a longer view distance.
    this.camera.far = Math.max(50000, size * 5);
    this.camera.updateProjectionMatrix();
    this.floorKey = JSON.stringify([w, z]);
  }

  /** Robot world frame in the cell for robot i, including its rail position. */
  armBase(i = this.s.active): Frame {
    const r = this.s.robots[i];
    return compose(this.s.baseFrame(i), { R: identity().R, p: [r.rail ? r.e[0] ?? 0 : 0, 0, 0] });
  }
  /** Active robot's world frame in the cell (no rail). */
  private worldF(): Frame { return this.s.baseFrame(this.s.active); }

  private syncModel() {
    const rs = this.s.robots;
    let changed = false;
    while (this.robots.length > rs.length) { const r = this.robots.pop()!; this.scene.remove(r.root); r.mesh.dispose(); changed = true; }
    rs.forEach((r, i) => {
      const cur = this.robots[i];
      if (cur && cur.modelId === r.model.id) return;
      if (cur) { this.scene.remove(cur.root); cur.mesh.dispose(); }
      const mesh = new RobotMesh(r.model);
      const root = new THREE.Group();
      root.matrixAutoUpdate = false;
      root.add(mesh.root);
      if (r.rail) { // carriage the robot rides on (its top is the robot's mounting surface)
        const k = r.model.a2 / 790, z = -r.model.baseZ;
        const mat = new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: 0.5, metalness: 0.4 });
        const cr = new THREE.Mesh(new THREE.BoxGeometry(900 * k, 700 * k, 110), mat);
        cr.position.z = z - 55;
        const mot = new THREE.Mesh(new THREE.CylinderGeometry(70 * k, 70 * k, 240 * k, 24), new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.45, metalness: 0.5 }));
        mot.position.set(480 * k, -280 * k, z - 30);
        cr.castShadow = mot.castShadow = true;
        root.add(cr, mot);
      }
      this.scene.add(root);
      this.robots[i] = { mesh, modelId: r.model.id, root };
      changed = true;
      if (cur && rs.length === 1) { // refit the camera to the new robot size
        const k = r.model.a2 / 330;
        this.controls.target.set(250 * k, 0, -100 * k);
        this.camera.position.set(1600 * k, -1300 * k, 900 * k);
      }
    });
    if (changed) this.cell.flanges = this.robots.map((r) => r.mesh.flange);
    const ek = `${this.s.active}:${this.s.model.id}`;
    if (ek !== this.envKey) { this.buildEnvelope(); this.envKey = ek; }
  }

  /** Faceplate group of robot i (things a gripper holds attach here). */
  flangeOf(i: number) { return this.robots[i]?.mesh.flange; }

  /** Floor height in the cell: below the first robot's mounting surface unless the cell sets it. */
  floorZ() { const r = this.s.robots[0]; return this.s.world.floorZ ?? r.base.z - r.model.baseZ; }

  /** Wrist-center work envelope: the radial profile swept over the J1 range. */
  private buildEnvelope() {
    this.env.clear();
    const e = envelope(this.s.model);
    const pts = e.profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 0.01), z));
    const a0 = e.j1[0] * Math.PI / 180, span = (e.j1[1] - e.j1[0]) * Math.PI / 180;
    // Lathe sweeps around +Y starting at +Z; turn it so it sweeps around world Z starting at J1 = lower limit.
    const lathe = new THREE.LatheGeometry(pts, 96, 0, span);
    lathe.rotateX(Math.PI / 2);
    lathe.rotateZ(a0 + Math.PI / 2);
    const shell = new THREE.Mesh(lathe, new THREE.MeshBasicMaterial({ color: 0x1f6fd1, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(lathe, 25), new THREE.LineBasicMaterial({ color: 0x1f6fd1, transparent: true, opacity: 0.35 }));
    // Outline in the J1 = 0 plane, both sides
    const outline = (sgn: number) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(e.profile.map(([r, z]) => new THREE.Vector3(sgn * r, 0, z))),
      new THREE.LineBasicMaterial({ color: 0x1f6fd1 }));
    this.env.add(shell, edges, outline(1), outline(-1));
    this.env.renderOrder = 5;
  }

  /** Robot links (capsules) and the active tool's bodies against every visible cell body. */
  private checkCollisions() {
    const hits = new Set<string>();
    const links = new Set<string>();
    const bodies = this.cell.bodies(this.s.objects);
    if (bodies.length) {
      const v = new THREE.Vector3();
      const B = this.armBase();
      const caps = robotCapsules(this.s.model, this.s.q).map((c) => ({ ...c, a: tp(B, c.a as V3), b: tp(B, c.b as V3) }));
      // tool bodies: a grid of points on each tool mesh's box
      const toolPts: THREE.Vector3[] = [];
      const t = this.s.shownTool(), ri = this.s.active;
      for (const o of this.s.objects) {
        if (o.role !== 'tool' || o.tool !== t || (o.robot ?? 0) !== ri || o.hidden) continue;
        this.cell.group(o.id)?.traverse((c) => {
          if (!(c instanceof THREE.Mesh) || !c.geometry) return;
          c.updateWorldMatrix(true, false);
          if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
          const bb = c.geometry.boundingBox!;
          for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++)
            toolPts.push(new THREE.Vector3(bb.min.x + (bb.max.x - bb.min.x) * i / 2, bb.min.y + (bb.max.y - bb.min.y) * j / 2, bb.min.z + (bb.max.z - bb.min.z) * k / 2).applyMatrix4(c.matrixWorld));
        });
      }
      for (const b of bodies) {
        const sc = new THREE.Vector3().setFromMatrixScale(b.m).x || 1;
        for (const c of caps) {
          const n = Math.max(2, Math.ceil(Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]) / 12));
          for (let i = 0; i <= n; i++) {
            v.set(c.a[0] + (c.b[0] - c.a[0]) * i / n, c.a[1] + (c.b[1] - c.a[1]) * i / n, c.a[2] + (c.b[2] - c.a[2]) * i / n).applyMatrix4(b.inv);
            if (b.box.distanceToPoint(v) * sc < c.r) { hits.add(b.id); links.add(c.name); break; }
          }
        }
        for (const p of toolPts) if (b.box.containsPoint(v.copy(p).applyMatrix4(b.inv))) { hits.add(b.id); links.add('tool'); break; }
      }
    }
    this.colliding = hits;
    this.robot.hit(links.size > 0);
    const key = [...hits].sort().join();
    if (key !== this.hitKey) {
      this.hitKey = key;
      if (hits.size) {
        this.s.collisionSeen = true;
        const names = [...new Set([...hits].map((id) => this.rootName(id)))];
        this.s.message('warn', `Collision: robot ${[...links].join(', ')} touches ${names.join(', ')}`);
      }
    }
  }
  /** Name of the top-level object (machine, fence...) an object belongs to. */
  private rootName(id: string) {
    let o = this.s.obj(id);
    while (o?.parent && this.s.obj(o.parent)) o = this.s.obj(o.parent);
    return o?.name ?? '?';
  }

  /** Tip of a tool's bodies in faceplate coordinates: XY center and the farthest Z. */
  toolTip(n: number): { x: number; y: number; z: number } | null {
    const fl = this.robot.flange;
    fl.updateWorldMatrix(true, true);
    const inv = fl.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    let any = false;
    for (const o of this.s.objects) {
      if (o.role !== 'tool' || o.tool !== n || (o.robot ?? 0) !== this.s.active) continue;
      const g = this.cell.group(o.id);
      if (!g) continue;
      g.updateWorldMatrix(true, true);
      g.traverse((c) => {
        if (!(c instanceof THREE.Mesh) || !c.geometry) return;
        c.geometry.computeBoundingBox();
        const bb = c.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        box.union(bb); any = true;
      });
    }
    if (!any) return null;
    const r = (v: number) => Math.round(v * 100) / 100;
    return { x: r((box.min.x + box.max.x) / 2), y: r((box.min.y + box.max.y) / 2), z: r(box.max.z) };
  }

  /** Attach the object gizmo to the selected cell object. */
  private syncObjGizmo() {
    const id = this.s.selectedObj;
    const g = id ? this.cell.group(id) : undefined;
    const o = this.s.obj(id);
    const locked = this.s.opts.lock && o?.role !== 'tool';
    if (g && o && this.gizmoMode !== 'off' && !locked) {
      if (this.objGizmo.object !== g) this.objGizmo.attach(g);
      this.objGizmo.setMode(this.gizmoMode);
      this.objGizmo.space = o.role === 'tool' ? 'local' : 'world';
      this.objGizmo.translationSnap = this.snap ? 10 : null;
      this.objGizmo.rotationSnap = this.snap ? Math.PI / 12 : null;
      this.objGizmo.getHelper().visible = true;
      this.objGizmo.enabled = true;
    } else {
      if (this.objGizmo.object) this.objGizmo.detach();
      this.objGizmo.getHelper().visible = false;
    }
    // The robot jog gizmo steps aside while an object is selected.
    const robotOn = this.gizmoMode !== 'off' && !g;
    this.gizmo.enabled = robotOn;
    this.gizmo.getHelper().visible = robotOn;
  }

  private objMoved() {
    const g = this.objGizmo.object;
    const o = this.s.obj(this.s.selectedObj);
    if (!g || !o) return;
    const m = new THREE.Matrix4().makeRotationFromQuaternion(g.quaternion).elements;
    const [w, p, r] = matToWpr([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]);
    const rd = (v: number) => Math.round(v * 1000) / 1000;
    o.pose = { x: rd(g.position.x), y: rd(g.position.y), z: rd(g.position.z), w: rd(w), p: rd(p), r: rd(r) };
  }

  /** Click (without dragging) on an object selects it; on empty space deselects. */
  private bindPick() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => { down = e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      if (this.objGizmo.dragging || this.gizmo.dragging || this.objGizmo.axis || this.gizmo.axis) return;
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const hits = this.raycaster.intersectObjects(this.cell.pickables(), true);
      const rh = this.raycaster.intersectObjects(this.robots.map((r) => r.root), true);
      if (rh.length && (!hits.length || rh[0].distance < hits[0].distance)) {
        const i = this.robots.findIndex((r) => { let o: THREE.Object3D | null = rh[0].object; while (o) { if (o === r.root) return true; o = o.parent; } return false; });
        if (i >= 0) { this.onRobotPick(i); return; }
      }
      this.onPick(hits.length ? this.cell.objectOf(hits[0].object) : null);
    });
  }

  setGizmo(mode: 'off' | 'translate' | 'rotate') {
    this.gizmoMode = mode;
    this.gizmo.enabled = mode !== 'off';
    this.gizmo.getHelper().visible = mode !== 'off';
    if (mode !== 'off') this.gizmo.setMode(mode);
    this.syncProxy();
    this.syncObjGizmo();
  }
  clearTrace() { this.tracePts = []; this.trace.geometry.setFromPoints([]); }

  /** Place the gizmo at the TCP, aligned with the current jog coordinate system. */
  private syncProxy() {
    if (this.gizmo.dragging) return;
    const W = this.worldF();
    const tcp = compose(W, this.s.tcpWorld());
    this.proxy.position.set(...tcp.p);
    let R: Mat3;
    const c = this.s.coord;
    if (this.gizmoMode === 'rotate' || c === 'TOOL') R = tcp.R;
    else if (c === 'USER') R = compose(W, this.s.userFrame()).R;
    else if (c === 'JGFRM') R = compose(W, this.s.jogFrameF()).R;
    else R = W.R;
    this.proxy.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1));
    this.gizmo.space = this.gizmoMode === 'rotate' && c !== 'TOOL' ? 'world' : 'local';
  }

  private gizmoMoved() {
    const why = this.jog.busy();
    const W = this.worldF();
    const tcp = compose(W, this.s.tcpWorld());
    let target: Frame;
    if (this.gizmoMode === 'translate') target = { R: tcp.R, p: [this.proxy.position.x, this.proxy.position.y, this.proxy.position.z] };
    else {
      const m = new THREE.Matrix4().makeRotationFromQuaternion(this.proxy.quaternion).elements; // column-major
      target = { R: [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]], p: tcp.p };
    }
    if (why || !this.jog.moveTo(compose(invert(W), target))) {
      if (why) this.s.message('warn', why);
      this.gizmo.dragging = false;
      this.controls.enabled = true;
      this.syncProxy();
    }
  }

  /** Push current state into the scene. */
  update() {
    this.syncModel();
    if (this.floorKey !== JSON.stringify([this.s.world, this.floorZ()])) this.buildFloor(this.floorZ());
    this.s.robots.forEach((r, i) => {
      const it = this.robots[i];
      setFrame(it.root, this.armBase(i));
      it.mesh.update(r.q);
    });
    this.onRobots(this.robots.map((r) => r.root));
    setFrame(this.env, this.armBase());
    this.cell.grip = this.s.robots.map((r) => !!(r.grip && this.s.io[r.grip.port]?.[r.grip.idx]));
    const shown = this.s.robots.map((_, i) => this.s.shownTool(i));
    this.cell.sync(this.s.objects, shown, this.s.selectedObj, this.colliding);
    if (this.s.opts.collisions) this.checkCollisions();
    else if (this.colliding.size || this.hitKey) { this.colliding = new Set(); this.hitKey = ''; this.robot.hit(false); }
    this.cell.sync(this.s.objects, shown, this.s.selectedObj, this.colliding);
    this.env.visible = this.s.opts.envelope;
    this.tcpTriad.visible = this.s.opts.teachTool;
    this.syncObjGizmo();
    const W = this.worldF();
    setFrame(this.tcpTriad, compose(W, this.s.tcpWorld()));
    setFrame(this.userTriad, compose(W, this.s.userFrame()));
    this.userTriad.visible = this.s.uframe !== 0;
    this.syncProxy();
    if (this.traceOn && this.isRunning()) {
      const p = compose(W, this.s.tcpWorld()).p;
      const n = this.tracePts.length;
      if (n < 3 || Math.hypot(p[0] - this.tracePts[n - 3], p[1] - this.tracePts[n - 2], p[2] - this.tracePts[n - 1]) > 1) {
        this.tracePts.push(...p);
        if (this.tracePts.length > 60000) this.tracePts.splice(0, 3);
        this.trace.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.tracePts, 3));
      }
    }
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.controls.update();
    if (this.s.world.floorSize > 10000) { // big layouts: shadows follow the point the camera looks at
      const t = this.controls.target, d = Math.min(9000, Math.max(2500, this.camera.position.distanceTo(t) * 0.5));
      this.sun.target.position.copy(t);
      this.sun.position.set(t.x + d * 0.6, t.y - d * 0.35, t.z + d);
      const c = this.sun.shadow.camera;
      if (c.right !== d) { Object.assign(c, { left: -d, right: d, top: d, bottom: -d, near: 10, far: d * 4 }); c.updateProjectionMatrix(); }
    }
    if (this.dragTarget) {
      const W = this.worldF();
      const tcp = compose(W, this.s.tcpWorld());
      this.jog.moveTo(compose(invert(W), { R: tcp.R, p: [this.dragTarget.x, this.dragTarget.y, this.dragTarget.z] }));
      this.dragTarget = null;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** Shift+drag: move the TCP in the plane facing the camera, keeping orientation. */
  private bindDrag() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!e.shiftKey || e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const p = compose(this.worldF(), this.s.tcpWorld()).p;
      const n = new THREE.Vector3();
      this.camera.getWorldDirection(n);
      this.dragPlane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...p));
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    }, { capture: true });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      e.stopImmediatePropagation();
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dragPlane, hit)) this.dragTarget = hit;
    }, { capture: true });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = '';
    };
    el.addEventListener('pointerup', end, { capture: true });
    el.addEventListener('pointercancel', end, { capture: true });
  }

  /** Point the camera at a target from a position. */
  frame(target: [number, number, number], from: [number, number, number]) {
    this.controls.target.set(...target);
    this.camera.position.set(...from);
  }

  /** Camera presets. */
  view(which: 'iso' | 'top' | 'front' | 'side') {
    const t = this.controls.target;
    const d = 2400;
    const pos: Record<string, [number, number, number]> = {
      iso: [t.x + 1350, t.y - 1550, t.z + 1000], top: [t.x, t.y - 0.01, t.z + d],
      front: [t.x + d, t.y, t.z], side: [t.x, t.y - d, t.z],
    };
    this.camera.position.set(...pos[which]);
  }
}

/** Transform a point by a frame. */
type V3 = [number, number, number];
function tp(f: Frame, v: V3): V3 {
  const R = f.R;
  return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + f.p[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + f.p[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + f.p[2]];
}
