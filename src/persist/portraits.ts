/** Portrait images live in IndexedDB (too large for localStorage). */
export interface Portrait {
  id: string;
  treeId: string;
  treeName: string;
  caption: string;
  background: string;
  createdAt: number;
  blob: Blob;
}

const DB = 'bonsai-studio';
const STORE = 'portraits';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open portrait storage'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error('Portrait storage error'));
      t.onabort = () => reject(t.error ?? new Error('Portrait storage aborted'));
    });
  } finally {
    db.close();
  }
}

export const putPortrait = (p: Portrait) => tx('readwrite', (s) => s.put(p)).then(() => undefined);
export const deletePortrait = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined);
export async function listPortraits(): Promise<Portrait[]> {
  const all = await tx<Portrait[]>('readonly', (s) => s.getAll() as IDBRequest<Portrait[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
