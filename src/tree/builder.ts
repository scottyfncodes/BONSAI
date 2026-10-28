import { type BranchLayout, attachFrame, placeBranch, solveDirection, type TreeLayout, computeLayout } from './layout';
import type { Branch, BranchId, Shape, TreeState } from './types';
import type { V3 } from './vec';

/**
 * Mutable helper used by generation and growth to add branches expressed in
 * world-space intent ("grow this way") rather than parent-relative angles.
 * Always operates on a private draft – never on a state held by history.
 */
export class TreeBuilder {
  readonly tree: TreeState;
  readonly layout: TreeLayout;

  constructor(tree: TreeState, layout?: TreeLayout) {
    this.tree = tree;
    this.layout = layout ?? computeLayout(tree);
  }

  newId(prefix: string): string {
    const id = `${prefix}${this.tree.nextId}`;
    this.tree.nextId += 1;
    return id;
  }

  addBranch(opts: {
    parentId: BranchId | null;
    attachT: number;
    dir: V3;
    length: number;
    radius: number;
    kind?: Branch['kind'];
    bend?: number;
    bendAngle?: number;
    foliage?: number;
    vigor?: number;
  }): Branch | null {
    const draft: Branch = {
      id: this.newId('b'),
      parentId: opts.parentId,
      kind: opts.kind ?? 'branch',
      attachT: opts.attachT,
      length: opts.length,
      radius: opts.radius,
      shape: { divergence: 0, roll: 0, bend: opts.bend ?? 0, bendAngle: opts.bendAngle ?? 0 },
      rest: { divergence: 0, roll: 0, bend: 0, bendAngle: 0 },
      bornDay: this.tree.day,
      foliage: opts.foliage ?? 0,
      vigor: opts.vigor ?? 0.8,
      wire: null,
    };
    const at = attachFrame(this.tree, this.layout, draft);
    if (!at) return null;
    const { divergence, roll } = solveDirection(at.frame, opts.dir);
    const shape: Shape = { ...draft.shape, divergence, roll };
    const branch: Branch = { ...draft, shape, rest: { ...shape } };
    this.tree.branches[branch.id] = branch;
    if (opts.parentId === null) this.tree.rootId = branch.id;
    const placed = placeBranch(branch, at.start, at.frame);
    const l: BranchLayout = {
      id: branch.id,
      start: at.start,
      control: placed.control,
      end: placed.end,
      frame: placed.frame,
      r0: branch.radius,
      r1: branch.radius * 0.45,
      depth: 0,
    };
    this.layout.set(branch.id, l);
    return branch;
  }

  addBud(branchId: BranchId, t: number, roll: number, age = 0): void {
    const id = this.newId('u');
    this.tree.buds[id] = { id, branchId, t, roll, age };
  }
}

/** World direction from azimuth (around +Y, radians) and elevation above horizontal. */
export function dirFromAngles(azimuth: number, elevation: number): V3 {
  const ce = Math.cos(elevation);
  return [ce * Math.cos(azimuth), Math.sin(elevation), ce * Math.sin(azimuth)];
}

export function anglesFromDir(d: V3): { azimuth: number; elevation: number } {
  return { azimuth: Math.atan2(d[2], d[0]), elevation: Math.asin(Math.max(-1, Math.min(1, d[1]))) };
}
