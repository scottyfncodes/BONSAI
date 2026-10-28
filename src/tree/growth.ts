import { TreeBuilder } from './builder';
import { type TreeLayout, bezierPoint, childrenIndex, computeLayout, frameAt, radiusAt } from './layout';
import { rngFor } from './rng';
import { SPECIES, seasonOf, seasonProgress } from './species';
import { type Branch, type BranchId, type Care, DEFAULT_CARE, MAX_BRANCHES, MAX_DEPTH, MIN_HEALTH, type TreeState } from './types';
import { clamp, dirInFrame, lerp, norm, type V3 } from './vec';

/** Longest single time-advance, to keep work bounded. */
export const MAX_ADVANCE_DAYS = 720;
const TICK = 6;

export interface GrowthReport {
  days: number;
  newShoots: BranchId[];
  woundsClosed: number;
  wiresSet: BranchId[];
  wireBiting: BranchId[];
  dieback: BranchId[];
  healthBefore: number;
  healthAfter: number;
}

const idNum = (id: string): number => Number.parseInt(id.slice(1), 10) || 0;
const sortedIds = (o: Record<string, unknown>): string[] => Object.keys(o).sort((a, b) => idNum(a) - idNum(b));

/** Seasonal growth energy multiplier. */
function seasonVigor(day: number): number {
  switch (seasonOf(day)) {
    case 'spring':
      return 1;
    case 'summer':
      return 0.6;
    case 'autumn':
      return 0.18;
    default:
      return 0;
  }
}

function seasonHealing(day: number): number {
  return { spring: 1, summer: 1, autumn: 0.6, winter: 0.2 }[seasonOf(day)];
}

/**
 * Advance the tree by `days`. Pure: returns a new state and a report.
 * Deterministic for a given state – the RNG is seeded from seed + day.
 */
export function advance(
  tree: TreeState,
  days: number,
  care: Care = DEFAULT_CARE,
): { tree: TreeState; report: GrowthReport } {
  const total = clamp(Math.round(days), 0, MAX_ADVANCE_DAYS);
  const draft: TreeState = structuredCloneTree(tree);
  const report: GrowthReport = {
    days: total,
    newShoots: [],
    woundsClosed: 0,
    wiresSet: [],
    wireBiting: [],
    dieback: [],
    healthBefore: tree.health,
    healthAfter: tree.health,
  };
  let left = total;
  while (left > 0) {
    const dt = Math.min(TICK, left);
    step(draft, dt, report, care);
    left -= dt;
  }
  report.healthAfter = draft.health;
  report.newShoots = report.newShoots.filter((id) => draft.branches[id]);
  report.wiresSet = [...new Set(report.wiresSet)];
  report.wireBiting = [...new Set(report.wireBiting)];
  report.dieback = [...new Set(report.dieback)];
  return { tree: draft, report };
}

function structuredCloneTree(t: TreeState): TreeState {
  const branches: Record<string, Branch> = {};
  for (const [k, b] of Object.entries(t.branches)) {
    branches[k] = { ...b, shape: { ...b.shape }, rest: { ...b.rest }, wire: b.wire ? { ...b.wire } : null };
  }
  const buds: TreeState['buds'] = {};
  for (const [k, b] of Object.entries(t.buds)) buds[k] = { ...b };
  const wounds: TreeState['wounds'] = {};
  for (const [k, w] of Object.entries(t.wounds)) wounds[k] = { ...w };
  return { ...t, branches, buds, wounds, stats: { ...t.stats } };
}

/** Light reaching each foliage-bearing branch: 1 = full sun, 0 = deep shade. */
export function computeLight(tree: TreeState, layout: TreeLayout): Map<BranchId, number> {
  const pts: { id: BranchId; p: V3; f: number }[] = [];
  for (const b of Object.values(tree.branches)) {
    const l = layout.get(b.id);
    if (!l || b.foliage <= 0.02) continue;
    pts.push({ id: b.id, p: bezierPoint(l, 0.8), f: b.foliage * Math.min(1, b.length * 2) });
  }
  const light = new Map<BranchId, number>();
  for (const a of pts) {
    let shade = 0;
    for (const o of pts) {
      if (o === a) continue;
      const dy = o.p[1] - a.p[1];
      if (dy < 0.04) continue;
      const dx = o.p[0] - a.p[0];
      const dz = o.p[2] - a.p[2];
      const h2 = dx * dx + dz * dz;
      const r = 0.22 + dy * 0.35;
      if (h2 < r * r) shade += o.f * (1 - Math.sqrt(h2) / r) * 0.55;
    }
    light.set(a.id, clamp(1 - (1 - Math.exp(-shade)) * 0.85, 0.05, 1));
  }
  return light;
}

function depthMap(tree: TreeState, kids: Map<BranchId, BranchId[]>): Map<BranchId, number> {
  const out = new Map<BranchId, number>();
  const stack: [BranchId, number][] = [[tree.rootId, 0]];
  while (stack.length) {
    const [id, d] = stack.pop()!;
    out.set(id, d);
    const b = tree.branches[id]!;
    for (const c of kids.get(id) ?? []) {
      const cb = tree.branches[c]!;
      stack.push([c, cb.kind === 'trunk' && b.kind === 'trunk' ? d : d + 1]);
    }
  }
  return out;
}

function subtreeFoliage(tree: TreeState, kids: Map<BranchId, BranchId[]>): Map<BranchId, number> {
  const memo = new Map<BranchId, number>();
  const visit = (id: BranchId): number => {
    const b = tree.branches[id]!;
    let m = b.foliage * b.length;
    for (const c of kids.get(id) ?? []) m += visit(c);
    memo.set(id, m);
    return m;
  };
  if (tree.branches[tree.rootId]) visit(tree.rootId);
  return memo;
}

function step(t: TreeState, dt: number, report: GrowthReport, care: Care): void {
  const sp = SPECIES[t.species].growth;
  const feed = care.feed ? 1.35 : 1;
  const sun = care.placement === 'sun' ? 1 : 0.72;
  const g = seasonVigor(t.day) * feed;
  const season = seasonOf(t.day);
  const rng = rngFor(t.seed, t.day, 'grow');
  let layout = computeLayout(t);
  const kids = childrenIndex(t);
  const depth = depthMap(t, kids);
  const light = computeLight(t, layout);

  // --- Health: pruning stress fades; health drifts toward a target.
  t.stats.recentFoliageLoss *= Math.exp(-dt / 50);
  const stress = clamp(t.stats.recentFoliageLoss * sp.foliageSensitivity, 0, 1.2);
  const target = clamp(1 - stress * 0.7, MIN_HEALTH, 1);
  t.health = clamp(lerp(t.health, target, 1 - Math.exp(-dt / 25)), MIN_HEALTH, 1);

  // --- Vigor from light, height (apical dominance) and health.
  let maxY = 0.001;
  for (const l of layout.values()) maxY = Math.max(maxY, l.end[1]);
  for (const id of sortedIds(t.branches)) {
    const b = t.branches[id]!;
    const l = layout.get(id);
    if (!l) continue;
    const h = clamp(l.end[1] / maxY, 0, 1);
    const apical = lerp(1, 0.55 + h * 0.75, sp.apical);
    const lt = (light.get(id) ?? 0.7) * sun;
    b.vigor = clamp(lt * apical * (0.45 + 0.55 * t.health), 0.05, 1);
  }

  // --- Foliage: twigs fill in during the growing season; deep shade causes die-back.
  for (const id of sortedIds(t.branches)) {
    const b = t.branches[id]!;
    const d = depth.get(id) ?? 0;
    if (d === 0 && kids.get(id)?.some((c) => t.branches[c]!.kind === 'trunk')) continue;
    const lt = light.get(id);
    if (lt !== undefined && lt < 0.3 && g > 0) {
      const before = b.foliage;
      b.foliage = Math.max(0, b.foliage - dt * 0.004 * (0.3 - lt) * 10);
      if (before > 0.2 && b.foliage <= 0.2) report.dieback.push(id);
    } else if (b.radius < 0.05 && g > 0) {
      b.foliage = Math.min(1, b.foliage + dt * 0.006 * b.vigor * g);
    }
  }

  // --- Extension of young shoots.
  const youngDays = 120;
  for (const id of sortedIds(t.branches)) {
    const b = t.branches[id]!;
    if (t.day - b.bornDay > youngDays || g === 0) continue;
    const max = sp.shoot * (1.1 + b.vigor * 0.8);
    if (b.length < max) b.length = Math.min(max, b.length + (dt * sp.shoot * g * b.vigor) / 35);
  }

  // --- Bud break (spring, early summer).
  const canBreak = (season === 'spring' || (season === 'summer' && seasonProgress(t.day) < 0.4)) && t.health > 0.3;
  if (canBreak) {
    const tb = new TreeBuilder(t, layout);
    for (const budId of sortedIds(t.buds)) {
      if (Object.keys(t.branches).length >= MAX_BRANCHES) break;
      const bud = t.buds[budId]!;
      const host = t.branches[bud.branchId];
      const hl = layout.get(bud.branchId);
      if (!host || !hl) {
        delete t.buds[budId];
        continue;
      }
      const hd = depth.get(host.id) ?? 0;
      if (hd >= MAX_DEPTH) continue;
      const oldWood = bud.t < 0.85 || t.day - host.bornDay > 200;
      // Pines only push buds where there are needles.
      if (sp.phyllotaxy === 'whorl' && host.foliage < 0.3 && oldWood) continue;
      const chance = 0.11 * dt * 0.25 * host.vigor * g * (oldWood ? sp.backBud : 1) * t.health;
      if (rng() > chance) {
        bud.age += dt;
        continue;
      }
      delete t.buds[budId];
      const f = frameAt(hl, bud.t);
      const [a0, a1] = sp.branchAngle;
      const angle = bud.t > 0.95 ? 0.15 + rng() * 0.35 : a0 + rng() * (a1 - a0);
      let dir = dirInFrame(f, angle, bud.roll);
      dir = norm([dir[0], dir[1] + 0.35, dir[2]]);
      const shoot = tb.addBranch({
        parentId: host.id,
        attachT: bud.t,
        dir,
        length: sp.shoot * 0.3,
        radius: Math.max(0.007, Math.min(radiusAt(hl, bud.t) * 0.5, 0.014)),
        bend: rng() * 0.15,
        bendAngle: rng() * 6.28,
        foliage: 0.45,
        vigor: host.vigor,
      });
      if (!shoot) continue;
      report.newShoots.push(shoot.id);
      const n = sp.phyllotaxy === 'whorl' ? 3 : sp.phyllotaxy === 'opposite' ? 2 : 1;
      const r0 = rng() * 6.28;
      for (let k = 0; k < n; k++) tb.addBud(shoot.id, k === 0 ? 1 : 0.55 + rng() * 0.3, r0 + (k * Math.PI * 2) / n);
    }
    layout = tb.layout;
  }

  // --- New buds set in summer on vigorous foliage.
  if (season === 'summer' && g > 0) {
    const budCount = new Map<BranchId, number>();
    for (const b of Object.values(t.buds)) budCount.set(b.branchId, (budCount.get(b.branchId) ?? 0) + 1);
    for (const id of sortedIds(t.branches)) {
      const b = t.branches[id]!;
      if ((budCount.get(id) ?? 0) >= 2 || b.foliage < 0.4) continue;
      if (rng() < dt * 0.012 * b.vigor * (0.4 + sp.backBud)) {
        const bid = `u${t.nextId++}`;
        const terminal = !(kids.get(id) ?? []).some((c) => t.branches[c]!.attachT > 0.9);
        t.buds[bid] = {
          id: bid,
          branchId: id,
          t: terminal && rng() < 0.6 ? 1 : 0.35 + rng() * 0.55,
          roll: rng() * 6.28,
          age: 0,
        };
        budCount.set(id, (budCount.get(id) ?? 0) + 1);
      }
    }
  }

  // --- Thickening (pipe model): wood grows to carry the foliage above it.
  const thickSeason = { spring: 0.6, summer: 1, autumn: 0.5, winter: 0 }[season];
  if (thickSeason > 0) {
    const mass = subtreeFoliage(t, kids);
    for (const id of sortedIds(t.branches)) {
      const b = t.branches[id]!;
      const m = mass.get(id) ?? 0;
      const targetR = (b.kind === 'trunk' ? 0.03 : 0.008) + 0.03 * Math.sqrt(m) * sp.thicken;
      if (targetR > b.radius) b.radius += (targetR - b.radius) * dt * 0.0012 * thickSeason * sp.thicken * t.health * feed;
    }
    // Children must stay thinner than their parent where they attach.
    for (const id of sortedIds(t.branches)) {
      const b = t.branches[id]!;
      if (!b.parentId) continue;
      const p = t.branches[b.parentId]!;
      const pr = lerp(p.radius, p.radius * 0.5, b.attachT);
      const cap = b.kind === 'trunk' ? pr * 1.0 : pr * 0.85;
      if (b.radius > cap) b.radius = cap;
    }
  }

  // --- Wound healing.
  const heal = seasonHealing(t.day);
  for (const id of sortedIds(t.wounds)) {
    const w = t.wounds[id]!;
    const host = t.branches[w.branchId];
    if (!host) {
      delete t.wounds[id];
      continue;
    }
    if (w.heal >= 1) continue;
    const days = sp.healDays * Math.pow(Math.max(w.size, 0.01) / 0.05, 0.7);
    w.heal = Math.min(1, w.heal + (dt / days) * heal * (0.4 + 0.6 * host.vigor));
    if (w.heal >= 1) report.woundsClosed += 1;
  }

  // --- Wire setting and bite.
  for (const id of sortedIds(t.branches)) {
    const b = t.branches[id]!;
    if (!b.wire) continue;
    const before = b.wire.set;
    const copper = b.wire.copper ? 1.5 : 1;
    b.wire.set = Math.min(1, b.wire.set + (dt / sp.wireSetDays) * (0.35 + 0.65 * heal) * (0.5 + 0.5 * b.vigor) * copper);
    if (before < 1 && b.wire.set >= 1) report.wiresSet.push(id);
    const overdue = t.day - b.wire.appliedDay - sp.wireSetDays * 1.3;
    if (overdue > 0 && g > 0) {
      b.wire.bite = Math.min(1, b.wire.bite + dt / 120);
      report.wireBiting.push(id);
    }
  }

  t.day += dt;
}
