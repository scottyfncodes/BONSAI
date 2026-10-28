export type PotShape = 'oval' | 'rectangle' | 'round' | 'drum' | 'crescent' | 'cascade';
export type PotMaterial = 'unglazed' | 'glazed';

export interface PotStyle {
  shape: PotShape;
  /** 0.75 .. 1.3 – relative size. */
  size: number;
  colorId: string;
}

export interface PotColor {
  id: string;
  name: string;
  hex: string;
  material: PotMaterial;
  /** Unlock key; undefined = available from the start. */
  unlock?: string;
}

export const POT_COLORS: PotColor[] = [
  { id: 'clay', name: 'Tokoname clay', hex: '#6a4636', material: 'unglazed' },
  { id: 'charcoal', name: 'Charcoal', hex: '#3d3a38', material: 'unglazed' },
  { id: 'stone', name: 'Warm stone', hex: '#9a8f80', material: 'unglazed' },
  { id: 'celadon', name: 'Celadon', hex: '#8fae9a', material: 'glazed' },
  { id: 'cream', name: 'Cream glaze', hex: '#e6dcc4', material: 'glazed' },
  { id: 'cobalt', name: 'Cobalt', hex: '#2f4a7a', material: 'glazed', unlock: 'pot:cobalt' },
  { id: 'vermilion', name: 'Vermilion', hex: '#b8452c', material: 'glazed', unlock: 'pot:vermilion' },
  { id: 'nanban', name: 'Nanban stoneware', hex: '#5e4a3c', material: 'unglazed', unlock: 'pot:nanban' },
];

export interface PotShapeDef {
  id: PotShape;
  name: string;
  /** Relative height (depth) of the pot. */
  depth: number;
  unlock?: string;
  note: string;
}

export const POT_SHAPES: PotShapeDef[] = [
  { id: 'oval', name: 'Oval', depth: 0.32, note: 'Soft and versatile – suits deciduous trees.' },
  { id: 'rectangle', name: 'Rectangle', depth: 0.36, note: 'Strong and formal – suits conifers.' },
  { id: 'round', name: 'Round bowl', depth: 0.34, note: 'Gentle, for flowing or literati trees.' },
  { id: 'drum', name: 'Drum', depth: 0.5, note: 'Studded drum – heavy, masculine trunks.', unlock: 'pot:drum' },
  { id: 'crescent', name: 'Crescent', depth: 0.22, note: 'Shallow, for windswept and forest scenes.', unlock: 'pot:crescent' },
  { id: 'cascade', name: 'Tall cascade', depth: 1.05, note: 'Tall, for trees that tumble below the rim.' },
];

export const DEFAULT_POT: PotStyle = { shape: 'oval', size: 1, colorId: 'clay' };

export const potColor = (id: string): PotColor => POT_COLORS.find((c) => c.id === id) ?? POT_COLORS[0]!;
export const potShape = (id: PotShape): PotShapeDef => POT_SHAPES.find((s) => s.id === id) ?? POT_SHAPES[0]!;

/** Pot footprint in world units. */
export function potDims(p: PotStyle): { width: number; depthZ: number; height: number } {
  const def = potShape(p.shape);
  const w = 1.95 * p.size;
  const round = p.shape === 'round' || p.shape === 'drum' || p.shape === 'cascade';
  const width = p.shape === 'cascade' ? w * 0.48 : round ? w * 0.72 : w;
  const depthZ = round ? width : width * 0.66;
  return { width, depthZ, height: def.depth * (p.shape === 'cascade' ? 1 : p.size) };
}

// ------------------------------------------------------------- surface

export type StoneKind = 'river' | 'slate' | 'quartz';

export interface Stone {
  id: string;
  kind: StoneKind;
  /** Normalised position within the soil (-1..1 on each axis). */
  x: number;
  z: number;
  scale: number;
  rot: number;
}

export interface SurfaceStyle {
  /** 0..1 coverage. */
  moss: number;
  stones: Stone[];
}

export const DEFAULT_SURFACE: SurfaceStyle = { moss: 0.35, stones: [] };
export const MAX_STONES = 5;
export const STONE_KINDS: { id: StoneKind; name: string; unlock?: string }[] = [
  { id: 'river', name: 'River stone' },
  { id: 'slate', name: 'Slate' },
  { id: 'quartz', name: 'White quartz', unlock: 'stone:quartz' },
];
