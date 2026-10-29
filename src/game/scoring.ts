import { foliageClusters } from '../tree/foliage';
import { type TreeLayout, bezierPoint, childrenIndex, computeLayout, frameAt } from '../tree/layout';
import { SPECIES } from '../tree/species';
import type { BranchId, TreeState } from '../tree/types';
import { type V3, clamp, dot } from '../tree/vec';
import { type TreeStyle, type Workpiece, detectStyle, trunkChain } from './model';
import { potColor, potDims } from './pots';

export type MetricId =
  | 'silhouette'
  | 'space'
  | 'balance'
  | 'trunk'
  | 'structure'
  | 'direction'
  | 'pot'
  | 'finish'
  | 'restraint';

export interface Metric {
  id: MetricId;
  label: string;
  /** 0..100 */
  score: number;
  /** Plain-language explanation of the score. */
  note: string;
}

export const METRIC_LABELS: Record<MetricId, string> = {
  silhouette: 'Silhouette',
  space: 'Negative space',
  balance: 'Balance',
  trunk: 'Trunk character',
  structure: 'Clean structure',
  direction: 'Sense of wind',
  pot: 'Pot harmony',
  finish: 'Health & finish',
  restraint: 'Restraint',
};

export const METRIC_HINTS: Record<MetricId, string> = {
  silhouette: 'A tapering, slightly uneven triangle with a clear apex.',
  space: 'Gaps between foliage pads let the tree breathe.',
  balance: 'Visual weight sits comfortably over the base.',
  trunk: 'Thick at the base, tapering, with some movement.',
  structure: 'No crossing, bar or eye-poking branches.',
  direction: 'Branches and foliage stream the same way.',
  pot: 'Pot size, depth, glaze and shape suit the tree.',
  finish: 'A healthy tree, no wire scars or ugly stubs.',
  restraint: 'Achieved with as few moves as possible.',
};

export interface Analysis {
  metrics: Record<Exclude<MetricId, 'restraint'>, Metric>;
  facts: {
    primaries: number;
    foliagePads: number;
    crossings: number;
    barPairs: number;
    eyePokers: number;
    height: number;
    width: number;
    style: TreeStyle;
    downwind: 1 | -1;
  };
}

const s01 = (x: number) => clamp(x, 0, 1);
/** 1 inside [lo, hi], falling linearly to 0 at lo - fall / hi + fall. */
const band = (x: number, lo: number, hi: number, fall: number) =>
  x < lo ? s01(1 - (lo - x) / fall) : x > hi ? s01(1 - (x - hi) / fall) : 1;

/** Screen-right and toward-camera vectors for a camera yaw. */
export function viewAxes(yaw: number): { right: V3; toward: V3 } {
  return { right: [Math.cos(yaw), 0, -Math.sin(yaw)], toward: [Math.sin(yaw), 0, Math.cos(yaw)] };
}

function primaryIds(tree: TreeState): BranchId[] {
  return Object.values(tree.branches)
    .filter((b) => b.kind === 'branch' && b.parentId && tree.branches[b.parentId]?.kind === 'trunk')
    .map((b) => b.id);
}

function segIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Evaluate a composition as seen from the given camera yaw (the "front").
 * Pure and deterministic: the same work and yaw always score the same.
 */
export function analyze(work: Workpiece, yaw: number, layout: TreeLayout = computeLayout(work.tree)): Analysis {
  const tree = work.tree;
  const sp = SPECIES[tree.species];
  const { right, toward } = viewAxes(yaw);
  const px = (p: V3) => dot(p, right);
  const clusters = foliageClusters(tree, layout, sp);
  const pts = clusters.map((c) => ({ x: px(c.pos), y: c.pos[1], r: c.size * 1.25, w: c.size * c.size, id: c.branchId }));
  const kids = childrenIndex(tree);
  const chain = trunkChain(tree);
  const apex = layout.get(chain[chain.length - 1]!)!;
  const apexX = px(apex.end);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let mass = 0;
  let cx = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r);
    maxY = Math.max(maxY, p.y + p.r);
    mass += p.w;
    cx += p.x * p.w;
  }
  cx = mass > 0 ? cx / mass : 0;
  const width = pts.length ? maxX - minX : 0;
  let treeTop = 0;
  for (const l of layout.values()) treeTop = Math.max(treeTop, l.end[1]);
  const height = Math.max(treeTop, maxY, 0.01);

  // ------------------------------------------------ silhouette
  let silhouette: Metric;
  if (pts.length < 3) {
    silhouette = { id: 'silhouette', label: METRIC_LABELS.silhouette, score: 0, note: 'Too little foliage to read a silhouette.' };
  } else {
    const bands = 6;
    const widths: number[] = Array(bands).fill(0);
    const lo = Array(bands).fill(Infinity);
    const hi = Array(bands).fill(-Infinity);
    for (const p of pts) {
      const k = clamp(Math.floor(((p.y - minY) / Math.max(maxY - minY, 1e-3)) * bands), 0, bands - 1);
      lo[k] = Math.min(lo[k], p.x - p.r);
      hi[k] = Math.max(hi[k], p.x + p.r);
    }
    for (let k = 0; k < bands; k++) widths[k] = hi[k] > lo[k] ? hi[k] - lo[k] : 0;
    const maxW = Math.max(...widths);
    let ok = 0;
    let checks = 0;
    for (let k = 1; k < bands; k++) {
      if (widths[k - 1]! <= 0 || widths[k]! <= 0) continue;
      checks++;
      if (widths[k]! <= widths[k - 1]! * 1.15) ok++;
    }
    const taper = checks ? ok / checks : 0.5;
    const topW = widths[bands - 1]! || widths[bands - 2]! || 0;
    const apexS = band(topW / Math.max(maxW, 1e-3), 0, 0.35, 0.45);
    const left = Math.max(0.01, -minX);
    const rightExt = Math.max(0.01, maxX);
    const ratio = Math.max(left, rightExt) / Math.min(left, rightExt);
    const asym = ratio < 1.1 ? 0.75 : band(ratio, 1.1, 2, 1.2);
    const score = 100 * (0.42 * taper + 0.36 * apexS + 0.22 * asym);
    const note =
      apexS < 0.5
        ? 'The top is as wide as the body – thin the apex to give it a point.'
        : taper < 0.6
          ? 'Upper tiers are wider than lower ones – the outline is top-heavy.'
          : asym < 0.6
            ? 'One side reaches much further than the other.'
            : 'A clear, tapering outline with a defined apex.';
    silhouette = { id: 'silhouette', label: METRIC_LABELS.silhouette, score, note };
  }

  // ------------------------------------------------ negative space
  let space: Metric;
  if (pts.length < 3) {
    space = { id: 'space', label: METRIC_LABELS.space, score: 0, note: 'Not enough foliage to judge.' };
  } else {
    const N = 14;
    const grid: boolean[] = Array(N * N).fill(false);
    const gw = (maxX - minX) / N;
    const gh = (maxY - minY) / N;
    for (const p of pts) {
      // Only visit the cells under this pad's bounding box.
      const i0 = Math.max(0, Math.floor((p.x - p.r - minX) / gw));
      const i1 = Math.min(N - 1, Math.ceil((p.x + p.r - minX) / gw));
      const j0 = Math.max(0, Math.floor((p.y - p.r - minY) / gh));
      const j1 = Math.min(N - 1, Math.ceil((p.y + p.r - minY) / gh));
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const x = minX + (i + 0.5) * gw;
          const y = minY + (j + 0.5) * gh;
          if ((x - p.x) ** 2 + (y - p.y) ** 2 < p.r * p.r) grid[j * N + i] = true;
        }
      }
    }
    const filled = grid.filter(Boolean).length / (N * N);
    const covS = band(filled, 0.36, 0.62, 0.3);
    let gaps = 0;
    let prevFilled = false;
    for (let j = 0; j < N; j++) {
      let rowFill = 0;
      for (let i = 0; i < N; i++) if (grid[j * N + i]) rowFill++;
      const rowOn = rowFill / N > 0.1;
      if (prevFilled && !rowOn) gaps++;
      prevFilled = rowOn;
    }
    // Pads visible from the side also count: horizontal channels between tiers.
    const layerS = s01(gaps / 2);
    // Connected components (4-neighbour) = distinct pads in the silhouette.
    const seen = new Uint8Array(N * N);
    let comps = 0;
    for (let k = 0; k < N * N; k++) {
      if (!grid[k] || seen[k]) continue;
      comps++;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        const ci = c % N;
        const cj = Math.floor(c / N);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nk = nj * N + ni;
          if (grid[nk] && !seen[nk]) {
            seen[nk] = 1;
            stack.push(nk);
          }
        }
      }
    }
    const compS = band(comps, 3, 9, 4);
    const score = 100 * (0.45 * covS + 0.3 * layerS + 0.25 * compS);
    const note =
      filled > 0.66
        ? 'The canopy is a solid mass – open windows between the pads.'
        : filled < 0.3
          ? 'So sparse it reads as gaps, not pads – let foliage fill in.'
          : gaps < 1
            ? 'No clear tiers yet – separate the pads vertically.'
            : 'Pads are separated by breathing space.';
    space = { id: 'space', label: METRIC_LABELS.space, score, note };
  }

  // ------------------------------------------------ balance
  const off = width > 0 ? Math.abs(cx) / width : 1;
  const offS = off <= 0.15 ? 1 : off <= 0.35 ? 1 - ((off - 0.15) / 0.2) * 0.7 : s01(0.3 - (off - 0.35));
  const apexLean = Math.abs(apexX) / height;
  const apexS = band(apexLean, 0, 0.18, 0.35);
  const balance: Metric = {
    id: 'balance',
    label: METRIC_LABELS.balance,
    score: pts.length ? 100 * (0.6 * offS + 0.4 * apexS) : 0,
    note:
      offS < 0.6
        ? `Foliage weight sits far to the ${cx > 0 ? 'right' : 'left'} of the base.`
        : apexS < 0.6
          ? 'The apex drifts away from the base – bring it back over the roots.'
          : 'The weight of the tree sits comfortably over its base.',
  };

  // ------------------------------------------------ trunk
  const root = layout.get(chain[0]!)!;
  const taper = root.r0 / Math.max(apex.r1, 0.005);
  const taperS = s01((taper - 1.6) / 2.6);
  let movement = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = layout.get(chain[i - 1]!)!.frame.t;
    const b = layout.get(chain[i]!)!.frame.t;
    movement += Math.acos(clamp(dot(a, b), -1, 1));
  }
  const moveS = movement < 0.1 ? 0.35 : band(movement, 0.3, 1.5, 0.9);
  const thickS = s01((root.r0 * 2) / height / 0.14);
  const trunk: Metric = {
    id: 'trunk',
    label: METRIC_LABELS.trunk,
    score: 100 * (0.4 * taperS + 0.3 * moveS + 0.3 * thickS),
    note:
      taperS < 0.4
        ? 'The trunk barely tapers – it looks like a pole.'
        : moveS < 0.5
          ? movement < 0.3
            ? 'A very straight trunk – fine for formal styles, but it lacks movement.'
            : 'So much movement the trunk looks contorted.'
          : thickS < 0.5
            ? 'The trunk is thin for its height.'
            : 'Strong taper and natural movement.',
  };

  // ------------------------------------------------ structure
  const prim = primaryIds(tree);
  type Seg = { id: BranchId; a: [number, number]; b: [number, number]; anc: Set<BranchId> };
  const ancestors = (id: BranchId) => {
    const s = new Set<BranchId>();
    let cur = tree.branches[id]?.parentId ?? null;
    while (cur) {
      s.add(cur);
      cur = tree.branches[cur]?.parentId ?? null;
    }
    return s;
  };
  const segs: Seg[] = [];
  for (const b of Object.values(tree.branches)) {
    const l = layout.get(b.id);
    if (!l || b.kind === 'trunk' || l.depth > 2 || b.length < 0.12) continue;
    // Ignore the inner 15% so branches sharing a junction never "cross".
    const s = bezierPoint(l, 0.15);
    segs.push({ id: b.id, a: [px(s), s[1]], b: [px(l.end), l.end[1]], anc: ancestors(b.id) });
  }
  let crossings = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i]!;
      const B = segs[j]!;
      if (A.anc.has(B.id) || B.anc.has(A.id)) continue;
      if (segIntersect(A.a, A.b, B.a, B.b)) crossings++;
    }
  }
  const primHeights = prim.map((id) => layout.get(id)!.start[1]).sort((a, b) => a - b);
  let barPairs = 0;
  let whorls = 0;
  for (let i = 0; i < primHeights.length; i++) {
    let n = 1;
    for (let j = i + 1; j < primHeights.length && primHeights[j]! - primHeights[i]! < 0.07; j++) n++;
    if (n === 2) barPairs++;
    if (n >= 3) {
      whorls++;
      i += n - 1;
    }
  }
  let eyePokers = 0;
  for (const id of prim) {
    const l = layout.get(id)!;
    if (l.start[1] < height * 0.66 && dot(l.frame.t, toward) > 0.78) eyePokers++;
  }
  let sprouts = 0;
  for (const b of Object.values(tree.branches)) {
    const l = layout.get(b.id);
    if (!l || l.depth !== 2 || l.start[1] > height * 0.6) continue;
    if (l.frame.t[1] > 0.93) sprouts++;
  }
  const crowd = Math.max(0, prim.length - 12);
  const penalty = crossings * 0.07 + barPairs * 0.12 + whorls * 0.15 + eyePokers * 0.1 + sprouts * 0.04 + crowd * 0.03;
  const structure: Metric = {
    id: 'structure',
    label: METRIC_LABELS.structure,
    score: 100 * s01(1 - penalty),
    note:
      crossings > 0 && crossings * 0.07 >= barPairs * 0.12
        ? `${crossings} crossing branch${crossings > 1 ? 'es' : ''} seen from the front.`
        : barPairs > 0
          ? `${barPairs} pair${barPairs > 1 ? 's' : ''} of bar branches leave the trunk at the same height.`
          : whorls > 0
            ? 'Three or more branches leave from one spot (a whorl).'
            : eyePokers > 0
              ? 'A low branch points straight at the viewer.'
              : crowd > 0
                ? 'Too many primary branches – the structure is crowded.'
                : 'Clean, readable branching.',
  };

  // ------------------------------------------------ direction (wind)
  let sum = 0;
  let sumAbs = 0;
  let wsum = 0;
  for (const b of Object.values(tree.branches)) {
    const l = layout.get(b.id);
    if (!l || b.kind === 'trunk' || l.depth > 3) continue;
    const w = b.length * (l.depth === 1 ? 1.5 : 1);
    const dx = dot(l.frame.t, right);
    sum += dx * w;
    sumAbs += Math.abs(dx) * w;
    wsum += w;
  }
  const consistency = sumAbs > 0 ? Math.abs(sum) / sumAbs : 0;
  const strength = wsum > 0 ? s01((sumAbs / wsum - 0.35) / 0.45) : 0;
  const downwind: 1 | -1 = sum >= 0 ? 1 : -1;
  let downMass = 0;
  for (const p of pts) if (p.x * downwind > 0) downMass += p.w;
  const downS = mass > 0 ? s01((downMass / mass - 0.5) / 0.3) : 0;
  const leanAgree = apexX * downwind > 0 ? 1 : 0.3;
  const direction: Metric = {
    id: 'direction',
    label: METRIC_LABELS.direction,
    score: 100 * (0.42 * consistency + 0.18 * strength + 0.25 * downS + 0.15 * leanAgree),
    note:
      consistency < 0.5
        ? 'Branches point every which way – the wind has no direction.'
        : downS < 0.5
          ? `Foliage still sits on both sides – push more of it to the ${downwind > 0 ? 'right' : 'left'}.`
          : leanAgree < 1
            ? 'The trunk leans against the wind – let it follow the branches.'
            : 'You can feel the wind.',
  };

  // ------------------------------------------------ pot harmony
  const dims = potDims(work.pot);
  const style = detectStyle(tree, layout);
  const target = 0.66 * Math.max(height, width * 0.85);
  const ratioS = s01(1 - Math.abs(dims.width / Math.max(target, 0.3) - 1) / 0.6);
  const depthRatio = dims.height / Math.max(root.r0 * 2, 0.02);
  const depthS = band(depthRatio, 0.9, 2.4, 1.5);
  const color = potColor(work.pot.colorId);
  const conifer = tree.species !== 'maple';
  const colorS = conifer ? (color.material === 'unglazed' ? 1 : 0.55) : color.material === 'glazed' ? 1 : 0.8;
  const shape = work.pot.shape;
  let shapeS: number;
  if (style === 'cascade') shapeS = shape === 'cascade' ? 1 : 0.3;
  else if (style === 'windswept' || style === 'literati') shapeS = shape === 'crescent' || shape === 'round' ? 1 : shape === 'oval' ? 0.8 : 0.6;
  else if (conifer) shapeS = shape === 'rectangle' || shape === 'drum' ? 1 : shape === 'oval' ? 0.85 : shape === 'cascade' ? 0.3 : 0.7;
  else shapeS = shape === 'oval' ? 1 : shape === 'round' || shape === 'crescent' ? 0.9 : shape === 'cascade' ? 0.3 : 0.75;
  const pot: Metric = {
    id: 'pot',
    label: METRIC_LABELS.pot,
    score: 100 * (0.4 * ratioS + 0.2 * depthS + 0.2 * colorS + 0.2 * shapeS),
    note:
      ratioS < 0.6
        ? dims.width > target
          ? 'The pot is too large – the tree looks lost in it.'
          : 'The pot is too small for the tree.'
        : shapeS < 0.7
          ? 'This pot shape fights the style of the tree.'
          : colorS < 0.7
            ? 'Conifers usually look best in unglazed pots.'
            : depthS < 0.6
              ? depthRatio > 2.4
                ? 'The pot is deep for this trunk.'
                : 'The pot is shallow for this trunk.'
              : 'Pot and tree belong together.',
  };

  // ------------------------------------------------ finish
  let bite = 0;
  let frontWounds = 0;
  let stubs = 0;
  for (const b of Object.values(tree.branches)) {
    if (b.wire) bite += b.wire.bite;
    const hasKids = (kids.get(b.id) ?? []).length > 0;
    if (b.kind === 'branch' && !hasKids && b.foliage < 0.05) stubs++;
  }
  for (const w of Object.values(tree.wounds)) {
    if (w.heal > 0.35 || w.size < 0.025) continue;
    const l = layout.get(w.branchId);
    if (!l) continue;
    const f = frameAt(l, w.t);
    const n: V3 = [
      f.n[0] * Math.cos(w.roll) + f.b[0] * Math.sin(w.roll),
      f.n[1] * Math.cos(w.roll) + f.b[1] * Math.sin(w.roll),
      f.n[2] * Math.cos(w.roll) + f.b[2] * Math.sin(w.roll),
    ];
    if (dot(n, toward) > 0.3) frontWounds++;
  }
  const healthS = s01((tree.health - 0.4) / 0.55);
  const finishPenalty = bite * 0.25 + frontWounds * 0.07 + stubs * 0.04;
  const finish: Metric = {
    id: 'finish',
    label: METRIC_LABELS.finish,
    score: 100 * s01(healthS - finishPenalty),
    note:
      healthS < 0.6
        ? 'The tree is stressed – give it time to recover before showing it.'
        : bite > 0.2
          ? 'Wire has bitten into the bark – remove it sooner next time.'
          : stubs > 0
            ? `${stubs} bare stub${stubs > 1 ? 's' : ''} with no foliage.`
            : frontWounds > 0
              ? 'Fresh cuts face the viewer – let them heal or turn the tree.'
              : 'Healthy and cleanly finished.',
  };

  return {
    metrics: { silhouette, space, balance, trunk, structure, direction, pot, finish },
    facts: { primaries: prim.length, foliagePads: pts.length, crossings, barPairs, eyePokers, height, width, style, downwind },
  };
}
