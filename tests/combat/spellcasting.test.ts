import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { diceAt, readSpell, readSpellcasting } from '../../src/lib/combat/spellText.ts';
import { applyUse, monsterActions, pcActions, problemOf, type TurnAction } from '../../src/lib/combat/turnActions.ts';
import type { Character, Combat, Combatant, MonsterDef, Pack, Sheet, SpellDef } from '../../src/lib/types.ts';

// 2014 spellcasting (SRD 5.1 "Spellcasting"): spell attack = ability mod + proficiency, save DC = 8 + mod + proficiency, a higher slot
// raises the spell's level, cantrips scale at 5th/11th/17th level, areas are cones, cubes, cylinders, lines and spheres; after a
// bonus-action spell only a cantrip with a casting time of 1 action that turn.
const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const spell = (n: string) => srd.entities.find((e) => e.kind === 'spell' && e.name === n) as SpellDef;
const mage = srd.entities.find((e) => e.id === 'monster:mage@SRD') as MonsterDef;
const byName = new Map(srd.entities.filter((e) => e.kind === 'spell').map((s) => [s.name.toLowerCase(), s as SpellDef]));

// Paraphrased fixtures (no book text): an attack-plus-burst spell like Ice Knife, which no SRD spell is.
const shard = { level: 1, range: '60 feet', text: [{ p: 'You fling a shard. Make a ranged spell attack against the target. On a hit, the target takes 1d10 piercing damage. Hit or miss, the shard bursts: the target and each creature within 5 feet of it must succeed on a Dexterity saving throw or take 2d6 cold damage.' }] } as unknown as SpellDef;

describe('reading a spell for targeting', () => {
  test('attack plus burst: hit damage, save damage, a 5-foot burst, nothing on a successful save', () => {
    expect(readSpell(shard)).toMatchObject({ attack: 'ranged', save: 'Dex', burst: 5, onSave: 'none', range: { feet: 60 },
      damage: [{ dice: '1d10', type: 'piercing', on: 'hit' }, { dice: '2d6', type: 'cold', on: 'save' }] });
  });
  test('Fireball: half on a success, 150 feet', () => {
    expect(readSpell(spell('Fireball'))).toMatchObject({ onSave: 'half', range: { feet: 150 } });
  });
  test('Sleep: a pure area, no damage', () => {
    const r = readSpell(spell('Sleep'));
    expect(r.area).toMatchObject({ shape: 'sphere', feet: 20 });
    expect(r.damage).toEqual([]);
  });
  test('Moonbeam hurts on entering or starting a turn there, not when cast', () => {
    expect(readSpell(spell('Moonbeam')).lingering).toBe(true);
    expect(readSpell(spell('Fireball')).lingering).toBeUndefined();
  });
  test('ranges: self, touch, miles', () => {
    expect(readSpell(spell('Burning Hands')).range).toBe('self');
    expect(readSpell(spell('Cure Wounds')).range).toBe('touch');
    expect(readSpell({ ...shard, range: '1 mile' }).range).toEqual({ feet: 5280 });
  });
});

describe('reading a spell (the interpreter)', () => {
  test('Fireball: a Dex save, 8d6 fire, +1d6 a slot above 3rd, a 20-foot sphere', () => {
    const r = readSpell(spell('Fireball'));
    expect(r).toMatchObject({ save: 'Dex', damage: [{ dice: '8d6', type: 'fire' }], perSlot: { dice: '1d6', above: 3, step: 1 }, area: { shape: 'sphere', feet: 20, self: false } });
    expect(diceAt(r, { slot: 5, level: 3 }).damage).toEqual(['10d6 fire']);
  });
  test('Fire Bolt: a ranged spell attack whose cantrip damage grows at 5th, 11th and 17th level', () => {
    const r = readSpell(spell('Fire Bolt'));
    expect(r.attack).toBe('ranged');
    expect(diceAt(r, { level: 0, charLevel: 4 }).damage).toEqual(['1d10 fire']);
    expect(diceAt(r, { level: 0, charLevel: 11 }).damage).toEqual(['3d10 fire']);
  });
  test('Cure Wounds and Healing Word heal dice + the spellcasting modifier, more with a higher slot', () => {
    expect(diceAt(readSpell(spell('Cure Wounds')), { slot: 3, level: 1, mod: 3 }).heal).toBe('3d8+3');
    expect(diceAt(readSpell(spell('Healing Word')), { slot: 1, level: 1, mod: 2 }).heal).toBe('1d4+2');
  });
  test('areas from the wording: cone, line, cylinder; Shatter and Spiritual Weapon\'s odd higher-level phrasing', () => {
    expect(readSpell(spell('Burning Hands')).area).toEqual({ shape: 'cone', feet: 15, self: true });
    expect(readSpell(spell('Lightning Bolt')).area).toEqual({ shape: 'line', feet: 100, width: 5, self: true });
    expect(readSpell(spell('Ice Storm')).area).toMatchObject({ shape: 'cylinder', feet: 20 });
    expect(readSpell(spell('Ice Storm')).damage.map((d) => d.dice)).toEqual(['2d8', '4d6']);
    expect(diceAt(readSpell(spell('Shatter')), { slot: 4, level: 2 }).damage).toEqual(['5d8 thunder']);
    const sw = readSpell(spell('Spiritual Weapon'));
    expect(sw.attack).toBe('melee');
    expect(diceAt(sw, { slot: 4, level: 2, mod: 3 }).damage).toEqual(['2d8+3 force']); // every two slot levels above 2nd
  });
});

const wizardWith = (names: string[], armor?: 'heavy'): { c: Character; sheet: Sheet } => {
  const spells = names.map(spell);
  const c = {
    build: { levels: Array.from({ length: 5 }, () => ({ classId: 'class:wizard@SRD' })), subclasses: {}, spells: { 'class:wizard@SRD': { known: spells.map((s) => s.id), prepared: spells.map((s) => s.id) } } },
    embedded: Object.fromEntries([...spells.map((s) => [s.id, s]), ['class:wizard@SRD', { kind: 'class', id: 'class:wizard@SRD', name: 'Wizard', spellcasting: { preparation: 'prepared' } }]]),
    state: { resourcesUsed: {}, slotsUsed: [], conditions: [] },
    inventory: armor ? [{ id: 'plate', item: { kind: 'item', name: 'Plate', armor: { category: 'heavy', ac: 18 } }, quantity: 1, equipped: true, attuned: false, chargesUsed: 0, notes: '' }] : [],
  } as unknown as Character;
  const sheet = { attacks: [], resources: [], slots: [4, 3, 2], skills: {}, proficiencies: { armor: [] },
    spellcasting: [{ classId: 'class:wizard@SRD', ability: 'int', dc: 14, attack: 6 }], scores: { int: 16 } } as unknown as Sheet;
  return { c, sheet };
};

describe('casting in the turn panel', () => {
  test('a character\'s spell carries its attack bonus or save DC and its dice', () => {
    const { c, sheet } = wizardWith(['Fire Bolt', 'Fireball']);
    const list = pcActions(c, sheet, []);
    expect(list.find((a) => a.name === 'Fire Bolt')!.cast).toMatchObject({ attack: 6 });
    expect(list.find((a) => a.name === 'Fire Bolt')!.cast!.read.attack).toBe('ranged');
    expect(list.find((a) => a.name === 'Fireball')!.cast).toMatchObject({ dc: 14, charLevel: 5, mod: 3 });
  });
  test('not proficient with the armor worn: no spells', () => {
    const { c, sheet } = wizardWith(['Fire Bolt'], 'heavy');
    const bolt = pcActions(c, sheet, []).find((a) => a.name === 'Fire Bolt')!;
    expect(problemOf(cb(), bolt, [], true)).toBe('not proficient with your armor');
  });
  test('after a bonus-action spell only an action cantrip; a bonus-action spell after another spell is refused', () => {
    const { c, sheet } = wizardWith(['Fire Bolt', 'Fireball', 'Misty Step']);
    const list = pcActions(c, sheet, []), get = (n: string) => list.find((a) => a.name === n)!;
    let k = applyUse(fight(cb()), cb(), get('Misty Step'));
    const x = k.combatants[0];
    expect(problemOf(x, get('Fireball'), [], true)).toMatch(/bonus-action spell/);
    expect(problemOf(x, get('Fire Bolt'), [], true)).toBeUndefined();
    k = applyUse(fight(cb()), cb(), get('Fireball'));
    expect(problemOf(k.combatants[0], get('Misty Step'), [], true)).toMatch(/already cast/);
  });
});

const cb = (o: Partial<Combatant> = {}): Combatant => ({ id: 'x', kind: 'monster', name: 'x', init: 10, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (x: Combatant): Combat => ({ campaignId: 'c', combatants: [x], round: 1, turn: x.id, groupMonsters: false, updatedAt: 0 });

describe('monster spellcasting', () => {
  test('the Mage\'s trait: DC 14, +6, a 9th-level caster, slots per level', () => {
    const book = readSpellcasting(mage.traits.find((t) => t.name === 'Spellcasting')!)!;
    expect(book).toMatchObject({ dc: 14, attack: 6, level: 9 });
    expect(book.groups.find((g) => g.slots?.level === 3)).toMatchObject({ slots: { level: 3, count: 3 }, spells: ['counterspell', 'fireball', 'fly'] });
    expect(book.groups[0]).toMatchObject({ atWill: true });
  });
  test('its spells are castable entries with uses from its slots; a cast spends a slot of that level', () => {
    const list = monsterActions(mage, { spell: (n) => byName.get(n), used: { 'slot:3': 1 } });
    const fb = list.find((a) => a.name === 'Fireball') as TurnAction;
    expect(fb).toMatchObject({ group: 'spell', cost: 'action', uses: { left: 2, max: 3 }, spend: 'slot:3' });
    expect(fb.cast).toMatchObject({ dc: 14, attack: 6, charLevel: 9 });
    expect(list.find((a) => a.name === 'Fire Bolt')?.uses).toBeUndefined(); // at will
    expect(list.find((a) => a.name === 'Shield')?.cost).toBe('reaction');
    const k = applyUse(fight(cb()), cb(), fb);
    expect(k.combatants[0].spellsUsed).toEqual({ 'slot:3': 1 });
  });
});

test('a light radius is not an area of effect (Light)', () => {
  expect(readSpell(spell('Light')).area).toBeUndefined();
});
