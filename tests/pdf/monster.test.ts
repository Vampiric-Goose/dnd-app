import fs from 'node:fs';
import { expect, test } from 'vitest';
import { blankMonster } from '../../src/lib/monsters/homebrew.ts';
import { exportMonsterPdf } from '../../src/lib/pdf/exportPdf.ts';
import { importPdf } from '../../src/lib/pdf/importPdf.ts';
import type { MonsterDef, Pack } from '../../src/lib/types.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const dragon = srd.entities.find((e) => e.id === 'monster:adult-red-dragon@SRD') as MonsterDef;

test('the SRD Adult Red Dragon round-trips with no edits', async () => {
  const r = await importPdf(await exportMonsterPdf(dragon));
  expect(r.kind).toBe('monster');
  expect(r.data).toEqual(dragon);
  expect((r as { edits: string[] }).edits).toEqual([]);
});

test('name and HP edited in a PDF reader come back and are listed', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await exportMonsterPdf(dragon));
  doc.getForm().getTextField('app.name').setText('Cinder Tyrant');
  doc.getForm().getTextField('app.hp').setText('300');
  const r = await importPdf(await doc.save()) as { data: MonsterDef; edits: string[] };
  expect(r.data.name).toBe('Cinder Tyrant');
  expect(r.data.hp).toEqual({ average: 300, formula: '19d12 + 133' });
  expect(r.edits).toEqual(['Name', 'HP']);
  expect(dragon.name).toBe('Adult Red Dragon'); // the export's record is untouched
});

test('AC, CR and a score edit; a CR edit drops a printed XP; junk values are ignored', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await exportMonsterPdf({ ...dragon, xp: 1 }));
  const f = doc.getForm();
  f.getTextField('app.ac').setText('20');
  f.getTextField('app.cr').setText('18');
  f.getTextField('app.score.str').setText('29');
  f.getTextField('app.score.dex').setText('lots'); // not a number
  const r = await importPdf(await doc.save()) as { data: MonsterDef; edits: string[] };
  expect([r.data.ac[0].value, r.data.cr, r.data.scores.str, r.data.scores.dex, r.data.xp]).toEqual([20, '18', 29, 10, undefined]);
  expect(r.edits).toEqual(['AC', 'CR', 'Strength']);
});

test('40 long traits overflow onto more pages and still round-trip', async () => {
  const long = 'The lurker exhales a cloud of grey spores that clings to everything nearby and slowly hardens into a brittle crust. '.repeat(4);
  const m: MonsterDef = { ...blankMonster('c1'), name: 'Bog Lurker', traits: Array.from({ length: 40 }, (_, i) => ({ name: `Spore Trait ${i + 1}`, text: [{ p: long }] })) };
  const bytes = await exportMonsterPdf(m);
  const { PDFDocument } = await import('pdf-lib');
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  const r = await importPdf(bytes);
  expect(r.data).toEqual(m);
  expect((r as { edits: string[] }).edits).toEqual([]);
});
