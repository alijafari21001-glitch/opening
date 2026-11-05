// PL-01 line simulation: everything around the two robots that moves. Works in layout coordinates (mm from the slab corner)
// inside one group shifted by PL01_ORIGIN. The robots stay real OpenCell robots run by their TP programs; this module is the
// "line PLC": it feeds cases and blanks, answers the robots' I/O, and moves pallets, the forklift, the wrapper, doors and people.
import * as THREE from 'three';
import { CellState } from '../state';
import { compose } from '../kin/math';
import { PL01_ORIGIN } from '../cell/productionLine';
import { getMesh } from '../cell/meshStore';
import { parseMesh } from '../scene/cellScene';
import { Worker, WorkerLook, Walk, face } from './worker';
import { CASE, PALLET, BLANK, VMC_X } from '../labs/pl01';

type V2 = [number, number];
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------ materials and simple bodies

const M = {
  card: new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.85 }),
  tape: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.4 }),
  label: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 }),
  wood2: new THREE.MeshStandardMaterial({ color: 0x9c7848, roughness: 0.9 }),
  blank: new THREE.MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.5, metalness: 0.6 }),
  done: new THREE.MeshStandardMaterial({ color: 0xdfe7ee, roughness: 0.18, metalness: 0.9 }),
  pocket: new THREE.MeshStandardMaterial({ color: 0x59626b, roughness: 0.3, metalness: 0.8 }),
  door: new THREE.MeshStandardMaterial({ color: 0xb9c2cb, roughness: 0.45, metalness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x6f8aa3, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.9 }),
  handle: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.4, metalness: 0.6 }),
  film: new THREE.MeshStandardMaterial({ color: 0xeaf4ff, roughness: 0.15, transparent: true, opacity: 0.38, depthWrite: false }),
  table: new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.6, metalness: 0.3 }),
  carriage: new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: 0.5, metalness: 0.4 }),
  roll: new THREE.MeshStandardMaterial({ color: 0xf5f8fb, roughness: 0.3 }),
  tote: new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.6 }),
};
const lamp = (c: number) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0, roughness: 0.4 });

function box(sx: number, sy: number, sz: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  b.position.set(x, y, z);
  b.castShadow = b.receiveShadow = true;
  return b;
}
function cyl(d: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 32) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, h, seg), m);
  c.rotation.x = Math.PI / 2;
  c.position.set(x, y, z);
  c.castShadow = c.receiveShadow = true;
  return c;
}

/** A shipping case: origin at its centre, 600 along local X. */
class Case {
  readonly g = new THREE.Group();
  private tapeM: THREE.Mesh;
  private labelM: THREE.Mesh;
  sealed = false; labeled = false;
  constructor() {
    this.g.add(box(CASE.l, CASE.w, CASE.h, M.card));
    this.tapeM = box(CASE.l + 4, 60, 3, M.tape, 0, 0, CASE.h / 2 + 1);
    this.labelM = box(150, 3, 100, M.label, 0, -CASE.w / 2 - 2, 40);
    this.tapeM.visible = this.labelM.visible = false;
    this.g.add(this.tapeM, this.labelM);
  }
  seal() { this.sealed = true; this.tapeM.visible = true; }
  label() { this.labeled = true; this.labelM.visible = true; }
}

/** 48 x 40 in pallet: origin at the bottom centre, 1219 along local Y. */
function palletMesh() {
  const g = new THREE.Group();
  for (const x of [-450, 0, 450]) g.add(box(90, PALLET.l, 108, M.wood2, x, 0, 16 + 54));
  for (let i = 0; i < 7; i++) g.add(box(PALLET.w, 110, 16, M.wood, 0, -PALLET.l / 2 + 55 + i * (PALLET.l - 110) / 6, PALLET.h - 8));
  for (const y of [-PALLET.l / 2 + 55, 0, PALLET.l / 2 - 55]) g.add(box(PALLET.w, 110, 16, M.wood, 0, y, 8));
  return g;
}

// ------------------------------------------------------------------ conveyor paths

/** Polyline / arc path in the floor plane with a constant height. */
class Path {
  private segs: { kind: 'line'; a: V2; b: V2; len: number }[] | { kind: 'arc'; c: V2; r: number; a0: number; a1: number; len: number }[] = [];
  readonly len: number;
  constructor(parts: ({ line: [V2, V2] } | { arc: { c: V2; r: number; a0: number; a1: number } })[]) {
    const segs: ({ kind: 'line'; a: V2; b: V2; len: number } | { kind: 'arc'; c: V2; r: number; a0: number; a1: number; len: number })[] = [];
    for (const p of parts) {
      if ('line' in p) segs.push({ kind: 'line', a: p.line[0], b: p.line[1], len: Math.hypot(p.line[1][0] - p.line[0][0], p.line[1][1] - p.line[0][1]) });
      else segs.push({ kind: 'arc', ...p.arc, len: Math.abs(p.arc.a1 - p.arc.a0) * p.arc.r });
    }
    this.segs = segs as typeof this.segs;
    this.len = segs.reduce((s, x) => s + x.len, 0);
  }
  /** Point and heading at distance s. */
  at(s: number): { x: number; y: number; h: number } {
    for (const g of this.segs as ({ kind: 'line'; a: V2; b: V2; len: number } | { kind: 'arc'; c: V2; r: number; a0: number; a1: number; len: number })[]) {
      if (s <= g.len || g === this.segs[this.segs.length - 1]) {
        const k = g.len ? Math.min(1, Math.max(0, s / g.len)) : 0;
        if (g.kind === 'line') return { x: g.a[0] + (g.b[0] - g.a[0]) * k, y: g.a[1] + (g.b[1] - g.a[1]) * k, h: Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]) };
        const a = g.a0 + (g.a1 - g.a0) * k, dir = Math.sign(g.a1 - g.a0);
        return { x: g.c[0] + g.r * Math.cos(a), y: g.c[1] + g.r * Math.sin(a), h: a + dir * Math.PI / 2 };
      }
      s -= g.len;
    }
    return { x: 0, y: 0, h: 0 };
  }
}


interface Belt { name: string; path: Path; next?: Belt; feeds?: Belt; cases: { c: Case; s: number }[]; claim?: boolean }

const BELT_Z = 800;
const GAP = 120;
const BELT_V = 450;
const BRANCH_X = [22000, 24500, 27000, 29500]; // centre lines of the four packing conveyors (rollers x 21600-22400 etc.)

// ------------------------------------------------------------------ pallets, machines, forklifts

interface Pallet { g: THREE.Group; line: number; x: number; y: number; state: 'in' | 'station' | 'out' | 'end' | 'xfer' | 'moved'; cases: number; wrapped: boolean; since: number }
interface Part { g: THREE.Group; done: boolean; pocket: THREE.Mesh; body: THREE.Mesh }
interface Vmc { x: number; door: THREE.Group; open: number; opening: THREE.Mesh; running: number; start: boolean; part: Part | null; lamps: THREE.MeshStandardMaterial[] }

const LINE_X = [32500, 36500];
/** Pallets: dispenser, palletizing station, end of line where the cross transfer to the wrapper starts. */
const DISP_Y = 17150, STATION_Y = 11500, XFER_Y = 3050, PAL_Z = 520, PAL_V = 320;
/** The stretch wrapper sits between the two pallet lines, on the cross transfer both lines feed. */
const TURN_C: V2 = [34500, XFER_Y];
const SHIP: V2[] = [[17000, 1300], [18600, 1300], [20200, 1300], [21800, 1300]];
const SUPPLY: V2 = [28400, 1300];
const TRAILER_X = 14800, TRAILER_Y = -300, TRAILER_CAP = 16;
const DISP_Z = PAL_Z + PALLET.h + 90;
const FORK_BODY = 1250; // fork heel -> middle of the truck
const UP = Math.PI / 2;
/** Finished parts ride back to the packers on this belt (layout mm). */
const RET_Z = 850, RET_V = 380, RET_PITCH = 240;
const RET_PATH: V2[] = [[11300, 18350], [20800, 18350], [20800, 24600], [30900, 24600]];

type Cmd = { k: 'goto'; x: number; y: number; h: number; rev?: boolean } | { k: 'lift'; z: number | (() => number) } | { k: 'wait'; until: () => boolean } | { k: 'do'; f: () => void };

class Forklift {
  readonly g = new THREE.Group();
  readonly lift = new THREE.Group();
  readonly driver: Worker;
  x: number; y: number; h: number; z = 0;
  q: Cmd[] = [];
  load: THREE.Object3D | null = null;
  constructor(readonly name: string, readonly home: [number, number, number], color: number, look: WorkerLook) {
    [this.x, this.y, this.h] = home;
    this.driver = new Worker(look);
    this.g.add(this.lift);
    this.driver.pose = 'seated';
    this.driver.place(-1260, 0, 0, 640);
    this.g.add(this.driver.root);
    this.g.userData.forklift = name;
    Promise.all([getMesh('page:pl01-forklift_body'), getMesh('page:pl01-forklift_lift')]).then(async ([b, l]) => {
      const add = async (d: ArrayBuffer | undefined, to: THREE.Group, c: number) => {
        if (!d) return;
        const o = await parseMesh(d, 'stl');
        o.traverse((m) => { if (m instanceof THREE.Mesh) { m.material = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.25 }); m.castShadow = true; } });
        to.add(o);
      };
      await add(b, this.g, color);
      await add(l, this.lift, 0x2b2f33);
    });
    this.sync();
  }
  get busy() { return this.q.length > 0; }
  sync() {
    this.g.position.set(this.x, this.y, 0);
    this.g.rotation.z = this.h;
    this.lift.position.z = this.z;
  }
  goHome() { if (Math.hypot(this.x - this.home[0], this.y - this.home[1]) > 5 || Math.abs(wrapA(this.h - this.home[2])) > 0.01) this.q.push({ k: 'lift', z: 0 }, { k: 'goto', x: this.home[0], y: this.home[1], h: this.home[2] }); }
  /** Run the command queue for dt seconds. */
  tick(dt: number) {
    let left = dt;
    while (left > 1e-6 && this.q.length) {
      const c = this.q[0];
      if (c.k === 'do') { c.f(); this.q.shift(); continue; }
      if (c.k === 'wait') { if (c.until()) { this.q.shift(); continue; } break; }
      if (c.k === 'lift') {
        const z = typeof c.z === 'function' ? c.z() : c.z;
        const d = z - this.z, v = 450 * left;
        if (Math.abs(d) <= v) { left -= Math.abs(d) / 450; this.z = z; this.q.shift(); } else { this.z += Math.sign(d) * v; left = 0; }
        continue;
      }
      // goto: turn toward the path, drive, turn to the final heading (rotating about the middle of the truck)
      const cx = this.x - FORK_BODY * Math.cos(this.h), cy = this.y - FORK_BODY * Math.sin(this.h);
      const tx = c.x - FORK_BODY * Math.cos(c.h), ty = c.y - FORK_BODY * Math.sin(c.h);
      const dist = Math.hypot(tx - cx, ty - cy);
      const setC = (nx: number, ny: number, nh: number) => { this.h = nh; this.x = nx + FORK_BODY * Math.cos(nh); this.y = ny + FORK_BODY * Math.sin(nh); };
      const turnTo = (want: number) => {
        const dh = wrapA(want - this.h), w = 0.8 * left;
        if (Math.abs(dh) <= w) { left -= Math.abs(dh) / 0.8; setC(cx, cy, want); return true; }
        setC(cx, cy, this.h + Math.sign(dh) * w); left = 0; return false;
      };
      if (dist > 2) {
        const travel = Math.atan2(ty - cy, tx - cx);
        if (!turnTo(c.rev ? travel + Math.PI : travel)) continue;
        const sp = c.rev ? 1300 : 2200, v = sp * left;
        if (dist <= v) { left -= dist / sp; setC(tx, ty, this.h); }
        else { setC(cx + (tx - cx) / dist * v, cy + (ty - cy) / dist * v, this.h); left = 0; }
        continue;
      }
      if (turnTo(c.h)) { this.x = c.x; this.y = c.y; this.q.shift(); }
    }
    this.sync();
    this.driver.update(dt);
  }
}

/** A stack of n empty pallets, origin at the bottom centre. */
function palletStack(n: number) {
  const g = new THREE.Group();
  for (let k = 0; k < n; k++) { const p = palletMesh(); p.position.z = k * PALLET.h; g.add(p); }
  return g;
}

/** The customer order the line works to. Pallets 0 = run continuously. */
export interface LineOrder { pallets: number; perPallet: number; partsPerCase: number; cncCycle: number }
/** What the line reads from and writes to the PLC (OpenRung). Optional: without it the line runs on its own. */
export interface LinePlc { live(): boolean; tag(path: string): number | undefined; write(path: string, v: number): void }

// ------------------------------------------------------------------ the simulation

export class Pl01Sim {
  /** Everything here is in layout coordinates. */
  readonly root = new THREE.Group();
  running = true;
  /** Conveyors, pallet lines and the wrapper have power (MCP-1 contactor M1 when the PLC is live). */
  powered = true;
  /** Pallet lines, transfer and wrapper have power (MCP-1 contactor M2). */
  palPowered = true;
  order: LineOrder = { pallets: 6, perPallet: 12, partsPerCase: 2, cncCycle: 28 };
  /** This order's progress. */
  ord = { dispensed: 0, wrapped: 0, loaded: 0 };
  stats = { cases: 0, pallets: 0, shipped: 0, parts: 0, packed: 0, trailers: 0 };
  plc: LinePlc | null = null;
  private views: CellState[];
  private prevDO = new Map<number, number>();
  private belts: Belt[] = [];
  private end!: Belt;
  private lines: Pallet[][] = [[], []];
  private held: (Case | Part | null)[] = [null, null];
  private loose: Case[] = [];
  private vmcs: Vmc[] = [];
  private inSlots: (Part | null)[] = [];
  private outSlots: (Part | null)[] = [];
  private f1 = new Forklift('F1 shipping', [26000, 2600, Math.PI], 0xd9822b, { vest: '#e9d21c', hat: '#ffffff' });
  private f2 = new Forklift('F2 empty pallets', [29400, 4600, UP], 0x2f7fd0, { vest: '#f28c28', hat: '#ffffff' });
  private f3 = new Forklift('F3 truck loading', [16000, 5200, -UP], 0x3a9d4a, { vest: '#d6e021', hat: '#1f6fd1' });
  private turntable = new THREE.Group();
  private filmCarriage = new THREE.Group();
  private wrap = { pallet: null as Pallet | null, t: -1, film: null as THREE.Mesh | null };
  private xfer: Pallet | null = null;
  private ship: (Pallet | 'res' | null)[] = SHIP.map(() => null);
  private disp = LINE_X.map(() => ({ n: 6, g: new THREE.Group(), coming: false }));
  private supply = { n: 6, g: new THREE.Group(), refill: 0 };
  private trailer = { g: new THREE.Group(), y: TRAILER_Y, state: 'docked' as 'docked' | 'leaving' | 'arriving', n: 0, res: 0, pallets: [] as THREE.Object3D[] };
  private ret = { path: null as unknown as Path, parts: [] as { p: Part; s: number }[] };
  private workers: { w: Worker; tick: (dt: number) => void }[] = [];
  private clock = 0;
  private lastPlc = 0;

  constructor(private s: CellState, scene: THREE.Scene, private flange: (i: number) => THREE.Object3D | undefined) {
    this.root.position.set(-PL01_ORIGIN.x, -PL01_ORIGIN.y, 0);
    scene.add(this.root);
    this.views = s.robots.map((_, i) => s.view(i));
    this.buildBelts();
    this.buildVmcs();
    this.buildTables();
    this.buildReturn();
    this.buildPalletEnd();
    this.buildWrapper();
    this.buildDispensers();
    this.buildTrailer();
    this.root.add(this.f1.g, this.f2.g, this.f3.g);
    this.buildWorkers();
    // Start with a few cases already queued, an empty pallet waiting on each line and finished parts on the way to packing.
    for (const [i, b] of this.belts.entries()) if (b.name.startsWith('M')) for (let k = 0; k < (i === this.belts.length - 1 ? 3 : 1); k++) this.putOnBelt(b, b.path.len - k * (CASE.l + GAP) - (b === this.end ? 0 : 900));
    for (const l of [0, 1]) { this.addPallet(l, STATION_Y, 'station'); this.ord.dispensed++; }
    for (let k = 0; k < 10; k++) { const p = this.part(); this.finish(p); this.ret.parts.push({ p, s: this.ret.path.len - 2000 - k * 1400 }); }
    // the static pallet stacks of the layout are replaced by live dispenser magazines
    for (const o of s.objects) if (o.mesh?.id === 'page:pl01-pallets') o.hidden = true;
  }

  // ---------------------------------------------------------------- building

  private buildBelts() {
    const mains: Belt[] = [];
    const xs = [...BRANCH_X, 33600];
    for (let i = 0; i < 4; i++) {
      const parts: ConstructorParameters<typeof Path>[0] = [{ line: [[xs[i], 18700], [xs[i + 1], 18700]] }];
      if (i === 3) parts.push({ arc: { c: [33600, 17800], r: 900, a0: Math.PI / 2, a1: 0 } }, { line: [[34500, 17800], [34500, 13400]] });
      mains.push({ name: `M${i + 1}`, path: new Path(parts), cases: [] });
    }
    mains.forEach((m, i) => { m.next = mains[i + 1]; });
    const branches = BRANCH_X.map((x, i): Belt => ({ name: `B${i + 1}`, path: new Path([{ line: [[x, 23300], [x, 18700]] }]), cases: [], next: mains[i] }));
    branches.forEach((b, i) => { mains[i].feeds = b; });
    this.belts = [...branches, ...mains];
    this.end = mains[3];
  }

  /** Belt conveyor from the machine tending outfeed back to the packing benches. */
  private buildReturn() {
    const segs = RET_PATH.slice(1).map((b, i) => ({ line: [RET_PATH[i], b] as [V2, V2] }));
    this.ret.path = new Path(segs);
    const frame = new THREE.MeshStandardMaterial({ color: 0x8c96a0, roughness: 0.5, metalness: 0.5 });
    const belt = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.8 });
    for (const sg of segs) {
      const [a, b] = sg.line, len = Math.hypot(b[0] - a[0], b[1] - a[1]) + 400, h = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const g = new THREE.Group();
      g.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
      g.rotation.z = h;
      g.add(box(len, 360, 40, belt, 0, 0, RET_Z - 20), box(len, 30, 90, frame, 0, -200, RET_Z - 25), box(len, 30, 90, frame, 0, 200, RET_Z - 25));
      for (let x = -len / 2 + 300; x < len / 2; x += 1500) for (const y of [-180, 180]) g.add(box(50, 50, RET_Z - 60, frame, x, y, (RET_Z - 60) / 2));
      this.root.add(g);
    }
  }

  /** Roller beds where the two pallet lines run out to the cross transfer. */
  private buildPalletEnd() {
    const frame = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.45, metalness: 0.5 });
    const roll = new THREE.MeshStandardMaterial({ color: 0xd3d7db, roughness: 0.3, metalness: 0.6 });
    const chain = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6 });
    const bed = (cx: number, cy: number, lx: number, ly: number, rollAlongX: boolean) => {
      const g = new THREE.Group();
      g.position.set(cx, cy, 0);
      g.add(box(lx, 60, 120, frame, 0, -ly / 2, PAL_Z - 70), box(lx, 60, 120, frame, 0, ly / 2, PAL_Z - 70));
      if (rollAlongX) for (let x = -lx / 2 + 60; x < lx / 2; x += 140) g.add(box(60, ly - 40, 50, roll, x, 0, PAL_Z - 30));
      else for (let y = -ly / 2 + 60; y < ly / 2; y += 140) g.add(box(lx - 40, 60, 50, roll, 0, y, PAL_Z - 30));
      for (const x of [-lx / 2 + 60, lx / 2 - 60]) for (const y of [-ly / 2 + 40, ly / 2 - 40]) g.add(box(60, 60, PAL_Z - 60, frame, x, y, (PAL_Z - 60) / 2));
      this.root.add(g);
      return g;
    };
    // chain transfer across the ends of both lines, with the wrapper in the middle
    for (const [x0, x1] of [[LINE_X[0] - 600, TURN_C[0] - 860], [TURN_C[0] + 860, LINE_X[1] + 600]]) {
      const g = bed((x0 + x1) / 2, XFER_Y, x1 - x0, PALLET.l + 100, true);
      for (const y of [-400, 0, 400]) g.add(box(x1 - x0, 40, 30, chain, 0, y, PAL_Z - 2));
    }
  }

  private putOnBelt(b: Belt, s: number, c = new Case()) {
    b.cases.push({ c, s: Math.max(0, s) });
    b.cases.sort((p, q) => q.s - p.s);
    this.root.add(c.g);
    this.placeOnBelt(b, b.cases.find((x) => x.c === c)!);
    return c;
  }
  private placeOnBelt(b: Belt, it: { c: Case; s: number }) {
    const p = b.path.at(it.s);
    it.c.g.position.set(p.x, p.y, BELT_Z + CASE.h / 2);
    it.c.g.rotation.set(0, 0, p.h);
  }

  private buildVmcs() {
    VMC_X.forEach((x) => {
      const door = new THREE.Group();
      door.add(box(1600, 40, 1350, M.door, 0, 0, 0));
      door.add(box(900, 44, 520, M.glass, 0, 0, 180));
      door.add(box(40, 70, 300, M.handle, -700, -40, 0));
      door.position.set(x, 21868, 650 + 675);
      const opening = box(1560, 4, 1320, M.dark, x, 21887, 650 + 670);
      opening.visible = false;
      const lamps = [lamp(0xe53935), lamp(0xffb300), lamp(0x43a047)];
      const col = new THREE.Group();
      col.position.set(x + 1100, 21960, 2780);
      col.add(cyl(30, 120, M.handle, 0, 0, 60));
      lamps.forEach((m, i) => col.add(cyl(90, 90, m, 0, 0, 160 + i * 95)));
      this.root.add(door, opening, col);
      this.vmcs.push({ x, door, open: 0, opening, running: 0, start: false, part: null, lamps });
    });
  }

  private part(): Part {
    const g = new THREE.Group();
    const body = box(BLANK.l, BLANK.w, BLANK.h, M.blank);
    const pocket = box(90, 90, 4, M.pocket, 0, 0, BLANK.h / 2 + 1);
    pocket.visible = false;
    g.add(body, pocket);
    this.root.add(g);
    return { g, done: false, pocket, body };
  }
  private finish(p: Part) { p.done = true; p.body.material = M.done; p.pocket.visible = true; }
  private slotPos(out: boolean, i: number): [number, number, number] {
    return [(out ? 10500 : 2800) + (i % 3) * 300, 19850 + Math.floor(i / 3) * 300, 840 + BLANK.h / 2];
  }
  private buildTables() {
    for (let i = 0; i < 6; i++) {
      const p = this.part();
      p.g.position.set(...this.slotPos(false, i));
      this.inSlots.push(p);
      this.outSlots.push(null);
    }
    this.s.io.DI[11] = 1; this.s.io.DI[12] = 1;
  }

  private buildWrapper() {
    const base = new THREE.Group();
    base.position.set(TURN_C[0], TURN_C[1], 0);
    base.add(cyl(1700, PAL_Z - 90, M.carriage, 0, 0, (PAL_Z - 90) / 2, 48));
    // mast on the far side, so the forklift comes in from the dock side
    base.add(box(220, 220, 3000, M.carriage, 0, 1180, 1500), box(700, 500, 160, M.carriage, 0, 1180, 80));
    this.root.add(base);
    this.turntable.position.set(TURN_C[0], TURN_C[1], PAL_Z - 90);
    this.turntable.add(cyl(1650, 90, M.table, 0, 0, 45, 48));
    this.turntable.add(box(1500, 60, 4, M.handle, 0, 0, 92));
    this.root.add(this.turntable);
    this.filmCarriage.position.set(TURN_C[0], TURN_C[1] + 980, PAL_Z);
    this.filmCarriage.add(box(300, 220, 420, M.carriage, 0, 60, 210), cyl(110, 380, M.roll, 0, -90, 210, 20));
    this.root.add(this.filmCarriage);
  }

  private buildDispensers() {
    this.disp.forEach((d, li) => { d.g.position.set(LINE_X[li], DISP_Y, DISP_Z); this.root.add(d.g); this.drawDisp(li); });
    this.supply.g = palletStack(this.supply.n);
    this.supply.g.position.set(SUPPLY[0], SUPPLY[1], 10);
    this.root.add(this.supply.g);
  }
  private drawDisp(li: number) {
    const d = this.disp[li];
    d.g.clear();
    d.g.add(palletStack(d.n));
  }

  private buildTrailer() {
    const t = this.trailer;
    const shell = new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
    const floorM = new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.8 });
    const cab = new THREE.MeshStandardMaterial({ color: 0x1f5fa8, roughness: 0.4, metalness: 0.3 });
    const L = 11500, W = 2500, H = 2700;
    const g = t.g;
    g.add(box(W, L, 40, floorM, 0, -L / 2, 20));
    g.add(box(40, L, H, shell, -W / 2, -L / 2, H / 2), box(40, L, H, shell, W / 2, -L / 2, H / 2), box(W, 40, H, shell, 0, -L, H / 2));
    g.add(box(W, L, 30, shell, 0, -L / 2, H));
    g.add(box(2400, 2200, 2600, cab, 0, -L - 1500, 1500), box(2300, 60, 900, M.glass, 0, -L - 400 - 5, 2100));
    for (const y of [-L + 1500, -L + 2900, -1500]) for (const x of [-W / 2 + 150, W / 2 - 150]) g.add(cyl(1000, 300, M.dark, x, y, 500, 24));
    g.children.slice(-6).forEach((w) => w.rotation.set(0, 0, Math.PI / 2));
    g.position.set(TRAILER_X, t.y, 0);
    this.root.add(g);
  }
  private trailerSlot(k: number): V2 { return [TRAILER_X + (k % 2 ? 560 : -560), TRAILER_Y - 650 - Math.floor(k / 2) * 1300]; }

  // ---------------------------------------------------------------- workers

  private buildWorkers() {
    const add = (w: Worker, tick: (dt: number) => void) => { this.root.add(w.root); this.workers.push({ w, tick }); };
    // Packers at the four benches: take finished parts off the return belt, pack them into a case, carry it to their branch conveyor.
    const looks = [{ vest: '#f28c28' }, { vest: '#d6e021', shirt: '#5a6b7c' }, { vest: '#f28c28', hat: '#ffffff' }, { vest: '#d6e021', hat: '#1f6fd1' }];
    BRANCH_X.forEach((bx, i) => {
      const w = new Worker(looks[i]);
      const bench: V2 = [bx + 1100, 23850];
      w.place(bench[0], bench[1], -UP);
      let st = 'collect', t = 0, walk: Walk | null = null, inHand: Part | null = null;
      const newCase = () => { const c = new Case(); c.g.position.set(bench[0], bench[1] - 650, 900 + CASE.h / 2); c.g.rotation.z = 0; this.root.add(c.g); return c; };
      let open = newCase(), inCase: Part[] = [];
      const branch = this.belts[i];
      add(w, (dt) => {
        const ppc = Math.max(1, Math.round(this.order.partsPerCase));
        if (st === 'collect') {
          if (inCase.length >= ppc) { st = 'pack'; t = 3.5; }
          else {
            // turn round to the belt and take a part passing (or queued) in reach
            const k = this.ret.parts.findIndex((q) => { const x = q.p.g.position.x; return q.p.g.position.y > 24000 && Math.abs(x - bench[0]) < 420; });
            if (k >= 0) {
              w.pose = 'reach';
              if (face(w, UP, dt)) {
                inHand = this.ret.parts.splice(k, 1)[0].p;
                this.root.remove(inHand.g); inHand.g.position.set(0, 0, 0); inHand.g.rotation.set(0, 0, 0); w.hands.add(inHand.g);
                st = 'put'; t = 0.6;
              }
            } else { w.pose = 'stand'; face(w, -UP, dt); }
          }
        } else if (st === 'put') {
          w.pose = 'work';
          if (face(w, -UP, dt) && (t -= dt) <= 0) {
            w.hands.remove(inHand!.g);
            const n = inCase.length;
            inHand!.g.position.set(-180 + (n % 3) * 180, -100 + Math.floor(n / 3) % 2 * 200, CASE.h / 2 + BLANK.h / 2);
            open.g.add(inHand!.g);
            inCase.push(inHand!); inHand = null;
            st = 'collect';
          }
        } else if (st === 'pack') {
          w.pose = 'work';
          if ((t -= dt) <= 0) {
            for (const p of inCase) open.g.remove(p.g);
            this.stats.packed += inCase.length; inCase = [];
            open.seal();
            this.root.remove(open.g); open.g.position.set(0, 0, 0); open.g.rotation.z = UP; w.hands.add(open.g);
            st = 'go'; walk = new Walk(w, [[bx + 350, 23900], [bx, 23950]], 1100, true);
          }
        } else if (st === 'go') {
          walk!.step(dt);
          if (walk!.done && face(w, -UP, dt)) { st = 'place'; t = 0.9; }
        } else if (st === 'place') {
          const room = branch.cases.every((c) => c.s > CASE.l + GAP);
          w.pose = room ? 'reach' : 'carry';
          if (room && (t -= dt) <= 0) {
            w.hands.remove(open.g);
            this.putOnBelt(branch, 0, open);
            open = newCase();
            st = 'back'; walk = new Walk(w, [[bx + 350, 23900], bench], 1100);
          }
        } else if (st === 'back') {
          walk!.step(dt);
          if (walk!.done && face(w, -UP, dt)) st = 'collect';
        }
        w.update(dt);
      });
    });

    // Machine operator: refills the infeed table, clears the outfeed table and puts the finished parts on the return belt.
    {
      const w = new Worker({ vest: '#d6e021', shirt: '#7b4b2a' });
      const home: V2 = [12000, 18750];
      const drop: V2 = [RET_PATH[0][0], 18950];
      w.place(home[0], home[1], UP);
      let st = 'idle', t = 0, walk: Walk | null = null, job: 'in' | 'out' = 'in';
      const tote = box(560, 380, 220, M.tote, 0, 0, -40);
      tote.visible = false;
      w.hands.add(tote);
      const carried: Part[] = [];
      add(w, (dt) => {
        if (st === 'idle') {
          w.pose = 'stand'; face(w, UP, dt);
          if (!this.s.io.DI[11]) { job = 'in'; st = 'go'; walk = new Walk(w, [[3100, 18950]], 1300, true); tote.visible = true; }
          else if (!this.s.io.DI[12]) { job = 'out'; st = 'go'; walk = new Walk(w, [[10800, 18950]], 1300); }
        } else if (st === 'go') {
          walk!.step(dt);
          if (walk!.done && face(w, UP, dt)) { st = 'work'; t = 0.8; tote.visible = true; }
        } else if (st === 'work') {
          w.pose = 'reach';
          if ((t -= dt) <= 0) {
            t = 0.7;
            if (job === 'in') {
              const i = this.inSlots.findIndex((p) => !p);
              if (i < 0) { this.s.io.DI[11] = 1; st = 'back'; tote.visible = false; walk = new Walk(w, [home], 1300); }
              else { const p = this.part(); p.g.position.set(...this.slotPos(false, i)); this.inSlots[i] = p; }
            } else {
              const i = this.outSlots.findIndex((p) => !!p);
              if (i < 0) { this.s.io.DI[12] = 1; st = carried.length ? 'unload' : 'back'; walk = new Walk(w, carried.length ? [drop] : [home], 1300, true); }
              else {
                const p = this.outSlots[i]!; this.outSlots[i] = null; this.stats.parts++;
                this.root.remove(p.g); p.g.position.set(-150 + carried.length * 100, 0, 30); tote.add(p.g); carried.push(p);
              }
            }
          }
        } else if (st === 'unload') {
          walk!.step(dt);
          if (walk!.done && face(w, -UP, dt)) {
            w.pose = 'reach';
            const first = this.ret.parts.length ? Math.min(...this.ret.parts.map((q) => q.s)) : Infinity;
            if ((t -= dt) <= 0 && first > RET_PITCH) {
              t = 0.6;
              const p = carried.shift()!;
              tote.remove(p.g); this.root.add(p.g);
              this.ret.parts.push({ p, s: 0 });
              if (!carried.length) { st = 'back'; walk = new Walk(w, [home], 1300); }
            }
          }
        } else if (st === 'back') {
          walk!.step(dt);
          if (walk!.done) { st = 'idle'; tote.visible = false; }
        }
        w.update(dt);
      });
    }

    // Walkers in the aisles and people at their stations.
    const patrol = (look: WorkerLook, pts: V2[], pause: number, pose: 'stand' | 'work', faceH?: number[]) => {
      const w = new Worker(look);
      w.place(pts[0][0], pts[0][1], 0);
      let i = 0, t = pause * Math.random(), walk: Walk | null = null;
      add(w, (dt) => {
        if (walk) { walk.step(dt); if (walk.done) { walk = null; t = pause; } }
        else {
          w.pose = pose;
          if (faceH) face(w, faceH[i % faceH.length], dt);
          if ((t -= dt) <= 0) { i = (i + 1) % pts.length; walk = new Walk(w, [pts[i]], 1150); }
        }
        w.update(dt);
      });
    };
    patrol({ vest: '#f28c28', shirt: '#2f5d50' }, [[13500, 17000], [20500, 17000], [20500, 9500], [13500, 9500]], 1.5, 'stand');
    patrol({ vest: '#d6e021', hat: '#ffffff' }, [[2200, 9800], [12500, 9800]], 3, 'stand');
    patrol({ vest: '#f28c28', hat: '#e53935' }, [[3000, 5500], [5400, 5500], [7800, 5500]], 8, 'work', [Math.PI / 2]);
    patrol({ shirt: '#ffffff', vest: '#3d5a80', hat: '#ffffff' }, [[15000, 21300], [14600, 22500], [15500, 22900]], 6, 'work', [Math.PI / 2, 0, Math.PI]);
    patrol({ vest: '#d6e021', shirt: '#22313f' }, [[28400, 9800], [28400, 11300], [28400, 8500]], 7, 'stand', [0]);
  }

  // ---------------------------------------------------------------- pallets

  private addPallet(line: number, y: number, state: Pallet['state']) {
    const g = palletMesh();
    g.position.set(LINE_X[line], y, PAL_Z);
    this.root.add(g);
    const p: Pallet = { g, line, x: LINE_X[line], y, state, cases: 0, wrapped: false, since: 0 };
    this.lines[line].push(p);
    return p;
  }

  private get dispenseOk() { return this.order.pallets <= 0 || this.ord.dispensed < this.order.pallets; }
  /** All the order's pallets are on the truck. */
  get orderDone() { return this.order.pallets > 0 && this.ord.loaded >= this.order.pallets; }

  private tickPallets(dt: number) {
    for (const [li, list] of this.lines.entries()) {
      list.sort((a, b) => a.y - b.y); // lowest y (furthest down the line) first
      for (const [k, p] of list.entries()) {
        if (p.state === 'station' || p.state === 'end' || p.state === 'xfer') continue;
        const ahead = k > 0 ? list[k - 1] : null;
        const stop = p.state === 'in' ? STATION_Y : XFER_Y;
        let ny = Math.max(stop, p.y - PAL_V * dt);
        if (ahead) ny = Math.max(ny, ahead.y + PALLET.l + 250);
        p.y = ny;
        p.g.position.y = ny;
        if (p.y <= stop + 0.5) { p.state = p.state === 'in' ? 'station' : 'end'; p.since = this.clock; }
      }
      // dispenser: drops the bottom pallet of its magazine when nothing is on its way to (or at) the station
      const d = this.disp[li];
      if (d.n > 0 && this.dispenseOk && !list.some((p) => p.state === 'in' || p.state === 'station') && !list.some((p) => p.y > DISP_Y - PALLET.l - 300)) {
        d.n--; this.ord.dispensed++; this.drawDisp(li);
        this.addPallet(li, DISP_Y, 'in');
      }
      this.s.io.DI[2 + li] = list.some((p) => p.state === 'station') ? 1 : 0;
    }
    // cross transfer: the pallet that has waited longest at the end of its line goes to the wrapper
    if (!this.xfer && !this.wrap.pallet) {
      const p = this.lines.flat().filter((q) => q.state === 'end').sort((a, b) => a.since - b.since)[0];
      if (p) { p.state = 'xfer'; this.xfer = p; }
    }
    const p = this.xfer;
    if (p) {
      const d = TURN_C[0] - p.x, v = PAL_V * dt;
      p.x = Math.abs(d) <= v ? TURN_C[0] : p.x + Math.sign(d) * v;
      p.g.position.x = p.x;
      if (p.x === TURN_C[0]) {
        this.lines[p.line] = this.lines[p.line].filter((q) => q !== p);
        p.state = 'moved';
        this.turntable.updateWorldMatrix(true, false);
        this.turntable.attach(p.g);
        this.wrap = { pallet: p, t: 0, film: null };
        this.xfer = null;
      }
    }
  }

  // ---------------------------------------------------------------- belts

  private tickBelts(dt: number) {
    const pitch = CASE.l + GAP;
    for (const b of this.belts) {
      const L = b.path.len;
      const next = b.next;
      const nextMin = next ? Math.min(Infinity, ...next.cases.map((c) => c.s)) : Infinity;
      const isBranch = b.name.startsWith('B');
      const mainIn = next && isBranch ? this.belts.find((x) => x.next === next && x !== b) : undefined;
      if (isBranch) b.claim = b.cases.some((c) => c.s > L - pitch);
      for (const [k, it] of b.cases.entries()) {
        let lim = k === 0 ? L : b.cases[k - 1].s - pitch;
        if (k === 0 && next) {
          if (nextMin < pitch) lim = Math.min(lim, L - (pitch - nextMin));
          if (isBranch && mainIn && !b.claim && mainIn.cases.some((c) => c.s > mainIn.path.len - pitch - 200)) lim = Math.min(lim, L - pitch);
          if (!isBranch && next.feeds?.claim) lim = Math.min(lim, L - pitch);
        }
        it.s = Math.max(it.s, Math.min(lim, it.s + BELT_V * dt));
      }
      if (next && b.cases.length && b.cases[0].s >= L - 0.5 && Math.min(Infinity, ...next.cases.map((c) => c.s)) >= pitch) {
        const it = b.cases.shift()!;
        next.cases.push({ c: it.c, s: 0 });
        next.cases.sort((p, q) => q.s - p.s);
      }
    }
    for (const b of this.belts) for (const it of b.cases) {
      this.placeOnBelt(b, it);
      if (b === this.end) {
        const x = it.c.g.position.x;
        if (!it.c.sealed && x > 31900) it.c.seal();
        if (!it.c.labeled && x > 32700) it.c.label();
      }
    }
    const e = this.end.cases[0];
    this.s.io.DI[1] = e && e.s >= this.end.path.len - 0.5 ? 1 : 0;
    // return belt: parts queue up at the far end
    const r = this.ret;
    r.parts.sort((a, b) => b.s - a.s);
    r.parts.forEach((q, k) => {
      const lim = k === 0 ? r.path.len : r.parts[k - 1].s - RET_PITCH;
      q.s = Math.max(q.s, Math.min(lim, q.s + RET_V * dt));
      const at = r.path.at(q.s);
      q.p.g.position.set(at.x, at.y, RET_Z + BLANK.h / 2);
      q.p.g.rotation.set(0, 0, at.h);
    });
  }

  // ---------------------------------------------------------------- VMCs

  private tickVmcs(dt: number) {
    const io = this.s.io;
    this.vmcs.forEach((m, i) => {
      const n = i + 1;
      const want = io.DO[20 + n] ? 1 : 0;
      m.open = want > m.open ? Math.min(1, m.open + dt / 1.6) : Math.max(0, m.open - dt / 1.6);
      m.door.position.x = m.x + m.open * 1450;
      m.opening.visible = m.open > 0.02;
      if (io.DO[30 + n] && !this.prevDO.get(30 + n)) m.start = true;
      if (m.start && m.open === 0 && m.part && !m.part.done) { m.start = false; m.running = Math.max(3, this.order.cncCycle); }
      else if (m.start && m.open === 0) m.start = false;
      if (m.running > 0) {
        m.running -= dt;
        if (m.running <= 0) { m.running = 0; if (m.part) this.finish(m.part); }
      }
      io.DI[20 + n] = m.open >= 1 ? 1 : 0;
      io.DI[30 + n] = m.running > 0 ? 0 : 1;
      io.DI[40 + n] = m.part?.done ? 1 : 0;
      const blink = Math.sin(this.clock * 6) > 0;
      m.lamps[2].emissiveIntensity = m.running > 0 ? 1.4 : 0;
      m.lamps[1].emissiveIntensity = m.running <= 0 && m.part?.done ? (blink ? 1.4 : 0.2) : 0;
      m.lamps[0].emissiveIntensity = 0;
    });
  }
  /** VMC n (1..3) is cutting. */
  vmcRunning(n: number) { return (this.vmcs[n - 1]?.running ?? 0) > 0; }

  // ---------------------------------------------------------------- robots: grab / release

  private tcp(i: number): THREE.Vector3 {
    const v = this.views[i];
    const f = compose(this.s.baseFrame(i), v.tcpWorld());
    return new THREE.Vector3(f.p[0] + PL01_ORIGIN.x, f.p[1] + PL01_ORIGIN.y, f.p[2]);
  }
  private worldPos(o: THREE.Object3D) { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).add(new THREE.Vector3(PL01_ORIGIN.x, PL01_ORIGIN.y, 0)); }

  private tickGrip() {
    this.s.robots.forEach((r, i) => {
      if (!r.grip) return;
      const on = this.s.io[r.grip.port][r.grip.idx] ? 1 : 0;
      const key = 1000 + i;
      const was = this.prevDO.get(key) ?? 0;
      this.prevDO.set(key, on);
      if (on === was) return;
      const fl = this.flange(i);
      if (!fl) return;
      const tcp = this.tcp(i);
      if (on && !this.held[i]) {
        if (i === 0) {
          const all: Case[] = [...this.belts.flatMap((b) => b.cases.map((c) => c.c)), ...this.loose, ...this.lines.flat().flatMap((p) => p.g.children.filter((c) => c.userData.case).map((c) => c.userData.case as Case))];
          const hit = all.find((c) => { const p = this.worldPos(c.g); return Math.hypot(p.x - tcp.x, p.y - tcp.y) < 150 && Math.abs(p.z + CASE.h / 2 - tcp.z) < 60; });
          if (hit) {
            for (const b of this.belts) b.cases = b.cases.filter((c) => c.c !== hit);
            this.loose = this.loose.filter((c) => c !== hit);
            for (const p of this.lines.flat()) if (hit.g.parent === p.g) p.cases--;
            fl.updateWorldMatrix(true, false);
            fl.attach(hit.g);
            this.held[i] = hit;
          }
        } else {
          const parts = [...this.inSlots, ...this.outSlots, ...this.vmcs.map((m) => m.part)].filter((p): p is Part => !!p);
          const hit = parts.find((p) => this.worldPos(p.g).distanceTo(tcp) < 45);
          if (hit) {
            this.inSlots = this.inSlots.map((p) => (p === hit ? null : p));
            this.outSlots = this.outSlots.map((p) => (p === hit ? null : p));
            for (const m of this.vmcs) if (m.part === hit) m.part = null;
            fl.updateWorldMatrix(true, false);
            fl.attach(hit.g);
            this.held[i] = hit;
          }
        }
      } else if (!on && this.held[i]) {
        const it = this.held[i]!;
        this.held[i] = null;
        if (it instanceof Case) {
          const p = this.worldPos(it.g);
          const pal = this.lines.flat().find((q) => Math.abs(p.x - q.x) < PALLET.w / 2 + 60 && Math.abs(p.y - q.y) < PALLET.l / 2 + 60);
          const to = pal ? pal.g : this.root;
          to.updateWorldMatrix(true, false);
          to.attach(it.g);
          const yaw = Math.round(it.g.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
          it.g.rotation.set(0, 0, yaw);
          it.g.userData.case = it;
          if (pal) { pal.cases++; this.stats.cases++; } else this.loose.push(it);
        } else {
          const part = it as Part;
          this.root.updateWorldMatrix(true, false);
          this.root.attach(part.g);
          const p = this.worldPos(part.g);
          const vmc = this.vmcs.find((m) => Math.abs(p.x - m.x) < 700 && p.y > 21880 && p.y < 23000);
          if (vmc) vmc.part = part;
          else {
            const slots = p.x > 6550 ? this.outSlots : this.inSlots;
            const i2 = [0, 1, 2, 3, 4, 5].map((k) => [k, p.distanceTo(new THREE.Vector3(...this.slotPos(slots === this.outSlots, k)))] as const).sort((a, b) => a[1] - b[1])[0];
            if (i2[1] < 120 && !slots[i2[0]]) slots[i2[0]] = part;
            part.g.rotation.set(0, 0, 0);
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------- forklifts, wrapper, shipping, trailer

  private grab(f: Forklift, src: () => THREE.Object3D) { return { k: 'do' as const, f: () => { const o = src(); f.lift.updateWorldMatrix(true, false); f.lift.attach(o); f.load = o; } }; }
  private drop(f: Forklift, to: THREE.Object3D, after?: (o: THREE.Object3D) => void) { return { k: 'do' as const, f: () => { const o = f.load!; to.updateWorldMatrix(true, false); to.attach(o); f.load = null; after?.(o); } }; }

  /** F1: wrapped pallet off the turntable to a free shipping lane. */
  private tickF1() {
    const f = this.f1;
    if (f.busy) return;
    const lane = this.ship.findIndex((x) => x === null);
    const w = this.wrap.pallet;
    if (w && w.wrapped && lane >= 0) {
      this.ship[lane] = 'res';
      const [sx, sy] = SHIP[lane], X = TURN_C[0], Y = TURN_C[1] - PALLET.l / 2;
      f.q.push(
        { k: 'lift', z: 440 },
        { k: 'goto', x: X, y: 1300, h: UP },
        { k: 'goto', x: X, y: Y, h: UP },
        this.grab(f, () => w.g),
        { k: 'do', f: () => { this.wrap.pallet = null; this.ord.wrapped++; this.stats.pallets++; } },
        { k: 'lift', z: 620 },
        { k: 'goto', x: X, y: 1300, h: UP, rev: true },
        { k: 'lift', z: 250 },
        { k: 'goto', x: sx, y: 4500, h: -UP },
        { k: 'goto', x: sx, y: sy + PALLET.l / 2, h: -UP },
        { k: 'lift', z: -70 },
        this.drop(f, this.root, () => { this.ship[lane] = w; }),
        { k: 'goto', x: sx, y: 4500, h: -UP, rev: true },
      );
    } else f.goHome();
  }

  /** F2: brings a stack of empty pallets from the dock supply to a dispenser that runs low. */
  private tickF2(dt: number) {
    const f = this.f2, sp = this.supply;
    if (sp.n === 0 && (sp.refill -= dt) <= 0) { sp.n = 6; sp.g = palletStack(6); sp.g.position.set(SUPPLY[0], SUPPLY[1], 10); this.root.add(sp.g); }
    if (f.busy) return;
    const li = [0, 1].filter((l) => this.disp[l].n <= 2 && !this.disp[l].coming).sort((a, b) => this.disp[a].n - this.disp[b].n)[0];
    if (li === undefined || sp.n === 0 || (!this.dispenseOk && this.disp[li].n > 0)) { f.goHome(); return; }
    const d = this.disp[li], stack = sp.g, n = sp.n;
    d.coming = true;
    const top = () => DISP_Z + d.n * PALLET.h - 80;
    f.q.push(
      { k: 'lift', z: -100 },
      { k: 'goto', x: SUPPLY[0], y: 3200, h: -UP },
      { k: 'goto', x: SUPPLY[0], y: SUPPLY[1] + PALLET.l / 2, h: -UP },
      this.grab(f, () => stack),
      { k: 'do', f: () => { sp.n = 0; sp.refill = 25; } },
      { k: 'lift', z: 150 },
      { k: 'goto', x: SUPPLY[0], y: 3200, h: -UP, rev: true },
    );
    const route: Cmd[] = li === 0
      ? [{ k: 'goto', x: 29400, y: 5800, h: UP }, { k: 'goto', x: 29400, y: 11000, h: UP }, { k: 'goto', x: 27400, y: 13000, h: UP }, { k: 'goto', x: 27400, y: 15200, h: UP }, { k: 'goto', x: 28600, y: DISP_Y, h: 0 }]
      : [{ k: 'goto', x: 30500, y: 1700, h: 0 }, { k: 'goto', x: 37500, y: 1700, h: 0 }, { k: 'goto', x: 39500, y: 5000, h: UP }, { k: 'goto', x: 39500, y: 15900, h: UP }, { k: 'goto', x: 39300, y: DISP_Y, h: Math.PI }];
    const at: Cmd = li === 0 ? { k: 'goto', x: LINE_X[0] - PALLET.w / 2, y: DISP_Y, h: 0 } : { k: 'goto', x: LINE_X[1] + PALLET.w / 2, y: DISP_Y, h: Math.PI };
    const out: Cmd = li === 0 ? { k: 'goto', x: 28600, y: DISP_Y, h: 0, rev: true } : { k: 'goto', x: 39300, y: DISP_Y, h: Math.PI, rev: true };
    f.q.push(...route,
      { k: 'lift', z: () => top() + 60 },
      at,
      { k: 'lift', z: () => top() },
      this.drop(f, this.root, (o) => { this.root.remove(o); d.n += n; d.coming = false; this.drawDisp(li); }),
      { k: 'lift', z: () => top() - 60 },
      out,
      { k: 'lift', z: 0 },
      ...[...route].reverse().slice(1).map((c) => ({ ...(c as { k: 'goto'; x: number; y: number; h: number }), h: wrapA((c as { h: number }).h + Math.PI) })),
      { k: 'goto', x: f.home[0], y: f.home[1], h: f.home[2] },
    );
  }

  /** F3: loads the shipping lanes into the trailer at the dock door. */
  private tickF3() {
    const f = this.f3, t = this.trailer;
    if (f.busy) return;
    const lane = this.ship.findIndex((x) => x && x !== 'res');
    if (t.state !== 'docked' || lane < 0 || t.res >= TRAILER_CAP) { f.goHome(); return; }
    const p = this.ship[lane] as Pallet;
    this.ship[lane] = 'res';
    const [sx, sy] = SHIP[lane], k = t.res++, [cx, cy] = this.trailerSlot(k);
    f.q.push(
      { k: 'lift', z: -100 },
      { k: 'goto', x: sx, y: 4500, h: -UP },
      { k: 'goto', x: sx, y: sy + PALLET.l / 2, h: -UP },
      this.grab(f, () => p.g),
      { k: 'do', f: () => { this.ship[lane] = null; } },
      { k: 'lift', z: 120 },
      { k: 'goto', x: sx, y: 4500, h: -UP, rev: true },
      { k: 'goto', x: cx, y: 4500, h: -UP },
      { k: 'goto', x: cx, y: cy + PALLET.l / 2, h: -UP },
      { k: 'lift', z: -60 },
      this.drop(f, t.g, (o) => { t.pallets.push(o); t.n++; this.ord.loaded++; this.stats.shipped++; }),
      { k: 'goto', x: cx, y: 4500, h: -UP, rev: true },
    );
  }

  private tickTrailer(dt: number) {
    const t = this.trailer, f3 = this.f3;
    if (t.state === 'docked') {
      const full = t.n >= TRAILER_CAP;
      const orderOut = this.orderDone && t.n > 0;
      if ((full || orderOut) && !f3.busy && t.n === t.res) t.state = 'leaving';
    } else if (t.state === 'leaving') {
      t.y -= 2500 * dt;
      if (t.y < -45000) {
        for (const o of t.pallets) t.g.remove(o);
        t.pallets = []; t.n = 0; t.res = 0; this.stats.trailers++;
        t.state = 'arriving';
      }
    } else {
      t.y = Math.min(TRAILER_Y, t.y + 3000 * dt);
      if (t.y >= TRAILER_Y) t.state = 'docked';
    }
    t.g.position.y = t.y;
  }

  private tickWrapper(dt: number) {
    const w = this.wrap;
    const RUN = 22;
    if (w.pallet && w.t >= 0) {
      w.t += dt;
      const k = Math.min(1, w.t / RUN);
      const spin = k < 1 ? 1.25 : 0;
      this.turntable.rotation.z += spin * dt;
      const loadH = Math.ceil(w.pallet.cases / 4) * CASE.h;
      const top = PALLET.h + loadH;
      const up = k < 0.5 ? k * 2 : 2 - k * 2;
      this.filmCarriage.position.z = PAL_Z + 40 + up * Math.max(0, top - 300);
      if (!w.film) {
        w.film = box(PALLET.w + 40, PALLET.l + 40, 1, M.film);
        w.pallet.g.add(w.film);
      }
      const h = Math.max(1, Math.min(top - 60, (k < 0.5 ? k * 2 : 1) * (top - 60)));
      w.film.scale.z = h;
      w.film.position.z = 60 + h / 2;
      if (k >= 1) {
        const snap = Math.round(this.turntable.rotation.z / Math.PI) * Math.PI;
        const d = snap - this.turntable.rotation.z;
        this.turntable.rotation.z += Math.sign(d) * Math.min(Math.abs(d), 0.6 * dt);
        if (Math.abs(d) < 1e-3) { this.turntable.rotation.z = snap; w.pallet.wrapped = true; w.t = -1; }
      }
    }
  }

  // ---------------------------------------------------------------- PLC

  /** Status out to the PLC and order / power in from it, five times a second. */
  private tickPlc() {
    const plc = this.plc;
    if (!plc || this.clock - this.lastPlc < 0.2) return;
    this.lastPlc = this.clock;
    if (!plc.live()) { this.powered = this.palPowered = true; return; }
    const num = (t: string) => { const v = plc.tag(t); return typeof v === 'number' && Number.isFinite(v) ? v : undefined; };
    const run = num('Conv_Running'), pal = num('Pal_Running');
    this.powered = run === undefined ? true : !!run;
    this.palPowered = pal === undefined ? true : !!pal;
    const o = this.order;
    const op = num('Order_Pallets'), pp = num('Cases_Per_Pallet'), pc = num('Parts_Per_Case'), cy = num('CNC_Cycle');
    if (op !== undefined && op >= 0) o.pallets = op;
    if (pp !== undefined && pp >= 1) o.perPallet = Math.min(16, pp);
    if (pc !== undefined && pc >= 1) o.partsPerCase = Math.min(6, pc);
    if (cy !== undefined && cy >= 3) o.cncCycle = cy;
    if (num('New_Order')) this.newOrder();
    const w = (t: string, v: number | boolean) => plc.write(t, +v);
    const io = this.s.io;
    w('Case_At_Pick', io.DI[1]); w('Pallet_A_Ready', io.DI[2]); w('Pallet_B_Ready', io.DI[3]);
    for (const n of [1, 2, 3]) { w(`VMC${n}_Running`, this.vmcRunning(n)); w(`VMC${n}_Door_Open`, io.DI[20 + n]); }
    w('Wrapper_Busy', !!this.wrap.pallet && this.wrap.t >= 0);
    w('Disp_A_Count', this.disp[0].n); w('Disp_B_Count', this.disp[1].n);
    w('Cases_Done', this.stats.cases); w('Parts_Done', this.stats.parts); w('Parts_Packed', this.stats.packed);
    w('Pallets_Wrapped', this.ord.wrapped); w('Pallets_Loaded', this.ord.loaded); w('Order_Done', this.orderDone);
    w('Trailer_Count', this.trailer.n); w('Return_Parts', this.ret.parts.length);
  }

  /** Start the next order: counters back to zero, dispensers release pallets again. */
  newOrder() { this.ord = { dispensed: this.lines.flat().length + (this.xfer ? 0 : 0), wrapped: 0, loaded: 0 }; }

  // ---------------------------------------------------------------- main tick

  tick(dt: number) {
    if (!this.running) return;
    this.clock += dt;
    this.tickPlc();
    const pal = this.s.robots[0]?.R?.[8];
    if (pal && pal.v !== this.order.perPallet) { pal.v = this.order.perPallet; pal.cmt = pal.cmt || 'Per pallet'; }
    this.tickGrip();
    if (this.powered) this.tickBelts(dt);
    if (this.palPowered) { this.tickPallets(dt); this.tickWrapper(dt); }
    this.tickVmcs(dt);
    this.tickF1(); this.tickF2(dt); this.tickF3();
    this.f1.tick(dt); this.f2.tick(dt); this.f3.tick(dt);
    this.tickTrailer(dt);
    for (const w of this.workers) w.tick(dt);
    const io = this.s.io;
    for (const l of [0, 1]) if (io.DO[2 + l] && !this.prevDO.get(2 + l)) {
      const p = this.lines[l].find((q) => q.state === 'station');
      if (p) p.state = 'out';
    }
    if (io.DO[16] && !this.prevDO.get(16)) io.DI[11] = 0;
    if (io.DO[17] && !this.prevDO.get(17)) io.DI[12] = 0;
    for (const n of [2, 3, 16, 17, 31, 32, 33]) this.prevDO.set(n, io.DO[n]);
  }

  /** Cases on all pallets right now (for the status line). */
  get onPallets() { return this.lines.flat().reduce((s, p) => s + p.cases, 0); }
  /** Live counts for the line panel. */
  get info() {
    return { dispA: this.disp[0].n, dispB: this.disp[1].n, supply: this.supply.n, ret: this.ret.parts.length, trailer: this.trailer.n, trailerState: this.trailer.state,
      lanes: this.ship.filter((x) => x && x !== 'res').length, wrapping: !!this.wrap.pallet && this.wrap.t >= 0 };
  }
}
