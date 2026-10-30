import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { exportBackup, exportRecord, importBackup, importRecord } from '../src/lib/backup.ts';
import { db, resetDb } from '../src/lib/db.ts';
import type { Pack } from '../src/lib/types.ts';
import { camp, char, item } from './fixtures/records.ts';

beforeEach(resetDb);

test('backup round-trip incl. blobs', async () => {
  const hash = await db.blobs.put(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
  await db.campaigns.put(camp('c1')); await db.characters.put(char('a', 'c1'));
  const file = await exportBackup({ includePacks: true });
  await resetDb();
  expect(await importBackup(file)).toEqual({ campaigns: 1, characters: 1, items: 0, packs: 0 });
  expect(new Uint8Array(await (await db.blobs.get(hash))!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

test('rejects foreign files', async () => {
  await expect(importBackup(new Blob(['{"x":1}']))).rejects.toThrow('Not a dnd-app backup file');
  await expect(importRecord(new Blob(['{"x":1}']))).rejects.toThrow('Not a dnd-app character or item file');
  await expect(importBackup(new Blob(['not json']))).rejects.toThrow('Not a dnd-app backup file');
});

test('importRecord never overwrites', async () => {
  await db.characters.put(char('a'));
  const r = await importRecord(exportRecord('character', char('a')));
  expect(r.data.id).not.toBe('a');
  const fresh = await importRecord(exportRecord('item', item('i', 'c1')));
  expect([fresh.kind, fresh.data.id]).toEqual(['item', 'i']);
});

test('campaign export is scoped; packs only when asked; stamps lastBackupAt', async () => {
  const pack: Pack = { id: 'p1', name: 'Book', source: 'X', importedAt: 1, hash: 'h', entities: [], patches: [] };
  await db.packs.put(pack); await db.packs.put({ ...pack, id: 'p2' });
  await db.campaigns.put({ ...camp('c1'), enabledPacks: ['p1'] }); await db.campaigns.put(camp('c2'));
  await db.characters.put(char('a', 'c1')); await db.characters.put(char('b', 'c2')); await db.characters.put(char('loose'));
  await db.items.put(item('i1', 'c1')); await db.items.put(item('i2', 'c2'));

  const json = async (o: Parameters<typeof exportBackup>[0]) => JSON.parse(await (await exportBackup(o)).text());
  const one = await json({ campaignId: 'c1', includePacks: true });
  expect(one.format).toBe('dnd-app-backup');
  expect(one.version).toBe(1);
  expect(one.campaigns.map((c: { id: string }) => c.id)).toEqual(['c1']);
  expect(one.characters.map((c: { id: string }) => c.id)).toEqual(['a']);
  expect(one.items.map((c: { id: string }) => c.id)).toEqual(['i1']);
  expect(one.packs.map((p: { id: string }) => p.id)).toEqual(['p1']);
  expect(typeof await db.meta.get('lastBackupAt')).toBe('number');

  const all = await json({ includePacks: false });
  expect([all.campaigns.length, all.characters.length, all.items.length, all.packs.length]).toEqual([2, 3, 2, 0]);
  expect((await json({ includePacks: true })).packs).toHaveLength(2);
});

test('importBackup upserts by id and keeps timestamps', async () => {
  await db.campaigns.put(camp('c1')); await db.characters.put({ ...char('a', 'c1'), name: 'Old' });
  const file = await exportBackup({ includePacks: false });
  const stamp = (await db.characters.get('a'))!.updatedAt;
  await db.characters.put({ ...char('a', 'c1'), name: 'Newer' });
  await db.characters.put(char('extra'));
  await importBackup(file);
  const a = (await db.characters.get('a'))!;
  expect([a.name, a.updatedAt]).toEqual(['Old', stamp]);
  expect(await db.characters.get('extra')).toBeDefined();
});
