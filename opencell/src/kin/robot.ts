// 6-axis spherical-wrist arm kinematics using FANUC conventions:
//  - World origin on the J1 axis at J2 height (base mount is `baseZ` below it).
//  - J3 is ground-referenced (FANUC J2/J3 interaction): the forearm angle does not change when J2 moves.
//  - All zeros: upper arm vertical, forearm horizontal, faceplate pointing +X.
//  - Faceplate frame: +Z out of the flange; at all-zeros WPR = (-180, -90, 0).
import {
  Frame, Mat3, Vec3, D2R, R2D, rotX, rotY, rotZ, mul3, transpose, col, compose, invert,
  fromCols, add, scale,
} from './math';

export type Joints = [number, number, number, number, number, number];

export interface RobotModel {
  id: string;
  name: string;
  a1: number;  // J1 axis -> J2 axis horizontal offset
  a2: number;  // upper arm (J2 -> J3)
  a3: number;  // J3 -> forearm axis offset
  d4: number;  // forearm length (J3 -> wrist center)
  d6: number;  // wrist center -> faceplate
  baseZ: number; // height of J2 axis above the mounting surface
  limits: [number, number][]; // deg
  maxSpeed: number[];        // deg/s
  payload: number;           // kg (info only)
  /** Datasheet-style facts for the robot properties panel (approximate; check the real datasheet). */
  spec?: { reach: number; repeat: number; mass: number; axes: string; ranges: number[]; speeds: number[]; wrist?: string; note?: string };
}

export const LRMATE_200ID: RobotModel = {
  id: 'lrmate200id', name: 'LR Mate 200iD', a1: 50, a2: 330, a3: 35, d4: 335, d6: 80, baseZ: 330,
  limits: [[-170, 170], [-100, 145], [-100, 205], [-190, 190], [-125, 125], [-360, 360]],
  maxSpeed: [450, 380, 520, 550, 545, 1000], payload: 7,
  spec: { reach: 717, repeat: 0.02, mass: 25, axes: '6, electric servo (AC), absolute encoders', ranges: [340, 245, 305, 380, 250, 720], speeds: [450, 380, 520, 550, 545, 1000] },
};

export const M10IA: RobotModel = {
  id: 'm10ia', name: 'M-10iA', a1: 150, a2: 600, a3: 200, d4: 640, d6: 100, baseZ: 450,
  limits: [[-170, 170], [-90, 160], [-180, 267], [-190, 190], [-190, 190], [-360, 360]],
  maxSpeed: [210, 190, 210, 400, 400, 600], payload: 10,
  spec: { reach: 1420, repeat: 0.08, mass: 130, axes: '6, electric servo (AC), absolute encoders', ranges: [340, 250, 447, 380, 380, 720], speeds: [210, 190, 210, 400, 400, 600] },
};

export const LRMATE_200IC: RobotModel = {
  id: 'lrmate200ic', name: 'LR Mate 200iC', a1: 75, a2: 300, a3: 75, d4: 320, d6: 80, baseZ: 330,
  limits: [[-170, 170], [-60, 140], [-130, 205], [-190, 190], [-120, 120], [-360, 360]],
  maxSpeed: [350, 350, 400, 450, 380, 720], payload: 5,
  spec: {
    reach: 704, repeat: 0.02, mass: 27, axes: '6, electric servo (AC), absolute encoders',
    ranges: [340, 200, 388, 380, 240, 720], speeds: [350, 350, 400, 450, 380, 720],
    wrist: 'J4 / J5 / J6 allowable moment about 11.9 / 11.9 / 6.7 N·m',
    note: 'OpenCell models J3 as ground referenced with a 335° window; the real J2/J3 interference limit is not modeled.',
  },
};

export const M20IA: RobotModel = {
  id: 'm20ia', name: 'M-20iA', a1: 150, a2: 790, a3: 250, d4: 835, d6: 100, baseZ: 525,
  limits: [[-170, 170], [-100, 160], [-180, 270], [-200, 200], [-140, 140], [-450, 450]],
  maxSpeed: [195, 175, 180, 360, 360, 550], payload: 20,
  spec: { reach: 1811, repeat: 0.08, mass: 250, axes: '6, electric servo (AC), absolute encoders', ranges: [340, 260, 450, 400, 280, 900], speeds: [195, 175, 180, 360, 360, 550], note: 'Approximate geometry for layout and teaching practice.' },
};

export const R2000IC_210L: RobotModel = {
  id: 'r2000ic210l', name: 'R-2000iC/210L', a1: 312, a2: 1075, a3: 225, d4: 1730, d6: 215, baseZ: 670,
  limits: [[-185, 185], [-80, 95], [-135, 235], [-360, 360], [-125, 125], [-360, 360]],
  maxSpeed: [95, 85, 90, 120, 120, 190], payload: 210,
  spec: { reach: 3095, repeat: 0.05, mass: 1100, axes: '6, electric servo (AC), absolute encoders', ranges: [370, 175, 370, 720, 250, 720], speeds: [95, 85, 90, 120, 120, 190], note: 'Approximate geometry for layout and teaching practice; check the real datasheet before planning a cell.' },
};

export const ROBOT_MODELS = [LRMATE_200ID, LRMATE_200IC, M10IA, M20IA, R2000IC_210L];

/** Maps the J6 link frame (x = flange normal) to the FANUC faceplate frame (z = flange normal). */
const FLANGE_M: Mat3 = fromCols([0, 0, 1], [0, -1, 0], [1, 0, 0]);

export interface LinkFrames {
  base: Frame; j1: Frame; j2: Frame; j3: Frame; j4: Frame; j5: Frame; j6: Frame; flange: Frame;
}

export function linkFrames(m: RobotModel, q: Joints): LinkFrames {
  const [t1, t2, t3, t4, t5, t6] = q.map((v) => v * D2R);
  const base: Frame = { R: rotZ(0), p: [0, 0, -m.baseZ] };
  const j1: Frame = { R: rotZ(t1), p: [0, 0, 0] };
  const j2 = compose(j1, { R: rotY(t2), p: [m.a1, 0, 0] });
  const elbow: Vec3 = [m.a1 + m.a2 * Math.sin(t2), 0, m.a2 * Math.cos(t2)];
  const j3 = compose(j1, { R: rotY(-t3), p: elbow });
  const j4 = compose(j3, { R: rotX(t4), p: [0, 0, m.a3] });
  const j5 = compose(j4, { R: rotY(-t5), p: [m.d4, 0, 0] });
  const j6 = compose(j5, { R: rotX(t6), p: [0, 0, 0] });
  const flange = compose(j6, { R: FLANGE_M, p: [m.d6, 0, 0] });
  return { base, j1, j2, j3, j4, j5, j6, flange };
}

/** Faceplate pose in world. */
export function fkFlange(m: RobotModel, q: Joints): Frame { return linkFrames(m, q).flange; }
/** TCP pose in world for a given tool frame (relative to the faceplate). */
export function fk(m: RobotModel, q: Joints, tool: Frame): Frame { return compose(fkFlange(m, q), tool); }

export interface Config { flip: boolean; up: boolean; front: boolean; turns: [number, number, number] }

export function turnOf(a: number) { return Math.floor((a + 180) / 360); }

export function configString(c: Config) {
  return `${c.flip ? 'F' : 'N'} ${c.up ? 'U' : 'D'} ${c.front ? 'T' : 'B'}, ${c.turns.join(', ')}`;
}

/** Derive the configuration of a joint solution. */
export function configOf(m: RobotModel, q: Joints): Config {
  const f = linkFrames(m, q);
  const wc = f.j5.p;
  const c1 = Math.cos(q[0] * D2R), s1 = Math.sin(q[0] * D2R);
  const radial = c1 * wc[0] + s1 * wc[1];          // wrist center along the J1 "forward" direction
  const t2 = q[1] * D2R;
  const elbow: [number, number] = [m.a1 + m.a2 * Math.sin(t2), m.a2 * Math.cos(t2)];
  const sh: [number, number] = [m.a1, 0];
  const w: [number, number] = [radial, wc[2]];
  // Elbow above the shoulder->wrist line = Up.
  const u = [w[0] - sh[0], w[1] - sh[1]], e = [elbow[0] - sh[0], elbow[1] - sh[1]];
  const crossv = u[0] * e[1] - u[1] * e[0];
  const up = u[0] >= 0 ? crossv >= 0 : crossv <= 0;
  return { flip: q[4] > 1e-9, up, front: radial >= 0, turns: [turnOf(q[3]), turnOf(q[5]), turnOf(q[0])] };
}

export interface IKSolution { q: Joints; config: Config }

export type IKFail = 'unreachable' | 'limits';

function withinLimits(m: RobotModel, q: Joints) {
  return q.every((v, i) => v >= m.limits[i][0] - 1e-6 && v <= m.limits[i][1] + 1e-6);
}

/** Shift an angle by whole turns so it is as close as possible to `ref` while inside [lo, hi]. */
function nearestTurn(a: number, ref: number, lo: number, hi: number): number | null {
  let best: number | null = null;
  for (let k = -2; k <= 2; k++) {
    const v = a + 360 * k;
    if (v < lo - 1e-6 || v > hi + 1e-6) continue;
    if (best === null || Math.abs(v - ref) < Math.abs(best - ref)) best = v;
  }
  return best;
}

/**
 * Analytic IK for the faceplate pose. Returns every valid solution (up to 8 configurations,
 * turn numbers chosen nearest to `seed`), or a failure reason.
 */
export function ikFlange(m: RobotModel, flange: Frame, seed: Joints): IKSolution[] | IKFail {
  const zf = col(flange.R, 2);
  const wc: Vec3 = add(flange.p, scale(zf, -m.d6));
  const L2 = m.a2, L3 = Math.hypot(m.a3, m.d4), phi = Math.atan2(m.a3, m.d4);
  const R6 = mul3(flange.R, transpose(FLANGE_M));
  const out: IKSolution[] = [];
  let reachable = false;
  const r = Math.hypot(wc[0], wc[1]);
  const baseJ1 = r < 1e-9 ? seed[0] * D2R : Math.atan2(wc[1], wc[0]);

  for (const front of [true, false]) {
    const t1 = front ? baseJ1 : baseJ1 + Math.PI;
    const rho = front ? r : -r;
    const dx = rho - m.a1, dz = wc[2];
    const d = Math.hypot(dx, dz);
    if (d > L2 + L3 + 1e-6 || d < Math.abs(L2 - L3) - 1e-6 || d < 1e-9) continue;
    reachable = true;
    const a = (L2 * L2 - L3 * L3 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L2 * L2 - a * a));
    const ux = dx / d, uz = dz / d;
    for (const sgn of [1, -1]) {
      const ex = a * ux + sgn * h * -uz, ez = a * uz + sgn * h * ux;
      const t2 = Math.atan2(ex, ez);
      const t3 = Math.atan2(dz - ez, dx - ex) - phi;
      const R3 = mul3(rotZ(t1), rotY(-t3));
      const W = mul3(transpose(R3), R6);
      const cb = Math.max(-1, Math.min(1, W[0]));
      const b = Math.acos(cb);
      const branches: [number, number, number][] = [];
      if (Math.abs(Math.sin(b)) < 1e-6) {
        // Wrist singular (J5 = 0 or 180): keep J4 at the seed, put the rest on J6.
        const t = Math.atan2(W[7], W[4]);
        const t4 = seed[3] * D2R;
        branches.push([t4, b, cb > 0 ? t - t4 : t4 - t]);
      } else {
        const a4 = Math.atan2(W[3], -W[6]), c6 = Math.atan2(W[1], W[2]);
        branches.push([a4, b, c6], [a4 + Math.PI, -b, c6 + Math.PI]);
      }
      for (const [t4, bb, t6] of branches) {
        const raw = [t1 * R2D, t2 * R2D, t3 * R2D, t4 * R2D, -bb * R2D, t6 * R2D];
        const q: number[] = [];
        let ok = true;
        for (let i = 0; i < 6; i++) {
          const [lo, hi] = m.limits[i];
          const v = nearestTurn(raw[i], seed[i], lo, hi);
          if (v === null) { ok = false; break; }
          q.push(v);
        }
        if (!ok) continue;
        const qq = q as Joints;
        if (!withinLimits(m, qq)) continue;
        out.push({ q: qq, config: configOf(m, qq) });
      }
    }
  }
  if (!out.length) return reachable ? 'limits' : 'unreachable';
  return out;
}

export function jointDistance(a: Joints, b: Joints) {
  const w = [1, 1, 1, 0.5, 0.5, 0.3];
  return a.reduce((s, v, i) => s + w[i] * Math.abs(v - b[i]), 0);
}

export function sameConfig(a: Config, b: Config) { return a.flip === b.flip && a.up === b.up && a.front === b.front; }

/** IK for a TCP pose. With `config` set, only matching solutions are considered; picks the one nearest `seed`. */
export function ik(m: RobotModel, tcp: Frame, tool: Frame, seed: Joints, config?: Config): IKSolution | IKFail {
  const sols = ikFlange(m, compose(tcp, invert(tool)), seed);
  if (typeof sols === 'string') return sols;
  const cand = config ? sols.filter((s) => sameConfig(s.config, config)) : sols;
  if (!cand.length) return 'limits';
  return cand.reduce((best, s) => (jointDistance(s.q, seed) < jointDistance(best.q, seed) ? s : best));
}

export interface Warnings { wrist: boolean; shoulder: boolean; elbow: boolean }

/** Singularity proximity checks for a joint position. */
export function singularities(m: RobotModel, q: Joints): Warnings {
  const f = linkFrames(m, q);
  const wc = f.j5.p;
  const L2 = m.a2, L3 = Math.hypot(m.a3, m.d4);
  const c1 = Math.cos(q[0] * D2R), s1 = Math.sin(q[0] * D2R);
  const dx = c1 * wc[0] + s1 * wc[1] - m.a1, dz = wc[2];
  const d = Math.hypot(dx, dz);
  return {
    wrist: Math.abs(q[4]) < 3,
    shoulder: Math.hypot(wc[0], wc[1]) < 40,
    elbow: d > (L2 + L3) * 0.995,
  };
}

/** Max reach of the wrist center from the J2 axis (for drawing a reach envelope). */
export function maxReach(m: RobotModel) { return m.a1 + m.a2 + Math.hypot(m.a3, m.d4) + m.d6; }

