import { type TreeLayout, bezierPoint } from './layout';
import { rngFor } from './rng';
import type { SpeciesDef } from './species';
import type { BranchId, TreeState } from './types';
import { type V3, clamp } from './vec';

export interface FoliageCluster {
  branchId: BranchId;
  pos: V3;
  size: number;
}

/**
 * Where foliage sits on the tree. Seeded per branch so cutting one branch
 * never reshuffles the foliage on another.
 */
export function foliageClusters(tree: TreeState, layout: TreeLayout, sp: SpeciesDef): FoliageCluster[] {
  const out: FoliageCluster[] = [];
  const perLen = sp.foliage.kind === 'scale' ? 9 : sp.foliage.kind === 'palmate' ? 7 : 6;
  for (const b of Object.values(tree.branches)) {
    if (b.foliage < 0.03) continue;
    const l = layout.get(b.id);
    if (!l) continue;
    const rng = rngFor(tree.seed, b.id, 'foliage');
    const n = Math.max(1, Math.round(b.length * perLen * Math.sqrt(b.foliage)));
    const tStart = l.depth <= 1 ? 0.55 : 0.3;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 1 : tStart + ((1 - tStart) * (i + rng() * 0.6)) / (n - 0.4);
      const p = bezierPoint(l, clamp(t, 0, 1));
      const s = sp.foliage.padSize * (0.085 + rng() * 0.05) * (0.55 + 0.45 * b.foliage);
      out.push({
        branchId: b.id,
        pos: [p[0] + (rng() - 0.5) * s * 0.6, p[1] + s * 0.35, p[2] + (rng() - 0.5) * s * 0.6],
        size: s,
      });
    }
  }
  return out;
}

