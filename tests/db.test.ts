import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db, resetDb } from '../src/lib/db.ts';
import type { Pack } from '../src/lib/types.ts';
import { camp, char, item } from './fixtures/records.ts';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

test('campaign delete removes items, unassigns characters', async () => {
  await db.campaigns.put(camp('c1')); await db.characters.put(char('a', 'c1')); await db.items.put(item('i', 'c1'));
  await db.campaigns.delete('c1');
  expect((await db.characters.get('a'))?.campaignId).toBeUndefined();
  expect(await db.items.get('i')).toBeUndefined();
  expect(await db.campaigns.get('c1')).toBeUndefined();
  expect((await db.characters.list()).map((c) => c.id)).toEqual(['a']);
});

test('write failure becomes StorageError', async () => {
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  await expect(db.characters.put(char('a'))).rejects.toThrow(/Could not save/);
});

test('list filters by campaign; put stamps updatedAt', async () => {
  await db.characters.put(char('a', 'c1')); await db.characters.put(char('b', 'c2')); await db.characters.put(char('c'));
  expect((await db.characters.list('c1')).map((c) => c.id)).toEqual(['a']);
  expect(await db.characters.list()).toHaveLength(3);
  expect((await db.characters.get('a'))!.updatedAt).toBeGreaterThan(0);
  await db.items.put(item('i', 'c1')); await db.items.put(item('j', 'c2'));
  expect((await db.items.list('c2')).map((i) => i.id)).toEqual(['j']);
});

test('packs: meta counts per kind, delete removes both', async () => {
  const spell = (id: string) => ({ id, name: id, source: 'X', text: [], kind: 'spell' as const, level: 1, school: 'evocation', castingTime: '1 action', range: 'self', components: {}, duration: 'instant', concentration: false, ritual: false, classes: [] });
  const p: Pack = { id: 'p1', name: 'Book', source: 'X', importedAt: 5, hash: 'h', entities: [spell('s1'), spell('s2'), item('i', 'c')], patches: [] };
  await db.packs.put(p);
  expect(await db.packs.listMeta()).toEqual([{ id: 'p1', name: 'Book', source: 'X', importedAt: 5, hash: 'h', counts: { spell: 2, item: 1 } }]);
  expect((await db.packs.get('p1'))!.entities).toHaveLength(3);
  await db.packs.delete('p1');
  expect(await db.packs.get('p1')).toBeUndefined();
  expect(await db.packs.listMeta()).toEqual([]);
});

test('blobs hash by SHA-256 and round-trip; raw5e and meta store values', async () => {
  const hash = await db.blobs.put(new Blob(['abc'], { type: 'text/plain' }));
  expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const b = (await db.blobs.get(hash))!;
  expect([b.type, await b.text()]).toEqual(['text/plain', 'abc']);
  expect(await db.blobs.get('nope')).toBeUndefined();

  await db.raw5e.putMany([['k1', { a: 1 }], ['k2', 'two']]);
  expect(await db.raw5e.getMany(['k2', 'missing', 'k1'])).toEqual(['two', undefined, { a: 1 }]);

  expect(await db.meta.get('x')).toBeUndefined();
  await db.meta.set('x', 42);
  expect(await db.meta.get<number>('x')).toBe(42);
});
