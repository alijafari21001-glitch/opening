// PLC + robot demo cell: an infeed conveyor run by the OpenRung PLC, a photo-eye at the end stop,
// an LR Mate 200iD with Gripper 1 that picks each part and drops it in a bin.
//
// Wiring (field devices are PLC tags, the robot talks to the PLC over DI/DO):
//   Conv_Motor   PLC output   -> conveyor motor
//   Part_At_Pick photo-eye    -> PLC input
//   Robot_Start  PLC tag      -> DI[1] Part ready
//   DO[1] Part picked         -> Robot_Picked PLC tag
// Without a PLC the cell wires itself: the conveyor runs until a part reaches the eye, and the eye drives DI[1].
import { CellState, newRobot } from '../state';
import { CellObject, box, gripper1, GRIPPER1_TCP, fence, conveyor } from '../cell/objects';
import { LRMATE_200ID } from '../kin/robot';
import { TPProgram, TPPos, newProgram } from '../tp/program';

export const DEMO_FLOOR = -330;
export const BELT = { x0: -520, x1: 330, y: -450, width: 200, height: 300 };
export const BELT_TOP = DEMO_FLOOR + BELT.height;
/** Part (cube) and where it stops: its centre at the end stop. */
export const PART = 50;
export const PICK = { x: 300, y: BELT.y };
export const BIN = { x: 330, y: 430, l: 260, w: 260, h: 120, stand: 180 };
export const BIN_FLOOR = DEMO_FLOOR + BIN.stand;
export const DEMO_TAGS = { motor: 'Conv_Motor', eye: 'Part_At_Pick', start: 'Robot_Start', picked: 'Robot_Picked' };
export const DEMO_LINKS = [
  { dir: 'in' as const, port: 'DI' as const, idx: 1, tag: DEMO_TAGS.start },
  { dir: 'out' as const, port: 'DO' as const, idx: 1, tag: DEMO_TAGS.picked },
];

const pose = (x: number, y: number, z: number, w = 0, p = 0, r = 0) => ({ x, y, z, w, p, r });
const down = { flip: false, up: true, front: true, turns: [0, 0, 0] as [number, number, number] };
const cart = (x: number, y: number, z: number, r = 0): TPPos => ({ uf: 0, ut: 1, cart: { pose: pose(x, y, z, 180, 0, r), cfg: down } });

export function demoCell(): CellObject[] {
  const len = BELT.x1 - BELT.x0;
  const bin = box('Bin', 'fixture', [BIN.l, BIN.w, 10], pose(BIN.x, BIN.y, BIN_FLOOR), '#3b6ea8');
  const walls: CellObject[] = [
    box('Bin wall', 'fixture', [BIN.l, 10, BIN.h], pose(0, BIN.w / 2 - 5, 10), '#3b6ea8'),
    box('Bin wall', 'fixture', [BIN.l, 10, BIN.h], pose(0, -BIN.w / 2 + 5, 10), '#3b6ea8'),
    box('Bin wall', 'fixture', [10, BIN.w, BIN.h], pose(BIN.l / 2 - 5, 0, 10), '#3b6ea8'),
    box('Bin wall', 'fixture', [10, BIN.w, BIN.h], pose(-BIN.l / 2 + 5, 0, 10), '#3b6ea8'),
  ].map((w) => ({ ...w, parent: bin.id }));
  return [
    ...gripper1(1),
    ...conveyor(DEMO_FLOOR, pose((BELT.x0 + BELT.x1) / 2, BELT.y, 0), len, BELT.width, BELT.height),
    box('End stop', 'fixture', [10, BELT.width, 40], pose(PICK.x + PART / 2 + 8, BELT.y, BELT_TOP), '#d33f3f'),
    box('Photo-eye', 'fixture', [30, 30, 60], pose(PICK.x, BELT.y - BELT.width / 2 - 30, BELT_TOP), '#f0c419'),
    box('Reflector', 'fixture', [30, 10, 60], pose(PICK.x, BELT.y + BELT.width / 2 + 20, BELT_TOP), '#9aa3ad'),
    box('Bin stand', 'fixture', [BIN.l, BIN.w, BIN.stand], pose(BIN.x, BIN.y, DEMO_FLOOR), '#8a9aa8'),
    bin, ...walls,
    ...fence(DEMO_FLOOR, 0, 0, 3200, 3200, 1400),
  ];
}

export function demoProgram(): TPProgram {
  const p = newProgram('DEMO', 'PLC pick+place');
  const pickZ = BELT_TOP + PART / 2;
  p.lines = [
    '!PLC + robot demo cell',
    '!DI[1] from PLC Robot_Start',
    '!DO[1] to PLC Robot_Picked',
    'UFRAME_NUM=0',
    'UTOOL_NUM=1',
    'DO[101:Gripper close]=OFF',
    'DO[1:Part picked]=OFF',
    'J P[1:Home] 100% FINE',
    'LBL[1:Next part]',
    'WAIT DI[1:Part ready]=ON',
    'J P[2:Above pick] 100% CNT50',
    'L P[3:Pick] 300mm/sec FINE',
    'DO[101:Gripper close]=ON',
    'WAIT .30(sec)',
    'L P[2:Above pick] 800mm/sec CNT50',
    'DO[1:Part picked]=ON',
    'J P[4:Above bin] 100% CNT50',
    'L P[5:Drop] 600mm/sec FINE',
    'DO[101:Gripper close]=OFF',
    'WAIT .30(sec)',
    'L P[4:Above bin] 800mm/sec CNT50',
    'DO[1:Part picked]=OFF',
    'R[1:Parts]=R[1:Parts]+1',
    'JMP LBL[1]',
  ];
  p.pos = {
    1: { uf: 0, ut: 1, joint: [0, 0, 0, 0, -90, 0], cmt: 'Home' },
    2: { ...cart(PICK.x, PICK.y, pickZ + 150), cmt: 'Above pick' },
    3: { ...cart(PICK.x, PICK.y, pickZ), cmt: 'Pick' },
    4: { ...cart(BIN.x, BIN.y, BIN_FLOOR + 10 + BIN.h + 120), cmt: 'Above bin' },
    5: { ...cart(BIN.x, BIN.y, BIN_FLOOR + 10 + BIN.h + 40), cmt: 'Drop' },
  };
  return p;
}

/** Replace the cell with the demo cell (other programs stay). */
export function loadDemo(s: CellState) {
  s.robots = [newRobot(LRMATE_200ID)]; s.active = 0;
  s.q = [0, 0, 0, 0, -90, 0];
  s.override = 100;
  s.objects = demoCell();
  s.tools[0] = { comment: 'Gripper 1', pose: { ...GRIPPER1_TCP } };
  s.utool = 1; s.uframe = 0;
  s.programs.DEMO = demoProgram();
  s.selected = 'DEMO';
  s.R[1] = { v: 0, cmt: 'Parts' };
  s.ioCmt = { ...s.ioCmt, DI: { ...(s.ioCmt.DI ?? {}), 1: 'Part ready' }, DO: { ...(s.ioCmt.DO ?? {}), 1: 'Part picked', 101: 'Gripper close' } };
  s.plcLinks = DEMO_LINKS.map((l) => ({ ...l }));
  s.world = { name: 'PLC_Robot_Demo', floorSize: 4000, floorColor: '#eef1f4', gridSpacing: 100, gridColor: '#b4bcc5', floorZ: DEMO_FLOOR, sim: 'demo' };
  s.opts = { teachTool: true, envelope: false, collisions: false, lock: false };
  if (!s.presets.includes('gripper1')) s.presets.push('gripper1');
  s.selectedObj = null;
  s.message('info', 'PLC robot demo loaded: conveyor + photo-eye wired to the PLC, DI[1]/DO[1] linked to Robot_Start/Robot_Picked. Run DEMO in AUTO.');
  s.emit();
}
