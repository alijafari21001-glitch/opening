// Animated people for the production line: a jointed figure (hard hat, hi-vis vest) that walks, carries, reaches, works or sits.
// Millimetres, z up; the figure faces +X of its root, feet on the root's z = 0.
import * as THREE from 'three';

export type WorkerPose = 'stand' | 'walk' | 'carry' | 'reach' | 'work' | 'seated' | 'carrywalk';

const mats = new Map<string, THREE.MeshStandardMaterial>();
const mat = (c: string, rough = 0.7) => {
  const k = `${c}:${rough}`;
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.02 }));
  return mats.get(k)!;
};

function capsule(r: number, len: number, m: THREE.Material) {
  const g = new THREE.CapsuleGeometry(r, Math.max(1, len - 2 * r), 4, 10);
  g.rotateX(Math.PI / 2);       // along z
  g.translate(0, 0, -len / 2);  // hangs down from its joint
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}
function boxM(sx: number, sy: number, sz: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
}

export interface WorkerLook { vest?: string; shirt?: string; pants?: string; hat?: string; skin?: string }

export class Worker {
  readonly root = new THREE.Group();
  /** Things the worker carries hang here (in front of the chest, about elbow height). */
  readonly hands = new THREE.Group();
  pose: WorkerPose = 'stand';
  /** Walk speed in mm/s (drives the gait while walking). */
  speed = 0;
  private body = new THREE.Group();
  private hip: THREE.Group[] = [];
  private knee: THREE.Group[] = [];
  private sh: THREE.Group[] = [];
  private el: THREE.Group[] = [];
  private torso = new THREE.Group();
  private phase = Math.random() * 6;
  private t = Math.random() * 10;

  constructor(look: WorkerLook = {}) {
    const vest = mat(look.vest ?? '#f28c28', 0.6), shirt = mat(look.shirt ?? '#3d5a80'), pants = mat(look.pants ?? '#27313d');
    const skin = mat(look.skin ?? '#d9a982', 0.8), hat = mat(look.hat ?? '#f2c418', 0.35), boot = mat('#1b1b1b');
    const stripe = mat('#e8eef2', 0.3);
    this.root.add(this.body);
    this.body.position.z = 930;
    // legs
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0, s * 95, 0);
      hip.add(capsule(68, 450, pants));
      const knee = new THREE.Group(); knee.position.z = -440; hip.add(knee);
      knee.add(capsule(58, 430, pants));
      knee.add(boxM(250, 105, 70, boot, 55, 0, -455));
      this.body.add(hip); this.hip.push(hip); this.knee.push(knee);
    }
    // torso (pivots at the hips so it can lean)
    this.body.add(this.torso);
    this.torso.add(boxM(210, 330, 140, pants, 0, 0, 40));             // belt / hips
    this.torso.add(boxM(230, 360, 420, vest, 0, 0, 300));             // vest
    this.torso.add(boxM(234, 364, 40, stripe, 0, 0, 250));            // reflective band
    this.torso.add(boxM(234, 364, 40, stripe, 0, 0, 380));
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(45, 50, 80, 12), skin); neck.rotation.x = Math.PI / 2; neck.position.z = 545; this.torso.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(105, 20, 14), skin); head.scale.set(1, 0.92, 1.1); head.position.z = 665; this.torso.add(head);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(122, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat); dome.rotation.x = Math.PI / 2; dome.position.z = 705; this.torso.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 12, 24), hat); brim.rotation.x = Math.PI / 2; brim.position.set(25, 0, 705); this.torso.add(brim);
    for (const o of [neck, head, dome, brim]) o.castShadow = true;
    // arms
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0, s * 215, 470);
      sh.add(capsule(50, 300, shirt));
      const el = new THREE.Group(); el.position.z = -290; sh.add(el);
      el.add(capsule(44, 260, shirt));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(45, 10, 8), skin); hand.position.z = -285; el.add(hand);
      this.torso.add(sh); this.sh.push(sh); this.el.push(el);
    }
    this.hands.position.set(330, 0, 1080);
    this.root.add(this.hands);
  }

  /** Place the worker: layout mm, heading in radians (0 = facing +X). */
  place(x: number, y: number, h: number, z = 0) { this.root.position.set(x, y, z); this.root.rotation.z = h; }

  update(dt: number) {
    this.t += dt;
    const walking = this.pose === 'walk' || this.pose === 'carrywalk';
    if (walking) this.phase += (Math.max(300, this.speed) * dt) / 700 * Math.PI;
    const sw = walking ? Math.sin(this.phase) : 0;
    const cw = walking ? Math.cos(this.phase) : 0;
    let hipA = [sw * 0.45, -sw * 0.45], kneeA = [Math.max(0, -cw) * 0.7, Math.max(0, cw) * 0.7];
    let shA = [-sw * 0.35, sw * 0.35], elA = [-0.25, -0.25], lean = 0, bodyZ = 930 + (walking ? Math.abs(cw) * 18 : 0);
    const breathe = Math.sin(this.t * 1.7) * 0.03;
    switch (this.pose) {
      case 'stand': shA = [0.05 + breathe, 0.05 - breathe]; elA = [-0.15, -0.15]; break;
      case 'carry': case 'carrywalk': shA = [-0.55, -0.55]; elA = [-1.0, -1.0]; lean = -0.04; break;
      case 'reach': shA = [-1.15, -1.15]; elA = [-0.35, -0.35]; lean = 0.22; break;
      case 'work': {
        const a = Math.sin(this.t * 3.1), b = Math.sin(this.t * 2.3 + 1);
        shA = [-0.75 + 0.18 * a, -0.7 + 0.18 * b]; elA = [-0.9 + 0.3 * b, -0.85 + 0.3 * a]; lean = 0.18;
        break;
      }
      case 'seated': hipA = [1.5, 1.5]; kneeA = [1.45, 1.45]; shA = [-0.7, -0.7]; elA = [-0.6, -0.6]; bodyZ = 520; break;
    }
    this.body.position.z = bodyZ;
    this.torso.rotation.y = lean;
    for (let i = 0; i < 2; i++) {
      this.hip[i].rotation.y = -hipA[i];
      this.knee[i].rotation.y = kneeA[i];
      this.sh[i].rotation.y = shA[i];
      this.el[i].rotation.y = elA[i];
    }
    this.hands.position.set(this.pose === 'reach' ? 560 : 360, 0, this.pose === 'seated' ? 700 : this.pose === 'reach' ? 1150 : 1060);
  }
}

/** Walks a worker along way points (layout mm) at `speed` mm/s; `done` once the last point is reached. */
export class Walk {
  private i = 0;
  done = false;
  constructor(private w: Worker, private pts: [number, number][], private speed = 1250, private carrying = false) {
    if (!pts.length) this.done = true;
  }
  step(dt: number) {
    if (this.done) return;
    const r = this.w.root;
    let left = this.speed * dt;
    while (left > 0 && this.i < this.pts.length) {
      const [tx, ty] = this.pts[this.i];
      const dx = tx - r.position.x, dy = ty - r.position.y, d = Math.hypot(dx, dy);
      if (d < 1) { this.i++; continue; }
      const want = Math.atan2(dy, dx);
      let dh = want - r.rotation.z;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const turn = 4 * dt;
      r.rotation.z += Math.max(-turn, Math.min(turn, dh));
      if (Math.abs(dh) > 1.2) break; // turn on the spot first
      const k = Math.min(d, left);
      r.position.x += (dx / d) * k; r.position.y += (dy / d) * k;
      left -= k;
    }
    if (this.i >= this.pts.length) this.done = true;
    this.w.pose = this.done ? (this.carrying ? 'carry' : 'stand') : this.carrying ? 'carrywalk' : 'walk';
    this.w.speed = this.speed;
  }
}

/** Turn a worker toward a heading; returns true when facing it. */
export function face(w: Worker, h: number, dt: number) {
  let dh = h - w.root.rotation.z;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  const turn = 3.5 * dt;
  w.root.rotation.z += Math.max(-turn, Math.min(turn, dh));
  return Math.abs(dh) < 0.05;
}
