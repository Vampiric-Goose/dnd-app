import { expect, test } from 'vitest';
import { importPdf } from '../../src/lib/pdf/importPdf.ts';
import { official2014 } from '../../src/lib/pdf/maps/official2014.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { Character } from '../../src/lib/types.ts';
import { fixtureIndex } from '../fixtures/content.ts';

// A synthetic sheet: only the field names the map lists, never the official PDF itself.
const sheet = async (texts: Record<string, string>, checks: string[] = []) => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  let y = 800;
  for (const [name, value] of Object.entries({ ProficienciesLang: '', ...texts })) { // detect wants a 2014-sheet-only field too
    const f = form.createTextField(name);
    f.setText(value);
    f.addToPage(page, { x: 20, y: (y -= 14), width: 100, height: 12 });
  }
  for (const name of checks) {
    const f = form.createCheckBox(name);
    f.check();
    f.addToPage(page, { x: 200, y: (y -= 14), width: 12, height: 12 });
  }
  return doc.save();
};
const read = async (bytes: Uint8Array) => (await importPdf(bytes, fixtureIndex())) as { kind: 'character'; data: Character; edits: string[] };
const DM = { settings: DEFAULT_SETTINGS, viewer: 'dm' as const };

test('official 2014 sheet: name, race, class levels, score, AC override, skill proficiency', async () => {
  const { data } = await read(await sheet(
    { CharacterName: 'Tordek', ClassLevel: 'Fighter 3', 'Race ': 'Dwarf', STR: '16', AC: '20' },
    ['Check Box 26'], // Athletics
  ));
  expect(data.name).toBe('Tordek');
  expect(data.build.raceId).toBe('race:dwarf@FIX');
  expect(data.build.levels.length).toBe(3);
  expect(data.build.baseScores.str).toBe(16);
  expect(data.build.abilityMethod).toBe('manual');
  expect(data.overrides.ac).toBe(20);
  expect(data.overrides.speed).toBeUndefined(); // not on the sheet
  expect(data.imported).toBe('unverified');
  expect(computeSheet(data, DM).skills.athletics.proficient).toBe(true);
});

test('official 2014 sheet: "Fighter 3 / Wizard 2" is five levels; names ignore case and spacing; a failed prerequisite is noted', async () => {
  const { data } = await read(await sheet({ '  charactername ': 'Mix', classlevel: 'Fighter 3 / Wizard 2', ' Race': 'dwarf', STR: '13', INT: '8' }));
  expect(data.build.levels.map((l) => l.classId)).toEqual(['class:fighter@FIX', 'class:fighter@FIX', 'class:fighter@FIX', 'class:wizard@FIX', 'class:wizard@FIX']);
  expect(data.name).toBe('Mix');
  expect(data.build.raceId).toBe('race:dwarf@FIX');
  expect(data.details.notes).toMatch(/Wizard needs Int 13/);
  expect(data.imported).toBe('unverified');
});

test('official 2014 sheet: an unknown race is left out and listed in the notes', async () => {
  const { data } = await read(await sheet({ CharacterName: 'X', ClassLevel: 'Fighter 1', STR: '10', 'Race ': 'Zorblax' }));
  expect(data.build.raceId).toBe('');
  expect(data.details.notes).toContain('Not found: race Zorblax');
});

const base = { CharacterName: 'T', ClassLevel: 'Fighter 1', STR: '10' };
const notesOf = async (texts: Record<string, string>, checks?: string[]) => (await read(await sheet({ ...base, ...texts }, checks))).data;

test('official 2014 sheet: the sheet shows final scores, so the racial bonus comes out of the base (no override)', async () => {
  const { build, overrides } = await notesOf({ 'Race ': 'Dwarf', CON: '16' });
  expect(build.baseScores.con).toBe(14);
  expect(overrides['score.con']).toBeUndefined();
  const hill = await notesOf({ 'Race ': 'Hill Dwarf', CON: '16', WIS: '13' });
  expect(hill.build.subraceId).toBe('subrace:hill-dwarf@FIX');
  expect(hill.build.raceId).toBe('race:dwarf@FIX');
  expect([hill.build.baseScores.con, hill.build.baseScores.wis]).toEqual([14, 12]);
  expect(hill.overrides['score.wis']).toBeUndefined();
});

test('official 2014 sheet: a save box the class already grants adds nothing; one it does not grant adds a proficiency', async () => {
  const { customEffects } = await notesOf({}, ['Check Box 11', 'Check Box 19', 'Check Box 20']); // Fighter: Str, Con; Int is extra
  expect(customEffects).toEqual([{ type: 'proficiency', category: 'save', value: 'int' }]);
});

test('official 2014 sheet: max HP is an override only when it differs; current HP is clamped to the max', async () => {
  const agree = await notesOf({ 'Race ': 'Dwarf', CON: '16', HPMax: '13' }); // d10 + 3
  expect(agree.overrides.maxHp).toBeUndefined();
  const differ = await notesOf({ 'Race ': 'Dwarf', CON: '16', HPMax: '30', HPCurrent: '99' });
  expect(differ.overrides.maxHp).toBe(30);
  expect(differ.state.hp).toBe(30);
  expect(differ.details.notes).toContain('Current HP 99 clamped to max HP 30');
});

test('official 2014 sheet: odd values are skipped and noted, and the import still succeeds', async () => {
  const d = await notesOf({ STR: 'abc', AC: '99999999999999999999', Speed: '1'.repeat(50), GP: '-5', Equipment: 'x'.repeat(25000) });
  expect(d.build.baseScores.str).toBe(10);
  expect(d.overrides.ac).toBeUndefined();
  expect(d.overrides.speed).toBeUndefined();
  expect(d.currency.gp).toBe(0);
  expect(d.details.notes).toMatch(/Ignored values that are not usable numbers: STR, AC, Speed, GP/);
  expect(d.details.notes).toMatch(/Shortened to 20000 characters: Equipment$/m); // the 50-digit Speed is "ignored", not "shortened"
  expect(d.details.notes).toContain('x'.repeat(20000));
  expect(d.details.notes).not.toContain('x'.repeat(20001));
});

test('official 2014 sheet: text the map has no slot for is kept in notes and appearance, and spell/weapon fields are counted', async () => {
  const d = await notesOf({
    AttacksSpellcasting: 'Flame Tongue lore', Treasure: 'A ruby', Allies: 'Bob the bard', FactionName: 'Order of Pens', 'Feat+Traits': 'Tavern brawler',
    Age: '40', Height: '4 ft', Eyes: 'grey', Hair: 'red', 'Spells 1014': 'Fire Bolt', 'SlotsTotal 19': '4', 'Wpn Name': 'Axe', PlayerName: 'ignored', XP: '300',
  });
  for (const t of ['Flame Tongue lore', 'A ruby', 'Bob the bard', 'Order of Pens', 'Tavern brawler']) expect(d.details.notes).toContain(t);
  expect(d.details.appearance).toBe('Age: 40, Height: 4 ft, Eyes: grey, Hair: red');
  expect(d.details.notes).toContain('Not imported (had text): spells, spell slots, weapon rows');
  expect(d.details.notes).not.toContain('ignored');
});

test('official 2014 sheet: words beside a class name mean a subclass was not detected', async () => {
  for (const text of ['Champion Fighter 3', 'Fighter (Champion) 3']) {
    const d = await notesOf({ ClassLevel: text });
    expect(d.build.levels.length).toBe(3);
    expect(d.details.notes).toMatch(/Subclass not detected: Champion/);
  }
});

test('official 2014 sheet: ClassLevel messages are honest and bounded', async () => {
  const noLevel = await notesOf({ ClassLevel: 'Fighter 3 / Wizard' });
  expect(noLevel.build.levels.length).toBe(3);
  expect(noLevel.details.notes).toContain('No level given for Wizard');
  const flood = await notesOf({ ClassLevel: 'Zork 1 / '.repeat(50) });
  expect(flood.details.notes.match(/Not found: class/g)?.length).toBe(1); // the same name is noted once
  const many = await notesOf({ ClassLevel: Array.from({ length: 50 }, (_, i) => `Zork${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} 1`).join(' / ') });
  expect(many.details.notes.match(/Not found: class/g)?.length).toBeLessThanOrEqual(10);
  expect(many.details.notes).toMatch(/more than 10 entries/);
});

test('official 2014 sheet: without a content library one note replaces the per-name notes', async () => {
  const { data } = (await importPdf(await sheet({ ...base, 'Race ': 'Dwarf', Background: 'Sage' }))) as { data: Character };
  expect(data.details.notes).toContain('Content library unavailable; race, class and background were not matched');
  expect(data.details.notes).not.toContain('Not found');
});

test('official 2014 sheet: detect needs a field only the 2014 sheet has', () => {
  expect(official2014.detect(new Set(['CharacterName', 'ClassLevel', 'STR']))).toBe(false);
  expect(official2014.detect(new Set(['CharacterName', 'ClassLevel', 'STR', 'ST Strength']))).toBe(true);
  expect(official2014.detect(new Set(['charactername', ' classlevel', 'STR', 'ProficienciesLang ']))).toBe(true);
});
