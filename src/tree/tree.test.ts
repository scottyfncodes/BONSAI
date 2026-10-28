import { describe, expect, it } from 'vitest';
import { generateSapling } from './generate';
import { advance, MAX_ADVANCE_DAYS } from './growth';
import { canRedo, canUndo, createHistory, push, redo, undo, HISTORY_LIMIT } from './history';
import { bezierPoint, childrenIndex, computeLayout, subtreeIds } from './layout';
import {
  aimTip,
  applyWire,
  clampShape,
  curveTo,
  holdFraction,
  maxBendAngle,
  previewPrune,
  prune,
  releaseShape,
  removeWire,
  totalFoliage,
} from './ops';
import { MAX_BRANCHES, MIN_HEALTH, type TreeState } from './types';
import { validateTree } from './validate';
import { dist, dot, norm, sub } from './vec';

const sapling = (seed = 42) => generateSapling('juniper', seed);

/** A primary branch (child of a trunk segment) that has children of its own. */
function primaryWithKids(t: TreeState): string {
  const kids = childrenIndex(t);
  const id = Object.values(t.branches).find(
    (b) => b.kind === 'branch' && t.branches[b.parentId ?? '']?.kind === 'trunk' && (kids.get(b.id)?.length ?? 0) >= 2,
  )?.id;
  if (!id) throw new Error('fixture has no primary with children');
  return id;
}

describe('generation', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(JSON.stringify(sapling(7))).toEqual(JSON.stringify(sapling(7)));
    expect(JSON.stringify(sapling(7))).not.toEqual(JSON.stringify(sapling(8)));
  });

  it('produces a valid connected structure for every species and preset', () => {
    for (const sp of ['juniper', 'maple', 'pine'] as const) {
      for (const preset of ['nursery', 'windswept', 'overgrown', 'collected', 'literati'] as const) {
        const t = generateSapling(sp, 3, preset);
        expect(validateTree(t)).toEqual([]);
        expect(Object.keys(t.branches).length).toBeGreaterThan(12);
        expect(Object.keys(t.branches).length).toBeLessThan(MAX_BRANCHES);
      }
    }
  });

  it('keeps children thinner than their parents and attached on the parent curve', () => {
    const t = sapling();
    const layout = computeLayout(t);
    for (const b of Object.values(t.branches)) {
      if (!b.parentId) {
        expect(layout.get(b.id)!.start).toEqual([0, 0, 0]);
        continue;
      }
      const p = t.branches[b.parentId]!;
      expect(b.radius).toBeLessThanOrEqual(p.radius + 1e-9);
      const onParent = bezierPoint(layout.get(p.id)!, b.attachT);
      expect(dist(onParent, layout.get(b.id)!.start)).toBeLessThan(1e-9);
    }
  });

  it('round-trips through JSON to an identical layout', () => {
    const t = sapling();
    const copy = JSON.parse(JSON.stringify(t)) as TreeState;
    const a = computeLayout(t);
    const b = computeLayout(copy);
    for (const [id, l] of a) expect(dist(l.end, b.get(id)!.end)).toBeLessThan(1e-12);
  });
});

describe('pruning', () => {
  it('removes the branch and its whole subtree and leaves a wound on the parent', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const parent = t.branches[id]!.parentId!;
    const sub = subtreeIds(t, id);
    expect(sub.length).toBeGreaterThan(2);
    const r = prune(t, id, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const s of sub) expect(r.tree.branches[s]).toBeUndefined();
    expect(Object.keys(r.tree.branches).length).toBe(Object.keys(t.branches).length - sub.length);
    expect(Object.values(r.tree.wounds).some((w) => w.branchId === parent)).toBe(true);
    expect(Object.values(r.tree.buds).every((b) => r.tree.branches[b.branchId])).toBe(true);
    expect(r.tree.stats.cuts).toBe(1);
    expect(totalFoliage(r.tree)).toBeLessThan(totalFoliage(t));
    expect(validateTree(r.tree)).toEqual([]);
  });

  it('keeps untouched branches identical (stable ids, shared objects)', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const removed = new Set(subtreeIds(t, id));
    const r = prune(t, id, 0);
    if (!r.ok) throw new Error(r.reason);
    for (const [bid, b] of Object.entries(t.branches)) {
      if (!removed.has(bid)) expect(r.tree.branches[bid]).toBe(b);
    }
    // Original state is not mutated.
    expect(t.branches[id]).toBeDefined();
  });

  it('refuses to remove the trunk base', () => {
    const t = sapling();
    const r = prune(t, t.rootId, 0);
    expect(r.ok).toBe(false);
  });

  it('preview matches the actual cut', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const p = previewPrune(t, id, 0);
    const r = prune(t, id, 0);
    if (!r.ok) throw new Error(r.reason);
    expect(new Set(p.removed)).toEqual(new Set(Object.keys(t.branches).filter((k) => !r.tree.branches[k])));
    expect(p.foliageFraction).toBeGreaterThan(0);
    expect(p.foliageFraction).toBeLessThan(1);
  });

  it('shortening keeps the inner part exactly in place', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const before = computeLayout(t);
    const r = prune(t, id, 0.6);
    if (!r.ok) throw new Error(r.reason);
    const after = computeLayout(r.tree);
    const b = r.tree.branches[id]!;
    expect(b.length).toBeLessThan(t.branches[id]!.length);
    // New tip sits where the old curve was at t = 0.6.
    expect(dist(after.get(id)!.end, bezierPoint(before.get(id)!, 0.6))).toBeLessThan(1e-6);
    // Surviving children keep their attach position and direction.
    for (const c of Object.values(t.branches).filter((c) => c.parentId === id)) {
      if (c.attachT > 0.6) {
        expect(r.tree.branches[c.id]).toBeUndefined();
        continue;
      }
      // The shape model approximates the sub-curve; allow sub-millimetre drift.
      expect(dist(before.get(c.id)!.start, after.get(c.id)!.start)).toBeLessThan(5e-3);
      expect(dot(before.get(c.id)!.frame.t, after.get(c.id)!.frame.t)).toBeGreaterThan(0.9999);
      expect(dist(before.get(c.id)!.end, after.get(c.id)!.end)).toBeLessThan(5e-3);
    }
    expect(validateTree(r.tree)).toEqual([]);
  });

  it('cuts near the base snap to a full removal', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const r = prune(t, id, 0.05);
    if (!r.ok) throw new Error(r.reason);
    expect(r.tree.branches[id]).toBeUndefined();
  });
});

describe('shaping', () => {
  it('aiming the tip changes real geometry and carries the subtree along', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const layout = computeLayout(t);
    const l = layout.get(id)!;
    const child = Object.values(t.branches).find((c) => c.parentId === id)!;
    const target = [l.end[0], l.end[1] + 0.4, l.end[2]] as const;
    const r = aimTip(t, layout, id, target);
    if (!r.ok) throw new Error(r.reason);
    const after = computeLayout(r.tree);
    const want = norm(sub(target, l.start));
    expect(dot(after.get(id)!.frame.t, want)).toBeGreaterThan(0.99);
    expect(after.get(id)!.end[1]).toBeGreaterThan(l.end[1]);
    expect(dist(after.get(child.id)!.start, layout.get(child.id)!.start)).toBeGreaterThan(1e-3);
    // Length is preserved.
    expect(dist(after.get(id)!.start, after.get(id)!.end)).toBeCloseTo(t.branches[id]!.length, 6);
  });

  it('clamps bends to what the wood allows', () => {
    const t = sapling();
    const trunk = t.branches[t.rootId]!;
    const { shape, limited } = clampShape(t, trunk, { ...trunk.shape, divergence: 3 });
    expect(limited).toBe(true);
    expect(shape.divergence).toBeLessThanOrEqual(1.15);
    const twig = Object.values(t.branches).find((b) => b.radius < 0.015)!;
    expect(maxBendAngle(t, twig)).toBeGreaterThan(maxBendAngle(t, trunk));
  });

  it('curving moves the branch midpoint', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const layout = computeLayout(t);
    const l = layout.get(id)!;
    const mid = bezierPoint(l, 0.5);
    const r = curveTo(t, layout, id, [mid[0], mid[1] + 0.15, mid[2]]);
    if (!r.ok) throw new Error(r.reason);
    const after = computeLayout(r.tree).get(id)!;
    expect(bezierPoint(after, 0.5)[1]).toBeGreaterThan(mid[1] + 0.01);
  });

  it('bare wood springs part-way back on release; wired wood holds', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const layout = computeLayout(t);
    const l = layout.get(id)!;
    const target = [l.end[0], l.end[1] + 0.5, l.end[2]] as const;
    const bent = aimTip(t, layout, id, target);
    if (!bent.ok) throw new Error(bent.reason);
    const released = releaseShape(t, bent.tree, id);
    const h = holdFraction(t, t.branches[id]!);
    expect(h).toBeLessThan(1);
    const yBare = computeLayout(released).get(id)!.end[1];
    const yBent = computeLayout(bent.tree).get(id)!.end[1];
    expect(yBare).toBeLessThan(yBent);
    expect(yBare).toBeGreaterThan(l.end[1]);
    expect(released.stats.bends).toBe(1);

    const wired = applyWire(t, id);
    if (!wired.ok) throw new Error(wired.reason);
    const wl = computeLayout(wired.tree);
    const bent2 = aimTip(wired.tree, wl, id, target);
    if (!bent2.ok) throw new Error(bent2.reason);
    const held = releaseShape(wired.tree, bent2.tree, id);
    expect(computeLayout(held).get(id)!.end[1]).toBeCloseTo(computeLayout(bent2.tree).get(id)!.end[1], 9);

    // Remove the wire before it has set: it springs back to rest.
    const unwired = removeWire(held, id);
    if (!unwired.ok) throw new Error(unwired.reason);
    expect(computeLayout(unwired.tree).get(id)!.end[1]).toBeCloseTo(l.end[1], 6);
  });

  it('wire sets with time so the shape survives removal', () => {
    const t = sapling();
    const id = primaryWithKids(t);
    const w = applyWire(t, id);
    if (!w.ok) throw new Error(w.reason);
    const layout = computeLayout(w.tree);
    const l = layout.get(id)!;
    const bent = aimTip(w.tree, layout, id, [l.end[0], l.end[1] + 0.4, l.end[2]]);
    if (!bent.ok) throw new Error(bent.reason);
    const held = releaseShape(w.tree, bent.tree, id);
    const { tree: grown } = advance(held, 360);
    expect(grown.branches[id]!.wire!.set).toBe(1);
    const off = removeWire(grown, id);
    if (!off.ok) throw new Error(off.reason);
    const yAfter = computeLayout(off.tree).get(id)!.end[1];
    const yWired = computeLayout(grown).get(id)!.end[1];
    expect(yAfter).toBeCloseTo(yWired, 6);
  });
});

describe('undo / redo', () => {
  it('restores exact states across a sequence of edits', () => {
    const t0 = sapling();
    let h = createHistory(t0);
    const id = primaryWithKids(t0);
    const r1 = prune(t0, id, 0.5);
    if (!r1.ok) throw new Error(r1.reason);
    h = push(h, r1.tree);
    const other = Object.keys(r1.tree.branches).find((k) => r1.tree.branches[k]!.parentId && k !== id)!;
    const r2 = prune(r1.tree, other, 0);
    if (!r2.ok) throw new Error(r2.reason);
    h = push(h, r2.tree);
    expect(h.present).toBe(r2.tree);
    h = undo(h);
    expect(h.present).toBe(r1.tree);
    h = undo(h);
    expect(h.present).toBe(t0);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe(r2.tree);
    expect(canRedo(h)).toBe(false);
    // A new edit after undo clears the redo stack.
    h = undo(h);
    h = push(h, t0);
    expect(canRedo(h)).toBe(false);
  });

  it('caps history length', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = push(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe('growth', () => {
  it('is deterministic', () => {
    const t = sapling();
    expect(JSON.stringify(advance(t, 120).tree)).toEqual(JSON.stringify(advance(t, 120).tree));
  });

  it('grows new shoots in spring and thickens wood over a year', () => {
    const t = sapling();
    const { tree, report } = advance(t, 360);
    expect(report.newShoots.length).toBeGreaterThan(0);
    expect(tree.branches[tree.rootId]!.radius).toBeGreaterThan(t.branches[t.rootId]!.radius);
    expect(tree.day).toBe(t.day + 360);
    expect(validateTree(tree)).toEqual([]);
  });

  it('heals wounds over time', () => {
    const t = sapling();
    const r = prune(t, primaryWithKids(t), 0);
    if (!r.ok) throw new Error(r.reason);
    const { tree } = advance(r.tree, 720);
    for (const w of Object.values(tree.wounds)) expect(w.heal).toBeGreaterThan(0.5);
  });

  it('never kills the tree, even after brutal pruning', () => {
    let t = sapling();
    for (const id of Object.keys(t.branches)) {
      const b = t.branches[id];
      if (b && b.kind === 'branch' && t.branches[b.parentId ?? '']?.kind === 'trunk') {
        const r = prune(t, id, 0);
        if (r.ok) t = r.tree;
      }
    }
    const { tree } = advance(t, 200);
    expect(tree.health).toBeGreaterThanOrEqual(MIN_HEALTH);
    expect(tree.health).toBeLessThan(1);
    expect(advance(tree, 720).tree.health).toBeGreaterThan(tree.health);
  });

  it('stays bounded over many years', () => {
    let t = generateSapling('maple', 5, 'overgrown');
    for (let y = 0; y < 8; y++) t = advance(t, 360).tree;
    expect(Object.keys(t.branches).length).toBeLessThanOrEqual(MAX_BRANCHES);
    expect(validateTree(t)).toEqual([]);
  });

  it('clamps a single advance', () => {
    const t = sapling();
    expect(advance(t, 99999).report.days).toBe(MAX_ADVANCE_DAYS);
    expect(advance(t, -5).tree.day).toBe(t.day);
  });
});

describe('validation', () => {
  it('rejects corrupt trees', () => {
    const t = sapling();
    const ids = Object.keys(t.branches);
    const orphan = JSON.parse(JSON.stringify(t)) as TreeState;
    orphan.branches[ids[3]!]!.parentId = 'nope';
    expect(validateTree(orphan).length).toBeGreaterThan(0);
    const nan = JSON.parse(JSON.stringify(t)) as TreeState;
    (nan.branches[ids[2]!]!.shape as { roll: number }).roll = Number.NaN;
    expect(validateTree(nan).length).toBeGreaterThan(0);
    const cyc = JSON.parse(JSON.stringify(t)) as TreeState;
    cyc.branches[ids[1]!]!.parentId = ids[2]!;
    cyc.branches[ids[2]!]!.parentId = ids[1]!;
    expect(validateTree(cyc).length).toBeGreaterThan(0);
    expect(validateTree(null)).not.toEqual([]);
    expect(validateTree({})).not.toEqual([]);
  });
});
