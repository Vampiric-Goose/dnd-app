import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { exportBackup, exportRecord, importBackup, importRecord, keepBoth } from '../src/lib/backup.ts';
import { db, resetDb } from '../src/lib/db.ts';
import type { Pack } from '../src/lib/types.ts';
import { mkChar } from './fixtures/content.ts';
import { camp, char, item } from './fixtures/records.ts';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

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

const backup = (o: object) => new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, ...o })]);

test('damaged backups are rejected with a readable message and write nothing', async () => {
  const good = { campaigns: [camp('c1')], characters: [char('a', 'c1')] };
  const cases: [object, string][] = [
    [{ ...good, characters: [{ id: 'x', state: {}, inventory: [] }] }, 'Backup file is damaged: characters[0] has no build'],
    [{ ...good, characters: [char('a'), 'nope'] }, 'Backup file is damaged: characters[1] is not an object'],
    [{ ...good, campaigns: [{ ...camp('c2'), id: 7 }] }, 'Backup file is damaged: campaigns[0] has no id'],
    [{ ...good, campaigns: [{ id: 'c2', settings: {}, loot: [] }] }, 'Backup file is damaged: campaigns[0] has no enabledPacks list'],
    [{ ...good, items: [{ ...item('i', 'c1'), kind: 'spell' }] }, 'Backup file is damaged: items[0] is not an item'],
    [{ ...good, packs: [{ id: 'p', entities: [] }] }, 'Backup file is damaged: packs[0] has no patches list'],
    [{ ...good, items: {} }, 'Backup file is damaged: items is not a list'],
  ];
  for (const [bad, message] of cases) await expect(importBackup(backup(bad))).rejects.toThrow(message);
  expect(await db.campaigns.list()).toEqual([]);
  expect(await db.characters.list()).toEqual([]);
  expect(await importBackup(backup(good))).toEqual({ campaigns: 1, characters: 1, items: 0, packs: 0 }); // control
});

test('corrupt blobs are rejected', async () => {
  const abc = { hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', type: 'text/plain', base64: 'YWJj' };
  for (const [bad, message] of [
    [{ ...abc, base64: '***' }, 'Backup file is damaged: blobs[0] is not valid base64'],
    [{ ...abc, base64: 'YWJk' }, 'Backup file is damaged: blobs[0] does not match its hash'],
    [{ ...abc, type: undefined }, 'Backup file is damaged: blobs[0] is incomplete'],
  ] as const) await expect(importBackup(backup({ blobs: [bad] }))).rejects.toThrow(message);
  expect(await db.blobs.all()).toEqual([]);
  await importBackup(backup({ blobs: [abc] })); // control
  expect(await (await db.blobs.get(abc.hash))!.text()).toBe('abc');
});

test('future backup versions and unknown campaigns are refused', async () => {
  await expect(importBackup(new Blob(['{"format":"dnd-app-backup","version":2}']))).rejects.toThrow('Unsupported backup version 2');
  await expect(exportBackup({ campaignId: 'nope', includePacks: false })).rejects.toThrow('Campaign not found');
});

test('a failure to record lastBackupAt warns but still returns the backup', async () => {
  vi.spyOn(db.meta, 'set').mockRejectedValue(new Error('disk full'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const file = await exportBackup({ includePacks: false });
  expect(JSON.parse(await file.text()).format).toBe('dnd-app-backup');
  expect(warn).toHaveBeenCalledWith('Could not record backup time', expect.any(Error));
});

test('damaged record files are rejected', async () => {
  const rec = (format: string, data: unknown) => new Blob([JSON.stringify({ format, version: 1, data })]);
  const { build: _build, ...noBuild } = char('a');
  for (const [file, message] of [
    [rec('dnd-app-character', noBuild), 'Record file is damaged: character has no build'],
    [rec('dnd-app-character', { ...char('a'), id: undefined }), 'Record file is damaged: character has no id'],
    [rec('dnd-app-character', null), 'Record file is damaged: character is not an object'],
    [rec('dnd-app-item', char('a')), 'Record file is damaged: item is not an item'],
  ] as const) await expect(importRecord(file)).rejects.toThrow(message);
});

test('importRecord flags a taken id (R49) and writes nothing; keepBoth gives a fresh id', async () => {
  await db.characters.put({ ...char('a'), name: 'Old' });
  const r = await importRecord(exportRecord('character', { ...char('a'), name: 'New' }));
  expect([r.data.id, r.taken]).toEqual(['a', true]);
  expect((await db.characters.get('a'))?.name).toBe('Old');
  const copy = keepBoth(r.data);
  expect([copy.id === 'a', copy.name]).toEqual([false, 'New']);
  const fresh = await importRecord(exportRecord('item', item('i', 'c1')));
  expect([fresh.kind, fresh.data.id, fresh.taken]).toEqual(['item', 'i', false]);
});

test('campaign export is scoped; packs only when asked; only a full export stamps lastBackupAt', async () => {
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
  expect(await db.meta.get('lastBackupAt')).toBeUndefined(); // a campaign export is not a full backup

  const all = await json({ includePacks: false });
  expect([all.campaigns.length, all.characters.length, all.items.length, all.packs.length]).toEqual([2, 3, 2, 0]);
  expect((await json({ includePacks: true })).packs).toHaveLength(2);
  expect(typeof await db.meta.get('lastBackupAt')).toBe('number');
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

test('a Player-view character file is the player-safe copy and says so (R51)', async () => {
  const c = { ...mkChar({ race: 'dwarf', base: {}, levels: ['fighter'], inventory: [['potion-of-poison', false, false, { name: 'Cloudy red potion', hidden: [], revealed: [] }]] }), id: 'p1' };
  const text = await exportRecord('character', c, 'player').text();
  expect(text).not.toContain('Potion of Poison');
  expect(text).not.toContain('"view"');
  const r = await importRecord(exportRecord('character', c, 'player'));
  expect([r.kind, r.playerView]).toEqual(['character', true]);
  expect((await importRecord(exportRecord('character', c))).playerView).toBe(false);
  expect(await exportRecord('character', c).text()).toContain('Potion of Poison');
});
