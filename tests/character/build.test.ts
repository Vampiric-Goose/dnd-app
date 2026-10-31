import { expect, test } from 'vitest';
import { addLevel, answerChoice, embedContent, listChoices, newCharacter, spellLimits, validateCharacter } from '../../src/lib/character/build.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { enumerateChoices } from '../../src/lib/character/choices.ts';
import type { ClassDef, Entity, OptionalFeatureDef } from '../../src/lib/types.ts';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { cleric, fixtureEntities, fixtureIndex, hillDwarf, magicMissile, mkChar } from '../fixtures/content.ts';

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
test('typed-in scores are valid without rule overrides, but must be 1 to 30', () => {
  const c = mkChar({ race: 'human', base: { str: 18, dex: 3, con: 20, int: 9, wis: 8, cha: 8 }, levels: ['fighter'] });
  c.build.abilityMethod = 'manual';
  expect(validateCharacter(c, idx, S).filter(p => p.step === 'abilities')).toEqual([]);
  c.build.baseScores.dex = 0;
  expect(validateCharacter(c, idx, S)).toContainEqual(expect.objectContaining({ step: 'abilities', message: 'Scores must be 1 to 30', blocking: true }));
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
// 3 wizard cantrips and 6 more 1st-level wizard spells, so a Wizard 1's full limits are reachable.
const extraSpells = Array.from({ length: 9 }, (_, i) => ({ ...magicMissile, id: `spell:s${i}@FIX`, name: `S${i}`, level: i < 3 ? 0 : 1 }));
const indexWith = (...extra: Entity[]) => new ContentIndex([{ id: 'fix', name: 'Fixture', source: 'FIX', importedAt: 0, hash: 'fix', entities: [...fixtureEntities, ...extra], patches: [] }]);
test('too few spells block; with overrides they warn (R34)', () => {
  const w = mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard'] });
  const big = indexWith(...extraSpells);
  const spells = (s: typeof S) => validateCharacter(w, big, s).filter(p => p.step === 'spells');
  expect(spells(S)).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: 'Wizard: pick 3 more cantrips', blocking: true }),
    expect.objectContaining({ message: 'Wizard: pick 6 more spellbook spells', blocking: true }),
  ]));
  expect(spells({ ...S, allowOverrides: true }).length).toBeGreaterThan(0);
  expect(spells({ ...S, allowOverrides: true }).every(p => !p.blocking)).toBe(true);
  // A full pick (3 cantrips, 6 in the book, level + Int mod prepared) clears them.
  const extra = extraSpells;
  const book = extra.slice(3).map(e => e.id);
  const prepared = spellLimits(embedContent(w, big), S)[0].prepared!;
  expect(prepared).toBeGreaterThan(1);
  w.build.spells['class:wizard@FIX'] = { known: [...extra.slice(0, 3).map(e => e.id), ...book], prepared: book.slice(0, prepared) };
  expect(validateCharacter(w, big, S).filter(p => p.step === 'spells')).toEqual([]);
});
test('a half-caster at level 1 (no spell slots yet) has no spell shortfall', () => {
  const paladin = { ...cleric, id: 'class:paladin@FIX', name: 'Paladin', features: [],
    spellcasting: { ability: 'cha', progression: 'half', preparation: 'prepared', preparedFormula: 'level/2+mod:cha' } } as ClassDef;
  const ix = indexWith(paladin, ...extraSpells.map(s => ({ ...s, classes: ['paladin'] })));
  const p = mkChar({ race: 'human', base: { cha: 16 }, levels: ['cleric'] }); // mkChar only knows fixture classes
  p.build.levels = [{ classId: paladin.id }];
  expect(spellLimits(embedContent(p, ix), S)[0]).toMatchObject({ maxLevel: 0 });
  expect(validateCharacter(p, ix, S).filter(x => x.step === 'spells')).toEqual([]);
});
test('a shortfall is capped at the spells that exist', () => {
  // The fixture index holds no wizard cantrips and one 1st-level wizard spell (Magic Missile).
  const w = mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard'] });
  const spells = () => validateCharacter(w, idx, S).filter(p => p.step === 'spells').map(p => p.message);
  expect(spells()).toEqual(['Wizard: pick 1 more spellbook spell']);
  w.build.spells['class:wizard@FIX'] = { known: [magicMissile.id], prepared: [] };
  expect(spells()).toEqual(['Wizard: pick 1 more prepared spell']); // only one spell is in the book
  w.build.spells['class:wizard@FIX'].prepared = [magicMissile.id];
  expect(spells()).toEqual([]);
});
test('embedding makes the sheet independent of the index', () => {
  const c = embedContent(mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard', 'wizard', 'wizard'] }), idx);
  const before = computeSheet(c, { settings: S, viewer: 'dm' });
  expect(computeSheet(JSON.parse(JSON.stringify(c)), { settings: S, viewer: 'dm' })).toEqual(before);
  expect(spellLimits(c, S)[0]).toMatchObject({ cantrips: 3, prepared: 6, maxLevel: 2 });
});
test('R55: a subrace is required only when one from the race\'s own source points at it', () => {
  // A 5etools-style race: its nameless "no subrace" entry was dropped on import, leaving only a Variant from another book.
  const variant = { ...hillDwarf, id: 'subrace:variant-human@OTH', name: 'Variant Human', source: 'OTH', raceId: 'race:human@FIX' };
  const ix = new ContentIndex([{ id: 'p', name: 'p', source: 'FIX', importedAt: 0, hash: '', patches: [], entities: [...fixtureEntities, variant] }]);
  const race = (c: ReturnType<typeof mkChar>) => validateCharacter(c, ix, S).filter(p => p.step === 'race').map(p => p.message);
  expect(race(mkChar({ race: 'human', base: {}, levels: ['fighter'] }))).toEqual([]);
  expect(race(mkChar({ race: 'dwarf', base: {}, levels: ['fighter'] }))).toEqual(['Choose a Dwarf subrace']); // Hill Dwarf shares the race's source
});
