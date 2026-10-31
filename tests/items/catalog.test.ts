import { expect, test } from 'vitest';
import { catalogRows, filterCatalog } from '../../src/lib/items/catalog.ts';
import { customize, importedItem } from '../../src/lib/items/homebrew.ts';
import type { ItemDef, StoredItem } from '../../src/lib/types.ts';

const item = (name: string, extra: Partial<ItemDef> = {}): ItemDef => ({ id: `item:${name.toLowerCase().replace(/\W+/g, '-')}@SRD`, kind: 'item', name, source: 'SRD', text: [], type: 'gear', magic: false, ...extra });

const longsword = item('Longsword', { type: 'weapon', weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', properties: [] } });
const healing = item('Potion of Healing', { type: 'potion', magic: true, rarity: 'common', consumable: true });
const wand = item('Wand of Fireballs', { type: 'wand', magic: true, rarity: 'rare', source: 'DMG' });
const SRD = [longsword, healing, wand];

const brew: StoredItem = {
  ...item('Cloudy Flask', { type: 'potion', magic: true, rarity: 'uncommon', id: 'item:homebrew-aaaaaaaa@HOMEBREW', source: 'Homebrew', text: [{ p: 'Secret: {{redact:r1}}poison{{/redact}}' }] }),
  campaignId: 'c1', updatedAt: 1, defaultView: { name: 'Odd flask', hidden: ['rarity'], revealed: [] },
};

const names = (xs: ReturnType<typeof filterCatalog>) => xs.map((r) => r.shown.name);

test('SRD, pack and homebrew items merge into one list, by name', () => {
  const rows = catalogRows(SRD, [brew], 'dm');
  expect(names(rows)).toEqual(['Cloudy Flask', 'Longsword', 'Potion of Healing', 'Wand of Fireballs']);
  expect(rows.find((r) => r.shown.name === 'Cloudy Flask')).toMatchObject({ source: 'HOMEBREW', stored: brew });
  expect(rows.find((r) => r.shown.name === 'Longsword')?.stored).toBeUndefined();
});

test('Magic hides the longsword, Mundane hides the potion', () => {
  const rows = catalogRows(SRD, [brew], 'dm');
  expect(names(filterCatalog(rows, { magic: 'magic' }))).toEqual(['Cloudy Flask', 'Potion of Healing', 'Wand of Fireballs']);
  expect(names(filterCatalog(rows, { magic: 'mundane' }))).toEqual(['Longsword']);
  expect(filterCatalog(rows, { magic: '' })).toHaveLength(4);
});

test('search, type, rarity and source narrow the list together', () => {
  const rows = catalogRows(SRD, [brew], 'dm');
  expect(names(filterCatalog(rows, { q: ' FIREBALL ' }))).toEqual(['Wand of Fireballs']);
  expect(names(filterCatalog(rows, { type: 'potion' }))).toEqual(['Cloudy Flask', 'Potion of Healing']);
  expect(names(filterCatalog(rows, { type: 'potion', rarity: 'common' }))).toEqual(['Potion of Healing']);
  expect(names(filterCatalog(rows, { source: 'DMG' }))).toEqual(['Wand of Fireballs']);
  expect(names(filterCatalog(rows, { source: 'HOMEBREW' }))).toEqual(['Cloudy Flask']);
  expect(names(filterCatalog(rows, { source: 'SRD', magic: 'magic' }))).toEqual(['Potion of Healing']);
});

test('a player sees the cover name and a hidden rarity cannot be searched or filtered on', () => {
  const rows = catalogRows(SRD, [brew], 'player');
  expect(names(rows)).toContain('Odd flask');
  expect(names(rows)).not.toContain('Cloudy Flask');
  expect(filterCatalog(rows, { q: 'cloudy' })).toHaveLength(0);
  expect(filterCatalog(rows, { rarity: 'uncommon' })).toHaveLength(0); // the rarity is hidden
  expect(names(filterCatalog(rows, { magic: 'mundane' }))).toContain('Odd flask'); // hidden rarity reads as mundane
});

test('customize copies every field into a new homebrew record that remembers its base', () => {
  const copy = customize(healing, 'c1');
  expect(copy.id).toMatch(/^item:homebrew-[0-9a-f]{8}@HOMEBREW$/);
  expect(copy).toMatchObject({ name: 'Potion of Healing', type: 'potion', magic: true, rarity: 'common', consumable: true, campaignId: 'c1', baseItemId: healing.id, source: 'Homebrew' });
  expect(copy).not.toHaveProperty('defaultView');
  expect(customize(healing, 'c1').id).not.toBe(copy.id); // never name-derived
  expect(healing.baseItemId).toBeUndefined(); // the source is untouched
});

test('customize keeps an existing base item, so a customized +1 Longsword stays a longsword', () => {
  const plusOne = { ...longsword, name: '+1 Longsword', baseItemId: 'item:longsword@SRD', id: 'item:longsword-1@SRD' };
  expect(customize(plusOne, 'c1').baseItemId).toBe('item:longsword@SRD');
  expect(customize(longsword, 'c1').baseItemId).toBe(longsword.id); // no base yet: the source itself
});

test('a malformed imported item is rejected with a message, never saved', () => {
  const bad = (x: object, msg: RegExp) => expect(() => importedItem({ ...longsword, ...x } as never, 'c2')).toThrow(msg);
  bad({ name: undefined }, /name/i);
  bad({ name: '   ' }, /name/i);
  bad({ text: 'not a list' }, /text/i);
  bad({ type: 'spaceship' }, /type/i);
  bad({ weight: Infinity }, /weight/i);
  bad({ costCp: 'free' }, /cost/i);
  bad({ rarity: 'mythic' }, /rarity/i);
  bad({ magic: 'yes' }, /magic/i);
  expect(() => importedItem(null as never, 'c2')).toThrow(/item/i);
});

test('import defaults a missing text and drops malformed blocks', () => {
  const { text: _t, ...noText } = longsword;
  const got = importedItem({
    ...noText, bonuses: { attack: 'x' }, charges: { max: 'many' }, weapon: { damage: 5 }, armor: 7, effects: 'nope', junk: 1,
  } as never, 'c2');
  expect(got.text).toEqual([]);
  for (const k of ['bonuses', 'charges', 'weapon', 'armor', 'effects', 'junk']) expect(got, k).not.toHaveProperty(k);
  expect(importedItem(longsword, 'c2').weapon).toEqual(longsword.weapon); // a good block survives
});

test('a bad stored record is skipped by the list instead of breaking it', () => {
  const nameless = { ...brew, id: 'item:homebrew-bbbbbbbb@HOMEBREW', name: undefined } as unknown as StoredItem;
  const badText = { ...brew, id: 'item:homebrew-cccccccc@HOMEBREW', text: 'x' } as unknown as StoredItem;
  for (const viewer of ['dm', 'player'] as const) {
    const rows = catalogRows(SRD, [nameless, badText, brew], viewer);
    expect(rows.filter((r) => r.stored).length).toBeLessThanOrEqual(2);
    expect(rows.map((r) => r.item.id)).not.toContain(nameless.id);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  }
});

test('an imported item gets a fresh id, this campaign and the homebrew source', () => {
  const got = importedItem(brew, 'c2');
  expect(got).toMatchObject({ name: 'Cloudy Flask', campaignId: 'c2', source: 'Homebrew', defaultView: brew.defaultView });
  expect(got.id).not.toBe(brew.id);
  expect(got.id).toMatch(/@HOMEBREW$/);
  expect(importedItem(longsword, 'c2').campaignId).toBe('c2'); // a PDF's plain item has no record fields
});
