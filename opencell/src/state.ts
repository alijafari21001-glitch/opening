// Central app state for the robot cell, with a tiny change-notification mechanism.
import { Frame, XYZWPR, poseToFrame, frameToPose, compose, invert, identity } from './kin/math';
import { Joints, RobotModel, ROBOT_MODELS, LRMATE_200ID, fk, configOf, Config, singularities, Warnings } from './kin/robot';
import { TPProgram, TPPos, newProgram } from './tp/program';
import { CellObject, defaultTooling, gripper1, boxGripper, GRIPPER1_TCP } from './cell/objects';

export const DEFAULT_WORLD = { name: 'HandlingPro1', floorSize: 4000, floorColor: '#eef1f4', gridSpacing: 100, gridColor: '#b4bcc5' };

export type Coord = 'JOINT' | 'JGFRM' | 'WORLD' | 'TOOL' | 'USER';
export const COORDS: Coord[] = ['JOINT', 'JGFRM', 'WORLD', 'TOOL', 'USER'];

/** Override steps like a real pendant: VFINE, FINE, 1..5, then 5% steps. */
export const OVERRIDES: Override[] = ['VFINE', 'FINE', 1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
export type Override = 'VFINE' | 'FINE' | number;
export type Mode = 'T1' | 'T2' | 'AUTO';

export interface FrameEntry { comment: string; pose: XYZWPR }

export type LogLevel = 'info' | 'warn' | 'alarm';
export interface LogEntry { t: Date; level: LogLevel; text: string }

export interface Register { v: number; cmt: string }
export interface PosRegister { v?: TPPos; cmt: string }

export type IOPort = 'DI' | 'DO' | 'RI' | 'RO' | 'UI' | 'UO' | 'SI' | 'SO' | 'F' | 'GI' | 'GO' | 'AI' | 'AO';
export const IO_PORT_LIST: IOPort[] = ['DI', 'DO', 'RI', 'RO', 'UI', 'UO', 'SI', 'SO', 'F', 'GI', 'GO', 'AI', 'AO'];

const zeroPose = (): XYZWPR => ({ x: 0, y: 0, z: 0, w: 0, p: 0, r: 0 });
const frames = (n: number) => Array.from({ length: n }, () => ({ comment: '', pose: zeroPose() } as FrameEntry));

function defaultTools(): FrameEntry[] {
  const t = frames(10);
  t[0] = { comment: 'Gripper 1', pose: { ...GRIPPER1_TCP } };
  t[1] = { comment: 'Suction cup', pose: { x: 0, y: 0, z: 95, w: 0, p: 0, r: 0 } };
  t[2] = { comment: 'Box gripper', pose: { x: 0, y: 0, z: 120, w: 0, p: 0, r: 0 } };
  return t;
}
function defaultUsers(): FrameEntry[] {
  const u = frames(9);
  u[0] = { comment: 'Table corner', pose: { x: 250, y: -200, z: -330, w: 0, p: 0, r: 0 } };
  return u;
}

function samplePrograms(): Record<string, TPProgram> {
  const p = newProgram('SAMPLE1', 'Square + counter');
  p.lines = [
    '!Sample: move around a square',
    'UFRAME_NUM=0',
    'UTOOL_NUM=1',
    'R[1:Cycles]=0',
    'J P[1] 50% FINE',
    'LBL[1]',
    'L P[2] 250mm/sec CNT50',
    'L P[3] 250mm/sec CNT50',
    'L P[4] 250mm/sec CNT50',
    'L P[1] 250mm/sec FINE',
    'R[1:Cycles]=R[1:Cycles]+1',
    'IF R[1:Cycles]<2,JMP LBL[1]',
    'MESSAGE[Square done]',
  ];
  const cfg = { flip: false, up: true, front: true, turns: [0, 0, 0] as [number, number, number] };
  const at = (x: number, y: number, z: number) => ({ uf: 0, ut: 1, cart: { pose: { x, y, z, w: 180, p: 0, r: 0 }, cfg } });
  p.pos = { 1: at(400, -150, 50), 2: at(400, 150, 50), 3: at(250, 150, 50), 4: at(250, -150, 50) };
  return { SAMPLE1: p };
}

/** Linear rail (extended axis E1) the robot base rides on: along the robot world +X, E1 = 0..length mm. */
export interface Rail { length: number; speed: number }

/** One robot controller: arm, its frames, programs and registers. A cell can hold several. */
export interface RobotCtrl {
  name: string;
  model: RobotModel;
  q: Joints;
  /** Extended axes (E1 = rail position, mm). Empty for a fixed robot. */
  e: number[];
  /** Pose of this robot's world frame in the cell (J1 axis at J2 height; on a rail, at E1 = 0). */
  base: XYZWPR;
  rail?: Rail;
  /** Output that closes this robot's gripper or turns on its vacuum (opens the jaws when OFF). */
  grip?: { port: IOPort; idx: number };
  override: Override;
  utool: number; uframe: number; jogFrame: number;
  tools: FrameEntry[]; users: FrameEntry[]; jogs: FrameEntry[];
  programs: Record<string, TPProgram>;
  selected: string;
  R: Register[];
  PR: PosRegister[];
}

export function newRobot(model: RobotModel = LRMATE_200ID, name = 'Robot 1'): RobotCtrl {
  return {
    name, model, q: [0, 0, 0, 0, -90, 0], e: [], base: zeroPose(), override: 10, utool: 1, uframe: 0, jogFrame: 1,
    tools: defaultTools(), users: defaultUsers(), jogs: frames(5), programs: samplePrograms(), selected: 'SAMPLE1',
    R: Array.from({ length: 201 }, () => ({ v: 0, cmt: '' })), PR: Array.from({ length: 101 }, () => ({ cmt: '' })),
    grip: { port: 'DO', idx: 101 },
  };
}

export class CellState {
  robots: RobotCtrl[] = [newRobot()];
  /** Robot the pendant, jog keys and Cell Browser work on. */
  active = 0;
  get ctrl(): RobotCtrl { return this.robots[this.active] ?? this.robots[0]; }
  // The active robot's controller data, so pendant / jog / interpreter code reads like a single-robot controller.
  get model() { return this.ctrl.model; } set model(v) { this.ctrl.model = v; }
  get q() { return this.ctrl.q; } set q(v) { this.ctrl.q = v; }
  get e() { return this.ctrl.e; } set e(v) { this.ctrl.e = v; }
  get override() { return this.ctrl.override; } set override(v) { this.ctrl.override = v; }
  get utool() { return this.ctrl.utool; } set utool(v) { this.ctrl.utool = v; }
  get uframe() { return this.ctrl.uframe; } set uframe(v) { this.ctrl.uframe = v; }
  get jogFrame() { return this.ctrl.jogFrame; } set jogFrame(v) { this.ctrl.jogFrame = v; }
  get tools() { return this.ctrl.tools; } set tools(v) { this.ctrl.tools = v; }
  get users() { return this.ctrl.users; } set users(v) { this.ctrl.users = v; }
  get jogs() { return this.ctrl.jogs; } set jogs(v) { this.ctrl.jogs = v; }
  get programs() { return this.ctrl.programs; } set programs(v) { this.ctrl.programs = v; }
  get selected() { return this.ctrl.selected; } set selected(v) { this.ctrl.selected = v; }
  get R() { return this.ctrl.R; } set R(v) { this.ctrl.R = v; }
  get PR() { return this.ctrl.PR; } set PR(v) { this.ctrl.PR = v; }
  /** Index of the robot this state object speaks for. */
  get robotIndex() { return this.robots.indexOf(this.ctrl); }

  coord: Coord = 'JOINT';
  mode: Mode = 'T1';
  tpEnabled = true;
  stepMode = false;
  shift = false;
  io: Record<IOPort, number[]> = Object.fromEntries(IO_PORT_LIST.map((p) => [p, new Array(513).fill(0)])) as Record<IOPort, number[]>;
  ioCmt: Partial<Record<IOPort, Record<number, string>>> = { DO: { 101: 'Gripper close' }, RO: { 1: 'Gripper close', 2: 'Gripper open' } };
  sys: Record<string, number> = { $WAITTMOUT: 3000, $DEFPULSE: 4 };
  /** Robot I/O wired to OpenRung PLC tags (see bus/plcbus.ts). */
  plcLinks: { tag: string; port: IOPort; idx: number; dir: 'in' | 'out' }[] = [];
  objects: CellObject[] = defaultTooling();
  /** Built-in content already added to this cell (so upgrades add new presets once). */
  presets: string[] = ['gripper1'];
  /** Workcell properties: name and the floor / grid look (like the simulator's world settings). */
  world: typeof DEFAULT_WORLD & { floorZ?: number; sim?: string } = { ...DEFAULT_WORLD };
  /** Set once the robot or its tool has touched a cell object while collisions are shown (Lab 5 step 7.3). */
  collisionSeen = false;
  /** Robot properties checkboxes (like the simulator's robot properties dialog). */
  opts = { teachTool: true, envelope: false, collisions: false, lock: false };
  /** Selected cell object (properties panel + move gizmo). */
  selectedObj: string | null = null;
  log: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private logListeners = new Set<(e: LogEntry) => void>();

  onChange(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  onLog(f: (e: LogEntry) => void) { this.logListeners.add(f); }
  emit() { for (const f of this.listeners) f(); this.saveSoon(); }

  message(level: LogLevel, text: string) {
    const e = { t: new Date(), level, text };
    this.log.push(e);
    if (this.log.length > 500) this.log.shift();
    for (const f of this.logListeners) f(e);
  }

  get program(): TPProgram | undefined { return this.programs[this.selected]; }

  toolFrame(n = this.utool): Frame { return n === 0 ? identity() : poseToFrame(this.tools[n - 1].pose); }
  userFrame(n = this.uframe): Frame { return n === 0 ? identity() : poseToFrame(this.users[n - 1].pose); }
  jogFrameF(n = this.jogFrame): Frame { return poseToFrame(this.jogs[n - 1].pose); }

  /** Rail carriage frame in robot world for extended-axis values `e` (identity without a rail). */
  railFrame(e = this.e): Frame { return { R: identity().R, p: [this.ctrl.rail ? e[0] ?? 0 : 0, 0, 0] }; }
  /** A world frame expressed relative to the robot's moving base (what the arm's IK sees). */
  toArm(f: Frame, e = this.e): Frame { return compose(invert(this.railFrame(e)), f); }
  /** Robot world frame in the cell. */
  baseFrame(i = this.robotIndex): Frame { return poseToFrame(this.robots[i].base); }
  /** TCP in world (robot world, including the rail position). */
  tcpWorld(q = this.q, e = this.e): Frame { return compose(this.railFrame(e), fk(this.model, q, this.toolFrame())); }
  /** Extended axis values to store with a taught position. */
  extNow(): number[] | undefined { return this.ctrl.rail ? [...this.e] : undefined; }

  /**
   * The same cell seen from robot `i`: model, q, frames, programs and registers are that robot's,
   * everything else (objects, I/O, log, listeners) is shared. Used to run each robot's interpreter.
   */
  view(i: number): CellState {
    const root = this;
    const v = Object.create(this) as CellState;
    Object.defineProperty(v, 'ctrl', { get: () => root.robots[i] ?? root.robots[0] });
    Object.defineProperty(v, 'active', { get: () => i });
    v.emit = () => root.emit();
    v.message = (level: LogLevel, text: string) => root.message(level, root.robots.length > 1 ? `${root.robots[i]?.name ?? 'Robot'}: ${text}` : text);
    return v;
  }
  /** TCP expressed in the active user frame (what the pendant shows as "USER"). */
  tcpUser(q = this.q): XYZWPR { return frameToPose(compose(invert(this.userFrame()), this.tcpWorld(q))); }
  config(q = this.q): Config { return configOf(this.model, q); }
  warnings(): Warnings { return singularities(this.model, this.q); }

  obj(id: string | null) { return id ? this.objects.find((o) => o.id === id) : undefined; }
  /** An object and everything attached to it (machine links, preset sub-bodies). */
  subtree(id: string): CellObject[] {
    const out: CellObject[] = [];
    const walk = (pid: string) => { for (const o of this.objects) if (o.parent === pid) { out.push(o); walk(o.id); } };
    const root = this.obj(id);
    if (root) { out.push(root); walk(id); }
    return out;
  }
  /** UTOOL whose tooling bodies are drawn: the active one, or UT1 if the active one has none. */
  shownTool(i = this.robotIndex) {
    const t = this.robots[i].utool;
    return this.objects.some((o) => o.role === 'tool' && o.tool === t && (o.robot ?? 0) === i) ? t : 1;
  }

  /** Override as a fraction (FINE/VFINE count as 1%). */
  get overridePct() { return typeof this.override === 'number' ? this.override : 1; }

  setModel(id: string) {
    const m = ROBOT_MODELS.find((r) => r.id === id);
    if (!m || m === this.model) return;
    this.model = m;
    this.q = [0, 0, 0, 0, -90, 0];
    this.message('info', `Robot changed to ${m.name}`);
    this.emit();
  }

  /** Older saved cells: swap the original box gripper on UT1 for Gripper 1 (the box one moves to UT3). */
  private upgradeGripper1() {
    const oldNames = ['Adapter plate', 'Gripper body', 'Finger L', 'Finger R'];
    const old = this.objects.filter((o) => o.role === 'tool' && o.tool === 1 && o.kind !== 'mesh' && oldNames.includes(o.name));
    const ut1Free = this.objects.every((o) => o.role !== 'tool' || o.tool !== 1 || old.includes(o));
    if (ut1Free) {
      const ut3Free = !this.objects.some((o) => o.role === 'tool' && o.tool === 3);
      this.objects = this.objects.filter((o) => !old.includes(o));
      if (ut3Free && old.length) { this.objects.push(...boxGripper(3)); if (!this.tools[2].comment) this.tools[2] = { comment: 'Box gripper', pose: { x: 0, y: 0, z: 120, w: 0, p: 0, r: 0 } }; }
      this.objects.push(...gripper1(1));
      if (this.tools[0].comment === 'Gripper TCP' || !this.tools[0].comment) this.tools[0] = { comment: 'Gripper 1', pose: { ...GRIPPER1_TCP } };
    }
    this.presets.push('gripper1');
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveSoon() {
    if (this.saveTimer || typeof setTimeout === 'undefined') return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 400);
  }
  /** One robot's controller data in file form (also the legacy single-robot cell layout). */
  private ctrlSnap(r: RobotCtrl) {
    return {
      name: r.name, model: r.model.id, q: r.q, e: r.e, base: r.base, rail: r.rail, grip: r.grip, override: r.override,
      utool: r.utool, uframe: r.uframe, jogFrame: r.jogFrame, tools: r.tools, users: r.users, jogs: r.jogs,
      programs: r.programs, selected: r.selected, R: r.R, PR: r.PR,
    };
  }
  snapshot() {
    return {
      ...this.ctrlSnap(this.robots[0]),
      robots: this.robots.length > 1 || this.robots[0].rail ? this.robots.map((r) => this.ctrlSnap(r)) : undefined,
      active: this.active,
      coord: this.coord, mode: this.mode,
      ioCmt: this.ioCmt, sys: this.sys, objects: this.objects, presets: this.presets, opts: this.opts, world: this.world, collisionSeen: this.collisionSeen,
      plcLinks: this.plcLinks,
    };
  }
  save() {
    try { localStorage.setItem('opencell.cell', JSON.stringify(this.snapshot())); } catch { /* storage unavailable */ }
  }
  load() {
    try {
      const raw = localStorage.getItem('opencell.cell');
      if (raw) this.restore(JSON.parse(raw));
    } catch { /* corrupted or unavailable storage: keep defaults */ }
  }
  private ctrlRestore(s: Partial<ReturnType<CellState['ctrlSnap']>>, i: number): RobotCtrl {
    const r = newRobot(ROBOT_MODELS.find((m) => m.id === s.model) ?? LRMATE_200ID, s.name ?? `Robot ${i + 1}`);
    if (Array.isArray(s.q) && s.q.length === 6) r.q = s.q as Joints;
    if (Array.isArray(s.e)) r.e = s.e;
    if (s.base) r.base = s.base;
    if (s.rail) { r.rail = s.rail; if (!r.e.length) r.e = [0]; }
    if (s.grip) r.grip = s.grip;
    if (s.override !== undefined) r.override = s.override;
    if (typeof s.utool === 'number') r.utool = s.utool;
    if (typeof s.uframe === 'number') r.uframe = s.uframe;
    if (typeof s.jogFrame === 'number') r.jogFrame = s.jogFrame;
    if (Array.isArray(s.tools) && s.tools.length === 10) r.tools = s.tools;
    if (Array.isArray(s.users) && s.users.length === 9) r.users = s.users;
    if (Array.isArray(s.jogs) && s.jogs.length === 5) r.jogs = s.jogs;
    if (s.programs && typeof s.programs === 'object') r.programs = s.programs;
    if (s.selected) r.selected = s.selected;
    if (Array.isArray(s.R) && s.R.length === 201) r.R = s.R;
    if (Array.isArray(s.PR) && s.PR.length === 101) r.PR = s.PR;
    return r;
  }
  restore(s: ReturnType<CellState['snapshot']>) {
    this.robots = Array.isArray(s.robots) && s.robots.length ? s.robots.map((r, i) => this.ctrlRestore(r, i)) : [this.ctrlRestore(s, 0)];
    this.active = typeof s.active === 'number' && s.active < this.robots.length ? s.active : 0;
    if (COORDS.includes(s.coord)) this.coord = s.coord;
    if (s.mode) this.mode = s.mode;
    if (s.ioCmt) this.ioCmt = s.ioCmt;
    if (s.sys) this.sys = { ...this.sys, ...s.sys };
    if (Array.isArray(s.objects)) this.objects = s.objects;
    if (s.opts) this.opts = { ...this.opts, ...s.opts };
    this.world = { ...DEFAULT_WORLD, ...(s.world ?? {}) };
    this.collisionSeen = !!s.collisionSeen;
    this.plcLinks = Array.isArray(s.plcLinks) ? s.plcLinks : [];
    this.presets = Array.isArray(s.presets) ? s.presets : [];
    if (!this.presets.includes('gripper1')) this.upgradeGripper1();
  }
}
