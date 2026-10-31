import { expect, test } from 'vitest';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { normalizeView, rowView } from '../../src/lib/items/rows.ts';
import type { ItemDef } from '../../src/lib/types.ts';

const potion = { id: 'item:potion-of-poison@test', kind: 'item', name: 'Potion of Poison', source: 'test', text: [], type: 'potion', magic: true, rarity: 'uncommon', consumable: true } as ItemDef;
const ring = { id: 'item:ring@test', kind: 'item', name: 'Ring of Protection', source: 'test', text: [], type: 'ring', magic: true, attunement: true } as ItemDef;

test('a row shows the true name and Secret badge to the DM, the cover to a player', () => {
  const e = makeEntry(potion, { view: { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] } });
  expect(rowView(e, 'dm')).toMatchObject({ name: 'Potion of Poison', secret: true, canEquip: true, consumable: true });
  const p = rowView(e, 'player');
  expect([p.name, p.secret, p.shown.rarity, p.canEquip]).toEqual(['Cloudy red potion', false, undefined, false]); // rarity hidden: reads as mundane
  expect(rowView(makeEntry(potion), 'dm').secret).toBe(false);
});

test('attunement toggle follows what the viewer may know', () => {
  expect(rowView(makeEntry(ring), 'player').needsAttune).toBe(true);
  expect(rowView(makeEntry(ring, { view: { hidden: ['attunement'], revealed: [] } }), 'player').needsAttune).toBe(false);
  expect(rowView(makeEntry(ring, { view: { hidden: ['attunement'], revealed: [] } }), 'dm').needsAttune).toBe(true);
});

test('an empty view is dropped', () => {
  expect(normalizeView({ hidden: [], revealed: [] })).toBeUndefined();
  expect(normalizeView({ hidden: ['rarity'], revealed: [] })).toBeDefined();
});
