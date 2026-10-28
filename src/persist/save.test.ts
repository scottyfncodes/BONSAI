import { describe, expect, it } from 'vitest';
import { createRecord } from '../game/model';
import { prune } from '../tree/ops';
import { MemoryKV } from './kv';
import { KEYS, SCHEMA, defaultProfile, deleteTree, loadAll, migrate, saveProfile, saveTree, validateRecord } from './save';

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
