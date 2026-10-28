import { useSyncExternalStore } from 'react';
import type { ChallengeResult } from '../game/challenges';
import type { TreeRecord, Workpiece } from '../game/model';
import type { Profile } from '../persist/save';
import type { GrowthReport } from '../tree/growth';
import type { History } from '../tree/history';
import type { BranchId } from '../tree/types';

export type Route = 'studio' | 'challenges' | 'collection' | 'gallery';
export type ToolId = 'prune' | 'shape' | 'wire' | 'grow' | 'pot' | 'surface' | 'view';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

export interface StudioState {
  history: History<Workpiece>;
  tool: ToolId;
  selected: BranchId | null;
  /** Where the shears close along the selected branch (0 = remove at base). */
  cutT: number;
  silhouette: boolean;
  turntable: boolean;
  lastReport: GrowthReport | null;
  /** True while a handle is being dragged (live preview, no undo step yet). */
  dragging: boolean;
  /** Set when a bend hit the wood's limit during the current drag. */
  resisting: boolean;
}

export type Sheet =
  | { kind: 'newTree' }
  | { kind: 'treeOptions'; treeId: string }
  | { kind: 'rename'; treeId: string }
  | { kind: 'confirmDelete'; treeId: string }
  | { kind: 'challengeIntro'; challengeId: string; variantId: string }
  | { kind: 'challengeResult'; treeId: string; result: ChallengeResult; unlocked: string[] }
  | { kind: 'settings' }
  | null;

export interface AppState {
  loaded: boolean;
  route: Route;
  profile: Profile;
  trees: Record<string, TreeRecord>;
  /** Tree ids, most recently edited first. */
  order: string[];
  activeId: string | null;
  studio: StudioState | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  toasts: Toast[];
  notice: string | null;
  sheet: Sheet;
  /** Tree shown in portrait mode (full-screen presentation), if any. */
  portraitId: string | null;
  webgl: 'ok' | 'unavailable' | 'lost';
  /** Collection thumbnails (data URLs), keyed by tree id. */
  thumbs: Record<string, string>;
  /** Bumped whenever portraits are added or removed. */
  galleryVersion: number;
}

let state: AppState = {
  loaded: false,
  route: 'studio',
  profile: {
    schema: 1,
    unlocks: [],
    claimed: [],
    best: {},
    activeTreeId: null,
    settings: { muted: false, volume: 0.8, ambient: true, haptics: true },
    onboarding: 0,
    createdAt: 0,
  },
  trees: {},
  order: [],
  activeId: null,
  studio: null,
  saveStatus: 'idle',
  saveError: null,
  toasts: [],
  notice: null,
  sheet: null,
  portraitId: null,
  webgl: 'ok',
  thumbs: {},
  galleryVersion: 0,
};

const listeners = new Set<() => void>();

export const getState = (): AppState => state;

export function setState(update: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const patch = typeof update === 'function' ? update(state) : update;
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

/** Convenience: the work currently shown in the Studio. */
export const presentWork = (s: AppState): Workpiece | null => s.studio?.history.present ?? null;
export const activeRecord = (s: AppState): TreeRecord | null => (s.activeId ? (s.trees[s.activeId] ?? null) : null);
