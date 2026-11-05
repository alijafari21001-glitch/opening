// Program motion: joint (J), linear (L) and circular (C) moves with a trapezoidal speed profile.
// FINE stops at the point; CNTn rounds the corner by handing over to the next move early.
import { Frame, Vec3, Mat3, mul3, transpose, rotAxis, add, sub, scale, norm, cross, dot, normalize, R2D } from './kin/math';
import { Joints, RobotModel, ik, fk, Config } from './kin/robot';

export class MotionError extends Error {}

const ACC = 0.12;          // s, accel/decel ramp
const ROT_MAX = 180;       // deg/s orientation speed at 100%
const T1_LIMIT = 250;      // mm/s TCP speed in T1

export interface MoveSpec {
  type: 'J' | 'L' | 'C';
  speed: number; unit: string;
  cnt: number | null;          // null = FINE
  override: number;            // 1..100
  t1: boolean;
}

/** Normalized trapezoid: position 0..1 at time t for total T, accel a1, decel a2. */
export function trapezoid(t: number, T: number, a1: number, a2: number) {
  if (t >= T) return 1;
  if (t <= 0) return 0;
  const v = 1 / Math.max(1e-9, T - a1 / 2 - a2 / 2);
  let s: number;
  if (t < a1) s = 0.5 * v * t * t / a1;
  else if (t <= T - a2) s = v * (t - a1 / 2);
  else { const r = T - t; s = 1 - 0.5 * v * r * r / a2; }
  return Math.min(1, Math.max(0, s));
}

/** Axis-angle between two rotations: returns [axis, angle(rad)] of Rb·Raᵀ. */
function relRot(Ra: Mat3, Rb: Mat3): [Vec3, number] {
  const M = mul3(Rb, transpose(Ra));
  const c = Math.max(-1, Math.min(1, (M[0] + M[4] + M[8] - 1) / 2));
  const ang = Math.acos(c);
  if (ang < 1e-9) return [[0, 0, 1], 0];
  let ax: Vec3 = [M[7] - M[5], M[2] - M[6], M[3] - M[1]];
  if (norm(ax) < 1e-9) {
    // 180 deg: axis from the diagonal
    const d = [M[0], M[4], M[8]];
    const i = d.indexOf(Math.max(...d));
    const col: Vec3 = [M[i] + (i === 0 ? 1 : 0), M[3 + i] + (i === 1 ? 1 : 0), M[6 + i] + (i === 2 ? 1 : 0)];
    ax = col;
  }
  return [normalize(ax), ang];
}

/** Extended-axis (rail) part of a move: start / end values and the rail's top speed (mm/s at 100%). */
export interface MoveExt { e0: number[]; e1: number[]; speed: number }

/** Rail offset along the robot world X for extended-axis values. */
const railP = (e: number[]): Vec3 => [e[0] ?? 0, 0, 0];

export class Move {
  t = 0;
  T: number;
  private a1 = ACC;
  private a2: number;
  private len: number;      // mm (L/C) or max joint delta (J), for CNT blending
  private rot: [Vec3, number] = [[0, 0, 1], 0];
  private arc?: { c: Vec3; u: Vec3; v: Vec3; r: number; ang: number };
  q: Joints;
  /** Extended-axis values along the move. */
  e: number[];
  done = false;

  constructor(
    private m: RobotModel, private tool: Frame, private q0: Joints, private spec: MoveSpec,
    private q1: Joints | null, private f0: Frame, private f1: Frame, private config: Config, via?: Frame, private ext?: MoveExt,
  ) {
    this.q = [...q0] as Joints;
    this.e = ext ? [...ext.e0] : [];
    const ov = spec.override / 100;
    this.a2 = spec.cnt === null ? ACC : 0;
    let T: number;
    const dist = norm(sub(f1.p, f0.p));
    if (spec.type === 'J') {
      const dq = q1!.map((v, i) => Math.abs(v - q0[i]));
      this.len = Math.max(...dq);
      if (spec.unit === 'sec' || spec.unit === 'msec') T = spec.speed / (spec.unit === 'msec' ? 1000 : 1) / ov;
      else T = Math.max(...dq.map((d, i) => d / (m.maxSpeed[i] * (spec.speed / 100) * ov)));
      if (spec.t1) T = Math.max(T, dist / T1_LIMIT);
    } else {
      this.rot = relRot(f0.R, f1.R);
      let pathLen = dist;
      if (spec.type === 'C' && via) {
        this.arc = circle(f0.p, via.p, f1.p);
        pathLen = this.arc.r * this.arc.ang;
      }
      this.len = pathLen;
      const rotDeg = this.rot[1] * R2D;
      if (spec.unit === 'sec' || spec.unit === 'msec') T = spec.speed / (spec.unit === 'msec' ? 1000 : 1) / ov;
      else {
        let v = spec.unit === 'cm/min' ? spec.speed * 10 / 60 : spec.unit === 'inch/min' ? spec.speed * 25.4 / 60 : spec.speed;
        if (spec.unit === 'deg/sec') { T = rotDeg / (spec.speed * ov); v = Infinity; }
        else T = 0;
        if (spec.t1) v = Math.min(v, T1_LIMIT);
        T = Math.max(T, pathLen / (v * ov), rotDeg / (ROT_MAX * ov));
      }
    }
    if (ext) {
      const de = Math.max(0, ...ext.e1.map((v, i) => Math.abs(v - (ext.e0[i] ?? 0))));
      if (de > 0) { T = Math.max(T, de / (ext.speed * ov)); this.len = Math.max(this.len, spec.type === 'J' ? Math.min(de, 50) : de); }
    }
    if (!isFinite(T) || T < 0) T = 0;
    // Short moves: shrink the ramps so the profile stays valid (triangular).
    const k = Math.min(1, (2 * T) / (this.a1 + this.a2));
    this.a1 *= k; this.a2 *= k;
    this.T = T + this.a1 / 2 + this.a2 / 2;
  }

  /** Remaining distance below which a CNT move hands over to the next one. */
  private blendZone() {
    const c = this.spec.cnt;
    if (!c) return 0;
    return this.spec.type === 'J' ? (c / 100) * Math.min(this.len / 2, 25) : (c / 100) * Math.min(this.len / 2, 100);
  }

  /** Pose at path fraction s (cartesian moves). */
  frameAt(s: number): Frame {
    const [ax, ang] = this.rot;
    const R = mul3(rotAxis(ax, ang * s), this.f0.R);
    if (this.arc) {
      const { c, u, v, r } = this.arc;
      const a = this.arc.ang * s;
      return { R, p: add(c, add(scale(u, r * Math.cos(a)), scale(v, r * Math.sin(a)))) };
    }
    return { R, p: add(this.f0.p, scale(sub(this.f1.p, this.f0.p), s)) };
  }

  /** Advance by dt seconds. Throws MotionError if the path leaves the work envelope. */
  update(dt: number) {
    this.t += dt;
    const s = this.T <= 0 ? 1 : trapezoid(this.t, this.T, this.a1, this.a2);
    if (this.ext) this.e = this.ext.e0.map((v, i) => v + ((this.ext!.e1[i] ?? v) - v) * s);
    if (this.spec.type === 'J') {
      this.q = this.q0.map((v, i) => v + (this.q1![i] - v) * s) as Joints;
    } else {
      let f = this.frameAt(s);
      if (this.ext) f = { R: f.R, p: sub(f.p, railP(this.e)) };
      const sol = ik(this.m, f, this.tool, this.q, this.config);
      if (typeof sol === 'string') throw new MotionError(sol === 'unreachable' ? 'Position not reachable on the path' : 'Joint limit or configuration change on the linear path');
      const jump = Math.max(...sol.q.map((v, i) => Math.abs(v - this.q[i])));
      if (jump > 30) throw new MotionError('Path passes through a wrist singularity (J5 near 0). Use a J move or change the orientation.');
      this.q = sol.q;
    }
    const remaining = (1 - s) * this.len;
    if (s >= 1 || (this.spec.cnt && remaining <= this.blendZone())) this.done = true;
  }

  /** TCP pose at the end of the move (world). */
  get target(): Frame {
    if (this.spec.type !== 'J') return this.f1;
    const f = fk(this.m, this.q1!, this.tool);
    return this.ext ? { R: f.R, p: add(f.p, railP(this.ext.e1)) } : f;
  }
}

/** Circle through three points: center, in-plane basis (u toward p0), radius, sweep angle p0 -> p2 through p1. */
export function circle(p0: Vec3, p1: Vec3, p2: Vec3) {
  const a = sub(p0, p2), b = sub(p1, p2);
  const axb = cross(a, b);
  const d = 2 * dot(axb, axb);
  if (d < 1e-6) throw new MotionError('Circular move: the three points are on a line');
  const c = add(p2, scale(cross(sub(scale(b, dot(a, a)), scale(a, dot(b, b))), axb), 1 / d));
  const r = norm(sub(p0, c));
  const n = normalize(axb);
  const u = normalize(sub(p0, c));
  // choose v so the arc goes p0 -> p1 -> p2
  let v = cross(n, u);
  const angOf = (p: Vec3) => { const w = sub(p, c); let t = Math.atan2(dot(w, v), dot(w, u)); if (t < 0) t += 2 * Math.PI; return t; };
  let a1 = angOf(p1), a2 = angOf(p2);
  if (a1 > a2) { v = scale(v, -1); a1 = angOf(p1); a2 = angOf(p2); }
  return { c, u, v, r, ang: a2 };
}
