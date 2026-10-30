import { expect, test } from 'vitest';
import { goldFormula, itemsInCategory } from '../../src/lib/character/equipment.ts';
import type { ItemDef } from '../../src/lib/types.ts';

const item = (name: string, extra: Partial<ItemDef> = {}): ItemDef => ({ id: `item:${name}@test`, kind: 'item', name, source: 'test', text: [], type: 'gear', magic: false, ...extra });
const weapon = (name: string, category: 'simple' | 'martial', ranged: boolean, magic = false) =>
  item(name, { type: 'weapon', magic, weapon: { category, ranged, damage: '1d6', damageType: 'slashing', properties: [] } });
const items = [
  weapon('Shortsword', 'martial', false), weapon('Longbow', 'martial', true), weapon('Dagger', 'simple', false),
  weapon('Sling', 'simple', true), weapon('Longsword +1', 'martial', false, true),
  item('Chain Mail', { type: 'armor', armor: { category: 'heavy', ac: 16 } }),
  item('Shield', { type: 'shield', armor: { category: 'shield', ac: 2 } }),
  item('Amulet', { category: 'holy-symbols' }), item('Lute', { type: 'tool', category: 'musical-instruments' }),
];
const names = (cat: string) => itemsInCategory(items, cat).map(i => i.name);

test('category options match weapon/armor data and ItemDef.category, never magic items', () => {
  expect(names('martial-weapons')).toEqual(['Longbow', 'Shortsword']);
  expect(names('martial-melee-weapons')).toEqual(['Shortsword']);
  expect(names('simple-weapons')).toEqual(['Dagger', 'Sling']);
  expect(names('simple-ranged-weapons')).toEqual(['Sling']);
  expect(names('heavy-armor')).toEqual(['Chain Mail']);
  expect(names('shields')).toEqual(['Shield']);
  expect(names('holy-symbols')).toEqual(['Amulet']);
  expect(names('musical-instruments')).toEqual(['Lute']);
  expect(names('arcane-foci')).toEqual([]);
});

test('goldFormula', () => {
  expect(goldFormula('5d4 × 10 gp')).toEqual({ dice: '5d4', times: 10 });
  expect(goldFormula('5d4 gp')).toEqual({ dice: '5d4', times: 1 });
  expect(goldFormula(undefined)).toBeUndefined();
});
