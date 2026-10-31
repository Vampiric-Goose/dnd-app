import { expect, test } from 'vitest';
import { embedContent } from '../../src/lib/character/build.ts';
import { playerCharacter } from '../../src/lib/items/playerView.ts';
import { decodeEnvelope } from '../../src/lib/pdf/appLayout.ts';
import { exportCharacterPdf, exportItemPdf } from '../../src/lib/pdf/exportPdf.ts';
import { importPdf, limits } from '../../src/lib/pdf/importPdf.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { Character, PlayerView } from '../../src/lib/types.ts';
import { fileName } from '../../src/ui/download.ts';
import { fixtureIndex, mkChar, potionFixture } from '../fixtures/content.ts';

const mk = (inventory: Parameters<typeof mkChar>[0]['inventory'] = [], o: Partial<Character> = {}): Character =>
  ({ ...embedContent(mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, levels: ['fighter'], inventory }), fixtureIndex()), ...o });
const DM = { settings: DEFAULT_SETTINGS, viewer: 'dm' as const };
const PLAYER = { settings: DEFAULT_SETTINGS, viewer: 'player' as const };
const dm = (c: Character) => exportCharacterPdf(c, computeSheet(c, DM), DM);
const player = (c: Character) => exportCharacterPdf(c, computeSheet(c, PLAYER), PLAYER);
type Edit = (f: (name: string) => import('pdf-lib').PDFTextField) => void;
const edited = async (bytes: Uint8Array, edit: Edit) => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  edit((n) => doc.getForm().getTextField(n));
  return importPdf(await doc.save()) as Promise<{ data: Character; edits: string[]; playerView?: boolean }>;
};
const embeddedJson = async (bytes: Uint8Array) => {
  const { PDFDocument } = await import('pdf-lib');
  return JSON.stringify(decodeEnvelope((await PDFDocument.load(bytes)).getForm().getTextField('app.data').getText()!));
};

// ---- 1. R51: a Player-view export is player-safe ----

const cover: PlayerView = { name: 'Plain band', hidden: ['attunement', 'rarity', 'bonuses'], revealed: [] };
const secrets = (): Character => mk([
  ['ring-of-protection', true, false, cover], // equipped, NOT attuned, attunement hidden: the `active` pitfall
  ['gauntlets-of-ogre-power', true, true, { name: 'Plain gauntlets', hidden: ['effects', 'attunement'], revealed: [] }],
  ['potion-of-poison', false, false, { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] }],
  ['chain-mail', true],
]);

test('playerCharacter computes the same sheet for the player as the real character', () => {
  for (const c of [secrets(), mk([['ring-of-protection', true, true, cover]]), mk([['ring-of-protection', false, false, cover]])]) {
    const safe = playerCharacter(c);
    expect(computeSheet(safe, PLAYER)).toEqual(computeSheet(c, PLAYER));
  }
});

test('playerCharacter holds nothing of what the player may not know', () => {
  const c = secrets();
  c.inventory[0] = { ...c.inventory[0], sourceId: 'item:ring-of-protection@SRD' };
  c.inventory[2] = { ...c.inventory[2], item: { ...potionFixture, text: [{ p: 'Looks like healing. {{redact:r1}}It is poison.{{/redact}}' }] } };
  const json = JSON.stringify(playerCharacter(c));
  for (const secret of ['Ring of Protection', 'ring-of-protection', 'Gauntlets of Ogre', 'gauntlets-of-ogre', 'Potion of Poison', 'potion-of-poison', 'It is poison', '"view"', '"revealed"', 'sourceId']) {
    expect(json, secret).not.toContain(secret);
  }
  expect(json).toContain('Cloudy red potion');
  expect(JSON.stringify(c)).toContain('Ring of Protection'); // the input is untouched
});

test('a player PDF embeds the player-safe copy and re-imports with no edits', async () => {
  const c = secrets();
  const bytes = await player(c);
  const json = await embeddedJson(bytes);
  for (const secret of ['Ring of Protection', 'ring-of-protection', 'Potion of Poison', '"view"', '"revealed"']) expect(json, secret).not.toContain(secret);
  const r = await importPdf(bytes) as { edits: string[]; playerView?: boolean };
  expect(r.edits).toEqual([]);
  expect(r.playerView).toBe(true);
});

test('a DM PDF still embeds the real names and is not flagged as a player export', async () => {
  const c = secrets();
  const bytes = await dm(c);
  expect(await embeddedJson(bytes)).toContain('Ring of Protection');
  expect(((await importPdf(bytes)) as { playerView?: boolean }).playerView).toBeFalsy();
});

// ---- 3. single-line fields ----

test('a name with a newline exports and round-trips with no edits', async () => {
  const c = mk([], { name: 'Bruni\nthe Bold' });
  const bytes = await dm(c);
  const r = await importPdf(bytes) as { data: Character; edits: string[] };
  expect(r.edits).toEqual([]);
  expect(r.data.name).toBe('Bruni\nthe Bold');
  const { PDFDocument } = await import('pdf-lib');
  expect((await PDFDocument.load(bytes)).getForm().getTextField('app.name').getText()).toBe('Bruni the Bold');
});

// ---- 4. notes the PDF cannot hold ----

test('an edited notes field is not applied over notes holding characters the PDF cannot', async () => {
  const c = mk([], { details: { ...mk().details, notes: 'Met 李 at dawn' } });
  const r = await edited(await dm(c), (f) => f('app.notes').setText('Met ? at dusk'));
  expect(r.data.details.notes).toBe('Met 李 at dawn');
  expect(r.edits).toEqual(['Notes (not applied: contains characters the PDF can\'t hold)']);
  const same = await edited(await dm(c), () => {}); // unedited: nothing to report
  expect(same.edits).toEqual([]);
});

// ---- 10. coverage ----

test('notes with several lines round-trip, and an edit to them applies', async () => {
  const c = mk([], { details: { ...mk().details, notes: 'one\ntwo\n\nfour' } });
  expect((await edited(await dm(c), () => {})).edits).toEqual([]);
  const r = await edited(await dm(c), (f) => f('app.notes').setText('one\r\ntwo\r\n\r\nfour\r\nfive'));
  expect(r.data.details.notes).toBe('one\ntwo\n\nfour\nfive');
  expect(r.edits).toEqual(['Notes']);
});

test('a value equal to the computed one is no edit; blank or non-numbers change nothing', async () => {
  const c = mk();
  const sheet = computeSheet(c, DM);
  const same = await edited(await dm(c), (f) => { f('app.ac').setText(`+${sheet.ac}`); f('app.hpMax').setText(` ${sheet.maxHp} `); });
  expect(same.edits).toEqual([]);
  expect(same.data.overrides).toEqual({});
  const junk = await edited(await dm(c), (f) => { f('app.ac').setText(''); f('app.speed').setText('abc'); f('app.hp').setText('x1'); });
  expect(junk.edits).toEqual([]);
  expect(junk.data).toEqual(c);
});

test('absurd numbers are skipped', async () => {
  const r = await edited(await dm(mk()), (f) => { f('app.ac').setText('9'.repeat(40)); f('app.hp').setText('1e400'); f('app.speed').setText('9007199254740993'); });
  expect(r.edits).toEqual([]);
});

test('HP and currency edits apply and clamp at 0', async () => {
  const r = await edited(await dm(mk()), (f) => { f('app.hp').setText('-5'); f('app.currency.gp').setText('12'); f('app.currency.cp').setText('-3'); });
  expect([r.data.state.hp, r.data.currency.gp, r.data.currency.cp]).toEqual([0, 12, 0]);
  expect(r.edits).toEqual(['HP', 'Currency']);
  const ok = await edited(await dm(mk()), (f) => f('app.hp').setText('7'));
  expect(ok.data.state.hp).toBe(7);
});

test('score, save and skill edits use the engine override keys', async () => {
  const r = await edited(await dm(mk()), (f) => { f('app.score.str').setText('18'); f('app.save.dex').setText('+9'); f('app.skill.sleight-of-hand').setText('4'); f('app.init').setText('3'); });
  expect(r.data.overrides).toEqual({ 'score.str': 18, 'save.dex': 9, 'skill.sleight-of-hand': 4, initiative: 3 });
  expect(r.edits).toEqual(['Initiative', 'Strength', 'Saving throw (Dex)', 'Skill (Sleight of Hand)']);
});

test('a __proto__ key in app.data pollutes nothing', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const c = mk();
  const doc = await PDFDocument.load(await dm(c));
  const data = JSON.stringify(c).slice(0, -1) + ',"__proto__":{"polluted":"yes"}}';
  doc.getForm().getTextField('app.data').setText(btoa(`{"format":"dnd-app-character","version":1,"data":${data},"__proto__":{"polluted":"yes"}}`));
  const r = await importPdf(await doc.save()).catch((e: Error) => e);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  if (!(r instanceof Error)) expect((r.data as unknown as Record<string, unknown>).polluted).toBeUndefined(); // an own "__proto__" key at most, never the prototype
});

test('an oversized app.data is refused with a clear message', async () => {
  const bytes = await dm(mk());
  limits.maxData = 1000; // the real cap is 32 MB: too big to build a PDF for here
  try { await expect(importPdf(bytes)).rejects.toThrow('too large'); } finally { limits.maxData = 32 * 1024 * 1024; }
});

test('the index is only loaded when a field map needs it', async () => {
  let loaded = 0;
  const { PDFDocument } = await import('pdf-lib');
  await importPdf(await dm(mk()), async () => { loaded++; return undefined; });
  const doc = await PDFDocument.create(); doc.addPage();
  await expect(importPdf(await doc.save(), async () => { loaded++; return undefined; })).rejects.toThrow('Unrecognised PDF');
  expect(loaded).toBe(0); // no map matched, so nothing asked for it
});

// ---- 2. long text ----

test('text that does not fit even at the smallest size continues on extra pages', async () => {
  const notes = Array.from({ length: 120 }, (_, i) => `Note line number ${i + 1}`).join('\n');
  const c = mk([], { details: { ...mk().details, notes } });
  const bytes = await dm(c);
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThan(3);
  expect(doc.getForm().getTextField('app.notes').getText()).toBe(notes); // the field keeps everything
  expect((await importPdf(bytes) as { edits: string[] }).edits).toEqual([]);
  const short = await PDFDocument.load(await dm(mk([], { details: { ...mk().details, notes: 'a\nb' } })));
  expect(short.getPageCount()).toBe(3);
});

// ---- 9 and 11 ----

test('reserved device names are caught before the first dot', () => {
  expect(fileName('con.foo', 'pdf')).toBe('character.pdf');
  expect(fileName('Lpt1.backup', 'json')).toBe('character.json');
  expect(fileName('console.log', 'pdf')).toBe('console.log.pdf');
});

test('labels read as in the books', async () => {
  const item = await importPdf(await exportItemPdf(potionFixture));
  expect(item.kind).toBe('item');
  const { PDFDocument } = await import('pdf-lib');
  const form = (await PDFDocument.load(await exportItemPdf(potionFixture))).getForm();
  expect([form.getTextField('app.item.type').getText(), form.getTextField('app.item.rarity').getText()]).toEqual(['Potion', 'Uncommon']);
  const chars = await PDFDocument.load(await dm(mk()));
  expect(chars.getForm().getTextField('app.spells').getText()).toBe('No spellcasting');
});
