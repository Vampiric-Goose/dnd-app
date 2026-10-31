import fs from 'node:fs';
import { expect, test } from 'vitest';
import { ITEM_MECHANICS, parseMechanics } from '../../scripts/srd/itemMechanics.ts';
import { addLevel, embedContent, newCharacter } from '../../src/lib/character/build.ts';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { makeEntry, rechargeEntry } from '../../src/lib/items/inventory.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { ItemDef, Pack } from '../../src/lib/types.ts';

const parse = parseMechanics;

test('parser: weapon and ammunition bonuses', () => {
  expect(parse('You have a +1 bonus to attack and damage rolls made with this magic weapon.', 'weapon').bonuses).toEqual({ attack: 1, damage: 1 });
  expect(parse('You gain a +3 bonus to Attack and Damage Rolls made with this Magic Weapon.', 'weapon').bonuses).toEqual({ attack: 3, damage: 3 });
  expect(parse('You have a +2 bonus to attack and damage rolls made with this piece of magic ammunition.', 'ammunition').bonuses).toEqual({ attack: 2, damage: 2 });
  // a staff has no weapon to carry the bonus, and a potion's bonus lasts an hour
  expect(parse('This staff can be wielded as a magic quarterstaff that grants a +2 bonus to attack and damage rolls made with it.', 'staff')).toEqual({});
  expect(parse('For 1 hour, the coated item is magical and has a +3 bonus to attack and damage rolls.', 'potion')).toEqual({});
  expect(parse('a +1 bonus to attack rolls and damage rolls and a damage die of 1d8', 'armor')).toEqual({});
});

test('parser: AC, saves and spell bonuses', () => {
  expect(parse('You have a +2 bonus to AC while wearing this armor.', 'armor').bonuses).toEqual({ ac: 2 });
  expect(parse('While wearing this armor, you gain a +2 bonus to Armor Class.').bonuses).toEqual({ ac: 2 });
  expect(parse('You gain a +1 bonus to AC and saving throws while wearing this ring.', 'ring').bonuses).toEqual({ ac: 1, save: 1 });
  expect(parse('You gain a +1 bonus to saving throws while you wear it.').bonuses).toEqual({ save: 1 });
  expect(parse('you gain a +1 bonus to ability checks and saving throws.').bonuses).toEqual({ save: 1 });
  expect(parse('While holding this wand, you gain a +2 bonus to spell attack rolls.').bonuses).toEqual({ spellAttack: 2 });
  expect(parse('You gain a +1 bonus to spell attack rolls and to your spell save DC.').bonuses).toEqual({ spellAttack: 1, spellDc: 1 });
  expect(parse('You gain a +1 bonus to your spell save DC.').bonuses).toEqual({ spellDc: 1 });
  expect(parse('you gain a +2 bonus to spell attack rolls and to the saving throw DCs of your warlock spells.').bonuses).toEqual({ spellAttack: 2, spellDc: 2 });
  // conditional bonuses are not read
  expect(parse('You gain a +2 bonus to AC against ranged attacks while you wield this shield.', 'shield')).toEqual({});
  expect(parse('you gain a +2 bonus to AC if you are wearing no armor and using no shield.', 'wondrous')).toEqual({});
});

test('parser: charges and dawn recharge', () => {
  expect(parse('This wand has 7 charges. The wand regains 1d6 + 1 expended charges daily at dawn.').charges).toEqual({ max: 7, recharge: 'dawn', rechargeAmount: '1d6+1' });
  expect(parse('The staff has 10 charges. The staff regains 1d6 + 4 expended charges daily at dawn.').charges).toEqual({ max: 10, recharge: 'dawn', rechargeAmount: '1d6+4' });
  expect(parse('This ring has 3 charges, and it regains 1d3 expended charges daily at dawn.').charges).toEqual({ max: 3, recharge: 'dawn', rechargeAmount: '1d3' });
  expect(parse('The cube starts with 36 charges, and it regains 1d20 expended charges daily at dawn.').charges).toEqual({ max: 36, recharge: 'dawn', rechargeAmount: '1d20' });
  expect(parse('They have 3 charges. The lenses regain all expended charges daily at dawn.').charges).toEqual({ max: 3, recharge: 'dawn' });
  expect(parse('you can use an action to expend 1 of its 3 charges to cast the wish spell from it.').charges).toEqual({ max: 3, recharge: 'none' });
  expect(parse('The scarab has 12 charges. It crumbles when its last charge is expended.').charges).toEqual({ max: 12, recharge: 'none' });
  expect(parse('The sword has 1d4 - 1 charges.').charges).toBeUndefined(); // rolled at random: ITEM_MECHANICS gives the maximum
  expect(parse('Its words are charged with magic.').charges).toBeUndefined();
});

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const idx = new ContentIndex([srd]);
const item = (slug: string) => idx.get(`item:${slug}@SRD`) as ItemDef;
const fighter = () => {
  const blank = newCharacter('Test');
  const c = { ...blank, build: { ...blank.build, raceId: 'race:human@SRD' } };
  return embedContent(addLevel(c, 'class:fighter@SRD', idx, DEFAULT_SETTINGS).character, idx);
};
const sheetWith = (slug: string, equipped: boolean, attuned: boolean) =>
  computeSheet({ ...fighter(), inventory: [{ ...makeEntry(item(slug)), equipped, attuned }] }, { settings: DEFAULT_SETTINGS, viewer: 'dm' });

test('SRD Ring of Protection: AC +1 and saves +1 only while equipped and attuned', () => {
  const bare = sheetWith('ring-of-protection', false, false);
  const worn = sheetWith('ring-of-protection', true, false); // needs attunement
  const on = sheetWith('ring-of-protection', true, true);
  expect([worn.ac - bare.ac, worn.saves.wis.bonus - bare.saves.wis.bonus]).toEqual([0, 0]);
  expect([on.ac - bare.ac, on.saves.wis.bonus - bare.saves.wis.bonus, on.saves.str.bonus - bare.saves.str.bonus]).toEqual([1, 1, 1]);
});

test('SRD magic weapon with a base item: the +1 reaches the attack; armor and stat items work', () => {
  const sheet = (slug: string, strip = false) => {
    const it = strip ? { ...item(slug), bonuses: undefined } : item(slug);
    return computeSheet({ ...fighter(), inventory: [{ ...makeEntry(it), equipped: true, attuned: true }] }, { settings: DEFAULT_SETTINGS, viewer: 'dm' });
  };
  const dagger = (strip: boolean) => sheet('dagger-of-venom', strip).attacks.find(a => a.name === 'Dagger of Venom')!;
  expect(item('dagger-of-venom').baseItemId).toBe('item:dagger@SRD');
  expect([dagger(false).toHit - dagger(true).toHit, dagger(false).damage, dagger(true).damage]).toEqual([1, '1d4+1', '1d4']);
  expect(sheet('dwarven-plate').ac).toBe(20); // plate 18 + 2
  expect(sheetWith('gauntlets-of-ogre-power', true, true).scores.str).toBe(19);
  expect(sheetWith('gauntlets-of-ogre-power', true, false).scores.str).toBe(11) // human +1;
  expect(sheetWith('bracers-of-defense', true, true).ac - sheetWith('bracers-of-defense', false, false).ac).toBe(2);
  expect(sheetWith('ring-of-fire-resistance', true, true).resistances).toContain('fire');
  expect(sheetWith('ring-of-fire-resistance', true, false).resistances).not.toContain('fire');
});

test('SRD wand: 7 charges, dawn restores 1d6+1', () => {
  const wand = item('wand-of-magic-missiles');
  expect(wand.charges).toEqual({ max: 7, recharge: 'dawn', rechargeAmount: '1d6+1' });
  const spent = { ...makeEntry(wand), chargesUsed: 7 };
  expect(rechargeEntry(spent, 'dawn', () => 0).chargesUsed).toBe(5); // lowest roll: 1 + 1 = 2 restored
  expect(rechargeEntry(spent, 'long').chargesUsed).toBe(7);
});

test('variant items each carry their own number', () => {
  expect([1, 2, 3].map(n => item(`weapon-${n}`).bonuses)).toEqual([1, 2, 3].map(n => ({ attack: n, damage: n })));
  expect([1, 2, 3].map(n => item(`armor-${n}`).bonuses)).toEqual([1, 2, 3].map(n => ({ ac: n })));
  expect([1, 2, 3].map(n => item(`ammunition-${n}`).bonuses)).toEqual([1, 2, 3].map(n => ({ attack: n, damage: n })));
  const belts = ['hill', 'stone', 'frost', 'fire', 'cloud', 'storm'].map(g => item(`belt-of-${g}-giant-strength`).effects);
  expect(belts.map(e => (e![0] as { value: number }).value)).toEqual([21, 23, 23, 25, 27, 29]);
});

test('every ITEM_MECHANICS key is an SRD item', () => {
  for (const id of Object.keys(ITEM_MECHANICS)) expect(idx.get(id)?.kind, id).toBe('item');
});
