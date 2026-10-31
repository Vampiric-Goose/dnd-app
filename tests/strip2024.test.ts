import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { importRecord } from '../src/lib/backup.ts';
import { strip2024, stripLoot } from '../src/lib/character/strip2024.ts';
import { db, resetDb } from '../src/lib/db.ts';
import { customize, importedItem } from '../src/lib/items/homebrew.ts';
import { makeEntry } from '../src/lib/items/inventory.ts';
import { exportCharacterPdf } from '../src/lib/pdf/exportPdf.ts';
import { importPdf } from '../src/lib/pdf/importPdf.ts';
import { computeSheet } from '../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';
import type { Campaign, Character, Entity, ItemDef } from '../src/lib/types.ts';
import { camp, char, importBackup, item } from './fixtures/records.ts';

beforeEach(resetDb);

const feat = { kind: 'feat', id: 'feat:x@AU', name: 'X', source: 'PHB', text: [] } as unknown as Entity; // the id alone gives it away
const cls = { kind: 'class', id: 'class:fighter@XPHB', name: 'Fighter', source: 'XPHB', text: [] } as unknown as Entity;
const ok = { kind: 'feat', id: 'feat:alert@PHB', name: 'Alert', source: 'PHB', text: [] } as unknown as Entity;
const xItem: ItemDef = { kind: 'item', id: 'item:longsword@XPHB', name: 'Longsword', source: 'XPHB', text: [], type: 'weapon', magic: false };
const sneaky: ItemDef = { ...xItem, id: 'item:dagger@XPHB', name: 'Dagger', source: 'PHB' }; // only the id suffix
const fine: ItemDef = { ...xItem, id: 'item:longsword@PHB', name: 'Longsword', source: 'PHB' };

const tainted = (): Character => ({
  ...char('a'),
  build: { ...char('a').build, levels: [{ classId: cls.id }] },
  embedded: { [feat.id]: feat, [cls.id]: cls, [ok.id]: ok, 'class:rogue@XPHB': { ...ok, id: 'class:rogue@PHB' } },
  inventory: [makeEntry(xItem), makeEntry(sneaky), makeEntry(fine)],
});
const clean = (c: Character) => {
  expect(Object.keys(c.embedded)).toEqual([ok.id]);
  expect(c.inventory.map((e) => e.item.id)).toEqual([fine.id]);
  expect(c.build.levels).toEqual([{ classId: cls.id }]); // the reference stays: the sheet reports it as missing
};
const loot = (): Campaign => ({ ...camp('c1'), loot: [makeEntry(xItem), makeEntry(fine)] });

test('strip2024 drops embedded 2024 entities and 2024 inventory items, and returns the same object when clean', () => {
  clean(strip2024(tainted()));
  const c = char('b');
  expect(strip2024(c)).toBe(c);
  expect(stripLoot(loot()).loot.map((e) => e.item.id)).toEqual([fine.id]);
  const k = camp('c2');
  expect(stripLoot(k)).toBe(k);
  expect(strip2024({} as Character)).toEqual({}); // a damaged record passes through for the shape check to report
});

test('a character carrying 2024 content round-trips through importRecord without it', async () => {
  const file = new Blob([JSON.stringify({ format: 'dnd-app-character', version: 1, data: tainted() })]);
  const r = await importRecord(file);
  clean(r.data as Character);
});

test('db strips 2024 content on read and on every write', async () => {
  await db.characters.put(tainted());
  clean((await db.characters.get('a'))!);
  await db.saveTogether({ characters: [{ ...tainted(), id: 'b' }], campaign: loot() });
  clean((await db.characters.get('b'))!);
  expect((await db.campaigns.get('c1'))!.loot.map((e) => e.item.id)).toEqual([fine.id]);
  await db.restore({ campaigns: [{ ...loot(), id: 'c2' }], characters: [{ ...tainted(), id: 'c' }], items: [], packs: [], blobs: [] });
  clean((await db.characters.get('c'))!);
  expect((await db.campaigns.list()).every((k) => k.loot.every((e) => e.item.id === fine.id))).toBe(true);
  await db.campaigns.put({ ...loot(), id: 'c3' });
  expect((await db.campaigns.get('c3'))!.loot).toHaveLength(1);
});

test('db reads strip a record stored before the rule (written around the db)', async () => {
  await db.characters.put(char('z'));
  const { openDB } = await import('idb');
  const raw = await openDB('dnd-app');
  await raw.put('characters', { ...tainted(), id: 'z' });
  await raw.put('campaigns', loot());
  raw.close();
  clean((await db.characters.get('z'))!);
  clean((await db.characters.list()).find((c) => c.id === 'z')!);
  expect((await db.campaigns.get('c1'))!.loot).toHaveLength(1);
  expect((await db.campaigns.list())[0].loot).toHaveLength(1);
});

test('backup import never stores 2024 content', async () => {
  const file = new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, campaigns: [loot()], characters: [tainted()] })]);
  await importBackup(file);
  clean((await db.characters.get('a'))!);
});

test('a PDF whose embedded character carries 2024 content imports without it', async () => {
  const c = tainted();
  const bytes = await exportCharacterPdf(c, computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'dm' }));
  const r = await importPdf(bytes);
  clean(r.data as Character);
});

// ---- R60: items too, including a customized copy that remembers a 2024 base ----

const based: ItemDef = { ...fine, id: 'item:homebrew-1@HOMEBREW', name: 'My Sword', source: 'Homebrew', baseItemId: 'item:longsword@XPHB' };

test('R60/1: an inventory or loot entry whose item has a 2024 baseItemId is stripped', () => {
  const c = strip2024({ ...char('a'), inventory: [makeEntry(based), makeEntry(fine)] });
  expect(c.inventory.map((e) => e.item.id)).toEqual([fine.id]);
  expect(stripLoot({ ...camp('c1'), loot: [makeEntry(based), makeEntry(fine)] }).loot.map((e) => e.item.id)).toEqual([fine.id]);
});

test('R60/2: an item file from the 2024 rules is refused (source, id suffix or baseItemId); customize refuses a 2024 item', () => {
  const file = { name: 'Sword', type: 'weapon', text: [] };
  expect(() => importedItem({ ...file, source: 'XPHB' }, 'c1')).toThrow('This item is from the 2024 rules');
  expect(() => importedItem({ ...file, id: 'item:sword@XDMG' }, 'c1')).toThrow('This item is from the 2024 rules');
  expect(() => importedItem({ ...file, baseItemId: 'item:longsword@XPHB' }, 'c1')).toThrow('This item is from the 2024 rules');
  expect(importedItem({ ...file, source: 'PHB', baseItemId: 'item:longsword@PHB' }, 'c1').item.name).toBe('Sword'); // control
  expect(() => customize(xItem, 'c1')).toThrow('This item is from the 2024 rules');
  expect(() => customize(based, 'c1')).toThrow('This item is from the 2024 rules');
});

test('R60/2: a backup holding a 2024 item stores nothing for it and says so', async () => {
  const items = [{ ...item('ok', 'c1') }, { ...item('item:x@XPHB', 'c1') }, { ...item('b', 'c1'), baseItemId: 'item:longsword@XPHB' }];
  const r = await importBackup(new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, campaigns: [camp('c1')], items })]));
  expect(r).toMatchObject({ items: 1, skippedItems: ['item:x@XPHB', 'b'] });
  expect((await db.items.list('c1')).map((i) => i.id)).toEqual(['ok']);
  await db.restore({ campaigns: [], characters: [], packs: [], blobs: [], items: [{ ...item('item:y@XPHB', 'c1') }] }); // restore refuses them too
  const { openDB } = await import('idb');
  const raw = await openDB('dnd-app');
  expect(await raw.get('items', 'item:y@XPHB')).toBeUndefined();
  raw.close();
});

test('R60/2: db.items.list and get hide a stored 2024 record (hidden, not deleted)', async () => {
  await db.items.put(item('ok', 'c1'));
  const { openDB } = await import('idb');
  const raw = await openDB('dnd-app');
  await raw.put('items', item('item:z@XPHB', 'c1'));
  await raw.put('items', { ...item('w', 'c1'), baseItemId: 'item:longsword@XPHB' });
  expect((await db.items.list('c1')).map((i) => i.id)).toEqual(['ok']);
  expect(await db.items.get('item:z@XPHB')).toBeUndefined();
  expect(await db.items.get('w')).toBeUndefined();
  expect(await raw.get('items', 'item:z@XPHB')).toBeDefined(); // still stored
  raw.close();
});
