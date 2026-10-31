import { is2024, strip2024 } from '../character/strip2024.ts';
import type { ContentIndex } from '../content/index.ts';
import { soundMonster } from '../monsters/homebrew.ts';
import { characterProblem, isRec, problem, SHAPES } from '../recordShape.ts';
import { ABILITIES, parseAlignment } from '../rules/constants.ts';
import { CR_LADDER } from '../rules/monsters.ts';
import { computeSheet } from '../rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import type { Ability, CampaignSettings, Character, ItemDef, MonsterDef, OverrideKey, Sheet, Skill } from '../types.ts';
import { ABILITY_LABEL, appFieldValues, cutShown, decodeEnvelope, monsterFieldValues, PayloadTooLarge, readPayload, SKILLS, skillLabel, withoutMarker, type Viewer } from './appLayout.ts';
import { FIELD_MAPS } from './fieldmap.ts';
import { toWinAnsi } from './winansi.ts';

// pdf-lib is reached only through `await import('pdf-lib')`, so it stays in its own lazy chunk.
// A PDF is a user's file: every failure below is a plain Error with a message fit to show, never a crash.

/** `playerView`: the file was exported in Player view, so secret item details are not in it (R51). */
export type ImportedPdf = { kind: 'character'; data: Character; edits: string[]; playerView?: boolean } | { kind: 'item'; data: ItemDef } | { kind: 'monster'; data: MonsterDef; edits: string[] };

/** What a field map may need: the content index itself, or a function that loads it (called only when a map matches). */
export type IndexSource = ContentIndex | (() => ContentIndex | undefined | Promise<ContentIndex | undefined>);

/** Characters of base64 allowed in app.data. A mutable object so a test can lower it. */
export const limits = { maxData: 32 * 1024 * 1024 };

type Field = { name: string; label: string; int: boolean; apply(c: Character, v: string | number): void };
const override = (name: string, label: string, key: OverrideKey): Field => ({ name, label, int: true, apply: (c, v) => { c.overrides[key] = v as number; } });

// The editable fields, in the order edits are listed. Everything else on the PDF is derived and ignored on re-import.
const FIELDS: Field[] = [
  { name: 'app.name', label: 'Name', int: false, apply: (c, v) => { c.name = v as string; } },
  { name: 'app.alignment', label: 'Alignment', int: false, apply: (c, v) => { c.details.alignment = parseAlignment(v as string); } },
  { name: 'app.hp', label: 'HP', int: true, apply: (c, v) => { c.state.hp = Math.max(0, v as number); } },
  override('app.ac', 'AC', 'ac'),
  override('app.init', 'Initiative', 'initiative'),
  override('app.speed', 'Speed', 'speed'),
  override('app.hpMax', 'Max HP', 'maxHp'),
  override('app.prof', 'Proficiency', 'prof'),
  override('app.passive', 'Passive Perception', 'passivePerception'),
  ...(Object.keys(ABILITY_LABEL) as Ability[]).flatMap((a) => [
    override(`app.save.${a}`, `Saving throw (${a[0].toUpperCase() + a.slice(1)})`, `save.${a}`),
    override(`app.score.${a}`, ABILITY_LABEL[a], `score.${a}`),
  ]),
  ...SKILLS.map((s: Skill) => override(`app.skill.${s}`, `Skill (${skillLabel(s)})`, `skill.${s}`)),
  ...(['cp', 'sp', 'ep', 'gp', 'pp'] as const).map((k): Field => ({ name: `app.currency.${k}`, label: 'Currency', int: true, apply: (c, v) => { c.currency[k] = Math.max(0, v as number); } })),
  { name: 'app.notes', label: 'Notes', int: false, apply: (c, v) => { c.details.notes = v as string; } },
];

const NOT_APPLIED = "Notes (not applied: contains characters the PDF can't hold)";
const tooLarge = () => new Error(`This PDF's embedded data is too large to import (over ${limits.maxData / 1024 / 1024} MB)`);
const damaged = (why: string) => new Error(`This PDF's data is damaged: ${why}`);
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const lines = (s: string) => s.replace(/\r\n?/g, '\n'); // readers may rewrite line breaks

/** Reads a PDF made by exportCharacterPdf or exportItemPdf (edits in a reader come back as overrides), or an official sheet a field map knows. */
export async function importPdf(bytes: Uint8Array, index?: IndexSource): Promise<ImportedPdf> {
  const lib = await import('pdf-lib');
  const fields: Record<string, string | boolean> = Object.create(null); // field names come from the file
  try {
    const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    for (const f of doc.getForm().getFields()) {
      if (f instanceof lib.PDFTextField) fields[f.getName()] = f.getName() === 'app.data' ? readPayload(f, limits.maxData) : f.getText() ?? '';
      else if (f instanceof lib.PDFCheckBox) fields[f.getName()] = f.isChecked();
      else if (f instanceof lib.PDFRadioGroup) fields[f.getName()] = f.getSelected() ?? '';
      else if (f instanceof lib.PDFDropdown) fields[f.getName()] = f.getSelected()[0] ?? '';
      else if (f instanceof lib.PDFOptionList) fields[f.getName()] = f.getSelected()[0] ?? '';
    }
  } catch (e) {
    if (e instanceof PayloadTooLarge) throw tooLarge();
    throw new Error(`That file is not a readable PDF: ${reason(e)}`);
  }

  const payload = fields['app.data'];
  if (typeof payload === 'string' && payload) {
    if (payload.length > limits.maxData) throw tooLarge();
    return fromData(payload, fields);
  }

  const names = new Set(Object.keys(fields));
  const map = FIELD_MAPS.find((m) => m.detect(names));
  if (!map) throw new Error('Unrecognised PDF: no supported form fields');
  let data: Character;
  try { data = map.toCharacter(fields, typeof index === 'function' ? await index() : index); } catch (e) { throw new Error(`Could not read this ${map.id} sheet: ${reason(e)}`); }
  const why = characterProblem(data);
  if (why) throw new Error(`Could not read this ${map.id} sheet: character ${why}`);
  return { kind: 'character', data: strip2024(data), edits: [] };
}

function fromData(payload: string, fields: Record<string, string | boolean>): ImportedPdf {
  let env: unknown;
  try { env = decodeEnvelope(payload); } catch (e) { throw damaged(`its embedded data cannot be decoded (${reason(e)})`); }
  if (!isRec(env) || (env.format !== 'dnd-app-character' && env.format !== 'dnd-app-item' && env.format !== 'dnd-app-monster')) throw new Error('This PDF holds data this app does not recognise (unknown format)');
  if (env.version !== 1) throw new Error(`This PDF was made by a newer version of the app (data version ${String(env.version)})`);

  if (env.format === 'dnd-app-monster') {
    if (!soundMonster(env.data)) throw damaged('monster is not a readable stat block');
    if (is2024(env.data)) throw new Error('This monster is from the 2024 rules, which this app does not use.'); // R60
    return { kind: 'monster', ...monsterEdits(env.data as MonsterDef, fields) };
  }
  if (env.format === 'dnd-app-item') {
    const why = problem(env.data, SHAPES.item);
    if (why) throw damaged(`item ${why}`);
    return { kind: 'item', data: env.data as ItemDef };
  }
  const why = characterProblem(env.data);
  if (why) throw damaged(`character ${why}`);
  const settings = { ...DEFAULT_SETTINGS, ...(isRec(env.settings) ? env.settings : {}) } as CampaignSettings;
  const viewer: Viewer = env.viewer === 'player' ? 'player' : 'dm';
  // Edits are found against the data as exported; 2024 content is stripped from the result (R54).
  const r = applyEdits(env.data as Character, settings, viewer, fields, isRec(env.cuts) ? env.cuts : {});
  return { kind: 'character', data: strip2024(r.data), edits: r.edits, ...(viewer === 'player' && { playerView: true }) };
}

/** Compares each editable field with what the data itself produces; a different value is an edit made in a PDF reader. */
function applyEdits(data: Character, settings: CampaignSettings, viewer: Viewer, fields: Record<string, string | boolean>, cuts: Record<string, unknown>): { data: Character; edits: string[] } {
  let sheet: Sheet, expected: Record<string, string>;
  try {
    sheet = computeSheet(data, { settings, viewer });
    expected = appFieldValues(data, sheet, { viewer, settings });
  } catch (e) {
    throw damaged(`the character cannot be computed (${reason(e)})`);
  }
  // Copies of what an edit touches: the embedded record itself is never mutated.
  const out: Character = { ...data, state: { ...data.state }, overrides: { ...data.overrides }, currency: { ...data.currency }, details: { ...data.details } };
  const edits: string[] = [];
  for (const f of FIELDS) {
    const raw = fields[f.name];
    if (typeof raw !== 'string') continue; // missing from this PDF
    if (f.int) {
      const n = parseInt(raw, 10);
      if (!Number.isSafeInteger(n) || n === parseInt(expected[f.name], 10)) continue; // not a usable number, or not a change
      f.apply(out, n);
    } else {
      const v = lines(raw);
      // A field that overflowed holds only the start of its text and a marker line (the rest is on extra pages and in app.data).
      const full = expected[f.name], at = cuts[f.name];
      const cut = typeof at === 'number' && Number.isInteger(at) && at >= 0 && at <= full.length ? at : undefined;
      if (v === lines(cut === undefined ? full : cutShown(full, cut))) continue;
      // The field holds only what the PDF could draw, so applying a partial edit of it would silently drop the rest.
      if (f.name === 'app.notes' && data.details.notes !== toWinAnsi(data.details.notes)) { edits.push(NOT_APPLIED); continue; }
      const next = cut === undefined ? v : withoutMarker(v) + full.slice(cut); // an edit of the visible part keeps everything after the cut
      if (next === lines(full)) continue; // only the marker line was removed
      f.apply(out, next);
    }
    edits.push(f.label);
  }
  return { data: out, edits: [...new Set(edits)] };
}

/**
 * The monster stat block's editable fields (name, main AC, HP average, CR, the six scores), compared with what the embedded record
 * prints. A changed, usable value replaces that field; everything else comes from the record. The record itself is never mutated.
 */
function monsterEdits(data: MonsterDef, fields: Record<string, string | boolean>): { data: MonsterDef; edits: string[] } {
  const expected = monsterFieldValues(data);
  const out: MonsterDef = { ...data, ac: data.ac.map((a) => ({ ...a })), scores: { ...data.scores } };
  const edits: string[] = [];
  const changed = (name: string): string | undefined => {
    const raw = fields[name];
    return typeof raw === 'string' && lines(raw).trim() !== expected[name].trim() ? lines(raw).trim() : undefined;
  };
  const int = (s: string | undefined) => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : undefined);
  const name = changed('app.name');
  if (name) { out.name = name; edits.push('Name'); }
  const ac = int(changed('app.ac'));
  if (ac !== undefined && out.ac.length) { out.ac[0].value = ac; edits.push('AC'); }
  const hp = int(changed('app.hp'));
  if (hp !== undefined && hp >= 1) { out.hp = { average: hp }; edits.push('HP'); } // I4: no formula, so the editor keeps it
  const cr = changed('app.cr');
  if (cr && CR_LADDER.includes(cr)) { out.cr = cr; delete out.xp; edits.push('CR'); } // a printed XP belonged to the old CR
  for (const a of ABILITIES) {
    const n = int(changed(`app.score.${a}`));
    if (n !== undefined && n >= 1 && n <= 30) { out.scores[a] = n; edits.push(ABILITY_LABEL[a]); }
  }
  return { data: out, edits };
}