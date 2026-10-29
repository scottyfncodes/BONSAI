import type { SpeciesId } from './types';

export type FoliageKind = 'scale' | 'palmate' | 'needle';
export type Phyllotaxy = 'alternate' | 'opposite' | 'whorl';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  latin: string;
  blurb: string;
  /** What changes how you play it – shown in the sapling picker. */
  traits: string[];
  bark: { base: string; dark: string; light: string; furrow: number; pattern: 'fibrous' | 'smooth' | 'plated' };
  foliage: {
    kind: FoliageKind;
    /** Colours by season: spring, summer, autumn, winter. */
    colors: [string, string, string, string];
    accent: string;
    padSize: number;
    deciduous: boolean;
  };
  growth: {
    /** Typical new-shoot length per season (world units). */
    shoot: number;
    /** 0..1: how strongly the top and tips out-compete the interior. */
    apical: number;
    /** 0..1: how readily dormant buds break near cuts and on old wood. */
    backBud: number;
    phyllotaxy: Phyllotaxy;
    branchAngle: [number, number];
    thicken: number;
    /** Days for a wound of size 0.05 to close completely. */
    healDays: number;
    /** Days for a wired branch to fully set. */
    wireSetDays: number;
    /** 0..1: how far wood can bend before it risks cracking. */
    flexibility: number;
    /** Health penalty multiplier for removing foliage. */
    foliageSensitivity: number;
  };
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  juniper: {
    id: 'juniper',
    name: 'Shimpaku Juniper',
    latin: 'Juniperus chinensis',
    blurb: 'Supple, twisting wood and dense scale foliage. Bends dramatically, heals slowly.',
    traits: ['Most flexible wood', 'Slow to heal cuts', 'Sulks if over-thinned', 'Weak back-budding'],
    bark: { base: '#6e4433', dark: '#3b2219', light: '#a87458', furrow: 0.85, pattern: 'fibrous' },
    foliage: {
      kind: 'scale',
      colors: ['#62843f', '#4b6d34', '#4a6536', '#415a35'],
      accent: '#8fb062',
      padSize: 1,
      deciduous: false,
    },
    growth: {
      shoot: 0.32,
      apical: 0.55,
      backBud: 0.25,
      phyllotaxy: 'alternate',
      branchAngle: [0.6, 1.25],
      thicken: 0.9,
      healDays: 240,
      wireSetDays: 150,
      flexibility: 0.95,
      foliageSensitivity: 1.5,
    },
  },
  maple: {
    id: 'maple',
    name: 'Japanese Maple',
    latin: 'Acer palmatum',
    blurb: 'Fine, opposite branching and seasonal colour. Back-buds eagerly, sets wire fast.',
    traits: ['Opposite buds', 'Back-buds vigorously', 'Brittle – bends less', 'Bare in winter'],
    bark: { base: '#7c7464', dark: '#4e483e', light: '#a39b88', furrow: 0.2, pattern: 'smooth' },
    foliage: {
      kind: 'palmate',
      colors: ['#93b04a', '#5f8a3a', '#c4462a', '#8b5a3c'],
      accent: '#d9633a',
      padSize: 0.9,
      deciduous: true,
    },
    growth: {
      shoot: 0.42,
      apical: 0.75,
      backBud: 0.9,
      phyllotaxy: 'opposite',
      branchAngle: [0.55, 0.95],
      thicken: 1.25,
      healDays: 110,
      wireSetDays: 70,
      flexibility: 0.55,
      foliageSensitivity: 0.7,
    },
  },
  pine: {
    id: 'pine',
    name: 'Japanese Black Pine',
    latin: 'Pinus thunbergii',
    blurb: 'Plated bark and candle growth in whorls. Strong at the top, buds only where it has needles.',
    traits: ['Whorled candles', 'Strong apical dominance', 'Buds only near needles', 'Moderate flexibility'],
    bark: { base: '#5a4a3f', dark: '#2e2520', light: '#8a7462', furrow: 1, pattern: 'plated' },
    foliage: {
      kind: 'needle',
      colors: ['#55743f', '#3f5f37', '#3d5a35', '#3a5234'],
      accent: '#c9b778',
      padSize: 1.05,
      deciduous: false,
    },
    growth: {
      shoot: 0.36,
      apical: 0.9,
      backBud: 0.35,
      phyllotaxy: 'whorl',
      branchAngle: [0.85, 1.45],
      thicken: 1,
      healDays: 170,
      wireSetDays: 110,
      flexibility: 0.72,
      foliageSensitivity: 1.1,
    },
  },
};

export const SPECIES_IDS: SpeciesId[] = ['juniper', 'maple', 'pine'];

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const YEAR_DAYS = 360;

export function seasonOf(day: number): Season {
  const d = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return SEASONS[Math.floor(d / 90)] as Season;
}

/** 0..1 progress within the current season. */
export function seasonProgress(day: number): number {
  const d = ((day % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return (d % 90) / 90;
}
