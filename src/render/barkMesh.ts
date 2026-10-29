import * as THREE from 'three';
import { type BranchLayout, type TreeLayout, bezierPoint, bezierTangent } from '../tree/layout';
import { rngFor } from '../tree/rng';
import type { SpeciesDef } from '../tree/species';
import type { BranchId, TreeState } from '../tree/types';
import { type Frame, type V3, clamp, transportFrame } from '../tree/vec';

export interface BarkOptions {
  /** Only include these branches (default: all). */
  include?: (id: BranchId) => boolean;
  /** Restrict a branch to part of its length, e.g. the part a cut would remove. */
  range?: Map<BranchId, [number, number]>;
  /** Grow radius by this factor plus a constant (for highlight shells). */
  inflate?: [number, number];
  /** Lower tessellation for previews and slower devices. */
  quality?: 'high' | 'low';
  /** Leave out vertex colours (single-colour overlays). */
  plain?: boolean;
}

function radialSegments(r: number, q: 'high' | 'low'): number {
  const s = r > 0.1 ? 16 : r > 0.045 ? 11 : r > 0.02 ? 7 : 5;
  return q === 'low' ? Math.max(4, Math.round(s * 0.65)) : s;
}

/** Root flare: the base of the trunk spreads into the soil. */
function flare(isRoot: boolean, s: number): number {
  if (!isRoot) return 1;
  return 1 + 0.85 * Math.exp(-Math.max(0, s + 0.05) / 0.09);
}

/** Append-only Float32/Uint32 buffer – avoids boxing every vertex in a JS array. */
class Buf<T extends Float32Array | Uint32Array> {
  data: T;
  length = 0;
  constructor(private make: (n: number) => T, initial = 4096) {
    this.data = make(initial);
  }
  private grow(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    const next = this.make(Math.max(this.data.length * 2, this.length + extra));
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push2(a: number, b: number): void {
    this.grow(2);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
  }
  push3(a: number, b: number, c: number): void {
    this.grow(3);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  view(): T {
    return this.data.subarray(0, this.length) as T;
  }
}

const trig = new Map<number, { cos: Float32Array; sin: Float32Array }>();
function trigTable(radial: number) {
  let t = trig.get(radial);
  if (!t) {
    const cos = new Float32Array(radial + 1);
    const sin = new Float32Array(radial + 1);
    for (let j = 0; j <= radial; j++) {
      cos[j] = Math.cos((j / radial) * Math.PI * 2);
      sin[j] = Math.sin((j / radial) * Math.PI * 2);
    }
    t = { cos, sin };
    trig.set(radial, t);
  }
  return t;
}

/** Bleached, sun-silvered deadwood. */
const SHARI = new THREE.Color('#e3dccf');

const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

interface Piece {
  id: BranchId;
  t0: number;
  t1: number;
}

/**
 * Group branches into strands: a trunk segment and the trunk segment that
 * continues from its tip form one continuous tube, so the leader has no seams.
 */
function buildStrands(tree: TreeState, layout: TreeLayout, opts: BarkOptions): Piece[][] {
  const included = (id: BranchId) => layout.has(id) && (!opts.include || opts.include(id));
  const rangeOf = (id: BranchId): [number, number] => opts.range?.get(id) ?? [0, 1];
  const continuation = new Map<BranchId, BranchId>();
  for (const b of Object.values(tree.branches)) {
    if (b.kind !== 'trunk' || !b.parentId || b.attachT < 0.999) continue;
    const p = tree.branches[b.parentId];
    if (p?.kind === 'trunk' && !continuation.has(p.id)) continuation.set(p.id, b.id);
  }
  const isContinued = new Set(continuation.values());
  const strands: Piece[][] = [];
  for (const b of Object.values(tree.branches)) {
    if (!included(b.id)) continue;
    const [r0, r1] = rangeOf(b.id);
    // Starts a strand unless it continues an included, full-length parent.
    const parentJoins =
      isContinued.has(b.id) && b.parentId && included(b.parentId) && rangeOf(b.parentId)[1] === 1 && r0 === 0;
    if (parentJoins) continue;
    const strand: Piece[] = [{ id: b.id, t0: r0, t1: r1 }];
    let cur = b.id;
    while (r1 === 1 && strand[strand.length - 1]!.t1 === 1) {
      const next = continuation.get(cur);
      if (!next || !included(next) || rangeOf(next)[0] !== 0) break;
      strand.push({ id: next, t0: 0, t1: rangeOf(next)[1] });
      cur = next;
    }
    strands.push(strand);
  }
  return strands;
}

/**
 * Build one merged BufferGeometry for the bark of the tree (or a subset).
 * Each strand is a tapered tube following its Bézier curves; ring frames are
 * parallel-transported so tubes never twist or pinch.
 */
export function buildBarkGeometry(
  tree: TreeState,
  layout: TreeLayout,
  sp: SpeciesDef,
  opts: BarkOptions = {},
): THREE.BufferGeometry {
  const q = opts.quality ?? 'high';
  const positions = new Buf((n) => new Float32Array(n), 16384);
  const normals = new Buf((n) => new Float32Array(n), 16384);
  const uvs = new Buf((n) => new Float32Array(n), 8192);
  const colors = new Buf((n) => new Float32Array(n), opts.plain ? 16 : 16384);
  const indices = new Buf((n) => new Uint32Array(n), 32768);
  const base = new THREE.Color(sp.bark.base);
  const dark = new THREE.Color(sp.bark.dark);
  const light = new THREE.Color(sp.bark.light);
  const young = new THREE.Color(sp.id === 'maple' ? '#8f8a5a' : sp.id === 'pine' ? '#8a6f52' : '#8a5a40');
  const [inflMul, inflAdd] = opts.inflate ?? [1, 0];

  for (const strand of buildStrands(tree, layout, opts)) {
    const first = tree.branches[strand[0]!.id]!;
    const fl = layout.get(first.id)!;
    const isRoot = first.parentId === null;
    const pl = first.parentId ? layout.get(first.parentId) : undefined;
    const parentR = pl ? pl.r0 + (pl.r1 - pl.r0) * first.attachT : 0;
    // Extend the start back inside the parent so joints look grown, not glued.
    const back =
      strand[0]!.t0 === 0
        ? isRoot
          ? 0.08
          : clamp((Math.max(0, parentR - fl.r0 * 0.66) * 0.8) / first.length, 0, 0.3)
        : 0;

    // Sample points along the whole strand.
    const samples: { p: V3; tan: V3; r: number; tc: number }[] = [];
    strand.forEach((piece, pi) => {
      const b = tree.branches[piece.id]!;
      const l = layout.get(piece.id)!;
      const t0 = pi === 0 ? piece.t0 - back : piece.t0;
      const rings = clamp(Math.ceil((b.length * (piece.t1 - t0)) / (q === 'low' ? 0.12 : 0.07)) + 2, 3, 18);
      for (let i = pi === 0 ? 0 : 1; i <= rings; i++) {
        const t = t0 + ((piece.t1 - t0) * i) / rings;
        const tc = clamp(t, 0, 1);
        let r = l.r0 + (l.r1 - l.r0) * tc;
        const s = t * b.length;
        if (b.parentId === null) r *= flare(true, s);
        else if (pi === 0 && b.kind === 'branch') r *= 1 + 0.32 * Math.exp(-Math.max(0, s) / (l.r0 * 2.5 + 0.01));
        // Taper the buried part so it can never poke out of the parent.
        if (t < 0 && pi === 0 && !isRoot && back > 0) r *= 1 + (t / back) * 0.5;
        let tan = bezierTangent(l, tc);
        if (i === rings && pi < strand.length - 1) {
          // Smooth the joint: average with the next segment's start tangent.
          const nl = layout.get(strand[pi + 1]!.id)!;
          const nt = bezierTangent(nl, 0);
          tan = norm3([tan[0] + nt[0], tan[1] + nt[1], tan[2] + nt[2]]);
        }
        samples.push({ p: pointAt(l, t), tan, r: r * inflMul + inflAdd, tc });
      }
    });

    const radial = radialSegments(fl.r0, q);
    const uRepeat = Math.max(1, Math.round((Math.PI * 2 * fl.r0) / 0.22));
    const rng = rngFor(tree.seed, first.id, 'bark');
    const tone = rng();
    const ageTone = clamp((fl.r0 - 0.008) / 0.05, 0, 1);
    const col = new THREE.Color().copy(young).lerp(base, ageTone).lerp(tone < 0.5 ? dark : light, Math.abs(tone - 0.5) * 0.35);

    // Shimpaku junipers carry a twisting band of bleached deadwood (shari) up the trunk.
    const shari =
      sp.id === 'juniper' && first.kind === 'trunk' && first.parentId === null && !opts.plain
        ? { a0: rng() * Math.PI * 2, twist: 0.9 + rng() * 0.8, width: 0.42 + rng() * 0.22 }
        : null;
    emitTube(samples, transportFrame(fl.frame, samples[0]!.tan), radial, uRepeat, col, ageTone, fl.r0 > 0.05 ? first.length : null, shari);
  }

  // Surface roots (nebari) radiate from the trunk base into the soil.
  const root = tree.branches[tree.rootId];
  const rootL = root ? layout.get(root.id) : undefined;
  if (root && rootL && (!opts.include || opts.include(root.id)) && !opts.range?.has(root.id) && !opts.plain) {
    const rng = rngFor(tree.seed, 'nebari');
    const n = 5 + Math.floor(rng() * 3);
    const r0 = rootL.r0;
    const col = new THREE.Color(sp.bark.base).lerp(dark, 0.25);
    const spin = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const az = spin + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.7;
      // Short enough to stay inside even a shallow pot; they vanish under the soil.
      const len = Math.min(r0 * (1.1 + rng() * 0.9), 0.36);
      const rs = r0 * (0.32 + rng() * 0.16);
      const wiggle = (rng() - 0.5) * 0.5;
      const pts: { p: V3; tan: V3; r: number; tc: number }[] = [];
      const N = q === 'low' ? 6 : 10;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const d = r0 * 0.35 + len * t;
        const bend = wiggle * t * t;
        const x = Math.cos(az + bend) * d;
        const z = Math.sin(az + bend) * d;
        // Rise slightly where the root leaves the trunk, then dive into the soil.
        const y = 0.05 * (1 - t) - 0.09 * t * t + 0.012;
        pts.push({ p: [x, y, z], tan: [0, 0, 0], r: (rs * Math.pow(1 - t, 1.2) + 0.004) * inflMul + inflAdd, tc: t });
      }
      for (let k = 0; k <= N; k++) {
        const a2 = pts[Math.max(0, k - 1)]!.p;
        const b2 = pts[Math.min(N, k + 1)]!.p;
        pts[k]!.tan = norm3([b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]]);
      }
      const t0 = pts[0]!.tan;
      const nrm = norm3([-t0[2], 0, t0[0]]);
      const f0: Frame = { t: t0, n: nrm, b: norm3(crossV(t0, nrm)) };
      emitTube(pts, f0, radialSegments(rs, q), Math.max(1, Math.round((Math.PI * 2 * rs) / 0.22)), col, 1, null, null);
    }
  }

  /** Append one tapered tube following `samples` (parallel-transported rings, capped tip). */
  function emitTube(
    samples: { p: V3; tan: V3; r: number }[],
    startFrame: Frame,
    radial: number,
    uRepeat: number,
    col: THREE.Color,
    ageTone: number,
    wobbleSeed: number | null,
    shari: { a0: number; twist: number; width: number } | null,
  ): void {
    let frame = startFrame;
    let arc = 0;
    const startIndex = positions.length / 3;
    const { cos: cosT, sin: sinT } = trigTable(radial);
    samples.forEach((smp, i) => {
      frame = transportFrame(frame, smp.tan);
      if (i > 0) {
        const pp = samples[i - 1]!.p;
        arc += Math.hypot(smp.p[0] - pp[0], smp.p[1] - pp[1], smp.p[2] - pp[2]);
      }
      const frac = i / Math.max(1, samples.length - 1);
      const shade = 1 - 0.18 * (1 - frac) * ageTone;
      const cr = col.r * shade;
      const cg = col.g * shade;
      const cb = col.b * shade;
      const [fnx, fny, fnz] = frame.n;
      const [fbx, fby, fbz] = frame.b;
      const [px, py, pz] = smp.p;
      const v = arc / 0.35;
      const shariCenter = shari ? shari.a0 + arc * shari.twist : 0;
      const shariHalf = shari ? shari.width * (1 - frac * 0.55) : 0;
      for (let j = 0; j <= radial; j++) {
        const ca = cosT[j]!;
        const sa = sinT[j]!;
        const nx = fnx * ca + fbx * sa;
        const ny = fny * ca + fby * sa;
        const nz = fnz * ca + fbz * sa;
        const ang = (j / radial) * Math.PI * 2;
        // A little irregularity on thick wood so it isn't a perfect cylinder.
        let r = wobbleSeed !== null ? smp.r * (1 + 0.07 * Math.sin(ang * 3 + arc * 5.3 + wobbleSeed) * ageTone) : smp.r;
        let k = 0;
        if (shari) {
          let d = Math.abs(((ang - shariCenter) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          k = clamp((shariHalf - d) / (shariHalf * 0.35), 0, 1);
          // Deadwood is carved slightly below the living bark.
          r *= 1 - 0.06 * k;
        }
        positions.push3(px + nx * r, py + ny * r, pz + nz * r);
        normals.push3(nx, ny, nz);
        uvs.push2((j / radial) * uRepeat, v);
        if (!opts.plain) {
          if (k > 0) {
            const g = 0.82 + 0.1 * Math.sin(arc * 9 + ang * 2);
            colors.push3(cr + (SHARI.r * g - cr) * k, cg + (SHARI.g * g - cg) * k, cb + (SHARI.b * g - cb) * k);
          } else colors.push3(cr, cg, cb);
        }
      }
    });
    const rings = samples.length - 1;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < radial; j++) {
        const a = startIndex + i * (radial + 1) + j;
        const c = a + radial + 1;
        indices.push3(a, a + 1, c);
        indices.push3(a + 1, c + 1, c);
      }
    }
    // Cap the tip so open tubes never show their insides.
    const last = samples[samples.length - 1]!;
    const capIdx = positions.length / 3;
    positions.push3(last.p[0] + last.tan[0] * last.r * 0.6, last.p[1] + last.tan[1] * last.r * 0.6, last.p[2] + last.tan[2] * last.r * 0.6);
    normals.push3(last.tan[0], last.tan[1], last.tan[2]);
    uvs.push2(0, arc / 0.35);
    if (!opts.plain) colors.push3(col.r, col.g, col.b);
    const lastRing = startIndex + rings * (radial + 1);
    for (let j = 0; j < radial; j++) indices.push3(lastRing + j, lastRing + j + 1, capIdx);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions.view(), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals.view(), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs.view(), 2));
  if (!opts.plain) g.setAttribute('color', new THREE.BufferAttribute(colors.view(), 3));
  g.setIndex(new THREE.BufferAttribute(indices.view(), 1));
  g.computeBoundingSphere();
  return g;
}

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Bézier point with linear extrapolation outside [0, 1]. */
function pointAt(l: BranchLayout, t: number): V3 {
  if (t >= 0 && t <= 1) return bezierPoint(l, t);
  const edge = t < 0 ? 0 : 1;
  const p = bezierPoint(l, edge);
  const tan = bezierTangent(l, edge);
  const d = (t - edge) * Math.hypot(l.end[0] - l.start[0], l.end[1] - l.start[1], l.end[2] - l.start[2]);
  return [p[0] + tan[0] * d, p[1] + tan[1] * d, p[2] + tan[2] * d];
}

/** Helical training wire wrapped around the given branches. */
export function buildWireGeometry(tree: TreeState, layout: TreeLayout, ids: BranchId[]): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const id of ids) {
    const b = tree.branches[id];
    const l = layout.get(id);
    if (!b?.wire || !l) continue;
    const thick = clamp(l.r0 * 0.22, 0.0035, 0.011);
    const pitch = 0.05 + l.r0 * 1.6;
    const turns = Math.max(2, Math.round((b.length * 0.92) / pitch));
    const steps = turns * 10;
    const pts: THREE.Vector3[] = [];
    let frame: Frame = transportFrame(l.frame, bezierTangent(l, 0));
    for (let i = 0; i <= steps; i++) {
      const t = 0.04 + (0.9 * i) / steps;
      const p = bezierPoint(l, t);
      frame = transportFrame(frame, bezierTangent(l, t));
      const a = (i / 10) * Math.PI * 2;
      const r = l.r0 + (l.r1 - l.r0) * t + thick * 0.8;
      pts.push(
        new THREE.Vector3(
          p[0] + (frame.n[0] * Math.cos(a) + frame.b[0] * Math.sin(a)) * r,
          p[1] + (frame.n[1] * Math.cos(a) + frame.b[1] * Math.sin(a)) * r,
          p[2] + (frame.n[2] * Math.cos(a) + frame.b[2] * Math.sin(a)) * r,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    parts.push(new THREE.TubeGeometry(curve, steps, thick, 4, false));
  }
  if (!parts.length) return null;
  return mergeSimple(parts);
}

/** Merge non-indexed or indexed geometries sharing position/normal/uv. */
export function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let offset = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + offset);
    else for (let i = 0; i < p.count; i++) idx.push(i + offset);
    offset += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
