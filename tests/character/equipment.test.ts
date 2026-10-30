import { expect, test } from 'vitest';
import { goldFormula, itemsInCategory, startingInventory, type Equip, type EquipSource } from '../../src/lib/character/equipment.ts';
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

test('startingInventory: default and category picks, equipped gear, gold mode (R35)', () => {
  const leather = item('Leather', { type: 'armor', armor: { category: 'light', ac: 11 } });
  const all = [...items, leather];
  const lookup = (id: string) => all.find(i => i.id === id);
  const sources: EquipSource[] = [{ id: 'class:f', name: 'F', eq: { text: [], choices: [
    [{ label: 'chain', items: [{ itemId: 'item:Chain Mail@test', quantity: 1 }] }, { label: 'leather', items: [{ itemId: leather.id, quantity: 1 }] }],
    [{ label: 'weapon and shield', items: [{ category: 'martial-weapons', quantity: 1 }, { itemId: 'item:Shield@test', quantity: 1 }] }],
    [{ label: 'lute', items: [{ itemId: 'item:Lute@test', quantity: 2 }] }],
  ] } }];
  const equip: Equip = { mode: 'pack', picks: {}, cats: { 'class:f|1|0|0|0': 'item:Shortsword@test' }, gold: { dice: '', times: 1 } };
  const row = (r: ReturnType<typeof startingInventory>) => r.inventory.map(e => [e.item.name, e.quantity, e.equipped]);
  expect(row(startingInventory(sources, equip, lookup))).toEqual([['Chain Mail', 1, true], ['Shortsword', 1, true], ['Shield', 1, true], ['Lute', 2, false]]);
  expect(startingInventory(sources, equip, lookup).gp).toBe(0);
  expect(row(startingInventory(sources, { ...equip, picks: { 'class:f|0': 1 } }, lookup))[0]).toEqual(['Leather', 1, true]);
  // Picks are keyed by source: another class's picks leave this one on its defaults.
  expect(row(startingInventory(sources, { ...equip, picks: { 'class:w|0': 1 } }, lookup))[0]).toEqual(['Chain Mail', 1, true]);
  expect(startingInventory(sources, { ...equip, mode: 'gold', gold: { dice: '5d4', times: 10, total: 120 } }, lookup)).toEqual({ inventory: [], gp: 120 });
});

test('goldFormula', () => {
  expect(goldFormula('5d4 × 10 gp')).toEqual({ dice: '5d4', times: 10 });
  expect(goldFormula('5d4 gp')).toEqual({ dice: '5d4', times: 1 });
  expect(goldFormula(undefined)).toBeUndefined();
});
