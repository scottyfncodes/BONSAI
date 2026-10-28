import { TreeBuilder, anglesFromDir, dirFromAngles } from './builder';
import { radiusAt } from './layout';
import { type Rng, range, rngFor } from './rng';
import { SPECIES } from './species';
import type { Branch, SpeciesId, TreeState } from './types';
import { norm } from './vec';

export type SaplingPreset = 'nursery' | 'windswept' | 'overgrown' | 'collected' | 'literati';

interface PresetParams {
  height: number;
  trunkSegments: number;
  trunkRadius: number;
  /** Trunk lean from vertical (radians) and how much each segment wanders. */
  lean: number;
  movement: number;
  /** Multiplies branch count. */
  density: number;
  /** Fraction of trunk height below the first branch. */
  clearTrunk: number;
}

const PRESETS: Record<SaplingPreset, PresetParams> = {
  nursery: { height: 2.7, trunkSegments: 4, trunkRadius: 0.2, lean: 0.12, movement: 0.32, density: 1, clearTrunk: 0.22 },
  windswept: { height: 2.5, trunkSegments: 4, trunkRadius: 0.21, lean: 0.38, movement: 0.28, density: 1, clearTrunk: 0.2 },
  overgrown: { height: 2.9, trunkSegments: 4, trunkRadius: 0.22, lean: 0.08, movement: 0.3, density: 1.45, clearTrunk: 0.15 },
  collected: { height: 2.6, trunkSegments: 5, trunkRadius: 0.27, lean: 0.18, movement: 0.5, density: 0.95, clearTrunk: 0.28 },
  literati: { height: 3.2, trunkSegments: 5, trunkRadius: 0.15, lean: 0.25, movement: 0.55, density: 0.55, clearTrunk: 0.55 },
};

export const PRESET_LABELS: Record<SaplingPreset, string> = {
  nursery: 'Nursery stock',
  windswept: 'Leaning sapling',
  overgrown: 'Overgrown nursery stock',
  collected: 'Collected yamadori',
  literati: 'Slender literati',
};

/** Generated trees stay well below MAX_BRANCHES so growth has headroom. */
const GEN_CAP = 260;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function emptyTree(species: SpeciesId, seed: number): TreeState {
  return {
    seed,
    species,
    rootId: '',
    branches: {},
    buds: {},
    wounds: {},
    nextId: 1,
    day: 20,
    health: 1,
    stats: { cuts: 0, bends: 0, wiresApplied: 0, recentFoliageLoss: 0 },
  };
}

/** Deterministically generate an unstyled starting tree. Same inputs → same tree. */
export function generateSapling(species: SpeciesId, seed: number, preset: SaplingPreset = 'nursery'): TreeState {
  const p = PRESETS[preset];
  const def = SPECIES[species];
  const rng = rngFor(seed, species, preset);
  const tree = emptyTree(species, seed);
  const tb = new TreeBuilder(tree, new Map());

  // --- Trunk: a chain of curved segments with movement.
  const leanAz = range(rng, -Math.PI, Math.PI);
  const trunk: Branch[] = [];
  let az = leanAz;
  let elev = Math.PI / 2 - p.lean;
  const segLen = p.height / p.trunkSegments;
  let radius = p.trunkRadius;
  for (let i = 0; i < p.trunkSegments; i++) {
    const zig = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * p.movement * range(rng, 0.6, 1.1);
    const dir = dirFromAngles(az + zig * 0.6, elev - Math.abs(zig) * 0.35);
    const b = tb.addBranch({
      parentId: i === 0 ? null : trunk[i - 1]!.id,
      attachT: i === 0 ? 0 : 1,
      dir: norm(dir),
      length: segLen * range(rng, 0.9, 1.1) * (1 - i * 0.06),
      radius,
      kind: 'trunk',
      bend: range(rng, 0.06, 0.18) * (0.5 + p.movement),
      bendAngle: range(rng, -Math.PI, Math.PI),
      foliage: i === p.trunkSegments - 1 ? 0.8 : 0,
    })!;
    trunk.push(b);
    radius *= 0.74;
    // Straighten upward a little each segment so the apex leans back over the base.
    elev = Math.min(Math.PI / 2 - 0.04, elev + p.lean * 0.35);
    az += range(rng, -0.4, 0.4);
  }

  // --- Primary branches spiral up the trunk.
  const totalH = trunk.reduce((s, b) => s + b.length, 0);
  let spiral = range(rng, 0, Math.PI * 2);
  let hAcc = 0;
  for (let si = 0; si < trunk.length; si++) {
    const seg = trunk[si]!;
    const segL = tb.layout.get(seg.id)!;
    const perNode = def.growth.phyllotaxy === 'whorl' ? 1.8 : def.growth.phyllotaxy === 'opposite' ? 1.5 : 1;
    const perSeg = Math.max(1, Math.round(((2.2 + rng() * 1.1) * p.density) / perNode));
    for (let k = 0; k < perSeg; k++) {
      const t = (k + 0.35 + rng() * 0.4) / perSeg;
      const hFrac = (hAcc + t * seg.length) / totalH;
      if (hFrac < p.clearTrunk || hFrac > 0.96) continue;
      const whorl = def.growth.phyllotaxy === 'whorl' ? 3 : def.growth.phyllotaxy === 'opposite' ? 2 : 1;
      const count = def.growth.phyllotaxy === 'alternate' ? 1 : Math.min(whorl, 1 + Math.floor(rng() * whorl));
      for (let w = 0; w < count; w++) {
        spiral += w === 0 ? GOLDEN : (Math.PI * 2) / whorl;
        const elevation = -0.12 + hFrac * 0.65 + range(rng, -0.12, 0.12);
        const dir = dirFromAngles(spiral, elevation);
        const parentR = radiusAt(segL, t);
        const len = p.height * (0.52 - 0.32 * hFrac) * range(rng, 0.8, 1.15);
        const primary = tb.addBranch({
          parentId: seg.id,
          attachT: t,
          dir,
          length: len,
          radius: Math.min(parentR * 0.5, 0.024 + 0.04 * (1 - hFrac)),
          bend: range(rng, 0.05, 0.22),
          bendAngle: range(rng, -Math.PI, Math.PI),
          foliage: 0.25,
        });
        if (primary && Object.keys(tree.branches).length < GEN_CAP) growSecondaries(tb, primary, rng, p.density, species);
      }
    }
    hAcc += seg.length;
  }

  // Apex twigs on the leader.
  const apex = trunk[trunk.length - 1]!;
  for (let k = 0; k < 3; k++) {
    const dir = dirFromAngles(spiral + k * 2.1, 0.55 + rng() * 0.3);
    const b = tb.addBranch({
      parentId: apex.id,
      attachT: 0.88 + k * 0.04,
      dir,
      length: range(rng, 0.28, 0.45),
      radius: Math.min(apex.radius * 0.4, 0.022),
      bend: range(rng, 0.05, 0.2),
      bendAngle: rng() * 6.28,
      foliage: 1,
    });
    if (b) tb.addBud(b.id, 1, 0, 200);
  }
  return tree;
}

function growSecondaries(tb: TreeBuilder, primary: Branch, rng: Rng, density: number, species: SpeciesId): void {
  const pl = tb.layout.get(primary.id)!;
  const base = anglesFromDir(pl.frame.t);
  const opposite = SPECIES[species].growth.phyllotaxy === 'opposite';
  const n = Math.max(opposite ? 1 : 2, Math.round(((2.5 + rng() * 1.6) * density) / (opposite ? 1.7 : 1)));
  let side = rng() < 0.5 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const t = 0.3 + (0.62 * (i + rng() * 0.5)) / n;
    const pairs = opposite ? 2 : 1;
    for (let j = 0; j < pairs; j++) {
      side = -side;
      const dir = dirFromAngles(base.azimuth + side * range(rng, 0.45, 1.05), base.elevation * 0.4 + range(rng, 0.05, 0.3));
      const len = primary.length * range(rng, 0.28, 0.45) * (1.1 - t * 0.4);
      const sec = tb.addBranch({
        parentId: primary.id,
        attachT: Math.min(0.97, t),
        dir,
        length: len,
        radius: Math.max(0.012, Math.min(radiusAt(pl, t) * 0.6, 0.03)),
        bend: range(rng, 0.04, 0.2),
        bendAngle: rng() * 6.28,
        foliage: range(rng, 0.65, 1),
      });
      if (!sec) continue;
      tb.addBud(sec.id, 1, rng() * 6.28, 200);
      // Tertiary twigs give the pads texture.
      const sl = tb.layout.get(sec.id)!;
      const sa = anglesFromDir(sl.frame.t);
      const m = Object.keys(tb.tree.branches).length > GEN_CAP ? 0 : Math.floor(rng() * 2.6 * density);
      for (let k = 0; k < m; k++) {
        const tt = range(rng, 0.45, 0.9);
        const tw = tb.addBranch({
          parentId: sec.id,
          attachT: tt,
          dir: dirFromAngles(sa.azimuth + (k % 2 ? 1 : -1) * range(rng, 0.5, 1), sa.elevation + range(rng, 0, 0.25)),
          length: len * range(rng, 0.35, 0.6),
          radius: Math.max(0.008, radiusAt(sl, tt) * 0.65),
          bend: range(rng, 0, 0.15),
          bendAngle: rng() * 6.28,
          foliage: 1,
        });
        if (tw) tb.addBud(tw.id, 1, rng() * 6.28, 200);
      }
    }
  }
  tb.addBud(primary.id, 1, 0, 200);
  tb.addBud(primary.id, range(rng, 0.2, 0.4), rng() * 6.28, 200);
}

