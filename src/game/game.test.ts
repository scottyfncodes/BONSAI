import { describe, expect, it } from 'vitest';
import { computeLayout } from '../tree/layout';
import { aimTip, prune, releaseShape } from '../tree/ops';
import { CHALLENGES, evaluateChallenge, rewardsFor, starsFor, variantDef } from './challenges';
import { createRecord, detectStyle } from './model';
import { analyze } from './scoring';
import { generateSapling } from '../tree/generate';

describe('scoring', () => {
  it('is deterministic and bounded', () => {
    const r = createRecord({ species: 'juniper', seed: 11 });
    const a = analyze(r.work, 0.3);
    const b = analyze(r.work, 0.3);
    expect(a).toEqual(b);
    for (const m of Object.values(a.metrics)) {
      expect(m.score).toBeGreaterThanOrEqual(0);
      expect(m.score).toBeLessThanOrEqual(100);
      expect(m.note.length).toBeGreaterThan(5);
    }
  });

  it('rewards sweeping branches one way for the windswept challenge', () => {
    const def = CHALLENGES.find((c) => c.id === 'windswept')!;
    const v = def.variants[0]!;
    const r = createRecord({ species: v.species, preset: v.preset, seed: v.seed });
    const yaw = 0;
    const before = evaluateChallenge(r, def, v, yaw);
    // Swing every primary branch toward screen-right (+x at yaw 0).
    let tree = r.work.tree;
    for (const b of Object.values(tree.branches)) {
      if (b.kind !== 'branch' || tree.branches[b.parentId ?? '']?.kind !== 'trunk') continue;
      const layout = computeLayout(tree);
      const l = layout.get(b.id)!;
      const target = [l.start[0] + b.length, l.start[1] - 0.1 * b.length, l.start[2]] as const;
      const res = aimTip(tree, layout, b.id, target);
      if (res.ok) tree = releaseShape(tree, res.tree, b.id);
    }
    const after = evaluateChallenge({ ...r, work: { ...r.work, tree } }, def, v, yaw);
    expect(after.analysis.metrics.direction.score).toBeGreaterThan(before.analysis.metrics.direction.score + 10);
  });

  it('penalises crossings and rewards removing clutter in structure', () => {
    const r = createRecord({ species: 'maple', preset: 'overgrown', seed: 3301 });
    const a = analyze(r.work, 0);
    expect(a.facts.primaries).toBeGreaterThan(8);
    // Thin to the five lowest-placed primaries spread around.
    let tree = r.work.tree;
    const layout = computeLayout(tree);
    const prims = Object.values(tree.branches)
      .filter((b) => b.kind === 'branch' && tree.branches[b.parentId ?? '']?.kind === 'trunk')
      .sort((x, y) => layout.get(x.id)!.start[1] - layout.get(y.id)!.start[1]);
    const keep = new Set(prims.filter((_, i) => i % 3 === 0).map((b) => b.id));
    for (const b of prims) {
      if (keep.has(b.id)) continue;
      const res = prune(tree, b.id, 0);
      if (res.ok) tree = res.tree;
    }
    const after = analyze({ ...r.work, tree }, 0);
    expect(after.facts.primaries).toBeLessThan(a.facts.primaries);
    expect(after.metrics.structure.score).toBeGreaterThanOrEqual(a.metrics.structure.score);
  });

  it('detects styles from geometry', () => {
    expect(['informal-upright', 'formal-upright', 'slanting']).toContain(detectStyle(generateSapling('juniper', 1)));
  });
});

describe('challenges', () => {
  it('every variant starts from a valid tree and can be evaluated', () => {
    for (const def of CHALLENGES) {
      for (const v of def.variants) {
        const r = createRecord({ species: v.species, preset: v.preset, seed: v.seed });
        const res = evaluateChallenge(r, def, v, 0);
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
        expect(res.metrics.length).toBeGreaterThan(3);
        expect(variantDef(def.id, v.id)).toBe(v);
      }
    }
  });

  it('enforces the move budget in Less Is More', () => {
    const def = CHALLENGES.find((c) => c.id === 'less')!;
    const v = def.variants[0]!;
    const r = createRecord({ species: v.species, preset: v.preset, seed: v.seed });
    const over = { ...r, work: { ...r.work, tree: { ...r.work.tree, stats: { ...r.work.tree.stats, cuts: v.budget! + 1 } } } };
    const res = evaluateChallenge(over, def, v, 0);
    expect(res.passed).toBe(false);
    expect(res.stars).toBe(0);
    expect(res.requirements.find((q) => q.label.includes('moves'))!.met).toBe(false);
  });

  it('maps scores to stars', () => {
    expect(starsFor(10)).toBe(0);
    expect(starsFor(59)).toBe(0);
    expect(starsFor(60)).toBe(1);
    expect(starsFor(74)).toBe(2);
    expect(starsFor(99)).toBe(3);
  });

  it('never grants the same reward twice', () => {
    const def = CHALLENGES[0]!;
    const first = rewardsFor(def, 2, new Set());
    expect(first.map((r) => r.key)).toEqual(['windswept:1', 'windswept:2']);
    const claimed = new Set(first.map((r) => r.key));
    expect(rewardsFor(def, 2, claimed)).toEqual([]);
    expect(rewardsFor(def, 3, claimed).map((r) => r.key)).toEqual(['windswept:3']);
  });
});
