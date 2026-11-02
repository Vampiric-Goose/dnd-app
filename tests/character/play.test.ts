import { expect, test } from 'vitest';
import { blankValues, buildEffect, describeEffect, EFFECT_FIELDS, EFFECT_TYPES } from '../../src/lib/character/customEffect.ts';
import { deathState, featureList, setAt, spellList } from '../../src/lib/character/play.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { magicMissile, mkChar, shatter } from '../fixtures/content.ts';

test('death state', () => {
  const s = { hp: 5, tempHp: 0, hitDiceUsed: {}, slotsUsed: [], pactSlotsUsed: 0, resourcesUsed: {}, conditions: [], exhaustion: 0, deathSaves: { success: 0, fail: 0 }, inspiration: false };
  expect([s, { ...s, hp: 0 }, { ...s, hp: 0, stable: true }, { ...s, hp: 0, dead: true }, { ...s, dead: true, stable: true }].map(deathState)).toEqual(['ok', 'dying', 'stable', 'dead', 'dead']);
});

test('feature list: race and subrace traits, class features, chosen options', () => {
  const c = mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: {}, levels: ['fighter'], answers: { optionalFeature: ['optionalFeature:defense@FIX'] } });
  const names = featureList(c, DEFAULT_SETTINGS).map((f) => `${f.source}/${f.name}`);
  expect(names).toContain('Dwarf/Dwarven Resilience');
  expect(names).toContain('Hill Dwarf/Dwarven Toughness');
  expect(names).toContain('Fighter 1/Second Wind');
  expect(names.filter((n) => n.endsWith('/Defense'))).toHaveLength(1);
  expect(names).not.toContain('Fighter 2/Action Surge');
});

test('spell list: picked and always-prepared spells, sorted, with prepared flags', () => {
  const c = mkChar({ race: 'human', base: {}, levels: ['wizard'] });
  c.embedded[magicMissile.id] = magicMissile;
  c.embedded[shatter.id] = shatter;
  c.build.spells['class:wizard@FIX'] = { known: [shatter.id, magicMissile.id, 'spell:missing@FIX'], prepared: [shatter.id] };
  expect(spellList(c, 'class:wizard@FIX').map((s) => [s.spell.name, s.prepared, s.always])).toEqual([['Magic Missile', false, false], ['Shatter', true, false]]);
  expect(spellList(c, 'class:nobody@FIX')).toEqual([]);
});

test('setAt fills holes with zero', () => {
  expect(setAt([], 2, 1)).toEqual([0, 0, 1]);
  expect(setAt([2, 1], 0, 0)).toEqual([0, 1]);
});

test('custom effect form: every type has fields, and each builds a valid Effect', () => {
  expect(EFFECT_TYPES.length).toBe(13);
  for (const t of EFFECT_TYPES) expect(EFFECT_FIELDS[t].length).toBeGreaterThan(0);
  // Defaults alone build for types that need no typing
  expect(buildEffect('flag', blankValues('flag'))).toEqual({ effect: { type: 'flag', flag: 'ignoreHeavyArmorSpeed' } });
  expect(buildEffect('bonus', { target: 'skill.stealth', value: ' 2 ', when: '' })).toEqual({ effect: { type: 'bonus', target: 'skill.stealth', value: 2 } });
  expect(buildEffect('bonus', { target: 'ac', value: 'mod:wis + prof', when: 'armored' })).toEqual({ effect: { type: 'bonus', target: 'ac', value: 'mod:wis + prof', when: 'armored' } });
  expect(buildEffect('acBase', { base: '13', abilities: ['dex'], shieldAllowed: true })).toEqual({ effect: { type: 'acBase', base: 13, abilities: ['dex'], shieldAllowed: true } });
  expect(buildEffect('halfProficiency', { abilities: [], roundUp: false })).toEqual({ effect: { type: 'halfProficiency', roundUp: false } });
  expect(buildEffect('resource', { name: 'Rage', max: '3', recharge: 'long' })).toEqual({ effect: { type: 'resource', name: 'Rage', max: '3', recharge: 'long' } }); // max stays a string (the union says so)
  expect(buildEffect('resource', { name: 'Ki', max: 'level + mod:wis', recharge: 'short' })).toEqual({ effect: { type: 'resource', name: 'Ki', max: 'level + mod:wis', recharge: 'short' } });
  const note = buildEffect('note', { text: 'Advantage vs fear' });
  expect(note).toEqual({ effect: { type: 'note', text: 'Advantage vs fear' } });
  expect(describeEffect('effect' in note ? note.effect : { type: 'note', text: '' })).toBe('note: text Advantage vs fear');
});

test('custom effect form: bad input is reported, not built', () => {
  expect(buildEffect('setScore', { ability: 'str', value: '' })).toEqual({ error: 'Score (raises to at least this) is required.' });
  expect(buildEffect('setScore', { ability: 'str', value: '19.5' })).toMatchObject({ error: expect.stringContaining('whole number') });
  expect(buildEffect('setScore', { ability: 'luck', value: '19' })).toMatchObject({ error: expect.stringContaining('pick one') });
  expect(buildEffect('bonus', { target: 'ac', value: '2 +' })).toMatchObject({ error: expect.stringContaining('Bad formula') });
  expect(buildEffect('proficiency', { category: 'tool', value: '  ' })).toMatchObject({ error: 'Name is required.' });
});

test('custom effect form: col[...] is rejected (custom effects have no owning class)', () => {
  expect(buildEffect('resource', { name: 'Rage', max: 'col[Rages]', recharge: 'long' })).toMatchObject({ error: expect.stringContaining('col[') });
  expect(buildEffect('bonus', { target: 'ac', value: 'col[Rages]' })).toMatchObject({ error: expect.stringContaining('col[') });
});

test('custom effect form: proficiency skill and save values are normalised or rejected', () => {
  expect(buildEffect('proficiency', { category: 'skill', value: 'Sleight of Hand' })).toEqual({ effect: { type: 'proficiency', category: 'skill', value: 'sleight-of-hand' } });
  expect(buildEffect('proficiency', { category: 'skill', value: ' stealth ' })).toEqual({ effect: { type: 'proficiency', category: 'skill', value: 'stealth' } });
  expect(buildEffect('proficiency', { category: 'save', value: 'Strength' })).toEqual({ effect: { type: 'proficiency', category: 'save', value: 'str' } });
  expect(buildEffect('proficiency', { category: 'save', value: 'wis' })).toEqual({ effect: { type: 'proficiency', category: 'save', value: 'wis' } });
  expect(buildEffect('proficiency', { category: 'skill', value: 'Stelth' })).toMatchObject({ error: expect.stringContaining('Stelth') });
  expect(buildEffect('proficiency', { category: 'save', value: 'Luck' })).toMatchObject({ error: expect.stringContaining('Luck') });
  // tools, weapons and the rest stay free text
  expect(buildEffect('proficiency', { category: 'tool', value: "Thieves' tools" })).toEqual({ effect: { type: 'proficiency', category: 'tool', value: "Thieves' tools" } });
});

test('a custom skill proficiency changes the skill bonus on the sheet', () => {
  const c = mkChar({ race: 'human', base: { dex: 14 }, levels: ['fighter'] });
  const built = buildEffect('proficiency', { category: 'skill', value: 'Stealth' });
  c.customEffects = ['effect' in built ? built.effect : { type: 'note', text: '' }];
  expect(computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'dm' }).skills.stealth).toMatchObject({ proficient: true, bonus: 4 });
});
