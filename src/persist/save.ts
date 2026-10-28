import type { ChallengeAttempt, ChallengeLink, TreeRecord, TreeStyle } from '../game/model';
import { MAX_STONES, POT_SHAPES, type PotStyle, type SurfaceStyle } from '../game/pots';
import { SPECIES_IDS } from '../tree/species';
import { sanitizeTree, validateTree } from '../tree/validate';
import { type KV, isQuotaError } from './kv';

/**
 * Save format
 * -----------
 *   bonsai.v1.profile         – Profile JSON
 *   bonsai.v1.index           – ordered list of tree ids
 *   bonsai.v1.tree.<id>       – { schema, record }
 *   bonsai.v1.tree.<id>.bak   – previous good copy of the same tree
 *   bonsai.v1.thumb.<id>      – small JPEG data URL (optional, best effort)
 *   bonsai.v1.quarantine.<id> – unreadable data kept aside, never deleted silently
 */
export const SCHEMA = 1;
const P = 'bonsai.v1.';
export const KEYS = {
  profile: `${P}profile`,
  index: `${P}index`,
  tree: (id: string) => `${P}tree.${id}`,
  bak: (id: string) => `${P}tree.${id}.bak`,
  thumb: (id: string) => `${P}thumb.${id}`,
  quarantine: (id: string) => `${P}quarantine.${id}`,
};

export interface Settings {
  muted: boolean;
  volume: number;
  ambient: boolean;
  haptics: boolean;
}

export interface Profile {
  schema: number;
  unlocks: string[];
  /** Reward keys like "windswept:2" that have been granted – prevents double rewards. */
  claimed: string[];
  best: Record<string, { score: number; stars: number }>;
  activeTreeId: string | null;
  settings: Settings;
  /** Onboarding step reached (0 = not started, 99 = finished). */
  onboarding: number;
  createdAt: number;
}

export const defaultProfile = (now = Date.now()): Profile => ({
  schema: SCHEMA,
  unlocks: [],
  claimed: [],
  best: {},
  activeTreeId: null,
  settings: { muted: false, volume: 0.8, ambient: true, haptics: true },
  onboarding: 0,
  createdAt: now,
});

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const STYLES: TreeStyle[] = ['formal-upright', 'informal-upright', 'slanting', 'windswept', 'cascade', 'literati', 'broom'];

function validPot(p: unknown): p is PotStyle {
  return isObj(p) && POT_SHAPES.some((s) => s.id === p.shape) && isNum(p.size) && isStr(p.colorId);
}

function validSurface(s: unknown): s is SurfaceStyle {
  if (!isObj(s) || !isNum(s.moss) || !Array.isArray(s.stones) || s.stones.length > MAX_STONES) return false;
  return s.stones.every(
    (st) => isObj(st) && isStr(st.id) && ['river', 'slate', 'quartz'].includes(st.kind as string) && isNum(st.x) && isNum(st.z) && isNum(st.scale) && isNum(st.rot),
  );
}

function validAttempt(a: unknown): a is ChallengeAttempt {
  return isObj(a) && isStr(a.challengeId) && isStr(a.variantId) && isNum(a.score) && isNum(a.stars) && isNum(a.at);
}

function validChallenge(c: unknown): c is ChallengeLink | null {
  if (c === null) return true;
  return isObj(c) && isStr(c.challengeId) && isStr(c.variantId) && isNum(c.startedAt) && (c.submitted === null || validAttempt(c.submitted));
}

/** Returns a list of problems; empty = safe to load. */
export function validateRecord(r: unknown): string[] {
  if (!isObj(r)) return ['record is not an object'];
  const errs: string[] = [];
  if (!isStr(r.id) || !r.id) errs.push('id');
  if (!isStr(r.name)) errs.push('name');
  if (!SPECIES_IDS.includes(r.species as never)) errs.push('species');
  if (!isStr(r.preset)) errs.push('preset');
  if (!(r.styleOverride === null || STYLES.includes(r.styleOverride as TreeStyle))) errs.push('style');
  if (!isNum(r.createdAt) || !isNum(r.updatedAt) || !isNum(r.baseAgeYears)) errs.push('dates');
  if (!isObj(r.work)) return [...errs, 'work'];
  errs.push(...validateTree(r.work.tree).map((e) => `tree: ${e}`));
  if (!validPot(r.work.pot)) errs.push('pot');
  if (!validSurface(r.work.surface)) errs.push('surface');
  if (!isObj(r.care) || typeof r.care.feed !== 'boolean' || !['sun', 'partial'].includes(r.care.placement as string)) errs.push('care');
  if (!validChallenge(r.challenge)) errs.push('challenge');
  if (!Array.isArray(r.history) || !r.history.every(validAttempt)) errs.push('history');
  return errs;
}

/**
 * Bring an older stored record up to the current schema. Each schema bump
 * adds a step here; unknown future schemas are refused (never downgraded).
 */
export function migrate(stored: unknown): { record: unknown; status: 'ok' | 'migrated' | 'newer' | 'invalid' } {
  if (!isObj(stored) || !isNum(stored.schema)) return { record: null, status: 'invalid' };
  if (stored.schema > SCHEMA) return { record: null, status: 'newer' };
  if (stored.schema === SCHEMA) return { record: stored.record, status: 'ok' };
  // No older schemas exist yet. Future example:
  //   if (stored.schema === 1) stored = { schema: 2, record: upgrade1to2(stored.record) };
  return { record: null, status: 'invalid' };
}

export interface LoadResult {
  profile: Profile;
  trees: TreeRecord[];
  /** Trees restored from their backup copy. */
  recovered: string[];
  /** Trees that could not be read; their data was quarantined, not deleted. */
  lost: string[];
  /** Trees saved by a newer version of the game – left untouched. */
  newer: string[];
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readTree(kv: KV, key: string): { record: TreeRecord | null; status: 'ok' | 'missing' | 'newer' | 'invalid' } {
  const raw = kv.get(key);
  if (raw === null) return { record: null, status: 'missing' };
  const m = migrate(parse(raw));
  if (m.status === 'newer') return { record: null, status: 'newer' };
  if (m.status === 'invalid' || validateRecord(m.record).length) return { record: null, status: 'invalid' };
  const r = m.record as TreeRecord;
  return { record: { ...r, work: { ...r.work, tree: sanitizeTree(r.work.tree) } }, status: 'ok' };
}

export function loadAll(kv: KV): LoadResult {
  const out: LoadResult = { profile: defaultProfile(), trees: [], recovered: [], lost: [], newer: [] };
  const prof = parse(kv.get(KEYS.profile));
  if (isObj(prof) && isNum(prof.schema) && prof.schema <= SCHEMA) {
    const d = defaultProfile();
    out.profile = {
      ...d,
      ...prof,
      unlocks: Array.isArray(prof.unlocks) ? prof.unlocks.filter(isStr) : [],
      claimed: Array.isArray(prof.claimed) ? prof.claimed.filter(isStr) : [],
      best: isObj(prof.best) ? (prof.best as Profile['best']) : {},
      settings: { ...d.settings, ...(isObj(prof.settings) ? prof.settings : {}) },
      activeTreeId: isStr(prof.activeTreeId) ? prof.activeTreeId : null,
      onboarding: isNum(prof.onboarding) ? prof.onboarding : 0,
      schema: SCHEMA,
    } as Profile;
  }
  const idxRaw = parse(kv.get(KEYS.index));
  const fromIndex = Array.isArray(idxRaw) ? idxRaw.filter(isStr) : [];
  // Also discover trees missing from the index (e.g. index write interrupted).
  const discovered = kv
    .keys()
    .filter((k) => k.startsWith(`${P}tree.`) && !k.endsWith('.bak'))
    .map((k) => k.slice(`${P}tree.`.length));
  const bakOnly = kv
    .keys()
    .filter((k) => k.startsWith(`${P}tree.`) && k.endsWith('.bak'))
    .map((k) => k.slice(`${P}tree.`.length, -4));
  const ids = [...new Set([...fromIndex, ...discovered, ...bakOnly])];
  for (const id of ids) {
    const main = readTree(kv, KEYS.tree(id));
    if (main.record) {
      out.trees.push(main.record);
      continue;
    }
    if (main.status === 'newer') {
      out.newer.push(id);
      continue;
    }
    const bak = readTree(kv, KEYS.bak(id));
    if (bak.record) {
      out.trees.push(bak.record);
      out.recovered.push(id);
      continue;
    }
    if (main.status === 'missing' && bak.status === 'missing') continue;
    // Keep unreadable bytes aside so nothing is ever silently destroyed.
    const raw = kv.get(KEYS.tree(id)) ?? kv.get(KEYS.bak(id));
    if (raw !== null) {
      try {
        kv.set(KEYS.quarantine(id), raw);
        kv.remove(KEYS.tree(id));
        kv.remove(KEYS.bak(id));
      } catch {
        /* leave in place if we can't move it */
      }
    }
    out.lost.push(id);
  }
  return out;
}

export type SaveOutcome = { ok: true } | { ok: false; reason: 'quota' | 'error'; message: string };

/** Save a tree, keeping the previous good copy as a backup. */
export function saveTree(kv: KV, record: TreeRecord, order: string[]): SaveOutcome {
  try {
    const prev = kv.get(KEYS.tree(record.id));
    if (prev !== null) kv.set(KEYS.bak(record.id), prev);
    kv.set(KEYS.tree(record.id), JSON.stringify({ schema: SCHEMA, record }));
    kv.set(KEYS.index, JSON.stringify(order));
    return { ok: true };
  } catch (e) {
    if (isQuotaError(e)) {
      // Free best-effort data and try once more.
      for (const k of kv.keys()) if (k.startsWith(`${P}thumb.`)) kv.remove(k);
      try {
        kv.set(KEYS.tree(record.id), JSON.stringify({ schema: SCHEMA, record }));
        kv.set(KEYS.index, JSON.stringify(order));
        return { ok: true };
      } catch {
        return { ok: false, reason: 'quota', message: 'Storage is full – delete a tree or portrait to keep saving.' };
      }
    }
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export function saveProfile(kv: KV, profile: Profile): SaveOutcome {
  try {
    kv.set(KEYS.profile, JSON.stringify(profile));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: isQuotaError(e) ? 'quota' : 'error', message: 'Could not save progress.' };
  }
}

export function deleteTree(kv: KV, id: string, order: string[]): void {
  kv.remove(KEYS.tree(id));
  kv.remove(KEYS.bak(id));
  kv.remove(KEYS.thumb(id));
  try {
    kv.set(KEYS.index, JSON.stringify(order));
  } catch {
    /* index is advisory; trees are discovered by key */
  }
}

export function saveThumb(kv: KV, id: string, dataUrl: string): void {
  try {
    kv.set(KEYS.thumb(id), dataUrl);
  } catch {
    /* thumbnails are optional */
  }
}

export const loadThumb = (kv: KV, id: string): string | null => kv.get(KEYS.thumb(id));
