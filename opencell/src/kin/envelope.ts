// Work envelope of the wrist center (J5 axis), like the "J5 axis rotation center" range on a robot datasheet.
// Sampled over the J2/J3 limits in the J1 = 0 plane, then described as a radial profile around the J1 axis.
import { RobotModel, linkFrames, Joints } from './robot';

export interface Envelope {
  /** Closed (r, z) outline: outer edge from bottom to top, then inner edge back down. r >= 0. */
  profile: [number, number][];
  /** J1 range in degrees (the envelope is this profile swept around Z). */
  j1: [number, number];
  /** Radial limits per angle bin (index = bin), angle measured from +r toward +z. */
  bins: { lo: number; hi: number }[];
  step: number;
}

const cache = new Map<string, Envelope>();

export function envelope(m: RobotModel): Envelope {
  const hit = cache.get(m.id);
  if (hit) return hit;
  const step = 2;
  const nb = 180 / step + 1;
  const bins = Array.from({ length: nb }, () => ({ lo: Infinity, hi: -Infinity }));
  const [[a2, b2], [a3, b3]] = [m.limits[1], m.limits[2]];
  for (let t2 = a2; t2 <= b2; t2 += 1) {
    for (let t3 = a3; t3 <= b3; t3 += 1) {
      const p = linkFrames(m, [0, t2, t3, 0, 0, 0] as Joints).j5.p;
      const r = Math.abs(p[0]), z = p[2];
      const d = Math.hypot(r, z);
      const i = Math.round((Math.atan2(z, r) * 180 / Math.PI + 90) / step);
      const b = bins[i];
      if (d < b.lo) b.lo = d;
      if (d > b.hi) b.hi = d;
    }
  }
  const ang = (i: number) => (i * step - 90) * Math.PI / 180;
  const outer: [number, number][] = [], inner: [number, number][] = [];
  bins.forEach((b, i) => {
    if (!isFinite(b.hi)) return;
    outer.push([b.hi * Math.cos(ang(i)), b.hi * Math.sin(ang(i))]);
    inner.push([b.lo * Math.cos(ang(i)), b.lo * Math.sin(ang(i))]);
  });
  const env: Envelope = { profile: [...outer, ...inner.reverse()], j1: m.limits[0], bins, step };
  cache.set(m.id, env);
  return env;
}

/** Is a world point (robot world frame, mm) inside the wrist-center envelope? */
export function inEnvelope(m: RobotModel, p: [number, number, number]): boolean {
  const e = envelope(m);
  const a = Math.atan2(p[1], p[0]) * 180 / Math.PI;
  const r = Math.hypot(p[0], p[1]);
  if (r > 1 && (a < e.j1[0] || a > e.j1[1])) return false;
  const i = Math.round((Math.atan2(p[2], r) * 180 / Math.PI + 90) / e.step);
  const b = e.bins[i];
  const d = Math.hypot(r, p[2]);
  return !!b && d >= b.lo && d <= b.hi;
}

/** Robot body as capsules (segment + radius) for collision checks, in world coordinates. */
export function robotCapsules(m: RobotModel, q: Joints): { name: string; a: number[]; b: number[]; r: number }[] {
  const f = linkFrames(m, q), k = m.a2 / 330;
  const j4 = f.j4.p, j5 = f.j5.p;
  return [
    { name: 'J1 base', a: [0, 0, -0.6 * m.baseZ], b: [0, 0, -0.1 * m.baseZ], r: 80 * k },
    { name: 'J2 arm', a: f.j2.p, b: f.j3.p, r: 42 * k },
    { name: 'J3 arm', a: f.j3.p, b: j4, r: 40 * k },
    { name: 'J3 arm', a: j4, b: j5, r: 36 * k },
    { name: 'Wrist', a: j5, b: f.flange.p, r: 30 * k },
  ];
}
