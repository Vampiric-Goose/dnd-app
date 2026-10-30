import fs from 'node:fs';
import { expect, test } from 'vitest';
import { effectTarget, SRD_EFFECTS } from '../../scripts/srd/effects.ts';
import { addLevel, answerChoice, embedContent, listChoices, newCharacter } from '../../src/lib/character/build.ts';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { Character, Choice, ItemDef, Pack, Scores } from '../../src/lib/types.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const idx = new ContentIndex([srd]);
const settings = DEFAULT_SETTINGS;

/** newCharacter -> race/subrace -> a level per class -> each answer fills the first unanswered choice of its type -> embedContent. */
function build(race: string, sub: string | undefined, base: Partial<Scores>, classes: string[], answers: Partial<Record<Choice['type'], string[]>> = {}): Character {
  const blank = newCharacter('Test');
  let c: Character = { ...blank, build: { ...blank.build, raceId: `race:${race}@SRD`, ...(sub && { subraceId: `subrace:${sub}@SRD` }), baseScores: { ...blank.build.baseScores, ...base } } };
  for (const k of classes) {
    const r = addLevel(c, `class:${k}@SRD`, idx, settings);
    expect(r.problems.filter(p => p.blocking), k).toEqual([]);
    c = r.character;
  }
  for (const [type, values = []] of Object.entries(answers)) {
    const p = listChoices(c, idx, settings).find(x => x.choice.type === type && !x.answer);
    if (!p) throw new Error(`no open ${type} choice`);
    const ch = p.choice;
    // 'option' values match option names case-insensitively by substring.
    const ids = ch.type === 'option' ? values.map(v => ch.options.find(o => o.name.toLowerCase().includes(v.toLowerCase()))?.name ?? v) : values;
    c = answerChoice(c, p.key, { type: 'ids', ids });
  }
  return embedContent(c, idx);
}

/** Adds SRD items by slug, [slug, equipped], then computes the sheet as the DM sees it. */
const sheetOf = (c: Character, inventory: [string, boolean][] = []) =>
  computeSheet({ ...c, inventory: inventory.map(([s, equipped]) => ({ ...makeEntry(idx.get(`item:${s}@SRD`) as ItemDef), equipped })) }, { settings, viewer: 'dm' });

test('SRD hill dwarf fighter 1 matches the hand-computed sheet', () => {
  const s = sheetOf(build('dwarf', 'hill-dwarf', { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, ['fighter'], { optionalFeature: ['optionalFeature:defense@SRD'], skill: ['athletics', 'perception'] }), [['chain-mail', true], ['shield', true], ['longsword', true]]);
  expect([s.ac, s.maxHp, s.saves.con.bonus, s.skills.perception.bonus, s.speed.walk]).toEqual([19, 14, 5, 3, 25]);
});

test('SRD class features drive numbers', () => {
  const monk = sheetOf(build('human', undefined, { dex: 15, wis: 15 }, Array(5).fill('monk')));
  expect([monk.ac, monk.speed.walk, monk.resources.find(r => r.name === 'Ki')!.max]).toEqual([16, 40, 5]);
  const barb = sheetOf(build('human', undefined, { dex: 13, con: 15 }, ['barbarian']));
  expect([barb.ac, barb.resources.find(r => r.name === 'Rage')!.max]).toEqual([15, 2]);
  const pal = sheetOf(build('human', undefined, { cha: 15 }, Array(6).fill('paladin')));
  expect([pal.saves.str.bonus, pal.resources.find(r => r.name === 'Lay on Hands')!.max, pal.resources.find(r => r.name === 'Divine Sense')!.max]).toEqual([3, 30, 4]); // str 11 (+0, not proficient) + aura 3
  const sorc = sheetOf(build('human', undefined, { dex: 13, con: 13 }, ['sorcerer'], { subclass: ['subclass:draconic@SRD'] }));
  expect([sorc.ac, sorc.maxHp]).toEqual([15, 6 + 2 + 1]);
  expect(sheetOf(build('half-orc', undefined, {}, ['fighter'])).skills.intimidation.proficient).toBe(true);
  expect(sheetOf(build('elf', 'high-elf', {}, ['wizard'])).skills.perception.proficient).toBe(true);
  expect(sheetOf(build('tiefling', undefined, {}, ['warlock'])).resistances).toContain('fire');
  expect(sheetOf(build('dragonborn', undefined, {}, ['fighter'], { option: ['red'] })).resistances).toContain('fire');
  expect(sheetOf(build('human', undefined, { int: 15, wis: 13 }, ['wizard', 'wizard', 'wizard', 'cleric', 'cleric'])).slots).toEqual([4, 3, 2]);
});

test('R27: a Cleric 2 / Paladin 3 has one Channel Divinity resource', () => {
  const s = sheetOf(build('human', undefined, { str: 13, wis: 13, cha: 13 }, ['cleric', 'cleric', 'paladin', 'paladin', 'paladin']));
  expect(s.resources.filter(r => r.name === 'Channel Divinity')).toEqual([{ name: 'Channel Divinity', max: 1, recharge: 'short' }]);
});

test('every authored SRD id exists', () => {
  for (const id of Object.keys(SRD_EFFECTS)) {
    expect(idx.get(id.split('/')[0]), id).toBeDefined();
    expect(effectTarget(x => idx.get(x), id), id).toBeDefined(); // R8: the trait/option sub-path resolves too
  }
});
