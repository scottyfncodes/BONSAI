import type { Branch, BranchId, TreeState } from './types';
import {
  type Frame,
  type V3,
  add,
  anglesInFrame,
  clamp,
  dirInFrame,
  dot,
  lerp3,
  madd,
  norm,
  scale,
  sub,
  transportFrame,
} from './vec';

/**
 * World-space description of one branch: a quadratic Bézier from `start`
 * through `control` to `end`, plus the frame children are attached in.
 */
export interface BranchLayout {
  id: BranchId;
  start: V3;
  control: V3;
  end: V3;
  /** Frame whose tangent is the chord direction; children transport from it. */
  frame: Frame;
  r0: number;
  r1: number;
  /** 0 for trunk segments, 1 for primary branches, … */
  depth: number;
}

export type TreeLayout = Map<BranchId, BranchLayout>;

export const BASE_FRAME: Frame = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] };

export function childrenIndex(tree: TreeState): Map<BranchId, BranchId[]> {
  const idx = new Map<BranchId, BranchId[]>();
  for (const b of Object.values(tree.branches)) {
    if (b.parentId === null) continue;
    const list = idx.get(b.parentId);
    if (list) list.push(b.id);
    else idx.set(b.parentId, [b.id]);
  }
  for (const list of idx.values()) {
    list.sort((a, b) => {
      const ta = tree.branches[a]!.attachT;
      const tb = tree.branches[b]!.attachT;
      return ta !== tb ? ta - tb : a < b ? -1 : 1;
    });
  }
  return idx;
}

export function bezierPoint(l: Pick<BranchLayout, 'start' | 'control' | 'end'>, t: number): V3 {
  const a = lerp3(l.start, l.control, t);
  const b = lerp3(l.control, l.end, t);
  return lerp3(a, b, t);
}

export function bezierTangent(l: Pick<BranchLayout, 'start' | 'control' | 'end'>, t: number): V3 {
  const d = add(scale(sub(l.control, l.start), 2 * (1 - t)), scale(sub(l.end, l.control), 2 * t));
  return norm(d);
}

export function frameAt(l: BranchLayout, t: number): Frame {
  return transportFrame(l.frame, bezierTangent(l, t));
}

export function radiusAt(l: BranchLayout, t: number): number {
  return l.r0 + (l.r1 - l.r0) * t;
}

/** Compute the chord-frame, control and end point of a branch given where it starts. */
export function placeBranch(
  b: Branch,
  start: V3,
  parentFrame: Frame,
): { frame: Frame; control: V3; end: V3 } {
  const chord = dirInFrame(parentFrame, b.shape.divergence, b.shape.roll);
  const frame = transportFrame(parentFrame, chord);
  const end = madd(start, chord, b.length);
  const bendDir = norm(add(scale(frame.n, Math.cos(b.shape.bendAngle)), scale(frame.b, Math.sin(b.shape.bendAngle))));
  const control = madd(madd(start, chord, b.length * 0.5), bendDir, b.shape.bend * b.length);
  return { frame, control, end };
}

export function tipRadius(b: Branch, children: Branch[]): number {
  let r = b.radius * (b.kind === 'trunk' ? 0.62 : 0.42);
  for (const c of children) {
    if (c.attachT > 0.9) r = Math.max(r, c.radius * (c.kind === 'trunk' ? 1.02 : 0.9));
  }
  return Math.min(r, b.radius);
}

export function computeLayout(tree: TreeState): TreeLayout {
  const out: TreeLayout = new Map();
  const kids = childrenIndex(tree);
  const root = tree.branches[tree.rootId];
  if (!root) return out;

  const visit = (b: Branch, start: V3, parentFrame: Frame, depth: number) => {
    const { frame, control, end } = placeBranch(b, start, parentFrame);
    const childIds = kids.get(b.id) ?? [];
    const children = childIds.map((id) => tree.branches[id]!).filter(Boolean);
    const layout: BranchLayout = {
      id: b.id,
      start,
      control,
      end,
      frame,
      r0: b.radius,
      r1: tipRadius(b, children),
      depth,
    };
    out.set(b.id, layout);
    for (const c of children) {
      const p = bezierPoint(layout, c.attachT);
      const f = frameAt(layout, c.attachT);
      const childDepth = c.kind === 'trunk' && b.kind === 'trunk' ? depth : depth + 1;
      visit(c, p, f, childDepth);
    }
  };
  visit(root, [0, 0, 0], BASE_FRAME, 0);
  return out;
}

/** The frame a branch is attached in (parent frame at attachT, or the world base frame). */
export function attachFrame(_tree: TreeState, layout: TreeLayout, b: Branch): { start: V3; frame: Frame } | null {
  if (b.parentId === null) return { start: [0, 0, 0], frame: BASE_FRAME };
  const pl = layout.get(b.parentId);
  if (!pl) return null;
  return { start: bezierPoint(pl, b.attachT), frame: frameAt(pl, b.attachT) };
}

/** Express a desired world chord direction as divergence/roll in the attach frame. */
export function solveDirection(frame: Frame, worldDir: V3): { divergence: number; roll: number } {
  const { div, roll } = anglesInFrame(frame, worldDir);
  return { divergence: div, roll };
}

/** Express a desired world-space curve midpoint as bend/bendAngle for a branch. */
export function solveBend(l: BranchLayout, length: number, targetMid: V3): { bend: number; bendAngle: number } {
  const chordMid = lerp3(l.start, l.end, 0.5);
  let off = sub(targetMid, chordMid);
  off = sub(off, scale(l.frame.t, dot(off, l.frame.t)));
  // Curve midpoint offset is half the control-point offset.
  const mag = Math.hypot(off[0], off[1], off[2]);
  const bend = clamp((2 * mag) / Math.max(length, 1e-6), 0, 1);
  const bendAngle = Math.atan2(dot(off, l.frame.b), dot(off, l.frame.n));
  return { bend, bendAngle: Number.isFinite(bendAngle) ? bendAngle : 0 };
}

/** Collect a branch and all its descendants. */
export function subtreeIds(tree: TreeState, id: BranchId, kids = childrenIndex(tree)): BranchId[] {
  const out: BranchId[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (!tree.branches[cur]) continue;
    out.push(cur);
    const c = kids.get(cur);
    if (c) stack.push(...c);
  }
  return out;
}

/** Overall bounds, handy for camera framing and scoring. */
export function layoutBounds(layout: TreeLayout): { min: V3; max: V3 } {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const l of layout.values()) {
    for (const p of [l.start, l.end, bezierPoint(l, 0.5)]) {
      min = [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])];
      max = [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])];
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
