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
  test('darts that always hit: one more a slot level up, each dart its own roll', () => {
    const r = readSpell(fix('120 feet', 'You conjure three darts of force. Each dart hits a creature you choose within range, dealing 1d4 + 1 force damage.', 'One more dart for each slot level above 1st.'));
    expect(r.auto).toEqual({ count: 3, above: 1 });
    expect(diceAt(r, { slot: 3, level: 1 }).damage).toEqual(['1d4+1 force']);
    expect(readSpell(spell('Magic Missile')).auto).toEqual({ count: 3, above: 1 });
  });
  test('several rays or beams, each its own attack: more with a higher slot, or with character level', () => {
    const rays = readSpell(fix('120 feet', 'You make three rays of fire. Make a ranged spell attack for each ray. On a hit, the target takes 2d6 fire damage.', 'You make one additional ray for each slot level above 2nd.'));
    expect(rays.rays).toEqual({ count: 3, above: 2 });
    const beams = readSpell({ ...fix('120 feet', 'A beam streaks out. Make a ranged spell attack against the target. On a hit, it takes 1d10 force damage. The spell makes more than one beam as you grow: two beams at 5th level, three beams at 11th level, and four beams at 17th level.'), level: 0 });
    expect(beams.rays).toEqual({ count: 1, byLevel: true });
  });
  test('Chaos Bolt leaps 30 feet when its d8s match', () => {
    expect(readSpell({ ...fix('120 feet', 'Make a ranged spell attack. On a hit, the target takes 2d8 + 1d6 damage.'), name: 'Chaos Bolt' }).leap).toBe(30);
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

test('damage over time: entering the area and starting a turn there are both automated', () => {
  const beam = readSpell(fix('120 feet', 'A beam shines in a 5-foot-radius, 40-foot-high cylinder. A creature that enters the area for the first time on a turn or starts its turn there makes a Constitution saving throw, taking 2d10 radiant damage on a failed save.'));
  expect([beam.manual, beam.enters]).toEqual([undefined, true]);
  expect(readSpell(fix('120 feet', 'A cloud fills a 20-foot-radius sphere. A creature that starts its turn there makes a Constitution saving throw or takes 5d8 poison damage.')).manual).toBeUndefined();
});

test('damage over time with no area to place stays by hand', () => {
  expect(readSpell(fix('Self', 'Spirits surround you. A creature that starts its turn within 10 feet of you takes 1d8 cold damage.')).manual).toBe('Damage over time isn’t automated: apply it by hand.');
});

test('a mark that pays off on any attack (Hex) rides spell attacks too; one on weapon attacks (Hunter\'s Mark) does not', () => {
  expect(readSpell(fix('90 feet', 'You curse a creature. Until the spell ends, you deal an extra 1d6 necrotic damage to the target whenever you hit it with an attack.')).rider)
    .toEqual({ dice: '1d6', type: 'necrotic', marked: true, anyAttack: true });
});

test('a hit that slows: its speed cut, read from the wording', () => {
  expect(readSpell(fix('60 feet', 'Make a ranged spell attack. On a hit, it takes 1d8 cold damage, and its speed is reduced by 10 feet until the start of your next turn.')).slow).toEqual({ feet: 10 });
  expect(readSpell(spell('Ray of Frost')).slow).toEqual({ feet: 10 });
  expect(readSpell(spell('Fire Bolt')).slow).toBeUndefined();
});

// Every Spell, Task 1 (paraphrased wording, no book text): half damage on a save in any phrasing; a save only when one is forced.
describe('saves and half damage, by wording', () => {
  const sp = (p: string) => ({ level: 1, range: '60 feet', text: [{ p }] }) as unknown as SpellDef;
  test('half damage however a success is worded', () => {
    expect(readSpell(sp('Each creature must make a Constitution saving throw. On a failed save, a creature takes 2d8 thunder damage. On a successful save, the creature takes half as much damage and isn\'t pushed.')).onSave).toBe('half');
    expect(readSpell(sp('Each creature must make a Strength saving throw or take 2d6 necrotic damage. On a successful save, a creature takes half damage, but suffers no other effect.')).onSave).toBe('half');
    expect(readSpell(sp('Each creature must make a Strength saving throw or take 3d8 force damage. A creature that succeeds on its saving throw takes half as much damage and isn\'t knocked prone.')).onSave).toBe('half');
  });
  test('a save only when the target must make one', () => {
    expect(readSpell(sp('Until the spell ends, the target gains a +2 bonus to AC and has advantage on Dexterity saving throws.')).save).toBeUndefined();
    expect(readSpell(sp('You touch an object that sheds bright light. If you target an object held or worn by a hostile creature, that creature must succeed on a Dexterity saving throw to avoid the spell.')).save).toBeUndefined();
    expect(readSpell(sp('One creature of your choice must make a Wisdom saving throw or be frightened.')).save).toBe('Wis');
  });
});
test('a save worded in the plural or as a failure still counts; one made with advantage does not', () => {
  const sp = (p: string) => readSpell({ level: 1, range: '30 feet', text: [{ p }] } as unknown as SpellDef);
  expect(sp('Up to three creatures of your choice within range must make charisma saving throws.').save).toBe('Cha');
  expect(sp('Any creature in the area is outlined in light if it fails a dexterity saving throw.').save).toBe('Dex');
  expect(sp('You make Constitution saving throws with advantage.').save).toBeUndefined();
});

// Every Spell, Task 2 (paraphrased wording): range-Self attacks reach, every upcast wording, areas of your choice.
describe('ranges, upcasts and areas', () => {
  const sp = (p: string, range = 'Self', higher?: string) => readSpell({ level: 1, range, text: [{ p }], ...(higher && { higherLevels: [{ p: higher }] }) } as unknown as SpellDef);
  test('a range-Self attack reaches 5 ft in melee, or as far as it is thrown', () => {
    expect(sp('Make a melee spell attack against a creature within your reach. On a hit, the target takes 3d6 necrotic damage.').reach).toBe(5);
    expect(sp('You can hurl the flame at a creature within 30 feet of you. Make a ranged spell attack. On a hit, the target takes 1d8 fire damage.').reach).toBe(30);
    expect(sp('You or someone else can make a ranged spell attack with a pebble by throwing it, with a range of 60 feet. On a hit, the target takes 1d6 bludgeoning damage.', 'Touch').reach).toBe(60);
  });
  test('upcasts with a comma, or as extra damage per slot level', () => {
    expect(sp('The target must make a Dexterity saving throw or take 3d8 bludgeoning damage.', '60 feet', 'The damage increases by 1d8, for each slot level above 1st.').perSlot).toEqual({ dice: '1d8', above: 1, step: 1 });
    expect(sp('Make a ranged spell attack. On a hit, the target takes 2d8 + 1d6 damage.', '120 feet', 'Each target takes 1d6 extra damage of the type rolled for each slot level above 1st.').perSlot).toEqual({ dice: '1d6', above: 1, step: 1 });
  });
  test('creatures of your choice around you are an area; one creature of your choice is not', () => {
    expect(sp('Each creature of your choice that you can see within 5 feet of you must succeed on a Constitution saving throw or take 1d6 radiant damage.').area).toEqual({ shape: 'sphere', feet: 5, self: true });
    const lure = readSpell({ level: 0, range: 'Self (15-foot radius)', text: [{ p: 'One creature of your choice that you can see within 15 feet of you must succeed on a Strength saving throw or take 1d8 lightning damage.' }],
      mech: { save: ['strength'], area: { shape: 'sphere', feet: 15 } } } as unknown as SpellDef);
    expect(lure.area).toBeUndefined();
  });
  test('a blade cantrip is a weapon attack: no spell attack, and it says what to do', () => {
    const r = sp('You brandish the weapon used in the spell\'s casting and make a melee attack with it against one creature within 5 feet of you. On a hit, the target suffers the weapon attack\'s normal effects and then becomes sheathed in booming energy.');
    expect([r.attack, r.manual]).toEqual([undefined, 'Make the weapon attack, then apply its extra effect by hand.']);
  });
});
test('range Self: one creature within N feet saves at that reach; "has a range of"; a named line', () => {
  const sp = (p: string, range = 'Self') => readSpell({ level: 1, range, text: [{ p }] } as unknown as SpellDef);
  expect(sp('One creature of your choice that you can see within 15 feet of you must succeed on a Strength saving throw or take 1d8 lightning damage.').reach).toBe(15);
  expect(sp('You can make a ranged spell attack with the pebble. If thrown, it has a range of 60 feet. On a hit, the target takes 1d6 bludgeoning damage.', 'Touch').reach).toBe(60);
  expect(sp('A line of roaring flame 15 feet long and 5 feet wide extends from you. Each creature in the line must make a Dexterity saving throw, taking 4d8 fire damage on a failed save.').area).toEqual({ shape: 'line', feet: 15, width: 5, self: true });
});

// Every Spell, Task 3 (paraphrased wording): damage parts that are not a sum.
describe('damage parts', () => {
  const sp = (p: string, range = '60 feet') => readSpell({ level: 1, range, text: [{ p }] } as unknown as SpellDef);
  test('a die used instead when the target is hurt is an alternative', () => {
    const r = sp('The target must succeed on a Wisdom saving throw or take 1d8 necrotic damage. If the target is missing any of its hit points, it instead takes 1d12 necrotic damage.');
    expect(r.damage.map((d) => [d.dice, d.part])).toEqual([['1d8', undefined], ['1d12', 'alt']]);
  });
  test('one of two types by the caster: one roll, two choices', () => {
    const r = sp('An affected creature takes 3d8 radiant damage (if you are good or neutral) or 3d8 necrotic damage (if you are evil) on a failed Wisdom save.');
    expect([r.damage.length, r.damage[0].type, r.choices]).toEqual([1, '', ['radiant', 'necrotic']]);
  });
  test('damage at the end of the target\'s next turn comes later; a miss deals half the first part', () => {
    const r = sp('Make a ranged spell attack against the target. On a hit, the target takes 4d4 acid damage immediately and 2d4 acid damage at the end of its next turn. On a miss, the arrow splashes the target with acid for half as much of the initial damage and no damage at the end of its next turn.');
    expect([r.damage.map((d) => d.part), r.missHalf]).toEqual([[undefined, 'later'], true]);
  });
});
test('a cantrip\'s alternative die scales with it (Toll the Dead at 5th level)', () => {
  const r = { damage: [{ dice: '1d8', type: 'necrotic' }, { dice: '1d12', type: 'necrotic', part: 'alt' }], scaling: { 1: '1d8', 5: '2d8' } } as never;
  expect(diceAt(r, { level: 0, charLevel: 5 }).damage).toEqual(['2d8 necrotic', '2d12 necrotic']);
});

// Every Spell, Task 6 (paraphrased wording): how many creatures a helpful spell takes, and temporary hit points.
test('a helpful spell\'s target count, its upcast, and temp HP', () => {
  const sp = (p: string, higher?: string) => readSpell({ level: 1, range: '30 feet', text: [{ p }], ...(higher && { higherLevels: [{ p: higher }] }) } as unknown as SpellDef);
  expect(sp('You bless up to three creatures of your choice within range.', 'You can target one additional creature for each slot level above 1st.').targets).toEqual({ count: 3, above: 1 });
  expect(sp('You gain 1d4 + 4 temporary hit points for the duration.', 'You gain 5 additional temporary hit points for each slot level above 1st.').temp).toEqual({ dice: '1d4+4', perSlot: 5 });
});

// Every Spell, Task 9 (paraphrased wording): conditions by "falls"/"knocked", square and cylinder areas, and saves in a lingering area.
describe('the audit at zero: wording classes', () => {
  const sp = (p: string, name?: string) => readSpell({ level: 1, range: '60 feet', text: [{ p }], ...(name && { name }) } as unknown as SpellDef);
  test('a creature that falls or is knocked prone is Prone', () => {
    expect(sp('Each creature there must succeed on a Dexterity saving throw or fall prone.').conditions).toEqual(['Prone']);
    expect(sp('Each creature must make a Strength saving throw. On a failed save, the creature is knocked prone.').conditions).toEqual(['Prone']);
  });
  test('a square is a cube on the ground, a cylinder can give its radius after', () => {
    expect(sp('Ice covers the ground in a 10-foot square centered on a point within range. Each creature there must make a Dexterity saving throw.').area).toEqual({ shape: 'cube', feet: 10, self: false });
    expect(sp('Hail falls in a 20-foot-tall cylinder with a 40-foot radius centered on a point within range. Each creature there must make a Dexterity saving throw.').area).toEqual({ shape: 'cylinder', feet: 40, self: false });
  });
  test('saves a lingering area calls for, with no damage, say they are by hand', () => {
    expect(sp('Each creature that enters the area or ends its turn there must succeed on a Dexterity saving throw or fall prone.').manual).toMatch(/by hand/);
  });
  test('an "either … or" condition is the caster\'s pick: the save rolls, the condition is by hand', () => {
    const r = sp('The target must make a Constitution saving throw. If it fails, the target is either blinded or deafened (your choice).');
    expect([r.save, r.conditions, r.manual]).toEqual(['Con', undefined, expect.stringMatching(/by hand/)]);
  });
});
test('a flat amount of healing is read as healing (Heal)', () => {
  expect(readSpell({ level: 6, range: '60 feet', text: [{ p: 'A creature you choose within range regains 70 hit points.' }] } as unknown as SpellDef).heal).toEqual({ dice: '70', mod: false });
  expect(readSpell({ level: 7, range: 'Touch', text: [{ p: 'The target regains 4d8 + 15 hit points.' }] } as unknown as SpellDef).heal).toEqual({ dice: '4d8+15', mod: false });
});
// Final review: one creature plus one per slot (Longstrider), any number (Beacon of Hope), and a flat upcast (Heal).
test('upcast target counts and a flat healing upcast', () => {
  const sp = (p: string, higher?: string) => readSpell({ level: 1, range: 'Touch', text: [{ p }], ...(higher && { higherLevels: [{ p: higher }] }) } as unknown as SpellDef);
  expect(sp('You touch a creature. Its speed increases by 10 feet.', 'You can target one additional creature for each slot level above 1st.').targets).toEqual({ count: 1, above: 1 });
  expect(sp('Choose a humanoid you can see within range. It must succeed on a Wisdom saving throw.', 'You can target one additional humanoid for each slot level above 2nd.').targets).toEqual({ count: 1, above: 2 });
  expect(sp('Choose any number of creatures within range.').targets?.count).toBeGreaterThan(10);
  const heal = readSpell({ level: 6, range: '60 feet', text: [{ p: 'A creature you choose within range regains 70 hit points.' }], higherLevels: [{ p: 'The amount of healing increases by 10 for each slot level above 6th.' }] } as unknown as SpellDef);
  expect(diceAt(heal, { slot: 8, level: 6 }).heal).toBe('90');
});
test('an area that hurts a creature entering it is marked so, and says nothing is by hand', () => {
  const r = readSpell({ level: 5, range: '120 feet', duration: 'Concentration, up to 10 minutes', text: [{ p: 'You create a 20-foot-radius sphere of fog centered on a point within range. When a creature enters the spell\'s area for the first time on a turn or starts its turn there, that creature must make a Constitution saving throw. The creature takes 5d8 poison damage on a failed save, or half as much damage on a successful one.' }] } as unknown as SpellDef);
  expect([r.lingering, r.enters, r.manual]).toEqual([true, true, undefined]);
});
test('an area that hurts on entering and at the end of a turn (Incendiary Cloud): entering automated, never the start of a turn', () => {
  const r = readSpell({ level: 8, range: '150 feet', duration: 'Concentration, up to 1 minute', text: [{ p: 'A cloud fills a 20-foot-radius sphere centered on a point within range. When the cloud appears, each creature in it must make a Dexterity saving throw, taking 10d8 fire damage on a failed save, or half as much on a successful one. A creature must also make this saving throw when it enters the spell\'s area for the first time on a turn or ends its turn there.' }] } as unknown as SpellDef);
  expect([r.lingering, r.enters, r.noStart, r.manual]).toEqual([true, true, true, expect.stringMatching(/appears and at the end of a turn/)]);
});
