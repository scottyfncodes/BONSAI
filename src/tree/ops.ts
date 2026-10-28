import {
  type TreeLayout,
  attachFrame,
  bezierPoint,
  childrenIndex,
  computeLayout,
  frameAt,
  placeBranch,
  solveBend,
  solveDirection,
  subtreeIds,
} from './layout';
import { SPECIES } from './species';
import type { Branch, BranchId, Shape, TreeState } from './types';
import {
  type Frame,
  type V3,
  add,
  clamp,
  dirInFrame,
  dot,
  lerp,
  lerp3,
  norm,
  rotateAxis,
  scale,
  sub,
  cross,
  wrapAngle,
  anglesInFrame,
  transportFrame,
} from './vec';

/** Cuts closer to the base than this remove the whole branch. */
export const MIN_SHORTEN_T = 0.18;
/** Branches thicker than this can't take wire. */
export const MAX_WIRE_RADIUS = 0.13;

export type OpResult = { ok: true; tree: TreeState; note?: string } | { ok: false; reason: string };

function cloneShallow(tree: TreeState): TreeState {
  return {
    ...tree,
    branches: { ...tree.branches },
    buds: { ...tree.buds },
    wounds: { ...tree.wounds },
    stats: { ...tree.stats },
  };
}

function newId(t: TreeState, prefix: string): string {
  const id = `${prefix}${t.nextId}`;
  t.nextId += 1;
  return id;
}

/** Foliage "mass" a set of branches carries. */
export function foliageMass(tree: TreeState, ids: Iterable<BranchId>): number {
  let m = 0;
  for (const id of ids) {
    const b = tree.branches[id];
    if (b) m += b.foliage * b.length;
  }
  return m;
}

export function totalFoliage(tree: TreeState): number {
  return foliageMass(tree, Object.keys(tree.branches));
}

export function isRemovable(tree: TreeState, id: BranchId): boolean {
  const b = tree.branches[id];
  return !!b && b.parentId !== null;
}

export interface PrunePreview {
  /** Branches removed entirely. */
  removed: BranchId[];
  /** Branch shortened (cut part-way), with the cut position. */
  shortened: { id: BranchId; t: number } | null;
  foliageFraction: number;
}

export function normaliseCutT(tree: TreeState, id: BranchId, cutT: number): number {
  const b = tree.branches[id];
  if (!b) return 0;
  return cutT < MIN_SHORTEN_T ? 0 : Math.min(cutT, 0.95);
}

export function previewPrune(tree: TreeState, id: BranchId, cutT = 0): PrunePreview {
  const b = tree.branches[id];
  if (!b) return { removed: [], shortened: null, foliageFraction: 0 };
  const t = normaliseCutT(tree, id, cutT);
  const kids = childrenIndex(tree);
  const total = Math.max(totalFoliage(tree), 1e-6);
  if (t === 0) {
    const removed = subtreeIds(tree, id, kids);
    return { removed, shortened: null, foliageFraction: foliageMass(tree, removed) / total };
  }
  const removed: BranchId[] = [];
  for (const c of kids.get(id) ?? []) {
    if (tree.branches[c]!.attachT > t) removed.push(...subtreeIds(tree, c, kids));
  }
  const lostOwn = b.foliage * b.length * (1 - t);
  return { removed, shortened: { id, t }, foliageFraction: (foliageMass(tree, removed) + lostOwn) / total };
}

/**
 * Prune: cutT ≈ 0 removes the branch at its base (leaving a wound on the parent);
 * larger cutT shortens it, keeping the inner part and everything attached there.
 */
export function prune(tree: TreeState, id: BranchId, cutT = 0): OpResult {
  const b = tree.branches[id];
  if (!b) return { ok: false, reason: 'That branch no longer exists.' };
  const t = normaliseCutT(tree, id, cutT);
  if (b.parentId === null && t === 0) return { ok: false, reason: 'The base of the trunk can’t be removed.' };
  const preview = previewPrune(tree, id, t);
  const next = cloneShallow(tree);
  const removedSet = new Set(preview.removed);
  for (const rid of preview.removed) delete next.branches[rid];
  for (const [bid, bud] of Object.entries(next.buds)) if (removedSet.has(bud.branchId)) delete next.buds[bid];
  for (const [wid, w] of Object.entries(next.wounds)) if (removedSet.has(w.branchId)) delete next.wounds[wid];

  if (t === 0) {
    const wid = newId(next, 'w');
    next.wounds[wid] = {
      id: wid,
      branchId: b.parentId!,
      t: b.attachT,
      roll: b.shape.roll,
      size: b.radius,
      day: tree.day,
      heal: 0,
    };
    // Dormant buds near a cut may wake – how readily depends on species.
    if (SPECIES[tree.species].growth.backBud > 0.5) {
      const uid = newId(next, 'u');
      next.buds[uid] = {
        id: uid,
        branchId: b.parentId!,
        t: clamp(b.attachT - 0.06, 0.02, 0.98),
        roll: b.shape.roll + 0.8,
        age: 0,
      };
    }
  } else {
    shortenInPlace(next, tree, id, t);
  }
  next.stats.cuts += 1;
  next.stats.recentFoliageLoss += preview.foliageFraction;
  return { ok: true, tree: next };
}

/** Shorten branch `id` to fraction t of its length, keeping children's world directions. */
function shortenInPlace(next: TreeState, prev: TreeState, id: BranchId, t: number): void {
  const prevLayout = computeLayout(prev);
  const l = prevLayout.get(id)!;
  const b = next.branches[id]!;
  // De Casteljau: the sub-curve [0,t] of a quadratic is a quadratic.
  const newEnd = bezierPoint(l, t);
  const newCtrl = lerp3(l.start, l.control, t);
  const at = attachFrame(prev, prevLayout, b)!;
  const chord = norm(sub(newEnd, l.start));
  const { divergence, roll } = solveDirection(at.frame, chord);
  const newLen = Math.hypot(...sub(newEnd, l.start));
  const placedTmp = placeBranch({ ...b, length: newLen, shape: { ...b.shape, divergence, roll, bend: 0 } }, at.start, at.frame);
  const sub3 = { start: l.start, end: newEnd, control: newCtrl };
  const { bend, bendAngle } = solveBend({ ...l, ...sub3, frame: placedTmp.frame }, newLen, bezierPoint(sub3, 0.5));
  const shape: Shape = { divergence, roll, bend, bendAngle };
  const shapeDelta = (s: Shape): Shape => ({
    divergence: s.divergence + (divergence - b.shape.divergence),
    roll: s.roll + (roll - b.shape.roll),
    bend: s.bend,
    bendAngle: s.bendAngle,
  });
  next.branches[id] = {
    ...b,
    length: newLen,
    shape,
    rest: b.wire ? shapeDelta(b.rest) : { ...shape },
    foliage: b.foliage * (0.55 + 0.45 * t),
  };
  // Re-anchor surviving children so they keep pointing where they did.
  const kids = Object.values(next.branches).filter((c) => c.parentId === id);
  const tmpLayout = computeLayout(next);
  const nl = tmpLayout.get(id)!;
  for (const c of kids) {
    const oldL = prevLayout.get(c.id);
    if (!oldL) continue;
    const newT = nearestT(nl, oldL.start);
    const frame = frameAt(nl, newT);
    const dir = solveDirection(frame, oldL.frame.t);
    const bendDir = norm(
      add(scale(oldL.frame.n, Math.cos(c.shape.bendAngle)), scale(oldL.frame.b, Math.sin(c.shape.bendAngle))),
    );
    const childFrame = transportFrame(frame, dirInFrame(frame, dir.divergence, dir.roll));
    const bendAngle = Math.atan2(dot(bendDir, childFrame.b), dot(bendDir, childFrame.n));
    const reshape = { ...c.shape, divergence: dir.divergence, roll: dir.roll, bendAngle };
    next.branches[c.id] = {
      ...c,
      attachT: newT,
      shape: reshape,
      rest: c.wire ? c.rest : { ...reshape },
    };
  }
  for (const bud of Object.values(next.buds)) {
    if (bud.branchId === id) {
      if (bud.t > t) delete next.buds[bud.id];
      else next.buds[bud.id] = { ...bud, t: bud.t / t };
    }
  }
  for (const w of Object.values(next.wounds)) {
    if (w.branchId === id) next.wounds[w.id] = { ...w, t: Math.min(1, w.t / t) };
  }
  const wid = newId(next, 'w');
  next.wounds[wid] = { id: wid, branchId: id, t: 1, roll: 0, size: radiusAtT(b, t, nl.r1), day: prev.day, heal: 0 };
  // A shortened tip pushes out new buds just behind the cut.
  const uid = newId(next, 'u');
  next.buds[uid] = { id: uid, branchId: id, t: 0.92, roll: b.shape.roll + 1.3, age: 0 };
}

/** Parameter of the point on a branch curve closest to p. */
function nearestT(l: Parameters<typeof bezierPoint>[0], p: V3): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= 64; i++) {
    const d = Math.hypot(...sub(bezierPoint(l, i / 64), p));
    if (d < bestD) {
      bestD = d;
      best = i / 64;
    }
  }
  let step = 1 / 128;
  for (let k = 0; k < 12; k++) {
    for (const cand of [best - step, best + step]) {
      const c = clamp(cand, 0, 1);
      const d = Math.hypot(...sub(bezierPoint(l, c), p));
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    step /= 2;
  }
  return best;
}

function radiusAtT(b: Branch, t: number, r1: number): number {
  return lerp(b.radius, r1, t);
}

// ---------------------------------------------------------------- shaping

/** 0 = twig, 1 = very thick wood. */
export function thickness01(b: Branch): number {
  return clamp((b.radius - 0.01) / 0.17, 0, 1);
}

/** How far (radians) a branch may be bent away from its rest direction right now. */
export function maxBendAngle(tree: TreeState, b: Branch): number {
  const flex = SPECIES[tree.species].growth.flexibility;
  const base = lerp(1.7, 0.28, Math.pow(thickness01(b), 0.7)) * (0.55 + 0.45 * flex);
  const wired = b.wire ? 1.45 : 1;
  const trunk = b.parentId === null ? 0.55 : 1;
  return base * wired * trunk;
}

/** How much of an unwired bend the wood keeps when released (0..1). */
export function holdFraction(tree: TreeState, b: Branch): number {
  if (b.wire) return 1;
  const flex = SPECIES[tree.species].growth.flexibility;
  return clamp(0.85 - thickness01(b) * 1.4 + (flex - 0.7) * 0.3, 0.12, 0.85);
}

const divergenceLimits = (b: Branch): [number, number] =>
  b.parentId === null ? [0, 1.15] : b.kind === 'trunk' ? [0, 1.05] : [0.12, 2.6];

/** Angle between two shapes' chord directions, measured in a common frame. */
function shapeAngle(a: Shape, b: Shape): number {
  const f: Frame = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] };
  const da = dirInFrame(f, a.divergence, a.roll);
  const db = dirInFrame(f, b.divergence, b.roll);
  return Math.acos(clamp(dot(da, db), -1, 1));
}

/**
 * Clamp a requested shape to what the wood allows: divergence limits, bend
 * magnitude, and maximum deviation from the rest shape.
 */
export function clampShape(tree: TreeState, b: Branch, want: Shape): { shape: Shape; limited: boolean } {
  let limited = false;
  const [dMin, dMax] = divergenceLimits(b);
  let s: Shape = { ...want, roll: wrapAngle(want.roll), bendAngle: wrapAngle(want.bendAngle) };
  if (s.divergence < dMin || s.divergence > dMax) {
    s.divergence = clamp(s.divergence, dMin, dMax);
    limited = true;
  }
  const maxBend = b.parentId === null ? 0.35 : 0.6;
  if (s.bend > maxBend) {
    s.bend = maxBend;
    limited = true;
  }
  if (s.bend < 0) s.bend = 0;
  const maxAng = maxBendAngle(tree, b);
  const ang = shapeAngle(b.rest, s);
  if (ang > maxAng + 1e-6) {
    // Slerp from rest direction toward the wanted one, stopping at the limit.
    const f: Frame = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] };
    const from = dirInFrame(f, b.rest.divergence, b.rest.roll);
    const to = dirInFrame(f, s.divergence, s.roll);
    const axis = cross(from, to);
    const sl = Math.hypot(...axis);
    if (sl > 1e-9) {
      const d = rotateAxis(from, scale(axis, 1 / sl), maxAng);
      const { div, roll } = anglesInFrame(f, d);
      s = { ...s, divergence: clamp(div, dMin, dMax), roll };
    }
    limited = true;
  }
  // Bend magnitude change is limited too, scaled by thickness.
  const maxBendDelta = lerp(0.6, 0.12, thickness01(b)) * (b.wire ? 1.4 : 1);
  if (Math.abs(s.bend - b.rest.bend) > maxBendDelta) {
    s.bend = b.rest.bend + Math.sign(s.bend - b.rest.bend) * maxBendDelta;
    limited = true;
  }
  return { shape: s, limited };
}

export function setShape(tree: TreeState, id: BranchId, want: Shape): OpResult & { limited?: boolean } {
  const b = tree.branches[id];
  if (!b) return { ok: false, reason: 'That branch no longer exists.' };
  const { shape, limited } = clampShape(tree, b, want);
  const next = { ...tree, branches: { ...tree.branches, [id]: { ...b, shape } } };
  return { ok: true, tree: next, limited, note: limited ? 'The wood resists – that’s as far as it will go.' : undefined };
}

/** Point a branch's tip toward a world-space target (keeping length). */
export function aimTip(tree: TreeState, layout: TreeLayout, id: BranchId, target: V3) {
  const b = tree.branches[id];
  if (!b) return { ok: false as const, reason: 'That branch no longer exists.' };
  const at = attachFrame(tree, layout, b);
  if (!at) return { ok: false as const, reason: 'Branch is detached.' };
  const d = sub(target, at.start);
  if (Math.hypot(...d) < 1e-6) return { ok: true as const, tree, limited: false };
  const { divergence, roll } = solveDirection(at.frame, norm(d));
  // Preserve the world bend direction as the chord swings.
  const oldPlaced = placeBranch(b, at.start, at.frame);
  const bendWorld = norm(
    add(scale(oldPlaced.frame.n, Math.cos(b.shape.bendAngle)), scale(oldPlaced.frame.b, Math.sin(b.shape.bendAngle))),
  );
  const newPlaced = placeBranch({ ...b, shape: { ...b.shape, divergence, roll } }, at.start, at.frame);
  let bendAngle = Math.atan2(dot(bendWorld, newPlaced.frame.b), dot(bendWorld, newPlaced.frame.n));
  if (!Number.isFinite(bendAngle)) bendAngle = b.shape.bendAngle;
  return setShape(tree, id, { ...b.shape, divergence, roll, bendAngle });
}

/** Curve a branch so its midpoint moves toward a world-space target. */
export function curveTo(tree: TreeState, layout: TreeLayout, id: BranchId, targetMid: V3) {
  const b = tree.branches[id];
  const l = layout.get(id);
  if (!b || !l) return { ok: false as const, reason: 'That branch no longer exists.' };
  const { bend, bendAngle } = solveBend(l, b.length, targetMid);
  return setShape(tree, id, { ...b.shape, bend, bendAngle });
}

/**
 * Called when the player lets go of a bend. Wired wood holds the shape;
 * bare wood springs part of the way back and remembers the rest.
 */
export function releaseShape(before: TreeState, after: TreeState, id: BranchId): TreeState {
  const b = after.branches[id];
  const prev = before.branches[id];
  if (!b || !prev) return after;
  const changed = shapeAngle(prev.shape, b.shape) > 1e-4 || Math.abs(prev.shape.bend - b.shape.bend) > 1e-4;
  if (!changed) return before;
  const stats = { ...after.stats, bends: after.stats.bends + 1 };
  if (b.wire) return { ...after, stats };
  const h = holdFraction(after, b);
  const kept = lerpShape(prev.shape, b.shape, h);
  return {
    ...after,
    stats,
    branches: { ...after.branches, [id]: { ...b, shape: kept, rest: { ...kept } } },
  };
}

export function lerpShape(a: Shape, b: Shape, t: number): Shape {
  // Interpolate the chord direction on the sphere to avoid roll wrap-around artefacts.
  const f: Frame = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] };
  const da = dirInFrame(f, a.divergence, a.roll);
  const db = dirInFrame(f, b.divergence, b.roll);
  const axis = cross(da, db);
  const sl = Math.hypot(...axis);
  let div = lerp(a.divergence, b.divergence, t);
  let roll = a.roll;
  if (sl > 1e-9) {
    const ang = Math.atan2(sl, dot(da, db));
    const d = rotateAxis(da, scale(axis, 1 / sl), ang * t);
    const r = anglesInFrame(f, d);
    div = r.div;
    roll = r.roll;
  } else if (dot(da, db) > 0) {
    roll = a.roll;
  }
  // Bends: interpolate as 2D offset vectors.
  const ax = a.bend * Math.cos(a.bendAngle);
  const ay = a.bend * Math.sin(a.bendAngle);
  const bx = b.bend * Math.cos(b.bendAngle);
  const by = b.bend * Math.sin(b.bendAngle);
  const x = lerp(ax, bx, t);
  const y = lerp(ay, by, t);
  return { divergence: div, roll, bend: Math.hypot(x, y), bendAngle: Math.hypot(x, y) > 1e-9 ? Math.atan2(y, x) : b.bendAngle };
}

// ---------------------------------------------------------------- wire

export function canWire(b: Branch): { ok: true } | { ok: false; reason: string } {
  if (b.radius > MAX_WIRE_RADIUS) return { ok: false, reason: 'Too thick to wire – shape it gradually instead.' };
  return { ok: true };
}

export function applyWire(tree: TreeState, id: BranchId, copper = false): OpResult {
  const b = tree.branches[id];
  if (!b) return { ok: false, reason: 'That branch no longer exists.' };
  if (b.wire) return { ok: false, reason: 'Already wired.' };
  const can = canWire(b);
  if (!can.ok) return can;
  return {
    ok: true,
    tree: {
      ...tree,
      branches: { ...tree.branches, [id]: { ...b, wire: copper ? { appliedDay: tree.day, set: 0, bite: 0, copper: true } : { appliedDay: tree.day, set: 0, bite: 0 } } },
      stats: { ...tree.stats, wiresApplied: tree.stats.wiresApplied + 1 },
    },
  };
}

/** Removing wire: the branch keeps whatever it has set; the rest springs back. */
export function removeWire(tree: TreeState, id: BranchId): OpResult {
  const b = tree.branches[id];
  if (!b) return { ok: false, reason: 'That branch no longer exists.' };
  if (!b.wire) return { ok: false, reason: 'No wire on this branch.' };
  const settled = lerpShape(b.rest, b.shape, b.wire.set);
  const sprang = b.wire.set < 0.98 && shapeAngle(settled, b.shape) > 0.02;
  return {
    ok: true,
    tree: {
      ...tree,
      branches: { ...tree.branches, [id]: { ...b, wire: null, shape: settled, rest: { ...settled } } },
    },
    note: sprang ? `It had set ${Math.round(b.wire.set * 100)}% – the rest sprang back.` : 'Fully set. The shape holds.',
  };
}

/** Convenience: world-space tip of a branch. */
export function tipPoint(layout: TreeLayout, id: BranchId): V3 | null {
  const l = layout.get(id);
  return l ? bezierPoint(l, 1) : null;
}

