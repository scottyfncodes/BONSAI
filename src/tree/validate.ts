import { MAX_BRANCHES, type Branch, type TreeState } from './types';
import { SPECIES_IDS } from './species';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function validShape(s: unknown): boolean {
  return isObj(s) && isNum(s.divergence) && isNum(s.roll) && isNum(s.bend) && isNum(s.bendAngle);
}

/**
 * Structural validation of a tree loaded from storage. Returns a list of
 * problems; an empty list means the tree is safe to render and edit.
 */
export function validateTree(x: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(x)) return ['tree is not an object'];
  if (!SPECIES_IDS.includes(x.species as never)) errs.push('unknown species');
  if (!isNum(x.seed) || !isNum(x.nextId) || !isNum(x.day) || !isNum(x.health)) errs.push('bad scalar fields');
  if (!isObj(x.branches) || !isObj(x.buds) || !isObj(x.wounds) || !isObj(x.stats)) return [...errs, 'missing tables'];
  const branches = x.branches as Record<string, unknown>;
  const ids = Object.keys(branches);
  if (ids.length === 0) errs.push('no branches');
  if (ids.length > MAX_BRANCHES * 2) errs.push('too many branches');
  if (typeof x.rootId !== 'string' || !branches[x.rootId]) errs.push('missing root');
  let roots = 0;
  for (const id of ids) {
    const b = branches[id];
    if (!isObj(b) || b.id !== id) {
      errs.push(`branch ${id} malformed`);
      continue;
    }
    if (!isNum(b.length) || b.length <= 0 || !isNum(b.radius) || b.radius <= 0 || !isNum(b.attachT)) {
      errs.push(`branch ${id} bad dimensions`);
    }
    if (!validShape(b.shape) || !validShape(b.rest)) errs.push(`branch ${id} bad shape`);
    if (!isNum(b.foliage) || !isNum(b.vigor) || !isNum(b.bornDay)) errs.push(`branch ${id} bad growth fields`);
    if (b.wire !== null && !(isObj(b.wire) && isNum(b.wire.set) && isNum(b.wire.appliedDay) && isNum(b.wire.bite))) {
      errs.push(`branch ${id} bad wire`);
    }
    if (b.parentId === null) roots++;
    else if (typeof b.parentId !== 'string' || !branches[b.parentId]) errs.push(`branch ${id} orphaned`);
  }
  if (roots !== 1) errs.push('tree must have exactly one root');
  // Cycle check: every branch must reach the root.
  if (errs.length === 0) {
    const tree = x as unknown as TreeState;
    for (const id of ids) {
      let cur: Branch | undefined = tree.branches[id];
      let steps = 0;
      while (cur && cur.parentId !== null && steps <= ids.length) {
        cur = tree.branches[cur.parentId];
        steps++;
      }
      if (steps > ids.length) {
        errs.push('cycle in branch graph');
        break;
      }
    }
  }
  for (const [k, w] of Object.entries(x.wounds as Record<string, unknown>)) {
    if (!isObj(w) || !isNum(w.heal) || !isNum(w.t) || !isNum(w.size) || typeof w.branchId !== 'string') {
      errs.push(`wound ${k} malformed`);
    }
  }
  for (const [k, u] of Object.entries(x.buds as Record<string, unknown>)) {
    if (!isObj(u) || !isNum(u.t) || !isNum(u.roll) || typeof u.branchId !== 'string') errs.push(`bud ${k} malformed`);
  }
  return errs;
}

/** Remove dangling buds/wounds that reference missing branches. */
export function sanitizeTree(t: TreeState): TreeState {
  const buds = Object.fromEntries(Object.entries(t.buds).filter(([, b]) => t.branches[b.branchId]));
  const wounds = Object.fromEntries(Object.entries(t.wounds).filter(([, w]) => t.branches[w.branchId]));
  return { ...t, buds, wounds };
}
