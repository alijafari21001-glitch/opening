import { describe, it, expect } from 'vitest';
import { tcpFromPoints, userFrameFromPoints, toolOrientation } from '../src/kin/frames';
import { LRMATE_200ID as M, fkFlange, ik, Joints } from '../src/kin/robot';
import { poseToFrame, compose, invert, identity, Frame } from '../src/kin/math';

describe('frame teaching', () => {
  it('3-point tool frame recovers a known TCP', () => {
    const tool = poseToFrame({ x: 10, y: -5, z: 130, w: 0, p: 0, r: 0 });
    const target = [400, 50, 0] as [number, number, number];
    const flanges: Frame[] = [[180, 0, 0], [160, 20, 30], [200, -25, -40]].map(([w, p, r]) => {
      const tcp = poseToFrame({ x: target[0], y: target[1], z: target[2], w, p, r });
      const sol = ik(M, tcp, tool, [0, 0, 0, 0, -90, 0] as Joints);
      if (typeof sol === 'string') throw new Error(sol);
      return fkFlange(M, sol.q);
    });
    const r = tcpFromPoints(flanges);
    expect(r.t[0]).toBeCloseTo(10, 4); expect(r.t[1]).toBeCloseTo(-5, 4); expect(r.t[2]).toBeCloseTo(130, 4);
    expect(r.err).toBeLessThan(1e-6);
  });
  it('6-point orientation (XZ)', () => {
    const o = identity();
    const a: Frame = { R: o.R, p: [0, 0, 50] };   // moved along faceplate +Z  => tool X = faceplate Z
    const b: Frame = { R: o.R, p: [50, 0, 0] };   // tool Z = faceplate X
    const [w, p, r] = toolOrientation(o, a, b, 'XZ');
    const R = poseToFrame({ x: 0, y: 0, z: 0, w, p, r }).R;
    expect(R[2]).toBeCloseTo(1, 6);  // tool x column = (0,0,1)
    expect(R[6 + 2]).toBeCloseTo(0, 6);
    expect(R[0 + 2]).toBeCloseTo(1, 6);
  });
  it('3-point user frame', () => {
    const uf = userFrameFromPoints([100, 100, 0], [200, 100, 0], [100, 300, 0]);
    expect(uf).toMatchObject({ x: 100, y: 100, z: 0 });
    expect(uf.w).toBeCloseTo(0, 6); expect(uf.p).toBeCloseTo(0, 6); expect(uf.r).toBeCloseTo(0, 6);
    const rot = userFrameFromPoints([0, 0, 0], [0, 100, 0], [-100, 0, 0]);
    expect(rot.r).toBeCloseTo(90, 6);
    const f = compose(invert(poseToFrame(uf)), poseToFrame({ x: 150, y: 120, z: 0, w: 0, p: 0, r: 0 }));
    expect(f.p[0]).toBeCloseTo(50, 6);
  });
});
