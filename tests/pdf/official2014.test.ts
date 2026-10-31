import { expect, test } from 'vitest';
import { importPdf } from '../../src/lib/pdf/importPdf.ts';
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
  for (const [name, value] of Object.entries(texts)) {
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
