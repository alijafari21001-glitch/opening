// CAD library: parametric cell equipment built from boxes and cylinders (no files needed).
// Every builder returns a root object (origin on the floor) plus children posed relative to it.
import { XYZWPR } from '../kin/math';
import { CellObject, ObjRole, box, cylinder, fence, conveyor, worker } from './objects';

export interface LibParam { k: string; label: string; def: number; min?: number; max?: number }
export interface LibItem {
  id: string; cat: string; name: string; desc: string;
  params: LibParam[];
  build(floor: number, at: XYZWPR, p: Record<string, number>): CellObject[];
}

const pose = (x = 0, y = 0, z = 0, w = 0, p = 0, r = 0): XYZWPR => ({ x, y, z, w, p, r });
const kid = (o: CellObject, root: CellObject, extra: Partial<CellObject> = {}): CellObject => ({ ...o, parent: root.id, ...extra });
const on = (at: XYZWPR, floor: number, dz = 0): XYZWPR => ({ ...at, z: floor + dz });
/** A root with no body of its own would be invisible; use a thin base plate as the root. */
const plate = (name: string, role: ObjRole, l: number, w: number, at: XYZWPR, color: string) => box(name, role, [l, w, 4], at, color);

export const LIB_CATS = ['Safety', 'Conveyors', 'Pallets + boxes', 'Stands + tables', 'Sensors', 'Machines', 'Material handling', 'People'];

export const LIBRARY: LibItem[] = [
  // ---------------------------------------------------------------- Safety
  { id: 'fence', cat: 'Safety', name: 'Fence enclosure', desc: 'Posts and mesh panels around a rectangle, 900 mm gate on the front side.',
    params: [{ k: 'l', label: 'Length X', def: 2600 }, { k: 'w', label: 'Width Y', def: 2600 }, { k: 'h', label: 'Height', def: 1800 }],
    build: (f, at, p) => fence(f, at.x, at.y, p.l, p.w, p.h) },
  { id: 'fencerun', cat: 'Safety', name: 'Fence run', desc: 'A straight run of fence along X with a post every panel.',
    params: [{ k: 'l', label: 'Length', def: 3000 }, { k: 'h', label: 'Height', def: 1800 }, { k: 'panel', label: 'Panel width', def: 1000, min: 300 }],
    build: (f, at, p) => {
      const root = box('Fence run', 'obstacle', [60, 60, p.h], on(at, f), '#f0c419');
      const out = [root];
      const n = Math.max(1, Math.round(p.l / p.panel)), step = p.l / n;
      for (let i = 1; i <= n; i++) out.push(kid(box('Fence post', 'obstacle', [60, 60, p.h], pose(i * step), '#f0c419'), root));
      for (let i = 0; i < n; i++) out.push(kid(box('Fence panel', 'obstacle', [step - 60, 20, p.h - 200], pose(i * step + step / 2, 0, 150), '#7a8794'), root, { opacity: 0.35 }));
      return out;
    } },
  { id: 'curtain', cat: 'Safety', name: 'Light curtain', desc: 'Transmitter and receiver columns with the protected field between them.',
    params: [{ k: 'gap', label: 'Opening width', def: 900 }, { k: 'h', label: 'Protected height', def: 1200 }, { k: 'z0', label: 'Bottom height', def: 300 }],
    build: (f, at, p) => {
      const root: CellObject = { ...box('Light curtain TX', 'obstacle', [40, 40, p.z0 + p.h], on(at, f), '#2b2f33'),
        sensor: { kind: 'light curtain', zone: [25, -15, p.z0, p.gap - 25, 15, p.z0 + p.h], out: { to: 'plc', tag: 'LC_Blocked' } } };
      return [root,
        kid(box('Light curtain RX', 'obstacle', [40, 40, p.z0 + p.h], pose(p.gap), '#2b2f33'), root),
        kid(box('Light curtain field', 'obstacle', [p.gap - 40, 4, p.h], pose(p.gap / 2, 0, p.z0), '#ff4040'), root, { opacity: 0.15, collide: false }),
      ];
    } },
  { id: 'estop', cat: 'Safety', name: 'E-stop pedestal', desc: 'Operator station with a mushroom E-stop and start / stop buttons.',
    params: [{ k: 'h', label: 'Height', def: 1100 }],
    build: (f, at, p) => {
      const root = box('E-stop pedestal', 'obstacle', [120, 120, p.h - 150], on(at, f), '#5b6670');
      return [root,
        kid(box('Operator box', 'obstacle', [200, 160, 150], pose(0, 0, p.h - 150), '#f0c419'), root),
        kid(cylinder('E-stop', 'obstacle', 60, 30, pose(0, -40, p.h), '#d32f2f'), root),
        kid(cylinder('Start button', 'obstacle', 30, 12, pose(-60, 40, p.h), '#2e7d32'), root),
        kid(cylinder('Stop button', 'obstacle', 30, 12, pose(60, 40, p.h), '#212121'), root),
      ];
    } },
  { id: 'stacklight', cat: 'Safety', name: 'Stack light', desc: 'Red, amber and green tower light on a pole.',
    params: [{ k: 'h', label: 'Pole height', def: 1600 }],
    build: (f, at, p) => {
      const root = cylinder('Stack light pole', 'obstacle', 30, p.h, on(at, f), '#9aa3ad');
      return [root, ...['#d32f2f', '#f9a825', '#2e7d32'].map((c, i) => kid(cylinder(['Red', 'Amber', 'Green'][i] + ' lamp', 'obstacle', 70, 80, pose(0, 0, p.h + (2 - i) * 82), c), root, { opacity: 0.85 }))];
    } },
  // ---------------------------------------------------------------- Conveyors
  { id: 'belt', cat: 'Conveyors', name: 'Belt conveyor', desc: 'Frame, belt, end rollers and legs. Runs along +X from the feed end.',
    params: [{ k: 'l', label: 'Length', def: 1200 }, { k: 'w', label: 'Belt width', def: 300 }, { k: 'h', label: 'Belt height', def: 750 }],
    build: (f, at, p) => conveyor(f, at, p.l, p.w, p.h) },
  { id: 'rollers', cat: 'Conveyors', name: 'Roller conveyor', desc: 'Side rails, gravity or powered rollers and legs. Runs along +X.',
    params: [{ k: 'l', label: 'Length', def: 2000 }, { k: 'w', label: 'Between frames', def: 600 }, { k: 'h', label: 'Top of rollers', def: 600 }, { k: 'pitch', label: 'Roller pitch', def: 100, min: 50 }],
    build: (f, at, p) => {
      const top = p.h, rd = 50;
      const root = box('Roller conveyor rail', 'fixture', [p.l, 40, 120], on(at, f, top - 90), '#5b6670');
      const out = [root];
      root.pose.y -= p.w / 2 + 20;
      out.push(kid(box('Roller conveyor rail', 'fixture', [p.l, 40, 120], pose(0, p.w + 40), '#5b6670'), root));
      for (let x = -p.l / 2 + p.pitch / 2; x < p.l / 2; x += p.pitch)
        out.push(kid(cylinder('Roller', 'fixture', rd, p.w, pose(x, p.w + 20, 65, 90), '#c9ced3'), root));
      for (const x of [-p.l / 2 + 80, p.l / 2 - 80]) for (const y of [0, p.w + 40])
        out.push(kid(box('Leg', 'fixture', [50, 50, top - 90], pose(x, y, -(top - 90)), '#5b6670'), root));
      return out;
    } },
  // ---------------------------------------------------------------- Pallets + boxes
  { id: 'pallet', cat: 'Pallets + boxes', name: 'Pallet', desc: 'Stringer pallet: 48 x 40 in (1219 x 1016) by default; 1200 x 800 for a EUR pallet.',
    params: [{ k: 'l', label: 'Length', def: 1219 }, { k: 'w', label: 'Width', def: 1016 }],
    build: (f, at, p) => {
      const root = box('Pallet', 'fixture', [p.l, 90, 95], on(at, f), '#b98a54');
      root.pose.y -= p.w / 2 - 45;
      const out = [root];
      out.push(kid(box('Stringer', 'fixture', [p.l, 90, 95], pose(0, p.w / 2 - 45), '#b98a54'), root));
      out.push(kid(box('Stringer', 'fixture', [p.l, 90, 95], pose(0, p.w - 90), '#b98a54'), root));
      const n = 7, gap = (p.l - n * 140) / (n - 1);
      for (let i = 0; i < n; i++) out.push(kid(box('Deck board', 'fixture', [140, p.w, 20], pose(-p.l / 2 + 70 + i * (140 + gap), p.w / 2 - 45, 95), '#d1a46c'), root));
      return out;
    } },
  { id: 'case', cat: 'Pallets + boxes', name: 'Box / case', desc: 'A cardboard case (a part the robot can handle).',
    params: [{ k: 'l', label: 'Length', def: 400 }, { k: 'w', label: 'Width', def: 300 }, { k: 'h', label: 'Height', def: 250 }, { k: 'z', label: 'Sits at height', def: 0 }],
    build: (f, at, p) => [box('Case', 'part', [p.l, p.w, p.h], on(at, f, p.z), '#c8a26b')] },
  { id: 'tote', cat: 'Pallets + boxes', name: 'Tote / bin', desc: 'Open plastic tote with walls.',
    params: [{ k: 'l', label: 'Length', def: 600 }, { k: 'w', label: 'Width', def: 400 }, { k: 'h', label: 'Height', def: 300 }, { k: 'z', label: 'Sits at height', def: 0 }],
    build: (f, at, p) => {
      const c = '#3b6ea8', root = box('Tote', 'fixture', [p.l, p.w, 10], on(at, f, p.z), c);
      return [root,
        kid(box('Tote wall', 'fixture', [p.l, 10, p.h], pose(0, p.w / 2 - 5), c), root), kid(box('Tote wall', 'fixture', [p.l, 10, p.h], pose(0, -p.w / 2 + 5), c), root),
        kid(box('Tote wall', 'fixture', [10, p.w, p.h], pose(p.l / 2 - 5), c), root), kid(box('Tote wall', 'fixture', [10, p.w, p.h], pose(-p.l / 2 + 5), c), root)];
    } },
  // ---------------------------------------------------------------- Stands + tables
  { id: 'table', cat: 'Stands + tables', name: 'Work table', desc: 'Steel table with a top plate and four legs.',
    params: [{ k: 'l', label: 'Length', def: 1200 }, { k: 'w', label: 'Width', def: 800 }, { k: 'h', label: 'Height', def: 850 }],
    build: (f, at, p) => {
      const root = box('Table top', 'fixture', [p.l, p.w, 30], on(at, f, p.h - 30), '#8a9aa8');
      const out = [root];
      for (const x of [-p.l / 2 + 40, p.l / 2 - 40]) for (const y of [-p.w / 2 + 40, p.w / 2 - 40])
        out.push(kid(box('Leg', 'fixture', [60, 60, p.h - 30], pose(x, y, -(p.h - 30)), '#5b6670'), root));
      return out;
    } },
  { id: 'riser', cat: 'Stands + tables', name: 'Robot riser / pedestal', desc: 'Steel riser with a base plate. Put the robot base on top (Robot > base Z).',
    params: [{ k: 's', label: 'Top plate size', def: 500 }, { k: 'h', label: 'Height', def: 400 }],
    build: (f, at, p) => {
      const root = box('Riser base plate', 'fixture', [p.s + 100, p.s + 100, 25], on(at, f), '#5b6670');
      return [root, kid(box('Riser column', 'fixture', [p.s * 0.7, p.s * 0.7, p.h - 50], pose(0, 0, 25), '#f0c419'), root),
        kid(box('Riser top plate', 'fixture', [p.s, p.s, 25], pose(0, 0, p.h - 25), '#5b6670'), root)];
    } },
  { id: 'nest', cat: 'Stands + tables', name: 'Part nest', desc: 'Fixture plate with locating pins for one part.',
    params: [{ k: 'l', label: 'Length', def: 300 }, { k: 'w', label: 'Width', def: 200 }, { k: 'z', label: 'Sits at height', def: 0 }],
    build: (f, at, p) => {
      const root = box('Nest plate', 'fixture', [p.l, p.w, 20], on(at, f, p.z), '#9aa3ad');
      return [root, ...[[-1, -1], [1, 1]].map(([sx, sy]) => kid(cylinder('Locating pin', 'fixture', 12, 25, pose(sx * (p.l / 2 - 25), sy * (p.w / 2 - 25), 20), '#3a3f45'), root))];
    } },
  // ---------------------------------------------------------------- Sensors
  { id: 'photoeye', cat: 'Sensors', name: 'Photo-eye + reflector', desc: 'Retro-reflective photo-eye across a lane (e.g. a conveyor).',
    params: [{ k: 'gap', label: 'Lane width', def: 400 }, { k: 'z', label: 'Beam height', def: 800 }],
    build: (f, at, p) => {
      const root: CellObject = { ...box('Photo-eye', 'fixture', [30, 40, 60], on(at, f, p.z - 30), '#f0c419'),
        sensor: { kind: 'photo-eye', zone: [-8, 25, 22, 8, p.gap - 10, 38], out: { to: 'plc', tag: 'PE_1' } } };
      return [root, kid(box('Reflector', 'fixture', [30, 8, 60], pose(0, p.gap), '#9aa3ad'), root),
        kid(box('Beam', 'fixture', [4, p.gap - 30, 4], pose(0, p.gap / 2, 28), '#ff3030'), root, { opacity: 0.4, collide: false })];
    } },
  { id: 'prox', cat: 'Sensors', name: 'Proximity sensor', desc: 'M18 inductive sensor on a bracket, facing down.',
    params: [{ k: 'z', label: 'Height', def: 800 }, { k: 'range', label: 'Sensing range', def: 8, min: 1 }],
    build: (f, at, p) => {
      const root: CellObject = { ...box('Prox bracket', 'fixture', [60, 40, 6], on(at, f, p.z), '#9aa3ad'),
        sensor: { kind: 'prox', zone: [-15, -15, -40 - p.range, 15, 15, -40], out: { to: 'plc', tag: 'Prox_1' } } };
      return [root, kid(cylinder('Prox sensor', 'fixture', 18, 70, pose(0, 0, -40), '#3a6ea5'), root)];
    } },
  { id: 'mat', cat: 'Sensors', name: 'Safety mat', desc: 'Pressure-sensitive floor mat.',
    params: [{ k: 'l', label: 'Length', def: 1000 }, { k: 'w', label: 'Width', def: 750 }],
    build: (f, at, p) => [{ ...plate('Safety mat', 'obstacle', p.l, p.w, on(at, f), '#f2c200'), collide: false,
      sensor: { kind: 'safety mat', zone: [-p.l / 2, -p.w / 2, 0, p.l / 2, p.w / 2, 300], out: { to: 'plc', tag: 'Mat_Occupied' } } }] },
  // ---------------------------------------------------------------- Machines
  { id: 'cnc', cat: 'Machines', name: 'CNC machine', desc: 'Machine enclosure with a front door opening and a control pendant.',
    params: [{ k: 'l', label: 'Width', def: 2200 }, { k: 'w', label: 'Depth', def: 1800 }, { k: 'h', label: 'Height', def: 2400 }],
    build: (f, at, p) => {
      const root = box('CNC machine', 'machine', [p.l, p.w, p.h], on(at, f), '#e8ecef');
      return [root,
        kid(box('Door window', 'machine', [p.l * 0.4, 10, p.h * 0.35], pose(-p.l * 0.1, -p.w / 2 - 5, p.h * 0.4), '#7fb3d5'), root, { opacity: 0.6 }),
        kid(box('Control panel', 'machine', [350, 120, 500], pose(p.l / 2 - 250, -p.w / 2 - 60, p.h * 0.45), '#2b2f33'), root)];
    } },
  { id: 'cabinet', cat: 'Machines', name: 'Electrical cabinet', desc: 'Floor-standing control panel enclosure with a disconnect handle.',
    params: [{ k: 'l', label: 'Width', def: 800 }, { k: 'w', label: 'Depth', def: 400 }, { k: 'h', label: 'Height', def: 2000 }],
    build: (f, at, p) => {
      const root = box('Electrical cabinet', 'machine', [p.l, p.w, p.h], on(at, f), '#c9cfd4');
      return [root, kid(box('Disconnect handle', 'machine', [40, 60, 160], pose(p.l / 2 - 80, -p.w / 2 - 30, p.h * 0.55), '#d32f2f'), root),
        kid(box('Door seam', 'machine', [4, 4, p.h - 40], pose(0, -p.w / 2 - 2, 20), '#7d868f'), root)];
    } },
  { id: 'forklift', cat: 'Material handling', name: 'Forklift', desc: 'Counterbalance forklift with mast, forks and overhead guard; forks point along +X. Parked (the PL-01 line drives its own three).',
    params: [{ k: 'l', label: 'Body length', def: 2400 }, { k: 'w', label: 'Width', def: 1150 }, { k: 'c', label: 'Color (0 orange, 1 blue, 2 green)', def: 0 }],
    build: (f, at, p) => {
      const col = ['#d9822b', '#2f7fd0', '#3a9d4a'][Math.max(0, Math.min(2, Math.round(p.c)))];
      const L = p.l, W = p.w;
      const root = box('Forklift', 'machine', [L, W, 900], on(at, f, 150), col);
      const out = [root];
      out.push(kid(box('Counterweight', 'machine', [450, W, 600], pose(-L / 2 + 225, 0, 900), '#3b4148'), root));
      for (const x of [-L / 2 + 300, L / 2 - 400]) for (const y of [-W / 2 + 60, W / 2 - 60]) out.push(kid(box('Guard post', 'machine', [60, 60, 1250], pose(x, y, 900), '#2b2f33'), root));
      out.push(kid(box('Overhead guard', 'machine', [L - 600, W, 60], pose(-50, 0, 2150), '#2b2f33'), root));
      out.push(kid(box('Seat', 'machine', [500, 500, 400], pose(-200, 0, 900), '#1c1f23'), root));
      for (const y of [-W / 2 + 150, W / 2 - 150]) out.push(kid(box('Mast', 'machine', [120, 120, 2300], pose(L / 2 + 80, y, -150), '#2b2f33'), root));
      out.push(kid(box('Carriage', 'machine', [80, W - 100, 500], pose(L / 2 + 180, 0, -100), '#2b2f33'), root));
      for (const y of [-280, 280]) out.push(kid(box('Fork', 'tool', [1070, 120, 45], pose(L / 2 + 760, y, -140), '#3b4148'), root));
      for (const x of [-L / 2 + 400, L / 2 - 350]) for (const y of [-W / 2 - 20, W / 2 + 20]) out.push(kid(box('Wheel', 'machine', [560, 200, 560], pose(x, y, -150), '#15181b'), root));
      return out;
    } },
  // ---------------------------------------------------------------- People
  { id: 'worker', cat: 'People', name: 'Worker', desc: 'Standing operator (about 1.75 m) facing -X.',
    params: [],
    build: (f, at) => worker(f, at.x, at.y) },
];

/** Build a library item at (x, y) on the floor, with params defaulted. */
export function buildLib(id: string, floor: number, x: number, y: number, params: Record<string, number> = {}): CellObject[] {
  const it = LIBRARY.find((i) => i.id === id);
  if (!it) throw new Error(`No library item ${id}`);
  const p: Record<string, number> = {};
  for (const q of it.params) p[q.k] = Number.isFinite(params[q.k]) ? params[q.k] : q.def;
  return it.build(floor, pose(x, y, 0), p);
}
