import { expect, test } from 'vitest';
import { richToPlain } from '../../src/lib/content/richtext.ts';
import { identify, playerItem, revealField, revealRedaction } from '../../src/lib/items/playerView.ts';
import { attunedCount, carriedWeight, makeEntry, rechargeEntry, refreshEntry, transfer, useCharge, useItem } from '../../src/lib/items/inventory.ts';
import type { ItemDef, PlayerView } from '../../src/lib/types.ts';

const item = (name: string): ItemDef => ({ id: name.toLowerCase().replace(/\W+/g, '-'), kind: 'item', name, source: 'test', text: [], type: 'other', magic: false });

const potion = { ...item('Potion of Poison'), rarity: 'uncommon', consumable: true, text: [{ p: 'Looks like healing. {{redact:r1}}It is poison.{{/redact}}' }] } as ItemDef;
test('player view hides, redacts, reveals, identifies', () => {
  const view: PlayerView = { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] };
  const p = playerItem(potion, view);
  expect([p.name, p.rarity, p.text]).toEqual(['Cloudy red potion', undefined, [{ p: 'Looks like healing. ██████' }]]);
  expect(richToPlain(playerItem(potion, revealRedaction(view, 'r1')).text)).toContain('It is poison.');
  expect(playerItem(potion, revealField(view, 'rarity')).rarity).toBe('uncommon');
  expect(identify(makeEntry(potion, { view })).view).toBeUndefined();
  expect(playerItem(potion).text).toEqual([{ p: 'Looks like healing. ██████' }]); // no view: markers never leak
});
test('hidden bonuses/effects/curse', () => {
  const sword = { ...item('Sword of Woe'), bonuses: { attack: -1 }, effects: [{ type: 'note', text: 'x' }], curse: [{ p: 'Cursed.' }] } as ItemDef;
  const p = playerItem(sword, { hidden: ['bonuses', 'effects', 'curse'], revealed: [], text: [{ p: 'A plain sword.' }] });
  expect([p.bonuses, p.effects, p.curse, p.text]).toEqual([undefined, [], undefined, [{ p: 'A plain sword.' }]]);
});
test('use, charges, recharge', () => {
  expect(useItem(makeEntry(potion, { quantity: 2 }))!.quantity).toBe(1);
  expect(useItem(makeEntry(potion))).toBeNull();
  const wand = { ...item('Wand'), charges: { max: 7, recharge: 'dawn', rechargeAmount: '1d6+1' } } as ItemDef;
  const spent = useCharge(makeEntry(wand), 7);
  expect(rechargeEntry(spent, 'dawn', () => 0.4).chargesUsed).toBe(3); // d6=3, +1 → 4 restored
  expect(rechargeEntry(spent, 'long').chargesUsed).toBe(7);
  expect(rechargeEntry(useCharge(makeEntry({ ...wand, charges: { max: 3, recharge: 'long' } }), 2), 'long').chargesUsed).toBe(0);
  expect(refreshEntry({ ...spent, chargesUsed: 5 }, { ...wand, charges: { max: 3, recharge: 'dawn' } }).chargesUsed).toBe(3);
});
test('weight, attunement, transfer', () => {
  const sword = makeEntry({ ...item('Longsword'), weight: 3 }), arrows = makeEntry({ ...item('Arrow'), weight: 0.05 }, { quantity: 20 });
  expect(carriedWeight([sword, arrows], { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 })).toBeCloseTo(6);
  expect(attunedCount([{ ...sword, attuned: true }, arrows])).toBe(1);
  const r = transfer([arrows], [], arrows.id, 5);
  expect([r.from[0].quantity, r.to[0].quantity, r.to[0].id === arrows.id]).toEqual([15, 5, false]);
  expect(transfer([arrows], [], arrows.id, 20).from).toEqual([]);
});

// Beyond the brief: the security property (nothing hidden survives) and purity.
test('curse text is redacted, aliases cannot undo a cover name, inputs are never mutated', () => {
  const cursed = { ...item('Ring of Woe'), aliases: ['Ring of Doom'], curse: [{ p: 'Cursed. {{redact:c1}}You cannot remove it.{{/redact}}' }] } as ItemDef;
  const before = JSON.stringify(cursed);
  const view: PlayerView = { name: 'Plain ring', hidden: [], revealed: [] };
  const p = playerItem(cursed, view);
  expect(p.curse).toEqual([{ p: 'Cursed. ██████' }]);
  expect(p.aliases).toBeUndefined();
  expect(playerItem(cursed).curse).toEqual([{ p: 'Cursed. ██████' }]);
  expect(playerItem(cursed).aliases).toEqual(['Ring of Doom']); // no cover name: aliases are fine
  const viewBefore = JSON.stringify(view);
  revealField(view, 'curse'); revealRedaction(view, 'c1'); identify(makeEntry(cursed, { view }));
  expect([JSON.stringify(cursed), JSON.stringify(view)]).toEqual([before, viewBefore]);
});
test('revealRedaction is idempotent; transfer edge cases leave inputs alone', () => {
  const view: PlayerView = { hidden: ['rarity'], revealed: [] };
  expect(revealRedaction(revealRedaction(view, 'a'), 'a').revealed).toEqual(['a']);
  expect(revealField(view, 'rarity').hidden).toEqual([]);
  expect(view.hidden).toEqual(['rarity']);
  const arrows = makeEntry({ ...item('Arrow'), weight: 0.05 }, { quantity: 4 });
  const from = [{ ...arrows, equipped: true, attuned: true }];
  expect(transfer(from, [], 'nope', 1)).toEqual({ from, to: [] });
  expect(transfer(from, [], arrows.id, 0)).toEqual({ from, to: [] });
  const all = transfer(from, [], arrows.id, 99); // over-asking moves the whole stack
  expect([all.from, all.to[0].quantity, all.to[0].equipped, all.to[0].attuned]).toEqual([[], 4, false, false]);
  expect(from[0].quantity).toBe(4);
});
test('useCharge clamps; recharge ignores items without charges or with recharge none', () => {
  const none = makeEntry({ ...item('Orb'), charges: { max: 2, recharge: 'none' } });
  expect(useCharge(none, 5).chargesUsed).toBe(2);
  expect(rechargeEntry(useCharge(none, 2), 'none').chargesUsed).toBe(2);
  const plain = makeEntry(item('Rock'));
  expect(useCharge(plain).chargesUsed).toBe(0);
  expect(rechargeEntry(plain, 'dawn')).toBe(plain);
  const shortWand = useCharge(makeEntry({ ...item('Wand'), charges: { max: 4, recharge: 'short' } }), 4);
  expect(rechargeEntry(shortWand, 'long').chargesUsed).toBe(0);
  expect(rechargeEntry(shortWand, 'dusk').chargesUsed).toBe(4);
});
