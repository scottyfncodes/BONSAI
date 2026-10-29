import { describe, expect, it } from 'vitest';
import { createRecord } from '../game/model';
import { prune } from '../tree/ops';
import { MemoryKV } from './kv';
import {
  EXPORT_FORMAT,
  KEYS,
  SCHEMA,
  buildExport,
  defaultProfile,
  deleteTree,
  loadAll,
  migrate,
  parseImport,
  readRecord,
  saveProfile,
  saveTree,
  treeIdFromKey,
  treeKeyExists,
  validateRecord,
} from './save';

const rec = (seed = 1) => createRecord({ species: 'juniper', seed, now: 1000 });

describe('save / load', () => {
  it('round-trips trees and profile exactly', () => {
    const kv = new MemoryKV();
    const a = rec(1);
    const b = rec(2);
    expect(saveTree(kv, a, [a.id]).ok).toBe(true);
    expect(saveTree(kv, b, [a.id, b.id]).ok).toBe(true);
    const p = { ...defaultProfile(5), unlocks: ['pot:drum'], activeTreeId: b.id };
    saveProfile(kv, p);
    const out = loadAll(kv);
    expect(out.trees.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(out.trees.find((t) => t.id === a.id)).toEqual(a);
    expect(out.profile.unlocks).toEqual(['pot:drum']);
    expect(out.profile.activeTreeId).toBe(b.id);
    expect(out.recovered).toEqual([]);
    expect(out.lost).toEqual([]);
  });

  it('keeps edits across a save/reload cycle', () => {
    const kv = new MemoryKV();
    const r = rec(3);
    const target = Object.values(r.work.tree.branches).find((b) => b.kind === 'branch')!.id;
    const cut = prune(r.work.tree, target, 0);
    if (!cut.ok) throw new Error(cut.reason);
    const edited = { ...r, work: { ...r.work, tree: cut.tree } };
    saveTree(kv, edited, [r.id]);
    const loaded = loadAll(kv).trees[0]!;
    expect(loaded.work.tree.branches[target]).toBeUndefined();
    expect(Object.keys(loaded.work.tree.branches).length).toBe(Object.keys(cut.tree.branches).length);
  });

  it('recovers from a corrupted main copy using the backup', () => {
    const kv = new MemoryKV();
    const r = rec(4);
    saveTree(kv, r, [r.id]);
    saveTree(kv, { ...r, name: 'Second save' }, [r.id]);
    kv.set(KEYS.tree(r.id), '{"schema":1,"record":{"broken":tru');
    const out = loadAll(kv);
    expect(out.recovered).toEqual([r.id]);
    expect(out.trees[0]!.name).toBe(r.name);
  });

  it('quarantines unrecoverable data instead of deleting it', () => {
    const kv = new MemoryKV();
    kv.set(KEYS.tree('tbad'), 'not json at all');
    const out = loadAll(kv);
    expect(out.lost).toEqual(['tbad']);
    expect(kv.get(KEYS.quarantine('tbad'))).toBe('not json at all');
    expect(out.trees).toEqual([]);
  });

  it('refuses saves from a newer version and leaves them untouched', () => {
    const kv = new MemoryKV();
    const raw = JSON.stringify({ schema: SCHEMA + 1, record: { id: 'tnew' } });
    kv.set(KEYS.tree('tnew'), raw);
    const out = loadAll(kv);
    expect(out.newer).toEqual(['tnew']);
    expect(kv.get(KEYS.tree('tnew'))).toBe(raw);
    expect(migrate({ schema: SCHEMA + 1, record: {} }).status).toBe('newer');
    expect(migrate('garbage').status).toBe('invalid');
  });

  it('validates records', () => {
    expect(validateRecord(rec(5))).toEqual([]);
    const bad = rec(6) as unknown as Record<string, unknown>;
    bad.work = { ...(bad.work as object), pot: { shape: 'teacup', size: 1, colorId: 'clay' } };
    expect(validateRecord(bad)).toContain('pot');
  });

  it('reports a full disk instead of throwing', () => {
    const kv = new MemoryKV();
    kv.quota = 500;
    const r = rec(7);
    const res = saveTree(kv, r, [r.id]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('quota');
  });

  it('deletes a tree completely', () => {
    const kv = new MemoryKV();
    const r = rec(8);
    saveTree(kv, r, [r.id]);
    saveTree(kv, r, [r.id]);
    deleteTree(kv, r.id, []);
    expect(loadAll(kv).trees).toEqual([]);
  });

  it('survives a missing index by discovering trees', () => {
    const kv = new MemoryKV();
    const r = rec(9);
    saveTree(kv, r, [r.id]);
    kv.remove(KEYS.index);
    expect(loadAll(kv).trees.map((t) => t.id)).toEqual([r.id]);
  });
});

describe('backup export / import', () => {
  it('round-trips a collection and keeps progress', () => {
    const a = rec(20);
    const b = rec(21);
    const prof = { ...defaultProfile(1), unlocks: ['pot:drum'], claimed: ['less:1'], best: { 'less-maple': { score: 71, stars: 2 } } };
    const text = JSON.stringify(buildExport(prof, [a, b]));
    const out = parseImport(text);
    expect(out.trees).toEqual([a, b]);
    expect(out.skipped).toBe(0);
    expect(out.profile.unlocks).toEqual(['pot:drum']);
    expect(out.profile.best['less-maple']!.score).toBe(71);
  });

  it('skips damaged trees instead of failing the whole import', () => {
    const a = rec(22);
    const data = buildExport(defaultProfile(1), [a]) as unknown as { trees: unknown[] };
    data.trees.push({ id: 'broken' });
    const out = parseImport(JSON.stringify(data));
    expect(out.trees.length).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it('rejects files that are not backups, or from a newer version', () => {
    expect(() => parseImport('nope')).toThrow(/JSON/);
    expect(() => parseImport('{"format":"other","trees":[]}')).toThrow(/BONSAI/);
    expect(() => parseImport(JSON.stringify({ format: EXPORT_FORMAT, schema: SCHEMA + 1, trees: [] }))).toThrow(/newer/);
  });
});

describe('recovery edge cases', () => {
  it('quarantines both copies when neither can be read', () => {
    const kv = new MemoryKV();
    kv.set(KEYS.tree('tx'), 'bad main');
    kv.set(KEYS.bak('tx'), 'bad backup');
    expect(loadAll(kv).lost).toEqual(['tx']);
    expect(kv.get(KEYS.quarantine('tx'))).toBe('bad main');
    expect(kv.get(`${KEYS.quarantine('tx')}.bak`)).toBe('bad backup');
    expect(treeKeyExists(kv, 'tx')).toBe(true);
  });

  it('frees thumbnails so progress can still be saved on a full disk', () => {
    const kv = new MemoryKV();
    kv.set(KEYS.thumb('t1'), 'x'.repeat(4000));
    kv.quota = 4200;
    const res = saveProfile(kv, { ...defaultProfile(1), unlocks: Array.from({ length: 40 }, (_, i) => `u${i}`) });
    expect(res.ok).toBe(true);
    expect(kv.get(KEYS.thumb('t1'))).toBeNull();
  });

  it('finds trees by storage key', () => {
    expect(treeIdFromKey(KEYS.tree('abc'))).toBe('abc');
    expect(treeIdFromKey(KEYS.bak('abc'))).toBeNull();
    expect(treeIdFromKey(KEYS.profile)).toBeNull();
    const kv = new MemoryKV();
    const r = rec(23);
    saveTree(kv, r, [r.id]);
    expect(readRecord(kv, r.id)).toEqual(r);
  });
});
