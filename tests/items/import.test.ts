import { expect, test } from 'vitest';
import { isRichText } from '../../src/lib/content/richtext.ts';
import { importedItem, soundItem } from '../../src/lib/items/homebrew.ts';
import type { StoredItem } from '../../src/lib/types.ts';

const base = { id: 'item:x@HOMEBREW', kind: 'item', name: 'Odd Blade', source: 'Homebrew', text: [{ p: 'A blade.' }], type: 'weapon', magic: true, campaignId: 'c1', updatedAt: 1 };

test('rich text: every block shape is checked, recursively', () => {
  expect(isRichText([{ p: 'a' }, { list: ['a', 'b'] }, { table: { head: ['h'], rows: [['r']] } }, { table: { caption: 'c', head: [], rows: [] } }, { h: 'H', blocks: [{ p: 'x' }, { h: 'I', blocks: [] }] }])).toBe(true);
  expect(isRichText([])).toBe(true);
  for (const bad of [[{}], [{ p: 5 }], [{ list: 'x' }], [{ list: [1] }], [{ table: { head: ['h'] } }], [{ table: { head: ['h'], rows: [[1]] } }], [{ h: 'H' }], [{ h: 'H', blocks: [{}] }], [{ h: 'H', blocks: [{ h: 'I', blocks: [{ p: 1 }] }] }], 'x', null, [null], ['p']]) {
    expect(isRichText(bad), JSON.stringify(bad)).toBe(false);
  }
});

test('an imported item with damaged text blocks is refused, however deep', () => {
  for (const text of [[{}], [{ p: 5 }], [{ h: 'Head', blocks: [{ p: 5 }] }]]) {
    expect(() => importedItem({ ...base, text }, 'c2'), JSON.stringify(text)).toThrow(/description|text/i);
  }
});

test('damaged curse, player-view text and choices are dropped and reported, not kept', () => {
  const { item, ignored } = importedItem({
    ...base, curse: [{}], defaultView: { hidden: [], revealed: [], text: [{ p: 1 }] },
    choices: [{ type: 'option', count: 1, options: [{ name: 'A', text: [{ p: 9 }] }] }], effects: [{ type: 'note', text: 'ok' }],
  }, 'c2');
  expect([...ignored].sort()).toEqual(['choices', 'curse', 'defaultView']);
  for (const k of ['curse', 'defaultView', 'choices']) expect(item, k).not.toHaveProperty(k);
  expect(item.effects).toEqual([{ type: 'note', text: 'ok' }]);
  expect(importedItem({ ...base, effects: [{ nope: 1 }] }, 'c2').ignored).toEqual(['effects']);
});

test('soundItem: the one guard for stored items', () => {
  expect(soundItem(base as unknown as StoredItem)).toBe(true);
  const bad = (x: object) => soundItem({ ...base, ...x } as unknown as StoredItem);
  expect(bad({ name: undefined })).toBe(false);
  expect(bad({ name: '' })).toBe(false);
  expect(bad({ text: 'x' })).toBe(false);
  expect(bad({ text: [{}] })).toBe(false);
  expect(bad({ curse: [{ p: 3 }] })).toBe(false);
  expect(bad({ defaultView: { hidden: [], revealed: [], text: [{}] } })).toBe(false);
  expect(soundItem(null as never)).toBe(false);
});

test('a full item survives import unchanged apart from id, campaign and time', () => {
  const full = {
    id: 'item:homebrew-12345678@HOMEBREW', kind: 'item', name: 'Everything Blade', source: 'Homebrew', srd: true, aliases: ['EB'],
    text: [{ p: 'Hits {{redact:r1}}hard{{/redact}}.' }, { list: ['a'] }, { table: { caption: 'T', head: ['x'], rows: [['1']] } }, { h: 'Head', blocks: [{ p: 'in' }] }],
    type: 'weapon', magic: true, weight: 3, costCp: 1500, rarity: 'rare', attunement: 'by a wizard', baseItemId: 'item:longsword@SRD', consumable: true, category: 'swords',
    curse: [{ p: 'Cursed.' }],
    weapon: { category: 'martial', ranged: true, damage: '1d8', damageType: 'slashing', versatile: '1d10', properties: ['finesse'], range: [20, 60] },
    armor: { category: 'medium', ac: 14, dexCap: 2, strReq: 13, stealthDisadvantage: true },
    bonuses: { attack: 1, damage: 1, ac: 1, save: 1, spellAttack: 1, spellDc: 1 },
    charges: { max: 3, recharge: 'dawn', rechargeAmount: '1d3' },
    effects: [{ type: 'bonus', target: 'ac', value: 1 }],
    choices: [{ type: 'option', count: 1, options: [{ name: 'Opt', text: [{ p: 'o' }], effects: [{ type: 'note', text: 'n' }], choices: [{ type: 'skill', count: 1, from: 'any' }] }] }],
    defaultView: { name: 'Plain stick', text: [{ p: 'A stick.' }], hidden: ['rarity', 'charges'], revealed: ['r1'] },
    campaignId: 'c1', updatedAt: 5,
  } as unknown as StoredItem;
  const { item, ignored } = importedItem(full, 'c2');
  expect(ignored).toEqual([]);
  const strip = ({ id: _i, campaignId: _c, updatedAt: _u, ...rest }: StoredItem) => rest;
  expect(strip(item)).toEqual(strip(full));
  expect([item.campaignId, item.id === full.id]).toEqual(['c2', false]);
  expect(importedItem({ ...full, attunement: true }, 'c2').item.attunement).toBe(true);
});
