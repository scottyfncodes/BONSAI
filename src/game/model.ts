import { generateSapling, type SaplingPreset } from '../tree/generate';
import { type TreeLayout, bezierPoint, childrenIndex, computeLayout, layoutBounds } from '../tree/layout';
import { SPECIES, YEAR_DAYS, seasonOf } from '../tree/species';
import { type Care, DEFAULT_CARE, type SpeciesId, type TreeState } from '../tree/types';
import { DEFAULT_POT, DEFAULT_SURFACE, type PotStyle, type SurfaceStyle } from './pots';

export type TreeStyle =
  | 'formal-upright'
  | 'informal-upright'
  | 'slanting'
  | 'windswept'
  | 'cascade'
  | 'literati'
  | 'broom';

export const STYLE_LABELS: Record<TreeStyle, string> = {
  'formal-upright': 'Formal upright',
  'informal-upright': 'Informal upright',
  slanting: 'Slanting',
  windswept: 'Windswept',
  cascade: 'Cascade',
  literati: 'Literati',
  broom: 'Broom',
};

/** Everything the player edits on a tree – the unit of undo/redo. */
export interface Workpiece {
  tree: TreeState;
  pot: PotStyle;
  surface: SurfaceStyle;
}

export interface ChallengeAttempt {
  challengeId: string;
  variantId: string;
  score: number;
  stars: number;
  at: number;
}

/** A challenge in progress (or finished) on this tree. */
export interface ChallengeLink {
  challengeId: string;
  variantId: string;
  startedAt: number;
  submitted: ChallengeAttempt | null;
}

export interface TreeRecord {
  id: string;
  name: string;
  species: SpeciesId;
  preset: SaplingPreset;
  /** Player override; when null the style is detected from the shape. */
  styleOverride: TreeStyle | null;
  createdAt: number;
  updatedAt: number;
  /** Age of the material when the player got it. */
  baseAgeYears: number;
  work: Workpiece;
  care: Care;
  challenge: ChallengeLink | null;
  history: ChallengeAttempt[];
}

export const PRESET_AGE: Record<SaplingPreset, number> = {
  nursery: 5,
  windswept: 6,
  overgrown: 7,
  collected: 38,
  literati: 12,
};

const NAMES = ['Kumo', 'Hoshi', 'Yūgen', 'Kaze', 'Shizuka', 'Tsuki', 'Hikari', 'Mori', 'Sora', 'Aki', 'Fuyu', 'Haru'];

export function suggestName(seed: number, species: SpeciesId): string {
  const base = NAMES[seed % NAMES.length]!;
  return `${base} ${species === 'juniper' ? 'Juniper' : species === 'maple' ? 'Maple' : 'Pine'}`;
}

export function newId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `t${Date.now().toString(36)}${rand}`;
}

export function createRecord(opts: {
  species: SpeciesId;
  preset?: SaplingPreset;
  seed?: number;
  name?: string;
  pot?: PotStyle;
  challenge?: ChallengeLink | null;
  now?: number;
}): TreeRecord {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const preset = opts.preset ?? 'nursery';
  const now = opts.now ?? Date.now();
  return {
    id: newId(),
    name: opts.name ?? suggestName(seed, opts.species),
    species: opts.species,
    preset,
    styleOverride: null,
    createdAt: now,
    updatedAt: now,
    baseAgeYears: PRESET_AGE[preset],
    work: {
      tree: generateSapling(opts.species, seed, preset),
      pot: opts.pot ?? { ...DEFAULT_POT, colorId: opts.species === 'maple' ? 'cream' : 'clay', shape: opts.species === 'maple' ? 'oval' : 'rectangle' },
      surface: { ...DEFAULT_SURFACE, stones: [] },
    },
    care: { ...DEFAULT_CARE },
    challenge: opts.challenge ?? null,
    history: [],
  };
}

export function ageYears(r: TreeRecord): number {
  return r.baseAgeYears + Math.floor((r.work.tree.day - 20) / YEAR_DAYS);
}

/** "Spring · Year 2" – the in-game calendar for a tree. */
export function calendarLabel(tree: TreeState): string {
  const season = seasonOf(tree.day);
  const year = Math.floor(tree.day / YEAR_DAYS) + 1;
  return `${season[0]!.toUpperCase()}${season.slice(1)} · Year ${year}`;
}

/** Leader chain from the base to the apex. */
export function trunkChain(tree: TreeState): string[] {
  const kids = childrenIndex(tree);
  const chain = [tree.rootId];
  for (;;) {
    const cur = chain[chain.length - 1]!;
    const next = (kids.get(cur) ?? []).find((c) => tree.branches[c]!.kind === 'trunk');
    if (!next) break;
    chain.push(next);
  }
  return chain;
}

/** Infer the classical style from the tree's actual geometry. */
export function detectStyle(tree: TreeState, layout: TreeLayout = computeLayout(tree)): TreeStyle {
  const chain = trunkChain(tree);
  const base = layout.get(chain[0]!)!;
  const apex = layout.get(chain[chain.length - 1]!)!;
  const bounds = layoutBounds(layout);
  const height = bounds.max[1];
  const apexOffset = Math.hypot(apex.end[0], apex.end[2]);
  const lean = Math.acos(Math.min(1, base.frame.t[1]));
  // Lowest foliage point decides cascades.
  let minFoliageY = Infinity;
  let maxFoliageY = 0;
  let mass = 0;
  let massLow = 0;
  let dirX = 0;
  let dirZ = 0;
  let dirAbs = 0;
  for (const b of Object.values(tree.branches)) {
    const l = layout.get(b.id);
    if (!l) continue;
    if (b.foliage > 0.1) {
      const p = bezierPoint(l, 0.8);
      minFoliageY = Math.min(minFoliageY, p[1]);
      maxFoliageY = Math.max(maxFoliageY, p[1]);
      const m = b.foliage * b.length;
      mass += m;
      if (p[1] < height * 0.55) massLow += m;
    }
    if (b.kind === 'branch' && l.depth <= 2) {
      const w = b.length;
      dirX += l.frame.t[0] * w;
      dirZ += l.frame.t[2] * w;
      dirAbs += Math.hypot(l.frame.t[0], l.frame.t[2]) * w;
    }
  }
  const consistency = dirAbs > 0 ? Math.hypot(dirX, dirZ) / dirAbs : 0;
  if (minFoliageY < -0.1) return 'cascade';
  if (consistency > 0.55) return 'windswept';
  if (mass > 0 && massLow / mass < 0.12 && height > 2.2) return 'literati';
  if (lean > 0.35 || apexOffset > height * 0.35) return 'slanting';
  const movement = chain.reduce((s, id) => s + (tree.branches[id]!.shape.divergence || 0), 0) - (tree.branches[chain[0]!]!.shape.divergence || 0);
  if (lean < 0.1 && apexOffset < height * 0.08 && movement < 0.3) return 'formal-upright';
  return 'informal-upright';
}

export function styleOf(r: TreeRecord): TreeStyle {
  return r.styleOverride ?? detectStyle(r.work.tree);
}

export function speciesName(id: SpeciesId): string {
  return SPECIES[id].name;
}
