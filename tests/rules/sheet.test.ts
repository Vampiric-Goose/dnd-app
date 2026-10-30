import { expect, test } from 'vitest';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { PlayerView } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';

const S = DEFAULT_SETTINGS, dm = { settings: S, viewer: 'dm' as const };
test('hill dwarf fighter 1', () => {
  const c = mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, levels: ['fighter'],
    answers: { optionalFeature: ['optionalFeature:defense@FIX'], skill: ['athletics', 'perception'] }, inventory: [['chain-mail', true], ['shield', true], ['longsword', true]] });
  const s = computeSheet(c, dm);
  expect([s.scores.con, s.scores.wis, s.ac, s.maxHp, s.prof, s.initiative, s.speed.walk, s.passivePerception]).toEqual([16, 13, 19, 14, 2, 1, 25, 13]);
  expect([s.saves.str.bonus, s.saves.con.bonus, s.saves.dex.bonus, s.skills.athletics.bonus, s.skills.perception.bonus]).toEqual([4, 5, 1, 4, 3]);
  expect(s.attacks.find(a => a.name === 'Longsword')).toMatchObject({ toHit: 4, damage: '1d8+2', versatile: '1d10+2', damageType: 'slashing' });
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
