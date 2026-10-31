import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { importRecord } from '../src/lib/backup.ts';
import { strip2024, stripLoot } from '../src/lib/character/strip2024.ts';
import { db, resetDb } from '../src/lib/db.ts';
import { makeEntry } from '../src/lib/items/inventory.ts';
import { exportCharacterPdf } from '../src/lib/pdf/exportPdf.ts';
import { importPdf } from '../src/lib/pdf/importPdf.ts';
import { computeSheet } from '../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';
import type { Campaign, Character, Entity, ItemDef } from '../src/lib/types.ts';
import { camp, char, importBackup } from './fixtures/records.ts';

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
