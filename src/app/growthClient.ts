import { type GrowthReport, advance } from '../tree/growth';
import type { Care, TreeState } from '../tree/types';

type Result = { tree: TreeState; report: GrowthReport };

let worker: Worker | null = null;
let failed = false;
let seq = 0;
const waiting = new Map<number, { resolve: (r: Result) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../tree/growth.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; tree?: TreeState; report?: GrowthReport; error?: string }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok) w.resolve({ tree: e.data.tree!, report: e.data.report! });
      else w.reject(new Error(e.data.error ?? 'Growth failed'));
    };
    worker.onerror = () => {
      // Fall back to the main thread for this and future runs.
      failed = true;
      worker?.terminate();
      worker = null;
      for (const [, w] of waiting) w.reject(new Error('worker-failed'));
      waiting.clear();
    };
    return worker;
  } catch {
    failed = true;
    return null;
  }
}

/** Advance a tree, off the main thread when possible. Deterministic either way. */
export function runGrowth(tree: TreeState, days: number, care: Care): Promise<Result> {
  const w = getWorker();
  if (!w) return Promise.resolve(advance(tree, days, care));
  const id = ++seq;
  return new Promise<Result>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, tree, days, care });
  }).catch((e: Error) => {
    if (e.message === 'worker-failed') return advance(tree, days, care);
    throw e;
  });
}
