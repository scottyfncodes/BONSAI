/** Minimal key-value storage abstraction so persistence is testable. */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  /** Simulate a full disk after this many characters (for tests). */
  quota = Infinity;
  get(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  set(k: string, v: string) {
    let used = 0;
    for (const [key, val] of this.m) if (key !== k) used += key.length + val.length;
    if (used + k.length + v.length > this.quota) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.m.set(k, v);
  }
  remove(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()];
  }
}

export function browserKV(): KV {
  try {
    const ls = window.localStorage;
    const probe = '__bonsai_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => ls.setItem(k, v),
      remove: (k) => ls.removeItem(k),
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)!).filter(Boolean),
    };
  } catch {
    // Private mode / blocked storage: keep working for this session only.
    return new MemoryKV();
  }
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(e.message));
}
