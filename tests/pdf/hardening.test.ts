import { expect, test } from 'vitest';
import { restoreSecrets } from '../../src/lib/backup.ts';
import { embedContent } from '../../src/lib/character/build.ts';
import { playerCharacter } from '../../src/lib/items/playerView.ts';
import { decodeEnvelope, readPayload } from '../../src/lib/pdf/appLayout.ts';
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
  return JSON.stringify(decodeEnvelope(readPayload((await PDFDocument.load(bytes)).getForm().getTextField('app.data'))));
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

test('I8: hidden charges leave no charge count, and a hidden attunement prints no "(attuned)" in a player PDF', async () => {
  const c = secrets();
  c.inventory[2] = { ...c.inventory[2], item: { ...potionFixture, charges: { max: 3, recharge: 'dawn' } }, chargesUsed: 2, view: { hidden: ['charges'], revealed: [] } };
  expect(playerCharacter(c).inventory[2].chargesUsed).toBe(0);
  expect(playerCharacter({ ...c, inventory: [{ ...c.inventory[2], view: undefined }] }).inventory[0].chargesUsed).toBe(2); // shown charges keep their count
  const { PDFDocument } = await import('pdf-lib');
  const inv = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getForm().getTextField('app.inventory').getText()!;
  expect(await inv(await player(c))).not.toContain('(attuned)'); // the gauntlets are attuned, but their attunement is hidden
  expect(await inv(await dm(c))).toContain('Gauntlets of Ogre Power (equipped) (attuned)');
});

test('a player PDF embeds the player-safe copy and re-imports with no edits', async () => {
  const c = secrets();
  const bytes = await player(c);
  const json = await embeddedJson(bytes);
  for (const secret of ['Ring of Protection', 'ring-of-protection', 'Potion of Poison', '"view"', '"revealed"']) expect(json, secret).not.toContain(secret);
  const r = await importPdf(bytes) as { data: Character; edits: string[]; playerView?: boolean };
  expect(r.edits).toEqual([]);
  expect(r.playerView).toBe(true);
  expect(restoreSecrets(r.data, c).inventory).toEqual(c.inventory); // R56: Replace puts the real items back
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

// A field that overflows even at 6 pt holds only its first k lines plus a marker; the extra pages carry the rest, with no overlap.
const MARKER = '(continued on next page)';
const longNotes = Array.from({ length: 120 }, (_, i) => `Note line number ${i + 1}`).join('\n');
const cutOf = async (bytes: Uint8Array, field: string) => {
  const { PDFDocument } = await import('pdf-lib');
  const env = decodeEnvelope(readPayload((await PDFDocument.load(bytes)).getForm().getTextField('app.data'))) as { cuts?: Record<string, number> };
  return env.cuts?.[field];
};

test('text that does not fit even at the smallest size is cut: the field holds the first lines and a marker, extra pages the rest', async () => {
  const c = mk([], { details: { ...mk().details, notes: longNotes } });
  const bytes = await dm(c);
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThan(3);
  const shown = doc.getForm().getTextField('app.notes').getText()!;
  const lines = shown.split('\n');
  expect(lines[0]).toBe('Note line number 1');
  expect(lines.at(-1)).toBe(MARKER);
  expect(lines.length).toBeLessThan(41); // fewer than the box holds at 6 pt by the layout model, with room to spare
  const cut = (await cutOf(bytes, 'app.notes'))!;
  expect(shown).toBe(longNotes.slice(0, cut) + '\n' + MARKER);
  const rest = longNotes.slice(cut).replace(/^\n/, '');
  expect(rest.split('\n')[0]).toBe(`Note line number ${lines.length}`); // line k+1: nothing printed twice, nothing skipped
  expect((await importPdf(bytes) as { edits: string[] }).edits).toEqual([]); // a straight round trip is no edit
});

test('editing the visible part of a cut notes field keeps everything after the cut', async () => {
  const c = mk([], { details: { ...mk().details, notes: longNotes } });
  const bytes = await dm(c);
  const { PDFDocument } = await import('pdf-lib');
  const shown = (await PDFDocument.load(bytes)).getForm().getTextField('app.notes').getText()!;
  const r = await edited(bytes, (f) => f('app.notes').setText(shown.replace('Note line number 1\n', 'EDITED first line\n')));
  expect(r.edits).toEqual(['Notes']);
  expect(r.data.details.notes).toBe(longNotes.replace('Note line number 1\n', 'EDITED first line\n'));
  expect(r.data.details.notes.endsWith('Note line number 120')).toBe(true);
  // deleting the marker line changes nothing else
  const noMarker = await edited(bytes, (f) => f('app.notes').setText(shown.replace('\n' + MARKER, '')));
  expect(noMarker.edits).toEqual([]);
  expect(noMarker.data.details.notes).toBe(longNotes);
});

test('every long multiline field is cut the same way, and short text only shrinks', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const short = await PDFDocument.load(await dm(mk([], { details: { ...mk().details, notes: 'a\nb' } })));
  expect(short.getPageCount()).toBe(3);
  const many = Array.from({ length: 120 }, (_, i) => ['chain-mail', false] as [string, boolean]).map(([s, e], i) => [i % 2 ? 'shield' : s, e] as [string, boolean]);
  const bytes = await dm(mk(many));
  const shown = (await PDFDocument.load(bytes)).getForm().getTextField('app.inventory').getText()!;
  expect(shown.endsWith(MARKER)).toBe(true);
  const cut = (await cutOf(bytes, 'app.inventory'))!;
  expect(cut).toBeGreaterThan(0);
  expect((await importPdf(bytes) as { edits: string[] }).edits).toEqual([]);
  // (paragraphs of ten sentences: pdf-lib's own layout of one very long paragraph is slow, which is not what is under test)
  const paras = (n: number) => Array.from({ length: n / 10 }, (_, p) => ({ p: Array.from({ length: 10 }, (_, i) => `sentence ${p * 10 + i + 1}.`).join(' ') }));
  const item = { ...potionFixture, text: paras(400) };
  const card = await PDFDocument.load(await exportItemPdf(item));
  expect(card.getPageCount()).toBe(1); // 400 short sentences fit by shrinking only
  const huge = await PDFDocument.load(await exportItemPdf({ ...potionFixture, text: paras(6000) }));
  expect(huge.getPageCount()).toBeGreaterThan(1);
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

test('I6: app.data rewritten by another tool as UTF-16, far past 100 KB, is decoded without pdf-lib\'s decoder; its size is checked first', async () => {
  const c = mk([], { details: { ...mk().details, backstory: 'A long tale. '.repeat(12_000) } }); // about 160 KB of text
  const { PDFDocument, PDFHexString } = await import('pdf-lib');
  const doc = await PDFDocument.load(await dm(c));
  const f = doc.getForm().getTextField('app.data');
  const payload = readPayload(f);
  expect(payload.length).toBeGreaterThan(100_000);
  f.acroField.setValue(PDFHexString.fromText(payload)); // UTF-16BE with a byte order mark, as other tools write it
  const bytes = await doc.save();
  const r = await importPdf(bytes) as { data: Character; edits: string[] };
  expect(r.data.details.backstory).toBe(c.details.backstory);
  expect(r.edits).toEqual([]);
  limits.maxData = 1000;
  try { await expect(importPdf(bytes)).rejects.toThrow(/^This PDF's embedded data is too large/); } finally { limits.maxData = 32 * 1024 * 1024; }
});

// T20-6: the cut paths beyond one-line-per-entry notes.
// Paragraphs of 50 words, each wrapped over several lines (pdf-lib's own layout of one huge paragraph is slow, which is not under test).
const wrappedNotes = Array.from({ length: 22 }, (_, p) => Array.from({ length: 50 }, (_, i) => `word${p * 50 + i + 1}`).join(' ')).join('\n');
test('a wrapped paragraph is cut between words; the field and the extra pages together hold it all, and a round trip is no edit', async () => {
  const bytes = await dm(mk([], { details: { ...mk().details, notes: wrappedNotes } }));
  const cut = (await cutOf(bytes, 'app.notes'))!;
  expect(cut).toBeGreaterThan(0);
  expect(wrappedNotes[cut]).toBe(' '); // a line boundary of the wrap, between two words
  const { PDFDocument } = await import('pdf-lib');
  expect((await PDFDocument.load(bytes)).getForm().getTextField('app.notes').getText()).toBe(`${wrappedNotes.slice(0, cut)}\n${MARKER}`);
  expect((await importPdf(bytes) as { edits: string[] }).edits).toEqual([]);
});

test('a single word longer than many lines is cut mid-word, and nothing is lost on re-import', async () => {
  const word = Array.from({ length: 36 }, (_, i) => `line ${i + 1}`).join('\n') + '\n' + 'x'.repeat(2500); // the cut falls inside the long word
  const bytes = await dm(mk([], { details: { ...mk().details, notes: word } }));
  const cut = (await cutOf(bytes, 'app.notes'))!;
  expect(cut).toBeGreaterThan(0);
  expect(cut).toBeGreaterThan(word.lastIndexOf('\n') + 1);
  expect(cut).toBeLessThan(word.length);
  const r = await importPdf(bytes) as { data: Character; edits: string[] };
  expect([r.data.details.notes, r.edits]).toEqual([word, []]);
});

test('an edit to the visible part of a wrapped paragraph is merged with the text after the cut', async () => {
  const bytes = await dm(mk([], { details: { ...mk().details, notes: wrappedNotes } }));
  const cut = (await cutOf(bytes, 'app.notes'))!;
  const r = await edited(bytes, (f) => f('app.notes').setText(`${wrappedNotes.slice(0, cut).replace('word1 ', 'EDITED ')}\n${MARKER}`));
  expect(r.edits).toEqual(['Notes']);
  expect(r.data.details.notes).toBe(wrappedNotes.replace('word1 ', 'EDITED '));
});

test('a character whose data is far past 100 KB still exports and re-imports (pdf-lib\'s text decoder overflows the stack there)', async () => {
  const c = mk([], { details: { ...mk().details, backstory: 'A long tale. '.repeat(40_000) } }); // about 520 KB of text
  const r = await importPdf(await dm(c)) as { data: Character; edits: string[] };
  expect(r.data.details.backstory.length).toBe(c.details.backstory.length);
  expect(r.edits).toEqual([]);
});
