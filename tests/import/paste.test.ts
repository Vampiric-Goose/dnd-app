import { expect, test } from 'vitest';
import { cleanPasted } from '../../src/lib/import/paste/clean.ts';
import { parseItemText } from '../../src/lib/import/paste/item.ts';
import { parseMonsterText } from '../../src/lib/import/paste/monster.ts';
import { parseSpellText } from '../../src/lib/import/paste/spell.ts';
import { soundMonster } from '../../src/lib/monsters/homebrew.ts';

// Every stat block here is invented for these tests (never book text).
const BOG_LURKER = `Bog Lurker
Medium monstrosity, neutral evil
Armor Class 13 (natural armor)
Hit Points 33 (6d8 + 6)
Speed 20 ft., swim 40 ft.
STR DEX CON INT WIS CHA
14 (+2) 12 (+1) 13 (+1) 6 (-2) 11 (+0) 5 (-3)
Saving Throws Con +3, Wis +2
Skills Stealth +5, Perception +2
Damage Vulnerabilities fire
Damage Resistances cold; bludgeoning, piercing, and slashing from nonmagical attacks
Damage Immunities poison
Condition Immunities poisoned, prone
Senses darkvision 60 ft., passive Perception 12
Languages understands Common but can't speak
Challenge 2 (450 XP)
Proficiency Bonus +2
Mire Camouflage. The lurker has advantage on Dexterity (Stealth) checks made in swamps.
Hold Breath. The lurker can hold its breath for 1 hour.
Actions
Multiattack. The lurker makes two attacks: one with its bite and one with its tendrils.
Bite. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (1d10 + 2) piercing damage.
Tendrils. Melee Weapon Attack: +4 to hit, reach 10 ft., one target. Hit: 5 (1d6 + 2) bludgeoning damage, and the target is grappled (escape DC 12).
Bonus Actions
Sink. The lurker submerges in mud or water.
Reactions
Slip Away. When a creature misses the lurker with a melee attack, the lurker moves 10 feet.
Legendary Actions
The bog lurker can take 2 legendary actions, choosing from the options below.
Lunge. The lurker makes a bite attack.
Lair Actions
The swamp bubbles. Each creature in the mud must succeed on a DC 11 Strength saving throw or be restrained.
Regional Effects
Fog rolls in within a mile of the lair.`;

test('cleanPasted: ligatures, numeric minus signs, broken lines', () => {
  expect(cleanPasted('ﬁve −1 and 1d4 – 2 — none')).toBe('five -1 and 1d4 - 2 — none');
  expect(cleanPasted('The lurker has advantage on\nchecks made in swamps.\nHold Breath.')).toBe('The lurker has advantage on checks made in swamps.\nHold Breath.');
  expect(cleanPasted('a grap-\npled target')).toBe('a grappled target');
});

test('every listed monster field parses', () => {
  const { draft: m, notes } = parseMonsterText(BOG_LURKER);
  expect(notes).toEqual([]);
  expect(m).toMatchObject({
    name: 'Bog Lurker', size: ['M'], type: 'monstrosity', alignment: 'neutral evil', source: 'HOMEBREW',
    ac: [{ value: 13, from: 'natural armor' }], hp: { average: 33, formula: '6d8 + 6' }, speed: { walk: 20, swim: 40 },
    scores: { str: 14, dex: 12, con: 13, int: 6, wis: 11, cha: 5 }, saves: { con: 3, wis: 2 }, skills: { stealth: 5, perception: 2 },
    vulnerable: ['fire'], resist: ['cold', 'bludgeoning, piercing, and slashing from nonmagical attacks'], immune: ['poison'], conditionImmune: ['poisoned', 'prone'],
    senses: ['darkvision 60 ft.'], passive: 12, languages: ["understands Common but can't speak"], cr: '2',
  });
  expect(m.id).toMatch(/^monster:homebrew-.*@HOMEBREW$/);
  expect(m.xp).toBeUndefined(); // 450 is CR 2's own XP
  expect(m.traits.map((t) => t.name)).toEqual(['Mire Camouflage', 'Hold Breath']);
  expect(m.actions.map((t) => t.name)).toEqual(['Multiattack', 'Bite', 'Tendrils']);
  expect(m.actions[1].text).toEqual([{ p: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (1d10 + 2) piercing damage.' }]);
  expect(m.bonusActions.map((t) => t.name)).toEqual(['Sink']);
  expect(m.reactions.map((t) => t.name)).toEqual(['Slip Away']);
  expect(m.legendary.map((t) => t.name)).toEqual(['Lunge']);
  expect(m.legendaryCount).toBe(2);
  expect(m.lair).toEqual([{ p: 'The swamp bubbles. Each creature in the mud must succeed on a DC 11 Strength saving throw or be restrained.' }]);
  expect(m.regional).toEqual([{ p: 'Fog rolls in within a mile of the lair.' }]);
  expect(soundMonster(m)).toBe(true);
});

test('Review Focus 5: broken lines, minus signs, a ligature, no Senses, pasted twice', () => {
  const messy = BOG_LURKER
    .replace('Mire Camouflage. The lurker has advantage on Dexterity (Stealth) checks made in swamps.', 'Mire Camouﬂage. The lurker has advantage on\nDexterity (Stealth) checks made in\nswamps.')
    .replace('6 (-2) 11 (+0) 5 (-3)', '6 (−2)\n11 (+0)\n5 (–3)')
    .replace('Senses darkvision 60 ft., passive Perception 12\n', '');
  const run = () => parseMonsterText(`${messy}\n${messy}`);
  expect(run).not.toThrow();
  const { draft: m, notes } = run();
  expect(m.name).toBe('Bog Lurker');
  expect(m.scores).toEqual({ str: 14, dex: 12, con: 13, int: 6, wis: 11, cha: 5 });
  expect(m.traits[0]).toEqual({ name: 'Mire Camouflage', text: [{ p: 'The lurker has advantage on Dexterity (Stealth) checks made in swamps.' }] });
  expect(m.actions.map((t) => t.name)).toEqual(['Multiattack', 'Bite', 'Tendrils']); // the second copy didn't add a second set
  expect(m.passive).toBe(12); // 10 + Perception +2
  expect(notes.join(' ')).toMatch(/appears twice/);
  expect(notes.join(' ')).toMatch(/No Senses line/);
  expect(soundMonster(m)).toBe(true);
});

test('an empty paste gives a blank draft and a note; junk lines go into a trait with a note', () => {
  const empty = parseMonsterText('');
  expect(empty.draft.name).toBe('Pasted monster');
  expect(empty.notes).toEqual(['Nothing to read: paste a stat block.']);
  expect(soundMonster(empty.draft)).toBe(true);
  const junk = parseMonsterText('Bog Lurker\nMedium monstrosity, neutral evil\nArmor Class 13\n@@@ smudge @@@\nMire Camouflage. Hides well.');
  expect(junk.draft.traits[0].text).toEqual([{ p: 'Hides well.' }, { p: '@@@ smudge @@@' }]);
  expect(junk.notes.join(' ')).toMatch(/not recognised.*Mire Camouflage/);
});

test('spell: every field of an invented "Ember Lattice" and its higher-levels paragraph', () => {
  const { draft: s, notes } = parseSpellText(`Ember Lattice
2nd-level evocation (ritual)
Casting Time: 1 action
Range: 60 feet
Components: V, S, M (a pinch of ash)
Duration: Concentration, up to 1 minute
Classes: Sorcerer, Wizard
A lattice of glowing embers fills a 10-foot cube within range. Each creature that
enters it takes 2d6 fire damage.
At Higher Levels. When you cast this spell using a spell slot of 3rd level or higher, the damage increases by 1d6 for each slot level above 2nd.`);
  expect(notes).toEqual([]);
  expect(s).toMatchObject({
    name: 'Ember Lattice', level: 2, school: 'evocation', ritual: true, castingTime: '1 action', range: '60 feet',
    components: { v: true, s: true, m: 'a pinch of ash' }, duration: 'Up to 1 minute', concentration: true, classes: ['sorcerer', 'wizard'], source: 'MYSPELLS',
    text: [{ p: 'A lattice of glowing embers fills a 10-foot cube within range. Each creature that enters it takes 2d6 fire damage.' }],
    higherLevels: [{ p: 'When you cast this spell using a spell slot of 3rd level or higher, the damage increases by 1d6 for each slot level above 2nd.' }],
  });
  expect(s.id).toMatch(/^spell:homebrew-.*@MYSPELLS$/);
  expect(parseSpellText('Spark Flick\nEvocation cantrip').draft).toMatchObject({ level: 0, school: 'evocation' });
});

test('item: type, rarity and attunement', () => {
  const { draft: it, notes } = parseItemText('Cloak of Moth Wings\nWondrous item, very rare (requires attunement by a sorcerer or wizard)\nWhile wearing this cloak you can\nglide on silent wings.');
  expect(notes).toEqual([]);
  expect(it).toMatchObject({ name: 'Cloak of Moth Wings', type: 'wondrous', rarity: 'very rare', attunement: 'by a sorcerer or wizard', magic: true, text: [{ p: 'While wearing this cloak you can glide on silent wings.' }] });
  expect(it.id).toMatch(/^item:homebrew-.*@HOMEBREW$/);
  const blade = parseItemText('Ashen Edge\nWeapon (longsword), uncommon\nYou gain a +1 bonus.');
  expect(blade.draft).toMatchObject({ type: 'weapon', rarity: 'uncommon' });
  expect(blade.draft.attunement).toBeUndefined();
  expect(blade.notes.join(' ')).toMatch(/longsword/);
});
