import { expect, test } from 'vitest';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { PlayerView } from '../../src/lib/types.ts';
import { enumerateChoices } from '../../src/lib/character/choices.ts';
import { featureList } from '../../src/lib/character/play.ts';
import type { Character, SubraceDef } from '../../src/lib/types.ts';
import { halfElf, human, mkChar } from '../fixtures/content.ts';

const S = DEFAULT_SETTINGS, dm = { settings: S, viewer: 'dm' as const };
test('a ranged weapon attack carries its normal and long range', () => {
  const c = mkChar({ race: 'human', base: { dex: 14 }, levels: ['fighter'], inventory: [['longbow', true]] });
  expect(computeSheet(c, dm).attacks.find(a => a.name === 'Longbow')).toMatchObject({ ranged: true, range: [150, 600] });
});

test('hill dwarf fighter 1', () => {
  const c = mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, levels: ['fighter'],
    answers: { optionalFeature: ['optionalFeature:defense@FIX'], skill: ['athletics', 'perception'] }, inventory: [['chain-mail', true], ['shield', true], ['longsword', true]] });
  const s = computeSheet(c, dm);
  expect([s.scores.con, s.scores.wis, s.ac, s.maxHp, s.prof, s.initiative, s.speed.walk, s.passivePerception]).toEqual([16, 13, 19, 14, 2, 1, 25, 13]);
  expect([s.saves.str.bonus, s.saves.con.bonus, s.saves.dex.bonus, s.skills.athletics.bonus, s.skills.perception.bonus]).toEqual([4, 5, 1, 4, 3]);
  expect(s.attacks.find(a => a.name === 'Longsword')).toMatchObject({ toHit: 4, damage: '1d8+2', damageType: 'slashing' });
  expect(s.attacks.find(a => a.name === 'Longsword')?.versatile).toBeUndefined(); // the shield takes the other hand
  const free = computeSheet({ ...c, inventory: c.inventory.map((e) => (e.item.armor?.category === 'shield' ? { ...e, equipped: false } : e)) }, dm);
  expect(free.attacks.find(a => a.name === 'Longsword')?.versatile).toBe('1d10+2');
});
test('heavy armor strength', () => {
  const weak = (race: string) => computeSheet(mkChar({ race, base: { str: 11 }, levels: ['fighter'], inventory: [['chain-mail', true]] }), dm).speed.walk; // human 12, dwarf 11: both under 13
  expect([weak('human'), weak('dwarf')]).toEqual([20, 25]);
});
test('AC variants', () => {
  const ac = (o: Parameters<typeof mkChar>[0]) => computeSheet(mkChar(o), dm).ac;
  expect(ac({ race: 'human', base: { dex: 15, wis: 15 }, levels: ['monk'] })).toBe(16); // human +1: dex16 wis16 → 10+3+3
  expect(ac({ race: 'human', base: { dex: 15, wis: 15 }, levels: ['monk'], inventory: [['shield', true]] })).toBe(15);
  expect(ac({ race: 'human', base: { dex: 13, con: 15 }, levels: ['barbarian'], inventory: [['shield', true]] })).toBe(17);
  expect(ac({ race: 'human', base: { dex: 17 }, levels: ['fighter'], inventory: [['half-plate', true]] })).toBe(17);
});
test('Mage Armor on a character: base AC 13 + Dex with no armor (a shield still adds); worn armor wins', () => {
  const ac = (o: Parameters<typeof mkChar>[0]) => { const c = mkChar(o); return computeSheet({ ...c, state: { ...c.state, conditions: ['Mage Armor'] } }, dm).ac; };
  expect(ac({ race: 'human', base: { dex: 15 }, levels: ['fighter'] })).toBe(16); // human +1: dex16 → 13+3
  expect(ac({ race: 'human', base: { dex: 15 }, levels: ['fighter'], inventory: [['shield', true]] })).toBe(18);
  expect(ac({ race: 'human', base: { dex: 17 }, levels: ['fighter'], inventory: [['half-plate', true]] })).toBe(17);
});
test('proficiency variants', () => {
  const bard = computeSheet(mkChar({ race: 'human', base: { dex: 13, int: 9 }, levels: ['bard', 'bard'] }), dm);
  expect([bard.initiative, bard.skills.arcana.bonus]).toEqual([3, 1]);
  const rogue = computeSheet(mkChar({ race: 'human', base: { dex: 15 }, levels: ['rogue'], answers: { skill: ['stealth', 'acrobatics', 'perception', 'insight'], expertise: ['stealth', 'acrobatics'] } }), dm);
  expect(rogue.skills.stealth.bonus).toBe(7);
});
test('spellcasting and slots', () => {
  const wiz = computeSheet(mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard'] }), dm);
  expect(wiz.spellcasting[0]).toMatchObject({ dc: 13, attack: 5, cantrips: 3, prepared: 4 });
  expect(wiz.slots).toEqual([2]);
  const mc = computeSheet(mkChar({ race: 'human', base: { int: 15, wis: 13 }, levels: ['wizard', 'wizard', 'wizard', 'cleric', 'cleric'] }), dm);
  expect([mc.slots, mc.saves.int.proficient, mc.saves.wis.proficient]).toEqual([[4, 3, 2], true, true]);
  expect(computeSheet(mkChar({ race: 'human', base: {}, levels: ['warlock', 'warlock', 'warlock'] }), dm)).toMatchObject({ slots: [], pact: { slots: 2, level: 2 } });
});
test('items: attunement, player view, setScore, override', () => {
  const ring = (attuned: boolean, view?: PlayerView) => mkChar({ race: 'human', base: {}, levels: ['fighter'], inventory: [['ring-of-protection', true, attuned, view]] });
  expect([computeSheet(ring(true), dm).ac, computeSheet(ring(false), dm).ac]).toEqual([11, 10]);
  const hidden = ring(true, { hidden: ['bonuses'], revealed: [] });
  expect([computeSheet(hidden, { settings: S, viewer: 'player' }).ac, computeSheet(hidden, dm).ac]).toEqual([10, 11]);
  const g = (str: number) => computeSheet(mkChar({ race: 'human', base: { str: str - 1 }, levels: ['fighter'], inventory: [['gauntlets-of-ogre-power', true, true]] }), dm).scores.str;
  expect([g(15), g(20)]).toEqual([19, 20]);
  const o = computeSheet({ ...ring(true), overrides: { ac: 25 } }, dm);
  expect([o.ac, o.overridden]).toEqual([25, ['ac']]);
});
test('initiative is a Dex check (R21)', () => {
  const champ = mkChar({ race: 'human', base: { dex: 13 }, levels: Array(7).fill('fighter'), answers: { subclass: ['subclass:champion@FIX'] } });
  expect(computeSheet(champ, dm).initiative).toBe(4); // dex 14: 2 + ceil(3/2) from Remarkable Athlete
});
test('class-sourced hpPerLevel counts per level of that class (R22)', () => {
  const hp = (levels: string[]) => computeSheet(mkChar({ race: 'human', base: { con: 9 }, levels, answers: { subclass: ['subclass:draconic@FIX'] } }), dm).maxHp;
  expect([hp(['sorcerer', 'fighter']), hp(['sorcerer', 'sorcerer'])]).toEqual([6 + 1 + 6, 6 + 1 + 4 + 1]); // con 10: +0
});
test('martial arts (R23)', () => {
  const unarmed = computeSheet(mkChar({ race: 'human', base: { dex: 15, str: 9 }, levels: ['monk'] }), dm).attacks.find(a => a.entryId === 'unarmed');
  expect(unarmed).toMatchObject({ toHit: 5, damage: '1d4+3' });
  const monk5 = computeSheet(mkChar({ race: 'human', base: { dex: 15, str: 9 }, levels: Array(5).fill('monk'), inventory: [['quarterstaff', true]] }), dm);
  expect(monk5.attacks.find(a => a.name === 'Quarterstaff')).toMatchObject({ damage: '1d6+3', versatile: '1d8+3' });
  expect(monk5.attacks.find(a => a.entryId === 'unarmed')!.damage).toBe('1d6+3');
});
test('custom origin replaces racial ability choices (R24)', () => {
  const c = mkChar({ race: 'half-elf', base: {}, levels: ['fighter'], answers: { ability: ['str', 'wis'] } });
  expect(computeSheet(c, dm).scores).toMatchObject({ str: 11, wis: 11, cha: 12, dex: 10 });
  c.build.customOrigin = { dex: 2, con: 1 };
  expect(computeSheet(c, dm).scores).toEqual({ str: 10, dex: 12, con: 11, int: 10, wis: 10, cha: 10 });
});
test('skill and expertise answers are names: no "Missing" warnings', () => {
  const rogue = mkChar({ race: 'human', base: {}, levels: ['rogue'], answers: { skill: ['stealth', 'acrobatics', 'perception', 'insight'], expertise: ['stealth', 'acrobatics'] } });
  expect(computeSheet(rogue, dm).warnings).toEqual([]);
});
test('robust to missing content; encumbrance; resources', () => {
  const broken = mkChar({ race: 'human', base: {}, levels: ['fighter'] }); broken.build.levels.push({ classId: 'class:nope@X' });
  expect(() => computeSheet(broken, dm)).not.toThrow();
  expect(computeSheet(broken, dm).warnings).toContain('Missing class: class:nope@X');
  const heavy = mkChar({ race: 'human', base: { str: 9 }, levels: ['fighter'], inventory: [['sack-of-60lb', false]] });
  expect(computeSheet(heavy, { settings: { ...S, encumbrance: 'variant' }, viewer: 'dm' })).toMatchObject({ carrying: { encumbrance: 'encumbered' }, speed: { walk: 20 } });
  const monk5 = computeSheet(mkChar({ race: 'human', base: {}, levels: Array(5).fill('monk') }), dm);
  expect(monk5.resources.find(r => r.name === 'Ki')).toEqual({ name: 'Ki', max: 5, recharge: 'short' });
  const bard5 = computeSheet(mkChar({ race: 'human', base: { cha: 15 }, levels: Array(5).fill('bard') }), dm);
  expect(bard5.resources.find(r => r.name === 'Bardic Inspiration')).toEqual({ name: 'Bardic Inspiration', max: 3, recharge: 'short' });
});

// A 5etools subrace with `overwrite` replaces the race's fields instead of adding to them.
const sub = (o: Partial<SubraceDef> & Pick<SubraceDef, 'id' | 'raceId'>): SubraceDef =>
  ({ kind: 'subrace', name: o.id, source: 'OTH', text: [], abilityBonuses: {}, proficiencies: { armor: [], weapons: [], tools: [], skills: [], languages: [] }, traits: [], ...o });
const withSub = (c: Character, s: SubraceDef, abilities?: Record<string, number>): Character => {
  c.build.subraceId = s.id;
  c.embedded[s.id] = s;
  const p = enumerateChoices(c, id => c.embedded[id], S).find(p => p.sourceId === s.id && p.choice.type === 'ability');
  if (p && abilities) c.build.choices[p.key] = { type: 'abilities', abilities };
  return c;
};
test('subrace overwrite: Variant Human replaces the +1 to every score with +1 to two', () => {
  const vh = sub({ id: 'subrace:variant-human@OTH', raceId: human.id, overwrite: ['ability'], choices: [{ type: 'ability', count: 2, amount: 1, from: ['str', 'dex', 'con', 'int', 'wis', 'cha'] }] });
  const s = computeSheet(withSub(mkChar({ race: 'human', base: {}, levels: ['fighter'] }), vh, { str: 1, dex: 1 }), dm);
  expect([s.scores.str, s.scores.dex, s.scores.con, s.scores.wis]).toEqual([11, 11, 10, 10]);
  // Without overwrite the subrace adds to the race (Hill Dwarf: Dwarf's +2 Con and its own +1 Wis).
  const hd = computeSheet(mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: {}, levels: ['fighter'] }), dm);
  expect([hd.scores.con, hd.scores.wis]).toEqual([12, 11]);
});
test('subrace overwrite: race ability and skill choices drop, other race choices keep their keys; overwritten traits drop', () => {
  const elf = { ...halfElf, choices: [...halfElf.choices!, { type: 'skill' as const, count: 2, from: 'any' as const }, { type: 'language' as const, count: 1 }], traits: [{ name: 'Skill Versatility', text: [] }, { name: 'Fey Ancestry', text: [] }] };
  const drow = sub({ id: 'subrace:drow-descent@OTH', raceId: elf.id, abilityBonuses: { dex: 2 }, overwrite: ['ability', 'skills'], overwriteTraits: ['Skill Versatility'],
    proficiencies: { armor: [], weapons: [], tools: [], skills: ['perception'], languages: [] }, traits: [{ name: 'Drow Magic', text: [] }] });
  const c = mkChar({ race: 'half-elf', base: {}, levels: ['fighter'] });
  c.embedded[elf.id] = elf;
  withSub(c, drow);
  const race = enumerateChoices(c, id => c.embedded[id], S).filter(p => p.sourceId === elf.id).map(p => p.key);
  expect(race).toEqual([`0|${elf.id}|2`]); // the language choice keeps index 2
  const s = computeSheet(c, dm);
  expect([s.scores.cha, s.scores.dex, s.skills.perception.proficient]).toEqual([10, 12, true]);
  expect(featureList(c, S).map(f => f.name)).toEqual(expect.arrayContaining(['Fey Ancestry', 'Drow Magic']));
  expect(featureList(c, S).map(f => f.name)).not.toContain('Skill Versatility');
});
