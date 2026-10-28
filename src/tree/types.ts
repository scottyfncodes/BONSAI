/**
 * Core tree data model. Plain JSON-serialisable data: no class instances,
 * no renderer types. Every edit produces a new TreeState (structural sharing
 * of untouched branches) so undo/redo is a simple snapshot stack.
 */
export type SpeciesId = 'juniper' | 'maple' | 'pine';
export type BranchId = string;

/** Branch shape, expressed relative to the parent's frame at the attach point. */
export interface Shape {
  /** Angle between the parent tangent and this branch's chord (radians). */
  divergence: number;
  /** Azimuth of the chord around the parent tangent (radians). */
  roll: number;
  /** Curvature: control-point offset as a fraction of length (0 = straight). */
  bend: number;
  /** Direction of the curvature offset around the chord (radians). */
  bendAngle: number;
}

export interface Wire {
  appliedDay: number;
  /** 0..1 – how far the branch has set into its wired shape. */
  set: number;
  /** 0..1 – wire left on too long starts biting into the bark. */
  bite: number;
  /** Copper holds harder: branches set faster. */
  copper?: boolean;
}

/** How the tree is being looked after – influences growth. */
export interface Care {
  /** Fertiliser in the growing season: more vigour, faster thickening. */
  feed: boolean;
  /** Full sun grows dense and strong; partial shade grows slower and leggier. */
  placement: 'sun' | 'partial';
}

export const DEFAULT_CARE: Care = { feed: false, placement: 'sun' };

export interface Branch {
  id: BranchId;
  parentId: BranchId | null;
  /** Trunk segments form the leader chain; everything else is a branch. */
  kind: 'trunk' | 'branch';
  /** Position along the parent's curve, 0 = base, 1 = tip. */
  attachT: number;
  length: number;
  /** Radius at the base. */
  radius: number;
  shape: Shape;
  /** The shape the wood "remembers"; unwired bends relax back toward it. */
  rest: Shape;
  bornDay: number;
  /** 0..1 – how much foliage this branch carries. */
  foliage: number;
  /** 0..1 – growth energy this branch receives (light, position, health). */
  vigor: number;
  wire: Wire | null;
}

/** A dormant growth point. */
export interface Bud {
  id: string;
  branchId: BranchId;
  t: number;
  roll: number;
  /** Days since formation. */
  age: number;
}

/** A pruning cut healing on its host branch. */
export interface Wound {
  id: string;
  branchId: BranchId;
  t: number;
  roll: number;
  /** Radius of the removed branch at the cut. */
  size: number;
  day: number;
  /** 0..1 – healing progress. */
  heal: number;
}

export interface TreeStats {
  cuts: number;
  bends: number;
  wiresApplied: number;
  /** Rolling foliage removed (decays over time) – drives pruning stress. */
  recentFoliageLoss: number;
}

export interface TreeState {
  seed: number;
  species: SpeciesId;
  rootId: BranchId;
  branches: Record<BranchId, Branch>;
  buds: Record<string, Bud>;
  wounds: Record<string, Wound>;
  nextId: number;
  /** In-game days since the tree's story began (day 0 = early spring). */
  day: number;
  /** 0.25..1. Never reaches zero – trees in the Studio cannot die. */
  health: number;
  stats: TreeStats;
}

export const MIN_HEALTH = 0.25;
export const MAX_BRANCHES = 420;
export const MAX_DEPTH = 7;
