/** Minimal immutable 3D vector math, independent of the renderer. */
export type V3 = readonly [number, number, number];

export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => len(sub(a, b));
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export function norm(a: V3): V3 {
  const l = len(a);
  return l < 1e-9 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Rotate v around unit axis k by angle (Rodrigues). */
export function rotateAxis(v: V3, k: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}

/** Apply the minimal rotation that takes unit vector `from` onto unit vector `to` to vector v. */
export function rotateMinimal(v: V3, from: V3, to: V3): V3 {
  const axis = cross(from, to);
  const s = len(axis);
  const c = clamp(dot(from, to), -1, 1);
  if (s < 1e-9) {
    if (c > 0) return v;
    // 180° flip: rotate around any axis perpendicular to `from`.
    const perp = Math.abs(from[0]) < 0.9 ? norm(cross(from, [1, 0, 0])) : norm(cross(from, [0, 0, 1]));
    return rotateAxis(v, perp, Math.PI);
  }
  return rotateAxis(v, scale(axis, 1 / s), Math.atan2(s, c));
}

/** Orthonormal frame: t = tangent, n/b span the perpendicular plane. */
export interface Frame {
  t: V3;
  n: V3;
  b: V3;
}

export function transportFrame(f: Frame, to: V3): Frame {
  const n = norm(rotateMinimal(f.n, f.t, to));
  const b = norm(cross(to, n));
  // Re-orthogonalise n against numerical drift.
  return { t: to, n: norm(cross(b, to)), b };
}

/** Direction at polar angle `div` from frame.t and azimuth `roll` around it. */
export function dirInFrame(f: Frame, div: number, roll: number): V3 {
  const sd = Math.sin(div);
  return norm([
    f.t[0] * Math.cos(div) + (f.n[0] * Math.cos(roll) + f.b[0] * Math.sin(roll)) * sd,
    f.t[1] * Math.cos(div) + (f.n[1] * Math.cos(roll) + f.b[1] * Math.sin(roll)) * sd,
    f.t[2] * Math.cos(div) + (f.n[2] * Math.cos(roll) + f.b[2] * Math.sin(roll)) * sd,
  ]);
}

/** Inverse of dirInFrame. */
export function anglesInFrame(f: Frame, d: V3): { div: number; roll: number } {
  const c = clamp(dot(norm(d), f.t), -1, 1);
  const div = Math.acos(c);
  const roll = Math.atan2(dot(d, f.b), dot(d, f.n));
  return { div, roll: Number.isFinite(roll) ? roll : 0 };
}

export const wrapAngle = (a: number): number => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};
