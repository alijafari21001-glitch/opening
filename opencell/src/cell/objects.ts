// Cell objects: tooling bodies (attached to the faceplate) and fixtures / parts / obstacles in the cell.
// Primitives have their origin at the center of the bottom face and extend along +Z.
import { XYZWPR, wprToMat } from '../kin/math';

export type ObjKind = 'box' | 'cylinder' | 'mesh';
export type ObjRole = 'tool' | 'fixture' | 'part' | 'obstacle' | 'machine' | 'worker';
export type MeshUnit = 'mm' | 'cm' | 'm' | 'in';
export type MeshFormat = 'stl' | 'obj' | 'glb';

export interface CellObject {
  id: string;
  name: string;
  kind: ObjKind;
  role: ObjRole;
  /** UTOOL number this body belongs to (role 'tool'); pose is then relative to the faceplate. */
  tool?: number;
  /** box: X, Y, Z size; cylinder: diameter, (unused), height. mm */
  size: [number, number, number];
  color: string;
  pose: XYZWPR;
  mesh?: { id: string; file: string; unit: MeshUnit; format: MeshFormat };
  /** Gripper finger: moves along X when the gripper opens (-1 / +1 side). */
  finger?: -1 | 1;
  /** How far a finger moves in (mm, along X) when the gripper closes; default 8. */
  stroke?: number;
  /** Robot (index in the cell) a tool body belongs to; default 0. */
  robot?: number;
  hidden?: boolean;
  /** Parent cell object (machine link, preset sub-body): pose is then relative to the parent. */
  parent?: string;
  /** 0..1, for see-through bodies like fence mesh. */
  opacity?: number;
  /** false = shown only, never checked for collisions (e.g. a whole factory layout as one mesh). */
  collide?: boolean;
  /** Live sensor (photo-eye, prox, light curtain, mat): see sim/sensors.ts. */
  sensor?: SensorCfg;
}

/** A sensor detects parts, people and robot tooling inside its zone (a box in the object's own frame, mm). */
export interface SensorCfg {
  kind: 'photo-eye' | 'prox' | 'light curtain' | 'safety mat';
  zone: [number, number, number, number, number, number];
  out: { to: 'plc'; tag: string } | { to: 'robot'; port: 'DI' | 'RI' | 'UI'; idx: number };
  /** Output 1 when the zone is clear instead of when it is blocked (safety devices are often wired this way). */
  invert?: boolean;
}

export const UNIT_MM: Record<MeshUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

export const ROLE_LABEL: Record<ObjRole, string> = { tool: 'Tooling', fixture: 'Fixture', part: 'Part', obstacle: 'Obstacle', machine: 'Machine', worker: 'Worker' };
export const ROLE_COLOR: Record<ObjRole, string> = { tool: '#5b6670', fixture: '#8a9aa8', part: '#2f80ed', obstacle: '#c0504d', machine: '#2f6db5', worker: '#d9822b' };

let counter = 0;
export function newId(prefix = 'o') { return `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`; }

const pose = (x = 0, y = 0, z = 0, w = 0, p = 0, r = 0): XYZWPR => ({ x, y, z, w, p, r });

export function box(name: string, role: ObjRole, size: [number, number, number], at: XYZWPR, color = ROLE_COLOR[role], tool?: number): CellObject {
  return { id: newId(), name, kind: 'box', role, size, color, pose: at, tool };
}
export function cylinder(name: string, role: ObjRole, dia: number, h: number, at: XYZWPR, color = ROLE_COLOR[role], tool?: number): CellObject {
  return { id: newId(), name, kind: 'cylinder', role, size: [dia, dia, h], color, pose: at, tool };
}

const mesh = (name: string, id: string, file: string, size: [number, number, number], at: XYZWPR, color: string, tool: number): CellObject =>
  ({ id: newId(), name, kind: 'mesh', role: 'tool', tool, size, color, pose: at, mesh: { id, file, unit: 'mm', format: 'stl' } });

/** TCP of Gripper 1: centred between the finger pads. */
export const GRIPPER1_TCP = { x: 0, y: 0, z: 116, w: 0, p: 0, r: 0 };

/** Gripper 1: Ali's round two-jaw gripper, rebuilt in mm (tools/gen_gripper1.py). Fingers open to a 56 mm pad gap. */
export function gripper1(tool: number): CellObject[] {
  return [
    mesh('Gripper 1 body', 'preset:gripper1-body', 'gripper1_body.stl', [80, 80, 68], pose(), '#4a5560', tool),
    { ...mesh('Gripper 1 finger L', 'preset:gripper1-finger-l', 'gripper1_finger_left.stl', [18, 24, 62], pose(-35, 0, 68), '#b8c2cc', tool), finger: -1 },
    { ...mesh('Gripper 1 finger R', 'preset:gripper1-finger-r', 'gripper1_finger_right.stl', [18, 24, 62], pose(35, 0, 68), '#b8c2cc', tool), finger: 1 },
  ];
}

/** Simple parallel gripper built from boxes (TCP z=120). */
export function boxGripper(tool: number): CellObject[] {
  return [
    cylinder('Adapter plate', 'tool', 64, 18, pose(), '#9aa3ad', tool),
    box('Gripper body', 'tool', [90, 40, 45], pose(0, 0, 18), '#3a3f45', tool),
    { ...box('Finger L', 'tool', [12, 26, 57], pose(-20, 0, 63), '#9aa3ad', tool), finger: -1 },
    { ...box('Finger R', 'tool', [12, 26, 57], pose(20, 0, 63), '#9aa3ad', tool), finger: 1 },
  ];
}

/** Default tooling: UT1 Gripper 1 (TCP z=116), UT2 suction cup (TCP z=95), UT3 box gripper (TCP z=120). */
export function defaultTooling(): CellObject[] {
  return [
    ...gripper1(1),
    ...boxGripper(3),
    cylinder('Adapter plate', 'tool', 64, 15, pose(), '#9aa3ad', 2),
    cylinder('Vacuum tube', 'tool', 18, 65, pose(0, 0, 15), '#3a3f45', 2),
    cylinder('Suction cup', 'tool', 34, 15, pose(0, 0, 80), '#2b2b2b', 2),
  ];
}

/** Guess the unit of a mesh from its largest dimension in file units. */
export function guessUnit(maxDim: number, format: MeshFormat): MeshUnit {
  if (format === 'glb') return 'm';
  if (maxDim < 3) return 'm';
  return 'mm';
}

/** Pose for a cylinder given by its center (ROBOGUIDE-style primitive) instead of its bottom face. */
export function centered(at: XYZWPR, h: number): XYZWPR {
  const R = wprToMat(at.w, at.p, at.r);
  return { ...at, x: at.x - R[2] * h / 2, y: at.y - R[5] * h / 2, z: at.z - R[8] * h / 2 };
}

const child = (o: CellObject, parent: CellObject, extra: Partial<CellObject> = {}): CellObject => ({ ...o, parent: parent.id, ...extra });

/** Pointer tool: adapter, shaft and a fine tip. TCP at the tip (Z 150). */
export const POINTER_TCP = { x: 0, y: 0, z: 150, w: 0, p: 0, r: 0 };
export function pointer(tool: number): CellObject[] {
  return [
    cylinder('Pointer adapter', 'tool', 63, 12, pose(), '#9aa3ad', tool),
    cylinder('Pointer shaft', 'tool', 16, 113, pose(0, 0, 12), '#3a3f45', tool),
    cylinder('Pointer tip', 'tool', 4, 25, pose(0, 0, 125), '#c62828', tool),
  ];
}

/** Safety fence: posts and see-through panels around a rectangle (center cx,cy; size lx,ly), gate on the -Y side. */
export function fence(floor: number, cx = 0, cy = 0, lx = 2400, ly = 2400, h = 1800): CellObject[] {
  const root = box('Fence', 'obstacle', [60, 60, h], pose(cx - lx / 2, cy - ly / 2, floor), '#f0c419');
  const out: CellObject[] = [root];
  const post = (x: number, y: number) => out.push(child(box('Fence post', 'obstacle', [60, 60, h], pose(x, y, 0), '#f0c419'), root));
  const panel = (x: number, y: number, len: number, alongX: boolean) => out.push(child(
    box('Fence panel', 'obstacle', alongX ? [len, 20, h - 200] : [20, len, h - 200], pose(x, y, 150), '#7a8794'), root, { opacity: 0.35 }));
  post(lx, 0); post(lx, ly); post(0, ly);
  panel(lx / 2, ly, lx - 60, true);
  panel(0, ly / 2, ly - 60, false); panel(lx, ly / 2, ly - 60, false);
  // -Y side: panel with a 900 mm gate opening at the +X end
  const g = 900;
  panel((lx - g) / 2, 0, lx - g - 60, true);
  post(lx - g, 0);
  return out;
}

/** Belt conveyor: frame, belt, end rollers and legs. Root origin at the floor under the feed end; belt runs +X. */
export function conveyor(floor: number, at: XYZWPR, len = 1200, width = 300, height = 300): CellObject[] {
  const root = box('Conveyor frame', 'fixture', [len, width + 40, 60], { ...at, z: floor + height - 70 }, '#5b6670');
  const out: CellObject[] = [root];
  out.push(child(box('Belt', 'fixture', [len - 20, width, 10], pose(0, 0, 60), '#262a2e'), root));
  for (const x of [-len / 2 + 30, len / 2 - 30]) out.push(child(cylinder('Roller', 'fixture', 60, width + 10, { x, y: width / 2 + 5, z: 40, w: 90, p: 0, r: 0 }, '#9aa3ad'), root));
  for (const x of [-len / 2 + 60, len / 2 - 60]) for (const y of [-width / 2, width / 2])
    out.push(child(box('Leg', 'fixture', [40, 40, height - 70], pose(x, y, -(height - 70)), '#5b6670'), root));
  return out;
}

/** Simple standing worker (about 1.75 m) built from primitives, facing -X. */
export function worker(floor: number, x: number, y: number, facing = 180): CellObject[] {
  const c = '#d9822b', skin = '#e0b48f', dark = '#2f3a46';
  const root = box('Worker', 'worker', [240, 380, 20], { x, y, z: floor, w: 0, p: 0, r: facing }, dark);
  root.opacity = 0;
  const k = (o: CellObject) => child(o, root);
  return [root,
    k(box('Leg L', 'worker', [140, 130, 820], pose(0, -95, 0), dark)),
    k(box('Leg R', 'worker', [140, 130, 820], pose(0, 95, 0), dark)),
    k(box('Torso', 'worker', [230, 420, 560], pose(0, 0, 820), c)),
    k(box('Arm L', 'worker', [100, 100, 600], pose(0, -265, 740), c)),
    k(box('Arm R', 'worker', [100, 100, 600], pose(0, 265, 740), c)),
    k(cylinder('Neck', 'worker', 90, 60, pose(0, 0, 1380), skin)),
    k(cylinder('Head', 'worker', 190, 230, pose(0, 0, 1430), skin)),
    k(cylinder('Hard hat', 'worker', 230, 60, pose(0, 0, 1620), '#f0c419')),
  ];
}

/** Lab 5 machine from the LR200Ver3 workcell: a block with three sticks (cylinders) poking out.
 *  Block size is an estimate (its CAD file is not in the .frw); stick positions are exact. */
export function lab5Cube(at: XYZWPR, color = '#2f6db5'): CellObject[] {
  const root = box('Cube', 'machine', [84, 84, 170], at, color);
  const stick = (name: string, p: XYZWPR) => child(cylinder(name, 'machine', 10, 100, centered(p, 100), '#ffffff'), root);
  return [root,
    stick('HighStick', pose(0, -42, 132, -30, 0, 0)),
    stick('LowStick', pose(2, 42, 104, 45, 0, 0)),
    stick('TopStick', pose(0, 2.5, 177, 90, 0, 0)),
  ];
}
