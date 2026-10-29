/// <reference lib="webworker" />
import { advance } from './growth';
import type { Care, TreeState } from './types';

/** Runs the growth simulation off the main thread so time-advance never freezes the UI. */
self.onmessage = (e: MessageEvent<{ id: number; tree: TreeState; days: number; care: Care }>) => {
  const { id, tree, days, care } = e.data;
  try {
    const result = advance(tree, days, care);
    self.postMessage({ id, ok: true, ...result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
