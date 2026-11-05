// Minimal rigid-transform math for kinematics (kept independent of three.js so it can be unit tested).
// Rotations are row-major 3x3 arrays; angles in degrees at the API surface, radians internally.

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export interface Frame { R: Mat3; p: Vec3 }

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const I3 = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const identity = (): Frame => ({ R: I3(), p: [0, 0, 0] });

export function rotX(a: number): Mat3 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
export function rotY(a: number): Mat3 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
export function rotZ(a: number): Mat3 { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
export function transpose(a: Mat3): Mat3 { return [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]; }
export function mulv(a: Mat3, v: Vec3): Vec3 {
  return [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (norm(a) || 1));
export const col = (R: Mat3, j: number): Vec3 => [R[j], R[3 + j], R[6 + j]];
export function fromCols(x: Vec3, y: Vec3, z: Vec3): Mat3 { return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]; }

export function compose(a: Frame, b: Frame): Frame { return { R: mul3(a.R, b.R), p: add(mulv(a.R, b.p), a.p) }; }
export function invert(a: Frame): Frame { const Rt = transpose(a.R); return { R: Rt, p: scale(mulv(Rt, a.p), -1) }; }

/** Rotation about an arbitrary unit axis (Rodrigues). */
export function rotAxis(axis: Vec3, a: number): Mat3 {
  const [x, y, z] = normalize(axis), c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** FANUC-style XYZWPR pose: W,P,R are fixed-axis rotations about X, Y, Z (R = Rz(r)·Ry(p)·Rx(w)), mm/deg. */
export interface XYZWPR { x: number; y: number; z: number; w: number; p: number; r: number }

export function wprToMat(w: number, p: number, r: number): Mat3 {
  return mul3(rotZ(r * D2R), mul3(rotY(p * D2R), rotX(w * D2R)));
}
export function matToWpr(R: Mat3): [number, number, number] {
  const p = Math.atan2(-R[6], Math.hypot(R[0], R[3]));
  let w: number, r: number;
  if (Math.abs(Math.cos(p)) < 1e-9) { // gimbal lock: fold everything into W
    r = 0;
    w = p > 0 ? Math.atan2(R[1], R[2]) : Math.atan2(-R[1], -R[2]);
  } else { w = Math.atan2(R[7], R[8]); r = Math.atan2(R[3], R[0]); }
  const fix = (a: number) => (Math.abs(a + Math.PI) < 1e-9 ? Math.PI : a); // show 180 rather than -180
  return [fix(w) * R2D, p * R2D, fix(r) * R2D];
}
export function poseToFrame(q: XYZWPR): Frame { return { R: wprToMat(q.w, q.p, q.r), p: [q.x, q.y, q.z] }; }
export function frameToPose(f: Frame): XYZWPR {
  const [w, p, r] = matToWpr(f.R);
  return { x: f.p[0], y: f.p[1], z: f.p[2], w, p, r };
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrap180(a: number) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }
