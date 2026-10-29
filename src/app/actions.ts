import { sound } from '../audio/sound';
import { CHALLENGES, challengeDef, evaluateChallenge, rewardsFor, variantDef } from '../game/challenges';
import { type TreeRecord, type Workpiece, branchLabel, createRecord, newId } from '../game/model';
import { type PotStyle, type Stone, type StoneKind, type SurfaceStyle, MAX_STONES } from '../game/pots';
import { unlockDef } from '../game/unlocks';
import { browserKV, type KV } from '../persist/kv';
import {
  type Profile,
  type Settings,
  KEYS,
  buildExport,
  deleteTree as deleteStored,
  loadAll,
  loadThumb,
  parseImport,
  readRecord,
  treeIdFromKey,
  treeKeyExists,
  saveProfile,
  saveThumb,
  saveTree,
} from '../persist/save';
import type { SceneInput } from '../render/stage';
import type { SaplingPreset } from '../tree/generate';
import { createHistory, push, redo as redoH, replace, undo as undoH } from '../tree/history';
import { computeLayout } from '../tree/layout';
import {
  aimTip as aimTipOp,
  applyWire as applyWireOp,
  previewPrune,
  prune,
  releaseShape as releaseShapeOp,
  removeWire as removeWireOp,
  setShape as setShapeOp,
} from '../tree/ops';
import { rotateAxis } from '../tree/vec';
import { mulberry32 } from '../tree/rng';
import type { BranchId, Care, SpeciesId } from '../tree/types';
import { emitFx, view } from './bus';
import { runGrowth } from './growthClient';
import { type Route, type Sheet, type StudioState, type ToolId, getState, setState } from './store';

let kv: KV | null = null;
const SAVE_DELAY = 450;
const pending = new Map<string, number>();
let toastSeq = 1;

// ------------------------------------------------------------------ boot

export function boot(storage: KV = browserKV()): void {
  kv = storage;
  const loaded = loadAll(kv);
  const trees: Record<string, TreeRecord> = {};
  for (const t of loaded.trees) trees[t.id] = t;
  const order = loaded.trees.sort((a, b) => b.updatedAt - a.updatedAt).map((t) => t.id);
  const notes: string[] = [];
  if (loaded.recovered.length) notes.push(`Restored ${loaded.recovered.length} tree${loaded.recovered.length > 1 ? 's' : ''} from a backup copy.`);
  if (loaded.lost.length) notes.push(`${loaded.lost.length} saved tree${loaded.lost.length > 1 ? 's' : ''} could not be read and were set aside.`);
  if (loaded.newer.length) notes.push(`${loaded.newer.length} tree${loaded.newer.length > 1 ? 's were' : ' was'} saved by a newer version and left untouched.`);
  const profile = loaded.profile;
  applySettings(profile.settings);
  setState({ loaded: true, profile, trees, order, notice: notes.length ? notes.join(' ') : null });

  // First visit: plant a tree immediately – no tutorial wall before the first cut.
  let active = profile.activeTreeId && trees[profile.activeTreeId] ? profile.activeTreeId : order[0] ?? null;
  if (!active) {
    const first = createRecord({ species: 'juniper', seed: 20241, name: 'First Juniper' });
    addRecord(first);
    active = first.id;
  }
  openTree(active, routeFromHash() ?? 'studio');
  window.addEventListener('hashchange', () => {
    const r = routeFromHash();
    if (r && r !== getState().route) setState({ route: r });
  });
  window.addEventListener('pagehide', flushSaves);
  window.addEventListener('storage', onStorageEvent);
  // Installed (Home Screen) apps: ask the browser not to evict saves.
  if (matchMedia('(display-mode: standalone)').matches) void requestPersistentStorage();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSaves();
    sound.suspend(document.hidden);
  });
}

function routeFromHash(): Route | null {
  const h = location.hash.replace(/^#\/?/, '');
  return (['studio', 'challenges', 'collection', 'gallery'] as const).find((r) => r === h) ?? null;
}

export function navigate(route: Route): void {
  if (location.hash !== `#/${route}`) history.pushState(null, '', `#/${route}`);
  setState({ route, sheet: null });
}

// ------------------------------------------------------------------ persistence

/**
 * Another tab or window changed a saved tree. Adopt its version unless we
 * have unsaved edits of our own to that tree (then ours wins on next save).
 */
function onStorageEvent(e: StorageEvent): void {
  if (!kv) return;
  if (e.key === KEYS.profile && e.newValue) {
    mergeProgress(e.newValue);
    return;
  }
  const id = treeIdFromKey(e.key);
  if (!id || pending.has(id)) return;
  const s = getState();
  if (e.newValue === null) {
    if (!s.trees[id]) return;
    const trees = { ...s.trees };
    delete trees[id];
    const order = s.order.filter((x) => x !== id);
    setState({ trees, order });
    if (s.activeId === id) {
      toast('This tree was deleted in another window.', 'warn');
      if (order[0]) openTree(order[0], s.route);
      else setState({ activeId: null, studio: null });
    }
    return;
  }
  const rec = readRecord(kv, id);
  if (!rec) return;
  const order = s.order.includes(id) ? s.order : [id, ...s.order];
  setState({ trees: { ...s.trees, [id]: rec }, order });
  if (s.activeId === id && s.studio && !s.studio.dragging) {
    setState({ studio: { ...freshStudio(rec.work, s.studio.tool) } });
    toast('Updated with changes from another window.', 'info');
  }
}

/** Union progress from another tab so neither tab can erase the other's unlocks. */
function mergeProgress(raw: string): void {
  let other: Partial<Profile>;
  try {
    other = JSON.parse(raw) as Partial<Profile>;
  } catch {
    return;
  }
  const p = getState().profile;
  const unlocks = [...new Set([...p.unlocks, ...(Array.isArray(other.unlocks) ? other.unlocks : [])])];
  const claimed = [...new Set([...p.claimed, ...(Array.isArray(other.claimed) ? other.claimed : [])])];
  const best = { ...p.best };
  for (const [k, v] of Object.entries(other.best ?? {})) {
    if (!v || typeof v.score !== 'number') continue;
    const cur = best[k];
    if (!cur || v.score > cur.score) best[k] = { score: v.score, stars: Math.max(v.stars ?? 0, cur?.stars ?? 0) };
  }
  if (unlocks.length === p.unlocks.length && claimed.length === p.claimed.length && JSON.stringify(best) === JSON.stringify(p.best)) return;
  setState({ profile: { ...p, unlocks, claimed, best } });
  persistProfile();
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageIsPersistent(): Promise<boolean | null> {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}

export function exportCollection(): { filename: string; text: string } {
  flushSaves();
  const s = getState();
  const data = buildExport(s.profile, s.order.map((id) => s.trees[id]!).filter(Boolean));
  const date = new Date().toISOString().slice(0, 10);
  return { filename: `bonsai-collection-${date}.json`, text: JSON.stringify(data) };
}

/** Merge a backup into this device. Never overwrites: clashing ids become copies. */
export function importCollection(text: string): void {
  let parsed: ReturnType<typeof parseImport>;
  try {
    parsed = parseImport(text);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Import failed.', 'error');
    return;
  }
  let added = 0;
  for (const t of parsed.trees) {
    const exists = getState().trees[t.id];
    if (exists && JSON.stringify(exists) === JSON.stringify(t)) continue;
    // Also avoid ids held by saves this version can't load (newer or quarantined).
    const clash = !!exists || (!!kv && treeKeyExists(kv, t.id));
    addRecord(clash ? { ...t, id: newId(), name: `${t.name} (imported)` } : t);
    added++;
  }
  updateProfile((p) => {
    const best = { ...p.best };
    for (const [k, v] of Object.entries(parsed.profile.best)) {
      const cur = best[k];
      if (!cur || v.score > cur.score) best[k] = { score: v.score, stars: Math.max(v.stars, cur?.stars ?? 0) };
    }
    return {
      ...p,
      unlocks: [...new Set([...p.unlocks, ...parsed.profile.unlocks])],
      claimed: [...new Set([...p.claimed, ...parsed.profile.claimed])],
      best,
    };
  });
  const skipped = parsed.skipped ? ` ${parsed.skipped} damaged tree${parsed.skipped > 1 ? 's were' : ' was'} skipped.` : '';
  toast(`Imported ${added} tree${added === 1 ? '' : 's'}.${skipped}`, added ? 'success' : 'info');
}

function addRecord(r: TreeRecord): void {
  setState((s) => ({ trees: { ...s.trees, [r.id]: r }, order: [r.id, ...s.order.filter((x) => x !== r.id)] }));
  scheduleSave(r.id, 0);
}

function updateRecord(id: string, patch: (r: TreeRecord) => TreeRecord, save = true): void {
  const s = getState();
  const r = s.trees[id];
  if (!r) return;
  const next = { ...patch(r), updatedAt: Date.now() };
  setState({ trees: { ...s.trees, [id]: next }, order: [id, ...s.order.filter((x) => x !== id)] });
  if (save) scheduleSave(id);
}

function scheduleSave(id: string, delay = SAVE_DELAY): void {
  window.clearTimeout(pending.get(id));
  setState({ saveStatus: 'saving' });
  pending.set(
    id,
    window.setTimeout(() => {
      pending.delete(id);
      writeTree(id);
    }, delay),
  );
}

function writeTree(id: string): void {
  const s = getState();
  const r = s.trees[id];
  if (!r || !kv) return;
  const res = saveTree(kv, r, s.order);
  if (res.ok) setState({ saveStatus: pending.size ? 'saving' : 'saved', saveError: null });
  else {
    setState({ saveStatus: 'error', saveError: res.message });
    toast(res.message, 'error');
  }
}

export function flushSaves(): void {
  for (const [id, h] of pending) {
    window.clearTimeout(h);
    writeTree(id);
  }
  pending.clear();
  persistProfile();
}

function persistProfile(): void {
  if (!kv) return;
  const res = saveProfile(kv, getState().profile);
  if (!res.ok) {
    setState({ saveStatus: 'error', saveError: res.message });
    toast(res.message, 'error');
  }
}

function updateProfile(fn: (p: Profile) => Profile): void {
  setState((s) => ({ profile: fn(s.profile) }));
  persistProfile();
}

export function storeThumbnail(id: string, dataUrl: string): void {
  if (kv) saveThumb(kv, id, dataUrl);
  setState((s) => ({ thumbs: { ...s.thumbs, [id]: dataUrl } }));
}

export const readThumb = (id: string): string | null => getState().thumbs[id] ?? (kv ? loadThumb(kv, id) : null);

// ------------------------------------------------------------------ toasts

export function toast(text: string, tone: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
  const id = toastSeq++;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  window.setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6000 : 3200);
}

let announceSeq = 0;
/** Tell screen-reader users what just happened in the 3D view. */
export function announce(text: string): void {
  // Alternate a zero-width suffix so repeating the same message is still announced.
  announceSeq++;
  setState({ announcement: text + (announceSeq % 2 ? '\u200b' : '') });
}

export const dismissNotice = () => setState({ notice: null });
export const openSheet = (sheet: Sheet) => setState({ sheet });
export const closeSheet = () => setState({ sheet: null });

// ------------------------------------------------------------------ settings

function applySettings(st: Settings): void {
  sound.muted = st.muted;
  sound.volume = st.volume;
  sound.ambient = st.ambient;
  sound.haptics = st.haptics;
}

export function updateSettings(patch: Partial<Settings>): void {
  updateProfile((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const st = getState().profile.settings;
  sound.setMuted(st.muted);
  sound.setVolume(st.volume);
  sound.setAmbient(st.ambient);
  sound.haptics = st.haptics;
}

export const hasUnlock = (key: string | undefined): boolean => !key || getState().profile.unlocks.includes(key);

// ------------------------------------------------------------------ trees

function freshStudio(work: Workpiece, tool: ToolId = 'prune'): StudioState {
  return {
    history: createHistory(work),
    tool,
    selected: null,
    cutT: 0,
    silhouette: false,
    turntable: false,
    lastReport: null,
    dragging: false,
    resisting: false,
    growing: false,
  };
}

export function openTree(id: string, route: Route = 'studio'): void {
  const r = getState().trees[id];
  if (!r) return;
  if (getState().activeId === id && getState().studio) {
    // Already on the bench: keep its undo history and camera.
    setState({ sheet: null });
    navigate(route);
    return;
  }
  const keepTool = getState().studio?.tool;
  setState({ activeId: id, studio: freshStudio(r.work, keepTool === 'grow' || keepTool === 'view' ? keepTool : 'prune'), sheet: null });
  updateProfile((p) => ({ ...p, activeTreeId: id }));
  navigate(route);
  emitFx({ type: 'frame' });
}

export function newTree(species: SpeciesId, preset: SaplingPreset): void {
  const r = createRecord({ species, preset });
  addRecord(r);
  openTree(r.id);
  sound.rustle(0.6);
  toast(`A new ${species === 'maple' ? 'maple' : species} is on your bench.`, 'success');
}

export function renameTree(id: string, name: string): void {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  updateRecord(id, (r) => ({ ...r, name: clean }));
  closeSheet();
}

export function deleteTree(id: string): void {
  const s = getState();
  const order = s.order.filter((x) => x !== id);
  const trees = { ...s.trees };
  delete trees[id];
  window.clearTimeout(pending.get(id));
  pending.delete(id);
  if (kv) deleteStored(kv, id, order);
  setState({ trees, order, sheet: null });
  if (s.activeId === id) {
    const next = order[0];
    if (next) openTree(next, s.route);
    else setState({ activeId: null, studio: null });
  }
  toast('Tree removed from your collection.');
}

export function setStyleOverride(id: string, style: TreeRecord['styleOverride']): void {
  updateRecord(id, (r) => ({ ...r, styleOverride: style }));
}

// ------------------------------------------------------------------ editing core

function studio(): StudioState | null {
  return getState().studio;
}

function setStudio(patch: Partial<StudioState>): void {
  const st = studio();
  if (!st) return;
  setState({ studio: { ...st, ...patch } });
}

/** Record a finished edit as one undo step and persist it. */
export function commit(work: Workpiece, extra: Partial<StudioState> = {}): void {
  const st = studio();
  const id = getState().activeId;
  if (!st || !id) return;
  setStudio({ history: push(st.history, work), ...extra });
  updateRecord(id, (r) => ({ ...r, work }));
}

/**
 * A drag owns the Studio from start to commit. The token lets previews and
 * the final commit detect that the tree or its history changed underneath
 * them (another tree opened, undo, sync from another tab) and back off.
 */
export interface DragToken {
  treeId: string;
  past: number;
}

export function beginDrag(): DragToken | null {
  const s = getState();
  if (!s.studio || !s.activeId) return null;
  setStudio({ dragging: true, resisting: false });
  return { treeId: s.activeId, past: s.studio.history.past.length };
}

export function dragValid(t: DragToken | undefined): boolean {
  if (!t) return true;
  const s = getState();
  return s.activeId === t.treeId && !!s.studio && s.studio.history.past.length === t.past;
}

/** Live preview while dragging: no undo step, no save. */
export function previewWork(work: Workpiece, token?: DragToken): boolean {
  const st = studio();
  if (!st || !dragValid(token)) return false;
  setStudio({ history: replace(st.history, work) });
  return true;
}

/** Finish a drag that started from `base`: exactly one undo step. */
export function commitFrom(base: Workpiece, final: Workpiece, token?: DragToken): void {
  const st = studio();
  const id = getState().activeId;
  if (!st || !id) return;
  if (!dragValid(token)) {
    setStudio({ dragging: false, resisting: false });
    return;
  }
  if (final === base) {
    setStudio({ history: { ...st.history, present: base }, dragging: false, resisting: false });
    return;
  }
  setStudio({
    history: { past: [...st.history.past, base].slice(-100), present: final, future: [] },
    dragging: false,
    resisting: false,
  });
  updateRecord(id, (r) => ({ ...r, work: final }));
}

export function undo(): void {
  const st = studio();
  const id = getState().activeId;
  if (!st || !id || !st.history.past.length || st.dragging) return;
  const h = undoH(st.history);
  setStudio({ history: h, selected: h.present.tree.branches[st.selected ?? ''] ? st.selected : null });
  updateRecord(id, (r) => ({ ...r, work: h.present }));
  sound.tap();
  announce('Undone.');
}

export function redo(): void {
  const st = studio();
  const id = getState().activeId;
  if (!st || !id || !st.history.future.length || st.dragging) return;
  const h = redoH(st.history);
  setStudio({ history: h, selected: h.present.tree.branches[st.selected ?? ''] ? st.selected : null });
  updateRecord(id, (r) => ({ ...r, work: h.present }));
  sound.tap();
  announce('Redone.');
}

export function setTool(tool: ToolId): void {
  const st = studio();
  if (!st) return;
  const keepSel = tool === 'prune' || tool === 'shape' || tool === 'wire';
  setStudio({ tool, selected: keepSel ? st.selected : null, cutT: 0 });
  sound.tap();
}

export function selectBranch(id: BranchId | null, t?: number): void {
  const st = studio();
  if (!st) return;
  if (id && st.selected === id && st.tool === 'prune' && t !== undefined) {
    // A second tap on the selected branch moves the cut point there.
    setCutT(t);
    return;
  }
  setStudio({ selected: id, cutT: 0 });
  const b = id ? st.history.present.tree.branches[id] : undefined;
  if (b) {
    const tree = st.history.present.tree;
    const kids = Object.values(tree.branches).filter((c) => c.parentId === b.id).length;
    announce(`${branchLabel(tree, b)} selected, ${(b.radius * 20).toFixed(1)} centimetres thick, ${kids} offshoots.`);
  } else announce('Selection cleared.');
  if (id) {
    sound.tap();
    sound.haptic(6);
    advanceOnboarding(1);
  }
}

export function selectParent(): void {
  const st = studio();
  if (!st?.selected) return;
  const b = st.history.present.tree.branches[st.selected];
  if (b?.parentId) selectBranch(b.parentId);
}

/** Step through branches in a stable order – a non-gesture way to select. */
export function selectNext(dir: 1 | -1): void {
  const st = studio();
  if (!st) return;
  const tree = st.history.present.tree;
  const ids = Object.keys(tree.branches)
    .filter((id) => tree.branches[id]!.parentId !== null)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (!ids.length) return;
  const i = st.selected ? ids.indexOf(st.selected) : -1;
  const next = ids[(i + dir + ids.length) % ids.length]!;
  selectBranch(next);
}

export function setCutT(t: number): void {
  setStudio({ cutT: Math.max(0, Math.min(0.95, t)) });
}

export function sceneOf(work: Workpiece): SceneInput {
  return { tree: work.tree, layout: computeLayout(work.tree), pot: work.pot, surface: work.surface };
}

// ------------------------------------------------------------------ tools

export function cutSelected(): void {
  const st = studio();
  if (!st?.selected) return;
  const work = st.history.present;
  const preview = previewPrune(work.tree, st.selected, st.cutT);
  const res = prune(work.tree, st.selected, st.cutT);
  if (!res.ok) {
    toast(res.reason, 'warn');
    return;
  }
  emitFx({ type: 'cut', before: sceneOf(work), preview });
  const b = work.tree.branches[st.selected]!;
  sound.snip(Math.min(1, b.radius / 0.08));
  if (preview.foliageFraction > 0.02) window.setTimeout(() => sound.rustle(Math.min(1, preview.foliageFraction * 4)), 90);
  sound.haptic([10, 30, 6]);
  commit({ ...work, tree: res.tree }, { selected: null, cutT: 0 });
  announce(
    preview.shortened
      ? `Branch shortened. ${Math.round(preview.foliageFraction * 100)}% of the foliage removed.`
      : `Cut. ${preview.removed.length} branch${preview.removed.length === 1 ? '' : 'es'} removed, ${Math.round(preview.foliageFraction * 100)}% of the foliage.`,
  );
  advanceOnboarding(2);
  if (preview.foliageFraction > 0.35) toast('A heavy cut – the tree will need time to recover.', 'warn');
}

export function applyWireToSelected(): void {
  const st = studio();
  if (!st?.selected) return;
  const work = st.history.present;
  const res = applyWireOp(work.tree, st.selected, hasUnlock('tool:copper') && copperPreferred);
  if (!res.ok) {
    toast(res.reason, 'warn');
    sound.creak();
    return;
  }
  sound.wire();
  sound.haptic(8);
  announce('Wire applied. The branch will hold any bend you give it.');
  emitFx({ type: 'pulse', id: st.selected });
  commit({ ...work, tree: res.tree });
}

let copperPreferred = true;
export const setCopperPreferred = (v: boolean) => {
  copperPreferred = v;
};
export const getCopperPreferred = () => copperPreferred;

export function removeWireFromSelected(): void {
  const st = studio();
  if (!st?.selected) return;
  const work = st.history.present;
  const res = removeWireOp(work.tree, st.selected);
  if (!res.ok) {
    toast(res.reason, 'warn');
    return;
  }
  sound.unwire();
  commit({ ...work, tree: res.tree });
  announce(res.note ?? 'Wire removed.');
  if (res.note) toast(res.note, res.note.startsWith('Fully') ? 'success' : 'info');
}

export async function grow(days: number): Promise<void> {
  const st = studio();
  const id = getState().activeId;
  const r = id ? getState().trees[id] : null;
  if (!st || !r || !id || st.growing) return;
  const work = st.history.present;
  setStudio({ growing: true });
  sound.growth();
  let result: Awaited<ReturnType<typeof runGrowth>>;
  try {
    result = await runGrowth(work.tree, days, r.care);
  } catch {
    setStudio({ growing: false });
    toast('Growth could not be simulated. Your tree is unchanged.', 'error');
    return;
  }
  const now = studio();
  // The player switched trees or edited meanwhile: don't overwrite their work.
  if (!now || getState().activeId !== id || now.history.present !== work) {
    if (now) setStudio({ growing: false });
    toast('Growth was cancelled because the tree changed.', 'warn');
    return;
  }
  const { tree, report } = result;
  commit({ ...work, tree }, { lastReport: report, growing: false, selected: tree.branches[now.selected ?? ''] ? now.selected : null });
  const bits: string[] = [];
  if (report.newShoots.length) bits.push(`${report.newShoots.length} new shoot${report.newShoots.length > 1 ? 's' : ''}`);
  if (report.woundsClosed) bits.push(`${report.woundsClosed} cut${report.woundsClosed > 1 ? 's' : ''} healed`);
  if (report.wiresSet.length) bits.push(`${report.wiresSet.length} wired branch${report.wiresSet.length > 1 ? 'es' : ''} set`);
  if (report.wireBiting.length) bits.push(`wire biting on ${report.wireBiting.length}`);
  if (report.dieback.length) bits.push(`${report.dieback.length} shaded twig${report.dieback.length > 1 ? 's' : ''} thinning`);
  const summary = bits.length ? bits.join(' · ') : 'The tree rests.';
  toast(summary, report.wireBiting.length ? 'warn' : 'info');
  announce(`${days} days passed. ${summary}`);
}

export function setCare(care: Partial<Care>): void {
  const id = getState().activeId;
  if (!id) return;
  updateRecord(id, (r) => ({ ...r, care: { ...r.care, ...care } }));
  sound.tap();
}

export function setPot(pot: Partial<PotStyle>): void {
  const st = studio();
  if (!st) return;
  const work = st.history.present;
  commit({ ...work, pot: { ...work.pot, ...pot } });
  sound.tap();
}

export function setSurface(surface: Partial<SurfaceStyle>, coalesce = false): void {
  const st = studio();
  if (!st) return;
  const work = st.history.present;
  const next = { ...work, surface: { ...work.surface, ...surface } };
  if (coalesce) previewWork(next);
  else commit(next);
}

export function addStone(kind: StoneKind): void {
  const st = studio();
  if (!st) return;
  const work = st.history.present;
  if (work.surface.stones.length >= MAX_STONES) {
    toast(`At most ${MAX_STONES} stones – restraint is part of the art.`, 'warn');
    return;
  }
  const r = mulberry32(work.tree.nextId * 31 + work.surface.stones.length * 7 + Date.now() % 1000);
  const a = r() * Math.PI * 2;
  const rad = 0.45 + r() * 0.45;
  const stone: Stone = { id: `s${Date.now().toString(36)}${Math.floor(r() * 1000)}`, kind, x: Math.cos(a) * rad, z: Math.sin(a) * rad, scale: 0.4 + r() * 0.6, rot: r() * 6.28 };
  commit({ ...work, surface: { ...work.surface, stones: [...work.surface.stones, stone] } });
  sound.tap();
}

export function removeStone(id: string): void {
  const st = studio();
  if (!st) return;
  const work = st.history.present;
  commit({ ...work, surface: { ...work.surface, stones: work.surface.stones.filter((s) => s.id !== id) } });
}

export function rearrangeStones(): void {
  const st = studio();
  if (!st) return;
  const work = st.history.present;
  const r = mulberry32(Date.now() % 100000);
  const stones = work.surface.stones.map((s) => {
    const a = r() * Math.PI * 2;
    const rad = 0.45 + r() * 0.45;
    return { ...s, x: Math.cos(a) * rad, z: Math.sin(a) * rad, rot: r() * 6.28 };
  });
  commit({ ...work, surface: { ...work.surface, stones } });
}

export function toggleSilhouette(): void {
  const st = studio();
  if (st) setStudio({ silhouette: !st.silhouette });
}

export function toggleTurntable(): void {
  const st = studio();
  if (st) setStudio({ turntable: !st.turntable });
}

// ------------------------------------------------------------------ onboarding

export function advanceOnboarding(reached: number): void {
  const p = getState().profile;
  if (p.onboarding >= 99) return;
  // Steps happen in order; only move forward from the step just before.
  if (reached === p.onboarding + 1 || (reached === 0 && p.onboarding === 0)) {
    const next = reached >= 3 ? 99 : reached;
    updateProfile((pp) => ({ ...pp, onboarding: next }));
    if (next === 99) toast('That’s the craft: cut, turn, look again. Explore the tools below.', 'success');
  }
}

export const skipOnboarding = () => updateProfile((p) => ({ ...p, onboarding: 99 }));

// ------------------------------------------------------------------ challenges

export function challengeRecords(challengeId: string, variantId: string): TreeRecord[] {
  const s = getState();
  return s.order
    .map((id) => s.trees[id]!)
    .filter((r) => r.challenge?.challengeId === challengeId && r.challenge.variantId === variantId);
}

export function startChallenge(challengeId: string, variantId: string): void {
  const def = challengeDef(challengeId);
  const v = variantDef(challengeId, variantId);
  if (!def || !v) return;
  if (!hasUnlock(v.unlock)) {
    toast('Earn more stars to unlock this variant.', 'warn');
    return;
  }
  const r = createRecord({
    species: v.species,
    preset: v.preset,
    seed: v.seed,
    name: `${def.title} · ${v.name}`,
    challenge: { challengeId, variantId, startedAt: Date.now(), submitted: null },
  });
  if (v.startDay !== undefined) r.work = { ...r.work, tree: { ...r.work.tree, day: v.startDay } };
  if (challengeId === 'windswept') r.work = { ...r.work, pot: { shape: 'oval', size: 1, colorId: 'clay' } };
  addRecord(r);
  openTree(r.id);
  toast(def.tagline, 'info');
}

export function submitChallenge(): void {
  const s = getState();
  const r = s.activeId ? s.trees[s.activeId] : null;
  if (!r?.challenge) return;
  const def = challengeDef(r.challenge.challengeId);
  const v = variantDef(r.challenge.challengeId, r.challenge.variantId);
  if (!def || !v) return;
  const result = evaluateChallenge(r, def, v, view.yaw);
  const attempt = { challengeId: def.id, variantId: v.id, score: result.score, stars: result.stars, at: Date.now() };
  updateRecord(r.id, (rec) => ({
    ...rec,
    challenge: rec.challenge ? { ...rec.challenge, submitted: attempt } : null,
    history: [...rec.history, attempt],
  }));
  // Best score per variant and rewards per challenge (never granted twice).
  const claimed = new Set(s.profile.claimed);
  const newRewards = rewardsFor(def, result.stars, claimed);
  const unlocked = newRewards.flatMap((x) => x.unlocks).filter((u) => !s.profile.unlocks.includes(u));
  updateProfile((p) => {
    const prev = p.best[v.id];
    const best = !prev || result.score > prev.score ? { score: result.score, stars: Math.max(result.stars, prev?.stars ?? 0) } : { ...prev, stars: Math.max(prev.stars, result.stars) };
    return {
      ...p,
      best: { ...p.best, [v.id]: best },
      claimed: [...p.claimed, ...newRewards.map((x) => x.key)],
      unlocks: [...new Set([...p.unlocks, ...unlocked])],
    };
  });
  setState({ sheet: { kind: 'challengeResult', treeId: r.id, result, unlocked } });
  if (result.stars > 0) {
    sound.reward(result.stars);
    sound.haptic([12, 40, 12]);
  } else sound.confirm();
}

export function unlockNames(keys: string[]): string[] {
  return keys.map((k) => unlockDef(k)?.name ?? k);
}

export const allChallenges = () => CHALLENGES;

// ------------------------------------------------------------------ portrait

export function openPortrait(treeId: string): void {
  setState({ portraitId: treeId, sheet: null });
}

export function closePortrait(): void {
  setState({ portraitId: null });
}

// ------------------------------------------------------------------ accessible shaping

/**
 * Button/keyboard alternative to dragging handles: swing the selected branch
 * a few degrees up/down/left/right (relative to the current view) or change
 * its curvature. Each nudge is one undo step and follows the same physics.
 */
export function nudgeSelected(kind: 'up' | 'down' | 'left' | 'right' | 'curve+' | 'curve-'): void {
  const st = studio();
  if (!st?.selected) return;
  const work = st.history.present;
  const id = st.selected;
  const b = work.tree.branches[id];
  if (!b) return;
  const layout = computeLayout(work.tree);
  const l = layout.get(id)!;
  let res: ReturnType<typeof setShapeOp>;
  if (kind === 'curve+' || kind === 'curve-') {
    const bend = Math.max(0, b.shape.bend + (kind === 'curve+' ? 0.06 : -0.06));
    res = setShapeOp(work.tree, id, { ...b.shape, bend });
  } else {
    const step = (8 * Math.PI) / 180;
    const yaw = view.yaw;
    const axis: [number, number, number] =
      kind === 'left' || kind === 'right' ? [0, 1, 0] : [Math.cos(yaw), 0, -Math.sin(yaw)];
    const sign = kind === 'up' || kind === 'left' ? -1 : 1;
    const chord = l.frame.t;
    const d = rotateAxis(chord, axis, (kind === 'up' || kind === 'down' ? -sign : sign) * step);
    const target: [number, number, number] = [l.start[0] + d[0] * b.length, l.start[1] + d[1] * b.length, l.start[2] + d[2] * b.length];
    res = aimTipOp(work.tree, layout, id, target);
  }
  if (!res.ok) return;
  if (res.limited) {
    sound.creak();
    toast('The wood resists – that’s as far as it goes.', 'warn');
  } else sound.bendTick();
  const tree = releaseShapeOp(work.tree, res.tree, id);
  if (tree === work.tree) return;
  commit({ ...work, tree });
}

export const emitResetCamera = () => emitFx({ type: 'resetCamera' });
