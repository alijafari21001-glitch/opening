// PL-01 production line cell: Ali's 40 x 25 m factory layout with two working, teachable robots.
//  Robot 1 (group 1): R-2000iC/210L palletizer on the pedestal between the two pallet lines. It takes cases off the end
//                     of the case conveyor and stacks them 2 x 2, 3 layers high on pallet A (left line) and pallet B (right line).
//  Robot 2 (group 2): M-20iA on the 11.5 m floor rail in front of the three VMCs. It takes blanks from the infeed table,
//                     loads each VMC through its door, and puts finished parts on the outfeed table.
// The layout's own coordinates (mm, slab corner at 0,0) are shifted by PL01_ORIGIN so the cell origin sits mid-floor.
import { CellState, RobotCtrl, newRobot } from '../state';
import { CellObject, box, cylinder } from '../cell/objects';
import { R2000IC_210L, M20IA, ik, Joints, RobotModel } from '../kin/robot';
import { Frame, XYZWPR, poseToFrame, fromCols, matToWpr } from '../kin/math';
import { TPPos, TPProgram, newProgram } from '../tp/program';
import { lite } from '../tp/interp';
import { productionLine, PL01_ORIGIN } from '../cell/productionLine';
import { buildLib } from '../cell/library';

/** Layout mm -> cell mm. */
export const L = (x: number, y: number, z = 0) => ({ x: x - PL01_ORIGIN.x, y: y - PL01_ORIGIN.y, z });

/** Robot 1: base on the pedestal (top at z 400), J1 = 0 facing the conveyor (+Y in the layout). */
export const PAL_BASE: XYZWPR = { ...L(34500, 11500, 400 + R2000IC_210L.baseZ), w: 0, p: 0, r: 90 };
/** Robot 2: rail E1 = 0 with the carriage at the left end of the rail (layout X 1450), carriage top z 450. */
export const MT_BASE: XYZWPR = { ...L(1450, 21000, 450 + M20IA.baseZ), w: 0, p: 0, r: 0 };
export const MT_RAIL = { length: 10600, speed: 2000 };

/** Cases (600 x 400 x 400 mm), pallets (48 x 40 in), pattern: 2 x 2 per layer, 3 layers. */
export const CASE = { l: 600, w: 400, h: 400 };
export const PALLET = { l: 1219, w: 1016, h: 140 };
export const PER_PALLET = 12;
/** Blank / finished part on the machine tending side. */
export const BLANK = { l: 160, w: 160, h: 100 };

export const PAL_TCP: XYZWPR = { x: 0, y: 0, z: 360, w: 0, p: 0, r: 0 };
export const MT_TCP: XYZWPR = { x: 0, y: 0, z: 240, w: 0, p: 0, r: 0 };

/** Cell I/O (one bus shared by both controllers and the line PLC). */
export const PL01_IO = {
  DI: {
    1: 'Case at pick', 2: 'Pallet A ready', 3: 'Pallet B ready',
    11: 'Infeed loaded', 12: 'Outfeed room',
    21: 'VMC1 door open', 22: 'VMC2 door open', 23: 'VMC3 door open',
    31: 'VMC1 idle', 32: 'VMC2 idle', 33: 'VMC3 idle',
    41: 'VMC1 part done', 42: 'VMC2 part done', 43: 'VMC3 part done',
  },
  DO: {
    1: 'Vacuum on', 2: 'Pallet A full', 3: 'Pallet B full',
    11: 'Gripper close', 16: 'Refill infeed', 17: 'Clear outfeed',
    21: 'VMC1 door open', 22: 'VMC2 door open', 23: 'VMC3 door open',
    31: 'VMC1 cycle start', 32: 'VMC2 cycle start', 33: 'VMC3 cycle start',
  },
};

const pose = (x: number, y: number, z: number, w = 0, p = 0, r = 0): XYZWPR => ({ x, y, z, w, p, r });
const DOWN = { w: 180, p: 0, r: 0 };
/** Tool pointing along robot world +Y (into a VMC), fingers vertical. */
const INTO_Y = (() => { const [w, p, r] = matToWpr(fromCols([0, 0, -1], [-1, 0, 0], [0, 1, 0])); return { w, p, r }; })();

/** Teach a Cartesian point in robot world: solve IK from `seed` (rail at `e`) and store the configuration it lands in. */
function teach(m: RobotModel, tool: XYZWPR, at: XYZWPR, seed: Joints, e?: number, cmt?: string): { pos: TPPos; q: Joints } {
  const f: Frame = poseToFrame(at);
  const arm: Frame = e === undefined ? f : { R: f.R, p: [f.p[0] - e, f.p[1], f.p[2]] };
  const sol = ik(m, arm, poseToFrame(tool), seed);
  if (typeof sol === 'string') throw new Error(`PL-01: ${cmt ?? 'point'} ${JSON.stringify(at)} is ${sol}`);
  return { pos: { uf: 0, ut: 1, cart: { pose: at, cfg: lite(sol.config) }, ...(e !== undefined ? { ext: [e] } : {}), cmt }, q: sol.q };
}
const jointPos = (q: Joints, e?: number): TPPos => ({ uf: 0, ut: 1, joint: [...q], ...(e !== undefined ? { ext: [e] } : {}) });

// ------------------------------------------------------------------ robot 1: palletizer

/** Robot-world point of a layout point, for the palletizer (base turned 90 deg). */
const palPt = (x: number, y: number, z: number) => ({ x: y - 11500, y: -(x - 34500), z: z - (400 + R2000IC_210L.baseZ) });

export const PAL_PICK = palPt(34500, 13400, 800 + CASE.h);         // top of a case at the conveyor end stop
export const PAL_A = palPt(32500 - 200, 11500 - 300, 520 + PALLET.h + CASE.h); // first case on pallet A
export const PAL_B = palPt(36500 - 200, 11500 - 300, 520 + PALLET.h + CASE.h);

function palPrograms(): Record<string, TPProgram> {
  const m = R2000IC_210L;
  const seed: Joints = [0, 0, 0, 0, -90, 0];
  const home = teach(m, PAL_TCP, pose(1300, 0, 750, DOWN.w, DOWN.p, DOWN.r), seed, undefined, 'Home');
  const above = teach(m, PAL_TCP, pose(PAL_PICK.x, PAL_PICK.y, PAL_PICK.z + 450, DOWN.w, DOWN.p, DOWN.r), home.q, undefined, 'Above pick');
  const pick = teach(m, PAL_TCP, pose(PAL_PICK.x, PAL_PICK.y, PAL_PICK.z, DOWN.w, DOWN.p, DOWN.r), above.q, undefined, 'Pick');
  const a = teach(m, PAL_TCP, pose(PAL_A.x, PAL_A.y, PAL_A.z, DOWN.w, DOWN.p, DOWN.r), home.q, undefined, 'Place A');
  const b = teach(m, PAL_TCP, pose(PAL_B.x, PAL_B.y, PAL_B.z, DOWN.w, DOWN.p, DOWN.r), home.q, undefined, 'Place B');

  const main = newProgram('PAL_MAIN', 'Palletize A/B');
  main.lines = [
    '!Palletize cases from the conveyor',
    '!onto pallet A (left) and B (right)',
    'UFRAME_NUM=0',
    'UTOOL_NUM=1',
    'PAYLOAD[1]',
    'DO[1:Vacuum on]=OFF',
    'J P[1:Home] 100% FINE',
    'LBL[1:Next case]',
    'WAIT DI[1:Case at pick]=ON',
    'J P[2:Above pick] 100% CNT50',
    'L P[3:Pick] 1200mm/sec FINE',
    'DO[1:Vacuum on]=ON',
    'WAIT .20(sec)',
    'L P[2:Above pick] 2000mm/sec CNT50',
    'IF R[3:Pallet]=2,JMP LBL[20]',
    '!Pallet A',
    'WAIT DI[2:Pallet A ready]=ON',
    'CALL PAL_OFS(R[1:Count A])',
    'J P[4:Place A] 100% CNT50 Offset,PR[2:Approach]',
    'L P[4:Place A] 1000mm/sec FINE Offset,PR[1:Place]',
    'DO[1:Vacuum on]=OFF',
    'WAIT .20(sec)',
    'L P[4:Place A] 2000mm/sec CNT50 Offset,PR[2:Approach]',
    'R[1:Count A]=R[1:Count A]+1',
    'R[5:Cases total]=R[5:Cases total]+1',
    'IF R[1:Count A]<R[8:Per pallet],JMP LBL[1]',
    'DO[2:Pallet A full]=PULSE,1.0sec',
    'R[1:Count A]=0',
    'R[3:Pallet]=2',
    'JMP LBL[1]',
    'LBL[20:Pallet B]',
    'WAIT DI[3:Pallet B ready]=ON',
    'CALL PAL_OFS(R[2:Count B])',
    'J P[5:Place B] 100% CNT50 Offset,PR[2:Approach]',
    'L P[5:Place B] 1000mm/sec FINE Offset,PR[1:Place]',
    'DO[1:Vacuum on]=OFF',
    'WAIT .20(sec)',
    'L P[5:Place B] 2000mm/sec CNT50 Offset,PR[2:Approach]',
    'R[2:Count B]=R[2:Count B]+1',
    'R[5:Cases total]=R[5:Cases total]+1',
    'IF R[2:Count B]<R[8:Per pallet],JMP LBL[1]',
    'DO[3:Pallet B full]=PULSE,1.0sec',
    'R[2:Count B]=0',
    'R[3:Pallet]=1',
    'JMP LBL[1]',
  ];
  main.pos = { 1: jointPos(home.q), 2: above.pos, 3: pick.pos, 4: a.pos, 5: b.pos };

  const ofs = newProgram('PAL_OFS', 'Pattern offset');
  ofs.lines = [
    '!Offset of case AR[1] on a pallet',
    '!2 x 2 cases per layer, 400 mm layers',
    'R[10:Layer]=AR[1] DIV 4',
    'R[11:In layer]=AR[1] MOD 4',
    'R[12:Row]=R[11:In layer] DIV 2',
    'R[13:Col]=R[11:In layer] MOD 2',
    'PR[1:Place]=LPOS-LPOS',
    'PR[1,1:Place]=R[12:Row]*600',
    'PR[1,2:Place]=R[13:Col]*(-400)',
    'PR[1,3:Place]=R[10:Layer]*400',
    'PR[2:Approach]=PR[1:Place]',
    'PR[2,3:Approach]=PR[1,3:Place]+400',
    '!4th layer is near the top of the reach: short approach',
    'IF R[10:Layer]<3,JMP LBL[1]',
    'PR[2,3:Approach]=PR[1,3:Place]+150',
    'LBL[1]',
  ];
  return { PAL_MAIN: main, PAL_OFS: ofs };
}

// ------------------------------------------------------------------ robot 2: machine tending on the rail

/** Robot-world point (rail robot: world = rail start frame, E1 adds along +X) of a layout point. */
const mtPt = (x: number, y: number, z: number) => ({ x: x - 1450, y: y - 21000, z: z - (450 + M20IA.baseZ) });
/** Table slots: 3 across (300 mm) by 2 deep (300 mm), first slot nearest the rail's left end. */
export const IN_SLOT0 = mtPt(2800, 19850, 840 + BLANK.h / 2);
export const OUT_SLOT0 = mtPt(10500, 19850, 840 + BLANK.h / 2);
export const VMC_X = [2550, 6550, 10550];
export const VMC_LOAD = mtPt(2550, 22250, 1100);
export const VMC_DOOR = mtPt(2550, 21550, 1100);
export const E_IN = 1650, E_OUT = 9350, E_VMC1 = 1100;

/** Taught positions of the rail robot; they live in position registers, Lab 6 style. */
export function mtTeach() {
  const m = M20IA;
  const seed: Joints = [-90, 0, 0, 0, -90, 0];
  const home = teach(m, MT_TCP, pose(E_IN, -700, 450, DOWN.w, DOWN.p, DOWN.r), seed, E_IN, 'Home');
  const inP = teach(m, MT_TCP, pose(IN_SLOT0.x, IN_SLOT0.y, IN_SLOT0.z, DOWN.w, DOWN.p, DOWN.r), home.q, E_IN, 'Infeed Pick');
  const outP = teach(m, MT_TCP, pose(OUT_SLOT0.x, OUT_SLOT0.y, OUT_SLOT0.z, DOWN.w, DOWN.p, DOWN.r), home.q, E_OUT, 'Outfeed Place');
  const door = teach(m, MT_TCP, pose(VMC_DOOR.x, VMC_DOOR.y, VMC_DOOR.z, INTO_Y.w, INTO_Y.p, INTO_Y.r), [90, 0, 0, 0, -90, 0], E_VMC1, 'VMC door');
  const load = teach(m, MT_TCP, pose(VMC_LOAD.x, VMC_LOAD.y, VMC_LOAD.z, INTO_Y.w, INTO_Y.p, INTO_Y.r), door.q, E_VMC1, 'VMC Load');
  return { home, inP, outP, load, door };
}

/** Register map of the rail robot (same layout idea as Lab 6: indices, counts, sizes, PRs). */
export const MT_R: Record<number, [string, number?]> = {
  1: ['VMC Number'], 2: ['Infeed Slot', 0], 3: ['Outfeed Slot', 0], 4: ['Num Columns', 3], 5: ['Num Rows', 2],
  6: ['Slot X mm', 300], 7: ['Slot Y mm', 300], 8: ['VMC Pitch mm', 4000],
  9: ['Idle DI'], 10: ['Door IO'], 11: ['Done DI'], 12: ['Start DO'], 13: ['Shift mm'], 14: ['Column'], 15: ['Row'], 16: ['Num Slots'],
  20: ['Loads'],
};
export const MT_PR: Record<number, string> = {
  1: 'Infeed Pick', 2: 'Outfeed Place', 3: 'VMC Load', 5: 'Working Offset', 6: 'VMC Target', 7: 'Pick Place Pos',
  10: 'Home', 96: 'Door Offset', 97: 'Clear Offset', 98: 'Z Offset', 99: 'Zero',
};

function mtPrograms(): Record<string, TPProgram> {
  const prog = (name: string, cmt: string, lines: string[]) => { const p = newProgram(name, cmt); p.lines = lines; return p; };
  const gOpen = prog('G_OPEN', 'Open gripper', ['!Open tool, show open', 'RO[1]=ON', 'RO[2]=OFF', 'DO[11:Gripper close]=OFF']);
  const gClose = prog('G_CLOSE', 'Close gripper', ['!Close tool, show closed', 'RO[2]=ON', 'RO[1]=OFF', 'DO[11:Gripper close]=ON']);
  const init = prog('MTINIT', 'Init PRs and Rs', [
    '!Counts and sizes, change in DATA',
    'R[4:Num Columns]=3',
    'R[5:Num Rows]=2',
    'R[6:Slot X mm]=300',
    'R[7:Slot Y mm]=300',
    'R[8:VMC Pitch mm]=4000',
    'R[16:Num Slots]=R[4:Num Columns]*R[5:Num Rows]',
    'R[20:Loads]=0',
    '!Makes PR99 a zero Cartesian PR',
    'PR[99:Zero]=LPOS',
    'PR[99:Zero]=PR[99:Zero]-PR[99:Zero]',
    '!PR98 = 0,0,120 slow approach',
    'PR[98:Z Offset]=PR[99:Zero]',
    'PR[98,3:Z Offset]=120',
    '!PR97 = 0,0,400 clearance',
    'PR[97:Clear Offset]=PR[99:Zero]',
    'PR[97,3:Clear Offset]=400',
    '!PR96 = 0,-450,0 outside the door',
    'PR[96:Door Offset]=PR[99:Zero]',
    'PR[96,2:Door Offset]=(-450)',
  ]);
  const main = prog('MTMAIN', 'Tend 3 VMCs', [
    '!Set Tool and User Frame',
    'UFRAME_NUM=0',
    'UTOOL_NUM=1',
    'CALL MTINIT',
    '!Move to Home',
    'J PR[10:Home] 100% FINE',
    '!Test tool',
    'CALL G_CLOSE',
    'WAIT .50(sec)',
    'CALL G_OPEN',
    'LBL[1]',
    'R[1:VMC Number]=1',
    'LBL[2]',
    'CALL MTVMC',
    'R[1:VMC Number]=R[1:VMC Number]+1',
    'IF R[1:VMC Number]<4,JMP LBL[2]',
    'JMP LBL[1]',
  ]);
  const vmc = prog('MTVMC', 'Serve VMC R[1]', [
    '!Indirect I/O for VMC R[1]',
    'R[9:Idle DI]=30+R[1:VMC Number]',
    'R[10:Door IO]=20+R[1:VMC Number]',
    'R[11:Done DI]=40+R[1:VMC Number]',
    'R[12:Start DO]=30+R[1:VMC Number]',
    '!Shift X and rail E1 by the VMC pitch',
    'R[13:Shift mm]=R[1:VMC Number]-1',
    'R[13:Shift mm]=R[13:Shift mm]*R[8:VMC Pitch mm]',
    'PR[5:Working Offset]=PR[99:Zero]',
    'PR[5,1:Working Offset]=R[13:Shift mm]',
    'PR[5,7:Working Offset]=R[13:Shift mm]',
    'PR[6:VMC Target]=PR[3:VMC Load]+PR[5:Working Offset]',
    '!Wait idle, open the door',
    'WAIT DI[R[9]]=ON',
    'DO[R[10]]=ON',
    'WAIT DI[R[10]]=ON',
    'IF DI[R[11]]=OFF,JMP LBL[10]',
    '!Unload the finished part',
    'J PR[6:VMC Target] 100% CNT30 Offset,PR[96:Door Offset]',
    'L PR[6:VMC Target] 600mm/sec FINE',
    'CALL G_CLOSE',
    'WAIT .30(sec)',
    'L PR[6:VMC Target] 1000mm/sec CNT30 Offset,PR[96:Door Offset]',
    'CALL MTPLACE',
    'LBL[10]',
    '!Load a blank',
    'CALL MTPICK',
    'WAIT DI[R[10]]=ON',
    'J PR[6:VMC Target] 100% CNT30 Offset,PR[96:Door Offset]',
    'L PR[6:VMC Target] 600mm/sec FINE',
    'CALL G_OPEN',
    'WAIT .30(sec)',
    'L PR[6:VMC Target] 1000mm/sec CNT30 Offset,PR[96:Door Offset]',
    '!Close door, start cycle',
    'DO[R[10]]=OFF',
    'DO[R[12]]=PULSE,0.5sec',
    'R[20:Loads]=R[20:Loads]+1',
  ]);
  const table = (name: string, cmt: string, slot: number, pr: number, di: string, act: string, pulse: string) => prog(name, cmt, [
    `WAIT ${di}=ON`,
    `!Slot offset: column, row`,
    `R[14:Column]=R[${slot}:${MT_R[slot][0]}] MOD R[4:Num Columns]`,
    `R[15:Row]=R[${slot}:${MT_R[slot][0]}] DIV R[4:Num Columns]`,
    'R[14:Column]=R[14:Column]*R[6:Slot X mm]',
    'R[15:Row]=R[15:Row]*R[7:Slot Y mm]',
    'PR[5:Working Offset]=PR[99:Zero]',
    'PR[5,1:Working Offset]=R[14:Column]',
    'PR[5,2:Working Offset]=R[15:Row]',
    `PR[7:Pick Place Pos]=PR[${pr}:${MT_PR[pr]}]+PR[5:Working Offset]`,
    'J PR[7:Pick Place Pos] 100% CNT30 Offset,PR[97:Clear Offset]',
    'L PR[7:Pick Place Pos] 1000mm/sec FINE Offset,PR[98:Z Offset]',
    'L PR[7:Pick Place Pos] 300mm/sec FINE',
    act,
    'WAIT .30(sec)',
    'L PR[7:Pick Place Pos] 1000mm/sec CNT30 Offset,PR[97:Clear Offset]',
    '!Next slot',
    `R[${slot}:${MT_R[slot][0]}]=R[${slot}:${MT_R[slot][0]}]+1`,
    `IF R[${slot}:${MT_R[slot][0]}]<R[16:Num Slots],JMP LBL[1]`,
    `R[${slot}:${MT_R[slot][0]}]=0`,
    pulse,
    'LBL[1]',
  ]);
  const pick = table('MTPICK', 'Pick a blank', 2, 1, 'DI[11:Infeed loaded]', 'CALL G_CLOSE', 'DO[16:Refill infeed]=PULSE,0.5sec');
  const place = table('MTPLACE', 'Place a part', 3, 2, 'DI[12:Outfeed room]', 'CALL G_OPEN', 'DO[17:Clear outfeed]=PULSE,0.5sec');
  return { MTMAIN: main, MTVMC: vmc, MTPICK: pick, MTPLACE: place, MTINIT: init, G_OPEN: gOpen, G_CLOSE: gClose };
}

// ------------------------------------------------------------------ tooling

const tp = (x = 0, y = 0, z = 0) => pose(x, y, z);
/** Vacuum gripper for the cases: 700 x 480 plate with six cups, TCP on the cup faces (Z 360). */
export function vacuumGripper(robot: number): CellObject[] {
  const t = (o: CellObject): CellObject => ({ ...o, robot });
  const out = [
    t(cylinder('Vacuum adapter', 'tool', 260, 60, tp(), '#2f3439', 1)),
    t(box('Vacuum mast', 'tool', [180, 180, 150], tp(0, 0, 60), '#3c4650', 1)),
    t(box('Vacuum frame', 'tool', [700, 480, 60], tp(0, 0, 210), '#2f6db5', 1)),
  ];
  for (const x of [-240, 0, 240]) for (const y of [-130, 130]) out.push(t(cylinder('Suction cup', 'tool', 80, 90, tp(x, y, 270), '#1d2024', 1)));
  return out;
}
/** Parallel gripper for the blanks: fingers close along tool X onto a 160 mm part, TCP between the pads (Z 240). */
export function blankGripper(robot: number): CellObject[] {
  const t = (o: CellObject): CellObject => ({ ...o, robot });
  return [
    t(cylinder('Gripper adapter', 'tool', 160, 40, tp(), '#2f3439', 1)),
    t(box('Gripper body', 'tool', [320, 120, 110], tp(0, 0, 40), '#4a5560', 1)),
    { ...t(box('Finger L', 'tool', [30, 90, 150], tp(-125, 0, 150), '#b8c2cc', 1)), finger: -1, stroke: 30 },
    { ...t(box('Finger R', 'tool', [30, 90, 150], tp(125, 0, 150), '#b8c2cc', 1)), finger: 1, stroke: 30 },
  ];
}

// ------------------------------------------------------------------ the cell

export function pl01Robots(): RobotCtrl[] {
  const pal = newRobot(R2000IC_210L, 'Palletizer');
  pal.base = { ...PAL_BASE };
  pal.grip = { port: 'DO', idx: 1 };
  pal.tools[0] = { comment: 'Vacuum gripper', pose: { ...PAL_TCP } };
  pal.programs = palPrograms();
  pal.selected = 'PAL_MAIN';
  pal.q = [...(pal.programs.PAL_MAIN.pos[1].joint as Joints)];
  pal.override = 100;
  pal.R[1].cmt = 'Count A'; pal.R[2].cmt = 'Count B'; pal.R[3].cmt = 'Pallet'; pal.R[3].v = 1; pal.R[5].cmt = 'Cases total';
  pal.R[8].cmt = 'Per pallet'; pal.R[8].v = PER_PALLET;
  pal.PR[1].cmt = 'Place'; pal.PR[2].cmt = 'Approach';

  const mt = newRobot(M20IA, 'Machine tender');
  mt.base = { ...MT_BASE };
  mt.rail = { ...MT_RAIL };
  mt.grip = { port: 'DO', idx: 11 };
  mt.tools[0] = { comment: 'Parallel gripper', pose: { ...MT_TCP } };
  mt.programs = mtPrograms();
  mt.selected = 'MTMAIN';
  const t = mtTeach();
  mt.q = [...t.home.q];
  mt.e = [E_IN];
  mt.override = 100;
  for (const [i, [cmt, v]] of Object.entries(MT_R)) mt.R[+i] = { cmt, v: v ?? 0 };
  for (const [i, cmt] of Object.entries(MT_PR)) mt.PR[+i].cmt = cmt;
  mt.PR[1].v = t.inP.pos; mt.PR[2].v = t.outP.pos; mt.PR[3].v = t.load.pos;
  mt.PR[10].v = jointPos(t.home.q, E_IN);
  return [pal, mt];
}

/** The electrical cabinets of the line. Click one in the cell to open its drawing in the Panel tab (same names there). */
export const PL01_CABINETS: [name: string, x: number, y: number, l: number, w: number, h: number][] = [
  ['MCP-1 Line control panel', 19200, 15800, 1200, 500, 2100],
  ['RCP-1 Palletizer controller', 28930, 12215, 1850, 720, 2000],
  ['RCP-2 Machine tender controller', 9430, 18610, 2700, 820, 2000],
];
export function pl01Cabinets(): CellObject[] {
  return PL01_CABINETS.flatMap(([name, x, y, l, w, h]) => {
    const p = L(x, y);
    const objs = buildLib('cabinet', 0, p.x, p.y, { l, w, h });
    objs[0].name = name;
    objs[0].color = name.startsWith('MCP') ? '#d9dee3' : '#e3d9a8';
    return objs;
  });
}

export const PL01_WORLD = { name: 'PL-01 Production Line', floorSize: 60000, floorColor: '#e6e9ec', gridSpacing: 1000, gridColor: '#b4bcc5', floorZ: -3, sim: 'pl01' };

/** Replace the cell with the PL-01 production line, both robots taught and ready to run in AUTO. */
export function loadPl01(s: CellState) {
  s.robots = pl01Robots();
  s.active = 0;
  s.objects = [...vacuumGripper(0), ...blankGripper(1), ...productionLine(), ...pl01Cabinets()];
  s.world = { ...PL01_WORLD };
  s.ioCmt = { DI: { ...PL01_IO.DI }, DO: { ...PL01_IO.DO } };
  s.mode = 'AUTO';
  s.coord = 'JOINT';
  s.opts = { teachTool: false, envelope: false, collisions: false, lock: true };
  if (!s.presets.includes('gripper1')) s.presets.push('gripper1');
  s.selectedObj = null;
}
