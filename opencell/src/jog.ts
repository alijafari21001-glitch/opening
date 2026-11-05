// Jogging: JOINT / JGFRM / WORLD / TOOL / USER, continuous while a key is held, or one increment at FINE/VFINE.
import { CellState } from './state';
import { Frame, Vec3, D2R, rotAxis, mul3, col, add, scale, identity } from './kin/math';
import { ik, Joints } from './kin/robot';
import { Move } from './motion';

const CART_SPEED = 250;   // mm/s at 100% (T1 limit)
const ROT_SPEED = 60;     // deg/s at 100%
const JOINT_SPEED = 0.2;  // fraction of max joint speed at 100%

export class Jogger {
  /** Active jog: axis 0..5, direction ±1. */
  private active: { axis: number; dir: number } | null = null;
  private lastAlarm = '';
  /** Point-to-point move started from a pendant screen (MOVE_TO). */
  private move: Move | null = null;
  /** Returns true when jogging must be refused (e.g. a program is running). */
  busy: () => string | null = () => null;

  constructor(private s: CellState) {}

  private canJog(): boolean {
    const why = this.busy();
    if (why) { this.s.message('warn', why); return false; }
    if (!this.s.tpEnabled) { this.s.message('warn', 'Teach pendant is disabled (TP OFF). Turn it ON to jog.'); return false; }
    if (!this.s.shift) { this.s.message('warn', 'Hold SHIFT to jog'); return false; }
    return true;
  }

  start(axis: number, dir: number) {
    if (!this.canJog()) return;
    this.lastAlarm = '';
    this.move = null;
    const ov = this.s.override;
    if (ov === 'FINE' || ov === 'VFINE') {
      const k = ov === 'FINE' ? 1 : 0.1;
      // FINE/VFINE: one increment per key press (1 mm / 0.1 deg or 0.1 mm / 0.01 deg).
      this.step(axis, dir, k, k * 0.1, k * 0.1);
      return;
    }
    this.active = { axis, dir };
  }
  stop() { this.active = null; }
  get jogging() { return this.active !== null || this.move !== null; }

  /** Joint move to a position at jog speed (MOVE_TO on the frame setup screens). */
  moveJoints(q: Joints) {
    if (!this.canJog()) return;
    const s = this.s;
    const tool = s.toolFrame();
    this.move = new Move(s.model, tool, s.q, { type: 'J', speed: 10, unit: '%', cnt: null, override: s.overridePct, t1: true }, q, s.tcpWorld(), s.tcpWorld(q), s.config());
  }

  /** Advance a continuous jog by dt seconds. */
  tick(dt: number) {
    if (this.move) {
      if (!this.s.shift) { this.move = null; this.s.message('warn', 'MOVE_TO stopped (SHIFT released)'); return; }
      this.move.update(dt);
      this.s.q = this.move.q;
      if (this.move.done) this.move = null;
      this.s.emit();
      return;
    }
    if (!this.active) return;
    if (!this.s.shift) { this.stop(); return; }
    const pct = typeof this.s.override === 'number' ? this.s.override / 100 : 0;
    const a = this.active.axis;
    if (a === 6) { this.stepRail(this.active.dir * (this.s.ctrl.rail?.speed ?? 0) * JOINT_SPEED * pct * dt); return; }
    const jointSpeed = this.s.model.maxSpeed[a] * JOINT_SPEED * pct;
    this.step(a, this.active.dir, CART_SPEED * pct * dt, ROT_SPEED * pct * dt, jointSpeed * dt);
  }

  private alarm(text: string) {
    if (text !== this.lastAlarm) this.s.message('alarm', text);
    this.lastAlarm = text;
    this.stop();
  }

  /** Axis directions of the current jog coordinate system. */
  basis(): Frame {
    const s = this.s;
    switch (s.coord) {
      case 'TOOL': return s.tcpWorld();
      case 'USER': return s.userFrame();
      case 'JGFRM': return s.jogFrameF();
      default: return identity();
    }
  }

  /** Move one increment: `lin` mm, `rot` deg (cartesian) or `jnt` deg (joint). */
  step(axis: number, dir: number, lin: number, rot: number, jnt: number) {
    const s = this.s;
    if (axis === 6) { this.stepRail(dir * lin); return; }
    if (s.coord === 'JOINT') {
      const q = [...s.q] as Joints;
      const [lo, hi] = s.model.limits[axis];
      const v = q[axis] + dir * jnt;
      if (v > hi || v < lo) {
        q[axis] = Math.min(hi, Math.max(lo, v));
        s.q = q; s.emit();
        this.alarm(`Joint limit reached: J${axis + 1} (${lo}..${hi} deg)`);
        return;
      }
      q[axis] = v; s.q = q; s.emit();
      return;
    }
    const tcp = s.tcpWorld();
    const ax: Vec3 = col(this.basis().R, axis % 3);
    let next: Frame;
    if (axis < 3) next = { R: tcp.R, p: add(tcp.p, scale(ax, dir * lin)) };
    else next = { R: mul3(rotAxis(ax, dir * rot * D2R), tcp.R), p: tcp.p }; // rotate about the axis through the TCP
    this.moveTo(next);
  }

  /** Move the rail (E1) by `d` mm; the arm rides along. */
  stepRail(d: number) {
    const s = this.s, rail = s.ctrl.rail;
    if (!rail) { this.alarm('This robot has no rail (E1)'); return; }
    const v = (s.e[0] ?? 0) + d;
    s.e = [Math.min(rail.length, Math.max(0, v))];
    s.emit();
    if (v < 0 || v > rail.length) this.alarm(`Rail limit reached: E1 (0..${rail.length} mm)`);
  }

  /** Move the TCP to a world pose keeping the current configuration. Returns false (and alarms) on failure. */
  moveTo(target: Frame): boolean {
    const s = this.s;
    const sol = ik(s.model, s.toArm(target), s.toolFrame(), s.q, s.config());
    if (sol === 'unreachable') { this.alarm('Position not reachable (outside work envelope)'); return false; }
    if (sol === 'limits') { this.alarm('Joint limit or configuration change required'); return false; }
    const jump = Math.max(...sol.q.map((v, i) => Math.abs(v - s.q[i])));
    if (jump > 20) { this.alarm('Near singularity: wrist (J5 close to 0). Jog in JOINT to pass through.'); return false; }
    s.q = sol.q; s.emit();
    return true;
  }
}
