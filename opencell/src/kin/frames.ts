// Frame teaching math: tool frame (3-point, 6-point) and user frame (3-point, 4-point).
import { Frame, Vec3, XYZWPR, sub, normalize, cross, norm, mulv, transpose, fromCols, matToWpr, dot } from './math';

export class FrameTeachError extends Error {}

/** Solve A x = b (small dense system) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) throw new FrameTeachError('Points are too similar to compute the frame');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Tool center point from faceplate poses that all touch the same fixed point.
 * Solves R_i·t + p_i = c (least squares) for t (in faceplate coords) and c (world).
 * Returns the TCP offset and the worst residual in mm.
 */
export function tcpFromPoints(flanges: Frame[]): { t: Vec3; c: Vec3; err: number } {
  if (flanges.length < 3) throw new FrameTeachError('Need three approach points');
  // Normal equations for [R_i  -I][t; c] = -p_i
  const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const Atb = new Array(6).fill(0);
  for (const f of flanges) {
    const R = f.R;
    for (let row = 0; row < 3; row++) {
      const a = [R[row * 3], R[row * 3 + 1], R[row * 3 + 2], row === 0 ? -1 : 0, row === 1 ? -1 : 0, row === 2 ? -1 : 0];
      const bb = -f.p[row];
      for (let i = 0; i < 6; i++) { Atb[i] += a[i] * bb; for (let j = 0; j < 6; j++) AtA[i][j] += a[i] * a[j]; }
    }
  }
  // Orientation diversity check: all rotations nearly the same => singular.
  const x = solve(AtA, Atb);
  const t: Vec3 = [x[0], x[1], x[2]], c: Vec3 = [x[3], x[4], x[5]];
  const err = Math.max(...flanges.map((f) => norm(sub([...mulv(f.R, t)].map((v, i) => v + f.p[i]) as Vec3, c))));
  return { t, c, err };
}

/** Orientation of a tool from orient-origin / direction points (faceplate poses). `kind` = XZ or XY. */
export function toolOrientation(origin: Frame, a: Frame, b: Frame, kind: 'XZ' | 'XY'): [number, number, number] {
  const Rt = transpose(origin.R);
  const d1 = mulv(Rt, sub(a.p, origin.p)), d2 = mulv(Rt, sub(b.p, origin.p));
  if (norm(d1) < 1 || norm(d2) < 1) throw new FrameTeachError('Direction points must be at least 1 mm from the orient origin point');
  const x = normalize(d1);
  let y: Vec3, z: Vec3;
  if (kind === 'XZ') { z = normalize(sub(d2, scale3(x, dot(d2, x)))); y = cross(z, x); }
  else { y = normalize(sub(d2, scale3(x, dot(d2, x)))); z = cross(x, y); }
  return matToWpr(fromCols(x, y, z));
}

/** User frame from TCP positions: origin, +X direction, point in the +Y side of the XY plane. */
export function userFrameFromPoints(origin: Vec3, xp: Vec3, yp: Vec3, systemOrigin?: Vec3): XYZWPR {
  const x = sub(xp, origin);
  if (norm(x) < 1) throw new FrameTeachError('X direction point is too close to the origin');
  const xn = normalize(x);
  const yv = sub(yp, origin);
  const z = cross(xn, yv);
  if (norm(z) < 1) throw new FrameTeachError('Y direction point is on the X axis');
  const zn = normalize(z);
  const yn = cross(zn, xn);
  const [w, p, r] = matToWpr(fromCols(xn, yn, zn));
  const o = systemOrigin ?? origin;
  return { x: o[0], y: o[1], z: o[2], w, p, r };
}

function scale3(v: Vec3, k: number): Vec3 { return [v[0] * k, v[1] * k, v[2] * k]; }
