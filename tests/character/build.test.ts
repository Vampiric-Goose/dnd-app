import { expect, test } from 'vitest';
import { addLevel, answerChoice, embedContent, listChoices, newCharacter, spellLimits, validateCharacter } from '../../src/lib/character/build.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { enumerateChoices } from '../../src/lib/character/choices.ts';
import type { Entity, OptionalFeatureDef } from '../../src/lib/types.ts';
import { fixtureEntities, fixtureIndex, mkChar } from '../fixtures/content.ts';

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
test('subclass option progressions add optionalFeature choices at the step levels (R28)', () => {
  const c = mkChar({ race: 'human', base: { str: 15 }, levels: Array(7).fill('fighter'), answers: { subclass: ['subclass:battle-master@FIX'] } });
  const ofp = listChoices(c, idx, S).filter(p => p.sourceId === 'subclass:battle-master@FIX/ofp:maneuvers');
  expect(ofp.map(p => [p.key, p.choice])).toEqual([
    ['3|subclass:battle-master@FIX/ofp:maneuvers|0', { type: 'optionalFeature', count: 3, featureTypes: ['MV:B'] }],
    ['7|subclass:battle-master@FIX/ofp:maneuvers|0', { type: 'optionalFeature', count: 2, featureTypes: ['MV:B'] }],
  ]);
});

// R29: whatever an answer picks contributes its own choices, recursively, with deterministic keys.
const fs = 'feature:fighter:fighting-style:1@FIX';
const walk = (extra: Entity[], choices: Record<string, string[]>) => {
  const c = mkChar({ race: 'human', base: { str: 15 }, levels: ['fighter'] });
  for (const [k, ids] of Object.entries(choices)) c.build.choices[k] = { type: 'ids', ids };
  const all = new Map([...fixtureEntities, ...extra].map(e => [e.id, e]));
  return enumerateChoices(c, id => all.get(id), S);
};
const opt = (name: string, choices: OptionalFeatureDef['choices']): OptionalFeatureDef =>
  ({ kind: 'optionalFeature', id: `optionalFeature:${name}@FIX`, name, source: 'FIX', text: [], featureTypes: ['FS:F'], choices });

test('a picked optional feature adds its choice, whose picked option trait adds another (R29)', () => {
  const trick = opt('trick', [{ type: 'option', count: 1, options: [{ name: 'Deep Lore', text: [], choices: [{ type: 'skill', count: 1, from: 'any' }] }] }]);
  const keys = walk([trick], { [`1|${fs}|0`]: [trick.id], [`1|${fs}/${trick.id}|0`]: ['Deep Lore'] }).map(p => [p.key, p.choice.type]);
  expect(keys).toEqual(expect.arrayContaining([
    [`1|${fs}|0`, 'optionalFeature'],
    [`1|${fs}/${trick.id}|0`, 'option'],
    [`1|${fs}/${trick.id}/option:deep-lore|0`, 'skill'],
  ]));
});

test('a choice that picks its own entity terminates (R29)', () => {
  const loop = opt('loop', [{ type: 'optionalFeature', count: 1, featureTypes: ['FS:F'] }]);
  const answers: Record<string, string[]> = {};
  let path = fs;
  for (let i = 0; i < 12; i++) { answers[`1|${path}|0`] = [loop.id]; path += `/${loop.id}`; }
  const nested = walk([loop], answers).filter(p => p.sourceId.startsWith(fs));
  expect(nested.map(p => p.key)).toEqual([`1|${fs}|0`, `1|${fs}/${loop.id}|0`]); // the second pick of loop is already visited
});

test('nesting stops at the depth cap without throwing (R29)', () => {
  const chain = Array.from({ length: 12 }, (_, i) => opt(`link-${i}`, [{ type: 'optionalFeature', count: 1, featureTypes: ['FS:F'] }]));
  const answers: Record<string, string[]> = {};
  let path = fs;
  for (const l of chain) { answers[`1|${path}|0`] = [l.id]; path += `/${l.id}`; }
  expect(walk(chain, answers).filter(p => p.sourceId.startsWith(fs))).toHaveLength(9); // the root choice plus 8 nested levels
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
