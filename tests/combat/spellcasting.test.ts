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

// More wording, from paraphrased fixtures: areas around the caster named by distance, damage whose type is chosen, darts that always hit.
const fix = (range: string, p: string, h?: string) => ({ level: 1, range, text: [{ p }], ...(h && { higherLevels: [{ p: h }] }) }) as unknown as SpellDef;
describe('reading a spell: one-off rule, then book mechanics, then wording', () => {
  test('mechanics fill what the wording lacks; the rule table wins over both', () => {
    const plain = fix('120 feet', 'A bolt of energy flies at the target, which takes 2d8 damage.');
    expect(readSpell({ ...plain, mech: { attack: 'ranged', types: ['fire'] } })).toMatchObject({ attack: 'ranged', damage: [{ dice: '2d8', type: 'fire' }] });
    const burst = fix('Self (10-foot radius)', 'Every creature nearby makes a Dexterity saving throw or takes 2d6 fire damage.');
    expect(readSpell({ ...burst, mech: { area: { shape: 'sphere', feet: 10 } } }).area).toEqual({ shape: 'sphere', feet: 10, self: true });
    expect(readSpell({ ...fix('120 feet', 'Make a ranged spell attack. On a hit, the target takes 2d8 + 1d6 damage.'), name: 'Chaos Bolt' }).typeFromDie?.sides).toBe(8);
  });
  test('two listed saves: the one the wording names', () => {
    expect(readSpell({ ...fix('60 feet', 'The target makes a Strength saving throw or falls.'), mech: { save: ['dex', 'str'] } }).save).toBe('Str');
    expect(readSpell({ ...fix('60 feet', 'The target resists or falls.'), mech: { save: ['dex', 'str'] } }).save).toBe('Dex');
  });
  test('without mechanics the reading is unchanged', () => {
    expect(readSpell(spell('Fireball'))).toEqual(readSpell({ ...spell('Fireball'), mech: undefined }));
  });
  test('scaling dice from the book table', () => {
    const r = readSpell({ ...fix('5 feet', 'Each creature within range must make a Constitution saving throw or take 1d6 thunder damage.'), level: 0,
      mech: { scaling: { 1: '1d6', 5: '2d6', 11: '3d6', 17: '4d6' } } });
    expect(diceAt(r, { level: 0, charLevel: 11 }).damage[0]).toBe('3d6 thunder');
    expect(diceAt(r, { level: 0, charLevel: 4 }).damage[0]).toBe('1d6 thunder');
  });
  test('conditions from the wording, or from the book', () => {
    expect(readSpell(fix('60 feet', 'The target must succeed on a Wisdom saving throw or be paralyzed for the duration.')).conditions).toEqual(['Paralyzed']);
    expect(readSpell({ ...fix('60 feet', 'The target must succeed on a Wisdom saving throw or be held.'), mech: { conditions: ['Paralyzed'] } }).conditions).toEqual(['Paralyzed']);
  });
});

test('how long a spell lasts, in rounds', () => {
  const at = (duration: string) => readSpell({ ...fix('60 feet', 'Something happens.'), duration }).rounds;
  expect([at('Concentration, up to 1 minute'), at('1 round'), at('8 hours'), at('Instantaneous')]).toEqual([10, 1, 4800, undefined]);
});

describe('never silently wrong', () => {
  test('what can’t be automated says so', () => {
    expect(readSpell(fix('Touch', 'Until the spell ends, the weapon deals an extra 1d4 damage of the chosen type when it hits.')).manual)
      .toBe('Extra damage on weapon hits isn’t automated: apply it by hand.');
    expect(readSpell(fix('120 feet', 'A ring of light rises. A creature that enters the area for the first time on a turn makes a Constitution saving throw or takes 2d10 radiant damage.')).manual)
      .toBe('Damage over time isn’t automated: apply it by hand.');
    expect(readSpell({ ...fix('Touch', 'The target is wreathed in energy for the duration.'), mech: { types: ['fire'] } }).manual)
      .toBe('Its damage isn’t automated: apply it by hand.');
    expect(readSpell({ ...fix('Self', 'You vanish from sight.'), mech: { conditions: ['Invisible'] } }).manual)
      .toBe('Its effect isn’t automated: apply it by hand.');
    expect(readSpell(spell('Fireball')).manual).toBeUndefined();
  });
});

describe('reading a spell: wording without a named shape', () => {
  test('a save against every creature within N feet of you is a burst around the caster; an aura with no save is not', () => {
    expect(readSpell(fix('Self (10-foot radius)', 'Shadows lash all creatures within 10 feet of you. Each one must make a Strength saving throw or take 2d6 necrotic damage.')).area)
      .toEqual({ shape: 'sphere', feet: 10, self: true });
    expect(readSpell(fix('Self', 'Each creature you choose within 30 feet of you must succeed on a Constitution saving throw or take 5d6 thunder damage.')).area)
      .toEqual({ shape: 'sphere', feet: 30, self: true });
    expect(readSpell(fix('Self (30-foot radius)', 'Each friendly creature within 30 feet of you deals an extra 1d4 radiant damage when it hits.')).area).toBeUndefined();
  });
  test('"each creature within range" bursts from the caster as far as the range', () => {
    expect(readSpell(fix('5 feet', 'A loud crack. Each creature within range, other than you, must make a Constitution saving throw or take 1d6 thunder damage.')).area)
      .toEqual({ shape: 'sphere', feet: 5, self: true });
  });
  test('a beam given as "W-foot-wide, L-foot-long line"', () => {
    expect(readSpell(fix('Self (60-foot line)', 'Light streams from you in a 5-foot-wide, 60-foot-long line. Each creature in the line must make a Constitution saving throw or take 6d8 radiant damage.')).area)
      .toEqual({ shape: 'line', feet: 60, width: 5, self: true });
  });
  test('damage of a type picked from those the spell names; extra damage that only rides on later hits is not read', () => {
    const orb = readSpell(fix('90 feet', 'Pick acid, cold or fire for the orb, then make a ranged spell attack. On a hit, the target takes 3d8 damage of the type you picked.'));
    expect(orb).toMatchObject({ damage: [{ dice: '3d8', type: '' }], choices: ['acid', 'cold', 'fire'] });
    const bolt = readSpell(fix('120 feet', 'Make a ranged spell attack. On a hit, the target takes 2d8 + 1d6 damage. One of the d8s sets the type:\n1 | Acid\n2 | Force\n3 | Thunder'));
    expect(bolt).toMatchObject({ damage: [{ dice: '2d8+1d6', type: '' }], choices: ['acid', 'force', 'thunder'] });
    expect(readSpell(fix('90 feet', 'The target must make a Constitution saving throw. Until the spell ends, it takes an extra 2d6 damage of the type you chose when hit.')).damage).toEqual([]);
    // one type word is no list to pick from (here it is the verb "fire"): every type is offered
    expect(readSpell(fix('Self (60-foot cone)', 'You fire a hail of arrows in a 60-foot cone. Each creature there makes a Dexterity saving throw and takes 3d8 damage of the ammunition\'s type on a failure.')).choices).toHaveLength(13);
  });
  test('"X or Y damage (your choice)" offers just those two', () => {
    const r = readSpell(fix('Self', 'Each creature you choose within 30 feet of you must succeed on a Constitution saving throw or take 5d6 thunder damage and 5d6 radiant or necrotic damage (your choice).'));
    expect(r).toMatchObject({ damage: [{ dice: '5d6', type: 'thunder' }, { dice: '5d6', type: '' }], choices: ['radiant', 'necrotic'] });
  });
  test('darts that always hit: one more a slot level up, all of them at the one target', () => {
    const r = readSpell(fix('120 feet', 'You conjure three darts of force. Each dart hits a creature you choose within range, dealing 1d4 + 1 force damage.', 'One more dart for each slot level above 1st.'));
    expect(r.auto).toEqual({ count: 3, above: 1 });
    expect(diceAt(r, { slot: 1, level: 1 }).damage).toEqual(['3d4+3 force']);
    expect(diceAt(r, { slot: 3, level: 1 }).damage).toEqual(['5d4+5 force']);
    expect(readSpell(spell('Magic Missile')).auto).toEqual({ count: 3, above: 1 });
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

test('a save repeated at the end of each turn', () => {
  expect(readSpell(fix('60 feet', 'The target makes a Wisdom saving throw or is paralyzed. At the end of each of its turns, the target can make another Wisdom saving throw.')).repeat).toBe(true);
  expect(readSpell(spell('Fireball')).repeat).toBeUndefined();
});

describe('extra damage on weapon hits', () => {
  test('the next hit, every weapon hit, or hits on a marked target', () => {
    const once = readSpell(fix('Self', 'The next time you hit a creature with a weapon attack, the attack deals an extra 2d6 radiant damage.'));
    expect([once.rider, once.manual]).toEqual([{ dice: '2d6', type: 'radiant', once: true }, undefined]);
    expect(readSpell(fix('Self', 'Your weapon attacks deal an extra 1d4 radiant damage on a hit.')).rider).toEqual({ dice: '1d4', type: 'radiant' });
    expect(readSpell(fix('90 feet', 'You mark a creature. Until the spell ends, you deal an extra 1d6 damage to the target whenever you hit it with a weapon attack.')).rider)
      .toEqual({ dice: '1d6', type: '', marked: true });
  });
});

test('damage over time: only entering the area stays by hand', () => {
  expect(readSpell(fix('120 feet', 'A beam shines in a 5-foot-radius, 40-foot-high cylinder. A creature that enters the area for the first time on a turn or starts its turn there makes a Constitution saving throw, taking 2d10 radiant damage on a failed save.')).manual)
    .toBe('Entering the area isn’t automated, only starting a turn in it.');
  expect(readSpell(fix('120 feet', 'A cloud fills a 20-foot-radius sphere. A creature that starts its turn there makes a Constitution saving throw or takes 5d8 poison damage.')).manual).toBeUndefined();
});

test('damage over time with no area to place stays by hand', () => {
  expect(readSpell(fix('Self', 'Spirits surround you. A creature that starts its turn near you takes 1d8 cold damage.')).manual).toBe('Damage over time isn’t automated: apply it by hand.');
});
