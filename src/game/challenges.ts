import type { SaplingPreset } from '../tree/generate';
import { computeLayout } from '../tree/layout';
import type { SpeciesId } from '../tree/types';
import type { TreeRecord } from './model';
import { type Analysis, type Metric, type MetricId, METRIC_LABELS, analyze } from './scoring';

export type ChallengeId = 'windswept' | 'less' | 'exhibition';

export interface ChallengeVariant {
  id: string;
  name: string;
  species: SpeciesId;
  preset: SaplingPreset;
  /** Fixed seed: everyone gets the same starting tree for a variant. */
  seed: number;
  /** Start on this in-game day (seasons matter for maples). */
  startDay?: number;
  /** Max cuts + bends + wire applications. */
  budget?: number;
  /** Max primary branches remaining. */
  maxPrimaries?: number;
  /** Minimum "Sense of wind" score. */
  minDirection?: number;
  /** Max crossing branches visible from the front. */
  maxCrossings?: number;
  /** Unlock key needed to play; undefined = always available. */
  unlock?: string;
  /** Score multiplier for stricter variants (applied before stars). */
  strictness?: number;
}

export interface ChallengeDef {
  id: ChallengeId;
  title: string;
  tagline: string;
  brief: string;
  tips: string[];
  weights: Partial<Record<MetricId, number>>;
  variants: ChallengeVariant[];
  /** Unlocks granted the first time each star level is reached. */
  rewards: Record<1 | 2 | 3, string[]>;
}

export const STAR_THRESHOLDS: [number, number, number] = [60, 74, 87];

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'windswept',
    title: 'Windswept',
    tagline: 'Make the wind visible.',
    brief:
      'Shape this leaning sapling so it tells the story of a constant wind. Sweep the branches and foliage one way, keep the outline convincing.',
    tips: [
      'Remove branches growing into the wind.',
      'Bend the remaining branches downwind with Shape or Wire.',
      'A shallow crescent or round pot completes the scene.',
    ],
    weights: { direction: 40, silhouette: 15, structure: 15, space: 15, pot: 10, finish: 5 },
    variants: [
      { id: 'windswept-juniper', name: 'Coastal juniper', species: 'juniper', preset: 'windswept', seed: 1207, minDirection: 55 },
      {
        id: 'windswept-gale',
        name: 'Gale (pine)',
        species: 'pine',
        preset: 'windswept',
        seed: 4411,
        minDirection: 65,
        unlock: 'variant:windswept-gale',
        strictness: 0.93,
      },
    ],
    rewards: { 1: ['pot:crescent'], 2: ['sapling:literati', 'bg:moss'], 3: ['variant:windswept-gale'] },
  },
  {
    id: 'less',
    title: 'Less Is More',
    tagline: 'A masterpiece in a handful of moves.',
    brief:
      'This tree is badly overgrown. Find the tree hiding inside it – within a strict budget of moves, keeping only the strongest primary branches.',
    tips: [
      'Each cut, bend and wire costs one move. Undo refunds it.',
      'One cut low on a big branch removes a lot – choose carefully.',
      'Aim for a clear trunk line and well-spaced tiers.',
    ],
    weights: { structure: 25, space: 25, silhouette: 20, restraint: 20, balance: 10 },
    variants: [
      { id: 'less-maple', name: 'Overgrown maple', species: 'maple', preset: 'overgrown', seed: 3301, budget: 14, maxPrimaries: 8 },
      {
        id: 'less-haiku',
        name: 'Haiku (juniper, 9 moves)',
        species: 'juniper',
        preset: 'overgrown',
        seed: 5150,
        budget: 9,
        maxPrimaries: 7,
        unlock: 'variant:less-haiku',
      },
    ],
    rewards: { 1: ['tool:copper'], 2: ['stone:quartz', 'pot:nanban'], 3: ['variant:less-haiku'] },
  },
  {
    id: 'exhibition',
    title: 'Exhibition Specimen',
    tagline: 'Prepare a tree for the judges.',
    brief:
      'An old collected tree with real character. Refine it, choose its front, pot and dress it, then present it to the judges.',
    tips: [
      'Judges look from the angle you are facing when you submit.',
      'Time lets cuts heal and foliage fill in – use Grow.',
      'Pot proportion matters: about two-thirds of the tree’s height.',
    ],
    weights: { trunk: 10, structure: 22, silhouette: 14, space: 16, balance: 8, pot: 16, finish: 14 },
    variants: [
      { id: 'exhibition-pine', name: 'Collected pine', species: 'pine', preset: 'collected', seed: 7788, maxPrimaries: 9, maxCrossings: 1 },
      {
        id: 'exhibition-autumn',
        name: 'Autumn maple',
        species: 'maple',
        preset: 'collected',
        seed: 9001,
        startDay: 200,
        maxPrimaries: 9,
        maxCrossings: 1,
        unlock: 'variant:exhibition-autumn',
        strictness: 0.95,
      },
    ],
    rewards: { 1: ['pot:drum', 'pot:cobalt'], 2: ['sapling:collected'], 3: ['bg:ink', 'pot:vermilion', 'variant:exhibition-autumn'] },
  },
];

export const challengeDef = (id: string): ChallengeDef | undefined => CHALLENGES.find((c) => c.id === id);

export function variantDef(challengeId: string, variantId: string): ChallengeVariant | undefined {
  return challengeDef(challengeId)?.variants.find((v) => v.id === variantId);
}

export interface Requirement {
  label: string;
  met: boolean;
  detail: string;
}

export interface ChallengeResult {
  score: number;
  stars: 0 | 1 | 2 | 3;
  passed: boolean;
  metrics: (Metric & { weight: number })[];
  requirements: Requirement[];
  movesUsed: number;
  analysis: Analysis;
}

export const movesUsed = (r: TreeRecord): number => {
  const s = r.work.tree.stats;
  return s.cuts + s.bends + s.wiresApplied;
};

export function starsFor(score: number): 0 | 1 | 2 | 3 {
  if (score >= STAR_THRESHOLDS[2]) return 3;
  if (score >= STAR_THRESHOLDS[1]) return 2;
  if (score >= STAR_THRESHOLDS[0]) return 1;
  return 0;
}

/** Score a tree against a challenge, as seen from camera yaw `yaw`. */
export function evaluateChallenge(record: TreeRecord, def: ChallengeDef, variant: ChallengeVariant, yaw: number): ChallengeResult {
  const layout = computeLayout(record.work.tree);
  const analysis = analyze(record.work, yaw, layout);
  const used = movesUsed(record);
  const requirements: Requirement[] = [];
  let restraint: Metric | null = null;
  if (variant.budget !== undefined) {
    const within = used <= variant.budget;
    requirements.push({
      label: `Use at most ${variant.budget} moves`,
      met: within,
      detail: `${used} of ${variant.budget} used`,
    });
    const left = Math.max(0, variant.budget - used);
    restraint = {
      id: 'restraint',
      label: METRIC_LABELS.restraint,
      score: within ? 55 + 45 * (left / variant.budget) : 0,
      note: within ? `${left} move${left === 1 ? '' : 's'} to spare.` : 'Over budget.',
    };
  }
  if (variant.maxPrimaries !== undefined) {
    requirements.push({
      label: `Keep at most ${variant.maxPrimaries} primary branches`,
      met: analysis.facts.primaries <= variant.maxPrimaries,
      detail: `${analysis.facts.primaries} remaining`,
    });
  }
  if (variant.maxCrossings !== undefined) {
    const c = analysis.facts.crossings;
    requirements.push({
      label: variant.maxCrossings === 0 ? 'No crossing branches from the front' : `At most ${variant.maxCrossings} crossing branch from the front`,
      met: c <= variant.maxCrossings,
      detail: `${c} visible`,
    });
  }
  if (variant.minDirection !== undefined) {
    const d = Math.round(analysis.metrics.direction.score);
    requirements.push({ label: `Sense of wind at least ${variant.minDirection}`, met: d >= variant.minDirection, detail: `Currently ${d}` });
  }
  requirements.push({
    label: 'Tree is healthy enough to show',
    met: record.work.tree.health >= 0.45,
    detail: `Vigour ${Math.round(record.work.tree.health * 100)}%`,
  });

  const metrics: (Metric & { weight: number })[] = [];
  let total = 0;
  let wsum = 0;
  for (const [id, weight] of Object.entries(def.weights) as [MetricId, number][]) {
    const m = id === 'restraint' ? restraint : analysis.metrics[id];
    if (!m) continue;
    metrics.push({ ...m, weight });
    total += m.score * weight;
    wsum += weight;
  }
  const raw = wsum ? total / wsum : 0;
  const score = Math.round(raw * (variant.strictness ?? 1));
  const passed = requirements.every((r) => r.met);
  return {
    score,
    stars: passed ? starsFor(score) : 0,
    passed,
    metrics: metrics.sort((a, b) => b.weight - a.weight),
    requirements,
    movesUsed: used,
    analysis,
  };
}

/** Unlocks newly earned by reaching `stars`, given what was already claimed. */
export function rewardsFor(def: ChallengeDef, stars: number, claimed: Set<string>): { key: string; unlocks: string[] }[] {
  const out: { key: string; unlocks: string[] }[] = [];
  for (const level of [1, 2, 3] as const) {
    const key = `${def.id}:${level}`;
    if (stars >= level && !claimed.has(key)) out.push({ key, unlocks: def.rewards[level] });
  }
  return out;
}
