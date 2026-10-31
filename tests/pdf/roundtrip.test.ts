import { expect, test } from 'vitest';
import { embedContent } from '../../src/lib/character/build.ts';
import { exportCharacterPdf, exportItemPdf } from '../../src/lib/pdf/exportPdf.ts';
import { importPdf } from '../../src/lib/pdf/importPdf.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { playerItem } from '../../src/lib/items/playerView.ts';
import type { Character, ItemDef } from '../../src/lib/types.ts';
import { fileName } from '../../src/ui/download.ts';
import { fixtureIndex, mkChar, potionFixture } from '../fixtures/content.ts';

const c = embedContent(mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, levels: ['fighter'], inventory: [['chain-mail', true], ['shield', true]] }), fixtureIndex());
const sheet = () => computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'dm' });
test('character round-trip is lossless', async () => {
  const r = await importPdf(await exportCharacterPdf(c, sheet()));
  expect(r.kind).toBe('character');
  expect({ ...r.data, updatedAt: 0 }).toEqual({ ...c, updatedAt: 0 });
  expect((r as { edits: string[] }).edits).toEqual([]);
});
test('edits made in a PDF reader come back as overrides', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await exportCharacterPdf(c, sheet()));
  doc.getForm().getTextField('app.ac').setText('21'); doc.getForm().getTextField('app.name').setText('Bruni');
  const r = await importPdf(await doc.save()) as { data: Character; edits: string[] };
  expect([r.data.overrides.ac, r.data.name]).toEqual([21, 'Bruni']);
  expect(r.edits).toEqual(expect.arrayContaining(['AC', 'Name']));
});
test('non-Latin names survive', async () => {
  const z = { ...c, name: 'Zoë 🐉 李' };
  const bytes = await exportCharacterPdf(z, sheet());
  const { PDFDocument } = await import('pdf-lib');
  expect((await PDFDocument.load(bytes)).getForm().getTextField('app.name').getText()).toBe('Zoë ? ?');
  expect((await importPdf(bytes)).data.name).toBe('Zoë 🐉 李');
});
test('item card carries only what it was given', async () => {
  const p = playerItem(potionFixture, { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] });
  const r = await importPdf(await exportItemPdf(p));
  // The brief's `rarity: undefined` inside toMatchObject fails under vitest 5 when the key is absent (as it is after the JSON round trip).
  expect(r).toMatchObject({ kind: 'item', data: { name: 'Cloudy red potion' } });
  expect((r.data as ItemDef).rarity).toBeUndefined();
  expect('rarity' in r.data).toBe(false);
  expect(JSON.stringify(r.data)).not.toContain('It is poison');
});
test('unknown PDFs are rejected', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create(); doc.addPage();
  await expect(importPdf(await doc.save())).rejects.toThrow('Unrecognised PDF: no supported form fields');
});

test('a corrupt or foreign app.data is rejected with a clear message', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  const withData = async (data: string) => {
    const doc = await PDFDocument.load(await exportCharacterPdf(c, sheet()));
    doc.getForm().getTextField('app.data').setText(data);
    return doc.save();
  };
  const cases: [string, string][] = [
    ['not base64 !!!', 'embedded data cannot be decoded'],
    [btoa('{ not json'), 'embedded data cannot be decoded'],
    [b64({ format: 'something-else', version: 1, data: {} }), 'unknown format'],
    [b64({ format: 'dnd-app-character', version: 2, data: {} }), 'newer version'],
    [b64({ format: 'dnd-app-character', version: 1, data: { id: 'x' } }), 'character has no build'],
    [b64({ format: 'dnd-app-item', version: 1, data: { id: 'x', kind: 'monster' } }), 'item is not an item'],
    [b64({ format: 'dnd-app-character', version: 1, data: { ...c, overrides: undefined } }), 'character has no overrides'], // I2: caught by the deep check, before the sheet
  ];
  for (const [data, message] of cases) await expect(importPdf(await withData(data))).rejects.toThrow(message);
  await expect(importPdf(new TextEncoder().encode('definitely not a pdf'))).rejects.toThrow('not a readable PDF');
});

test('a player export shows covered names on the page (R48) and embeds only the player-safe copy (R51)', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const p = embedContent(mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: {}, levels: ['fighter'], inventory: [['potion-of-poison', false, false, { name: 'Cloudy red potion', hidden: [], revealed: [] }]] }), fixtureIndex());
  const opts = { viewer: 'player' as const, settings: DEFAULT_SETTINGS };
  const bytes = await exportCharacterPdf(p, computeSheet(p, opts), opts);
  const shown = (await PDFDocument.load(bytes)).getForm().getTextField('app.inventory').getText();
  expect(shown).toBe('1 x Cloudy red potion');
  expect(((await importPdf(bytes)).data as Character).inventory[0].item.name).toBe('Cloudy red potion');
  expect((await importPdf(bytes) as { edits: string[] }).edits).toEqual([]);
});

test('download file names are safe on Windows', () => {
  expect(fileName('Bruni: "the <Bold>"', 'pdf')).toBe('Bruni the Bold.pdf');
  expect(fileName('a/b\\c|d?e*f', 'json')).toBe('abcdef.json');
  for (const bad of ['', '   ', '...', 'CON', 'nul', '???']) expect(fileName(bad, 'pdf')).toBe('character.pdf');
  expect(fileName('Ends with dot.', 'pdf')).toBe('Ends with dot.pdf');
});
