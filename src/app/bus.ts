import type { SceneInput } from '../render/stage';
import type { PrunePreview } from '../tree/ops';
import type { BranchId } from '../tree/types';

/** One-shot visual effects requested by actions, consumed by the viewport. */
export type FxEvent =
  | { type: 'cut'; before: SceneInput; preview: PrunePreview }
  | { type: 'pulse'; id: BranchId }
  | { type: 'resetCamera' }
  | { type: 'frame' }
  | { type: 'orbit'; yaw: number; pitch: number }
  | { type: 'zoom'; factor: number };

const fxListeners = new Set<(e: FxEvent) => void>();
export const onFx = (l: (e: FxEvent) => void) => {
  fxListeners.add(l);
  return () => {
    fxListeners.delete(l);
  };
};
export const emitFx = (e: FxEvent) => {
  for (const l of fxListeners) l(e);
};

/** Live camera info shared outside React (scoring uses the yaw as "front"). */
export const view = {
  yaw: 0.35,
  listeners: new Set<() => void>(),
  setYaw(y: number) {
    if (Math.abs(y - this.yaw) < 1e-4) return;
    this.yaw = y;
    for (const l of this.listeners) l();
  },
  onChange(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  },
};
