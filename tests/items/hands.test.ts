import { expect, test } from 'vitest';
import { equip, handsFor, handsHeld } from '../../src/lib/items/hands.ts';
import type { InventoryEntry, ItemDef } from '../../src/lib/types.ts';

// 2014 rules (SRD 5.1 Equipment): a creature has two hands; a two-handed weapon needs both, a versatile one one (two for its larger
// die), others one; a shield is carried in one hand and only one counts; one suit of armor.
const w = (name: string, properties: string[] = []): ItemDef => ({ kind: 'item', id: `item:${name}`, name, source: 'SRD', text: [], type: 'weapon', magic: false,
  weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', properties } });
const a = (name: string, category: 'light' | 'heavy' | 'shield'): ItemDef => ({ kind: 'item', id: `item:${name}`, name, source: 'SRD', text: [], type: category === 'shield' ? 'shield' : 'armor', magic: false,
  armor: { category, ac: category === 'shield' ? 2 : 14 } });
const e = (id: string, item: ItemDef, equipped = false): InventoryEntry => ({ id, item, quantity: 1, equipped, attuned: false, chargesUsed: 0, notes: '' });
const on = (inv: InventoryEntry[]) => inv.filter((x) => x.equipped).map((x) => x.id);

test('hands: two-handed 2, other weapons and a shield 1, armor 0', () => {
  expect(handsFor(w('Greatsword', ['heavy', 'two-handed']))).toBe(2);
  expect(handsFor(w('Longsword', ['versatile']))).toBe(1);
  expect(handsFor(a('Shield', 'shield'))).toBe(1);
  expect(handsFor(a('Chain mail', 'heavy'))).toBe(0);
  expect(handsHeld([e('s', w('Longsword'), true), e('sh', a('Shield', 'shield'), true), e('c', a('Chain mail', 'heavy'), true)])).toBe(2);
});

test('a greatsword with sword and shield in hand: both go back, the armor stays', () => {
  const inv = [e('c', a('Chain mail', 'heavy'), true), e('s', w('Longsword'), true), e('sh', a('Shield', 'shield'), true), e('g', w('Greatsword', ['two-handed']))];
  const r = equip(inv, 'g');
  expect(on(r.inventory)).toEqual(['c', 'g']);
  expect(r.stowed).toEqual(['Longsword', 'Shield']);
});

test('a dagger with sword and shield: the sword goes back (weapons before the shield); a second suit of armor or shield replaces the first', () => {
  const inv = [e('s', w('Longsword'), true), e('sh', a('Shield', 'shield'), true), e('d', w('Dagger', ['light', 'finesse', 'thrown']))];
  expect(on(equip(inv, 'd').inventory)).toEqual(['sh', 'd']);
  const armors = [e('l', a('Leather', 'light'), true), e('c', a('Chain mail', 'heavy'))];
  expect(on(equip(armors, 'c').inventory)).toEqual(['c']);
  const shields = [e('s1', a('Shield', 'shield'), true), e('s2', a('Spiked shield', 'shield'))];
  expect(equip(shields, 's2')).toMatchObject({ stowed: ['Shield'] });
});

test('two light weapons fit two hands; nothing is stowed when it fits', () => {
  const inv = [e('s', w('Shortsword', ['light']), true), e('d', w('Dagger', ['light']))];
  expect(equip(inv, 'd')).toMatchObject({ stowed: [] });
  expect(on(equip(inv, 'd').inventory)).toEqual(['s', 'd']);
});
