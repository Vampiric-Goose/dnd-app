import { expect, test } from 'vitest';
import { addLevel, answerChoice, embedContent, listChoices, newCharacter, spellLimits, validateCharacter } from '../../src/lib/character/build.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { fixtureIndex, mkChar } from '../fixtures/content.ts';

const idx = fixtureIndex(), S = DEFAULT_SETTINGS;
test('choices appear per level and after subclass', () => {
  let c = mkChar({ race: 'human', base: { str: 15 }, levels: ['fighter'] });
  const l1 = listChoices(c, idx, S);
  expect(l1.map(p => p.choice.type)).toEqual(expect.arrayContaining(['skill', 'optionalFeature']));
  expect(l1.find(p => p.choice.type === 'skill')!.key).toBe('1|class:fighter@FIX/skills|0');
  c = addLevel(addLevel(c, 'class:fighter@FIX', idx, S).character, 'class:fighter@FIX', idx, S).character;
  const sub = listChoices(c, idx, S).find(p => p.choice.type === 'subclass')!;
  c = answerChoice(c, sub.key, { type: 'ids', ids: ['subclass:champion@FIX'] });
  expect(c.build.subclasses['class:fighter@FIX']).toBe('subclass:champion@FIX');
  expect(Object.keys(embedContent(c, idx).embedded)).toContain('feature:fighter:champion:improved-critical:3@FIX');
  c = addLevel(c, 'class:fighter@FIX', idx, S).character;
  expect(listChoices(c, idx, S).some(p => p.level === 4 && p.choice.type === 'asi')).toBe(true);
});
test('ASI caps at 20', () => {
  let c = mkChar({ race: 'human', base: { str: 18 }, levels: ['fighter', 'fighter', 'fighter', 'fighter'] });
  const asi = listChoices(c, idx, S).find(p => p.choice.type === 'asi')!;
  c = embedContent(answerChoice(c, asi.key, { type: 'asi', abilities: { str: 2 } }), idx);
  expect(computeSheet(c, { settings: S, viewer: 'dm' }).scores.str).toBe(20);
});
test('multiclass prerequisites, overrides setting', () => {
  const c = mkChar({ race: 'human', base: { str: 15, int: 11 }, levels: ['fighter'] }); // int 12 after human +1
  expect(addLevel(c, 'class:wizard@FIX', idx, S).problems[0]).toMatchObject({ message: 'Multiclassing into Wizard needs Int 13', blocking: true });
  expect(addLevel(c, 'class:wizard@FIX', idx, { ...S, allowOverrides: true }).problems[0].blocking).toBe(false);
  expect(addLevel(c, 'class:wizard@FIX', idx, { ...S, multiclassing: false }).problems[0].message).toBe('Multiclassing is off in this campaign');
});
test('validation', () => {
  const c = mkChar({ race: 'human', base: { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 }, levels: ['fighter'] });
  c.build.abilityMethod = 'pointBuy';
  expect(validateCharacter(c, idx, S)).toContainEqual(expect.objectContaining({ step: 'abilities', message: 'Point buy total is 28 of 27', blocking: true }));
  const sk = listChoices(c, idx, S).find(p => p.choice.type === 'skill')!;
  const tooMany = answerChoice(c, sk.key, { type: 'ids', ids: ['athletics', 'perception', 'survival'] });
  expect(validateCharacter(tooMany, idx, S).some(p => p.key === sk.key && p.blocking)).toBe(true);
});
test('custom origin skips racial ability choices; new characters start empty', () => {
  const he = mkChar({ race: 'half-elf', base: {}, levels: ['fighter'] });
  const key = listChoices(he, idx, S).find(p => p.choice.type === 'ability')!.key;
  expect(validateCharacter(he, idx, S).some(p => p.key === key)).toBe(true);
  he.build.customOrigin = { cha: 2, dex: 1 };
  expect(validateCharacter(he, idx, { ...S, customOrigin: true }).some(p => p.key === key)).toBe(false);
  const n = newCharacter('Ann');
  expect(validateCharacter(n, idx, S).map(p => p.step)).toEqual(expect.arrayContaining(['race', 'class', 'abilities', 'background']));
  expect(addLevel(n, 'class:wizard@FIX', idx, S).character.build.levels).toEqual([{ classId: 'class:wizard@FIX' }]);
});
test('off-list spells warn (R25); spells above the max level block', () => {
  const b = mkChar({ race: 'human', base: {}, levels: ['bard'] });
  b.build.spells['class:bard@FIX'] = { known: ['spell:magic-missile@FIX', 'spell:shatter@FIX'], prepared: [] };
  const ps = validateCharacter(b, idx, S);
  expect(ps).toContainEqual(expect.objectContaining({ step: 'spells', message: "Magic Missile isn't on the Bard spell list", blocking: false }));
  expect(ps).toContainEqual(expect.objectContaining({ step: 'spells', message: 'Shatter is level 2; Bard casts up to level 1', blocking: true }));
});
test('embedding makes the sheet independent of the index', () => {
  const c = embedContent(mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard', 'wizard', 'wizard'] }), idx);
  const before = computeSheet(c, { settings: S, viewer: 'dm' });
  expect(computeSheet(JSON.parse(JSON.stringify(c)), { settings: S, viewer: 'dm' })).toEqual(before);
  expect(spellLimits(c, S)[0]).toMatchObject({ cantrips: 3, prepared: 6, maxLevel: 2 });
});
