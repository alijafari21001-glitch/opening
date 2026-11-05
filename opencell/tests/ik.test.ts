import { describe, it, expect } from 'vitest';
import { LRMATE_200ID as M, LRMATE_200IC, M10IA, fk, fkFlange, ik, ikFlange, configOf, configString, Joints } from '../src/kin/robot';
import { frameToPose, poseToFrame, identity, Frame } from '../src/kin/math';

const T0 = identity();
const close = (a: number[], b: number[], tol = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(tol)));

describe('LR Mate 200iD forward kinematics (known poses)', () => {
  it('all-zero pose is X465 Y0 Z365 W-180 P-90 R0', () => {
    const p = frameToPose(fkFlange(M, [0, 0, 0, 0, 0, 0]));
    close([p.x, p.y, p.z, p.p, p.r], [465, 0, 365, -90, 0]);
    expect(Math.abs(p.w)).toBeCloseTo(180, 6);
  });
  it('J5 = -90 points the tool straight down: W180 P0 R0', () => {
    const p = frameToPose(fkFlange(M, [0, 0, 0, 0, -90, 0]));
    close([p.x, p.y, p.z, Math.abs(p.w), p.p, p.r], [385, 0, 285, 180, 0, 0]);
  });
  it('J1 = 90 swings the arm to +Y', () => {
    const p = frameToPose(fkFlange(M, [90, 0, 0, 0, -90, 0]));
    close([p.x, p.y, p.z], [0, 385, 285]);
  });
  it('J3 is ground referenced: moving J2 does not tilt the forearm', () => {
    const a = fkFlange(M, [0, 0, 0, 0, 0, 0]), b = fkFlange(M, [0, 30, 0, 0, 0, 0]);
    close(a.R, b.R);
    close([b.p[0] - a.p[0], b.p[2] - a.p[2]], [330 * Math.sin(Math.PI / 6), 330 * Math.cos(Math.PI / 6) - 330]);
  });
  it('config of the tool-down pose is N U T, 0, 0, 0', () => {
    expect(configString(configOf(M, [0, 0, 0, 0, -90, 0]))).toBe('N U T, 0, 0, 0');
  });
});

describe('inverse kinematics round trip', () => {
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  for (const model of [M, LRMATE_200IC, M10IA]) {
    it(`${model.name}: IK(FK(q)) reproduces q with the same config`, () => {
      let tested = 0;
      for (let n = 0; n < 400; n++) {
        const q = model.limits.map(([lo, hi], i) => rand(Math.max(lo, -150), Math.min(hi, 150)) * (i === 4 ? 1 : 1)) as Joints;
        if (Math.abs(q[4]) < 2) continue;
        const tool: Frame = poseToFrame({ x: 0, y: 0, z: 120, w: 0, p: 0, r: 0 });
        const tcp = fk(model, q, tool);
        const sol = ik(model, tcp, tool, q, configOf(model, q));
        expect(typeof sol).not.toBe('string');
        if (typeof sol === 'string') continue;
        close(sol.q, q, 1e-5);
        tested++;
      }
      expect(tested).toBeGreaterThan(300);
    });
  }
  it('every returned solution maps back to the target pose', () => {
    const target = poseToFrame({ x: 400, y: 150, z: 100, w: 180, p: 0, r: 30 });
    const sols = ikFlange(M, target, [0, 0, 0, 0, -90, 0]);
    expect(Array.isArray(sols)).toBe(true);
    if (typeof sols === 'string') return;
    expect(sols.length).toBeGreaterThanOrEqual(2);
    for (const s of sols) {
      const f = fkFlange(M, s.q);
      close(f.p, target.p, 1e-6);
      close(f.R, target.R, 1e-6);
    }
  });
  it('reports unreachable targets', () => {
    expect(ik(M, poseToFrame({ x: 1500, y: 0, z: 0, w: 180, p: 0, r: 0 }), T0, [0, 0, 0, 0, -90, 0])).toBe('unreachable');
  });
  it('wrist singular pose (J5 = 0) still solves', () => {
    const q: Joints = [10, 20, -10, 30, 0, -40];
    const sol = ik(M, fkFlange(M, q), T0, q);
    expect(typeof sol).not.toBe('string');
    if (typeof sol !== "string") close(fkFlange(M, sol.q).p, fkFlange(M, q).p, 1e-3);
  });
});
