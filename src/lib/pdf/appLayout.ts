import { APP_NAME } from '../app.ts';
import { featureList, spellList } from '../character/play.ts';
import { richToPlain } from '../content/richtext.ts';
import { playerItem } from '../items/playerView.ts';
import { ABILITIES, SKILL_ABILITY } from '../rules/constants.ts';
import { DEFAULT_SETTINGS } from '../settings.ts';
import type { Ability, CampaignSettings, Character, ItemDef, Sheet, Skill } from '../types.ts';
import { toWinAnsi } from './winansi.ts';

// Pure except for the drawing (which takes pdf-lib as an argument, so this file never imports it at runtime).
// Our own layout: US Letter, plain boxes, no publisher trade dress.

export type Lib = typeof import('pdf-lib');
export type Viewer = 'dm' | 'player';
export interface Ctx { viewer?: Viewer; settings?: CampaignSettings }

export const ABILITY_LABEL: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
export const SKILLS = Object.keys(SKILL_ABILITY) as Skill[];
/** 'sleight-of-hand' becomes 'Sleight of Hand'. */
export const skillLabel = (s: Skill) => s.split('-').map((w) => (w === 'of' ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// Fields that hold several lines. Every other field is one line, so a newline in its value becomes a space.
const MULTILINE = new Set(['app.attacks', 'app.profs', 'app.features', 'app.spells', 'app.slots', 'app.inventory', 'app.notes', 'app.item.details', 'app.item.text']);
const clean = (v: Record<string, string>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, MULTILINE.has(k) ? toWinAnsi(x) : toWinAnsi(x).replace(/\n/g, ' ')]));
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
// ponytail: not Object.groupBy (iOS 16 lacks it)
const groupBy = <T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> => { const m = new Map<K, T[]>(); for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return m; };
const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** Every visible value of the character PDF, already passed through toWinAnsi. The viewer decides what an inventory shows. */
export function appFieldValues(c: Character, sheet: Sheet, ctx: Ctx = {}): Record<string, string> {
  const viewer = ctx.viewer ?? 'dm';
  const settings = ctx.settings ?? DEFAULT_SETTINGS;
  const name = (id?: string) => (id ? c.embedded[id]?.name : undefined);
  const counts: Record<string, number> = {};
  for (const l of c.build.levels) counts[l.classId] = (counts[l.classId] ?? 0) + 1;
  const v: Record<string, string> = {
    'app.name': c.name,
    'app.classLevels': Object.entries(counts).map(([id, n]) => `${name(id) ?? id} ${n}`).join(' / '),
    'app.race': name(c.build.subraceId) ?? name(c.build.raceId) ?? '',
    'app.background': name(c.build.backgroundId) ?? '',
    'app.alignment': c.details.alignment,
    'app.ac': String(sheet.ac),
    'app.init': signed(sheet.initiative),
    'app.speed': String(sheet.speed.walk),
    'app.hpMax': String(sheet.maxHp),
    'app.hp': String(c.state.hp),
    'app.hitDice': sheet.hitDice.map((h) => `${h.total}d${h.die}`).join(' + '),
    'app.prof': signed(sheet.prof),
    'app.passive': String(sheet.passivePerception),
    'app.attacks': sheet.attacks.map((a) => `${a.name} ${signed(a.toHit)}, ${a.damage} ${a.damageType}`).join('\n'),
    'app.profs': Object.entries({ Armor: sheet.proficiencies.armor, Weapons: sheet.proficiencies.weapons, Tools: sheet.proficiencies.tools, Languages: sheet.proficiencies.languages })
      .filter(([, l]) => l.length).map(([k, l]) => `${k}: ${l.join(', ')}`).join('\n'),
    'app.features': [...groupBy(featureList(c, settings), (f) => f.source)].map(([src, fs]) => `${src}: ${fs.map((f) => f.name).join(', ')}`).join('\n'),
    'app.spells': sheet.spellcasting.map((sc) => {
      const lines = [...groupBy(spellList(c, sc.classId), (s) => s.spell.level)].map(([lv, ss]) => `${lv === 0 ? 'Cantrips' : `Level ${lv}`}: ${ss.map((s) => s.spell.name + (s.prepared ? ' *' : '')).join(', ')}`);
      return [`${name(sc.classId) ?? 'Spells'} (save DC ${sc.dc}, attack ${signed(sc.attack)})`, ...lines].join('\n');
    }).join('\n\n') || 'No spellcasting',
    'app.slots': [...sheet.slots.flatMap((n, i) => (n ? [`${ordinal(i + 1)}: ${Math.max(0, n - (c.state.slotsUsed[i] ?? 0))}/${n}`] : [])),
      ...(sheet.pact ? [`Pact (level ${sheet.pact.level}): ${Math.max(0, sheet.pact.slots - c.state.pactSlotsUsed)}/${sheet.pact.slots}`] : [])].join('\n'),
    'app.inventory': c.inventory.map((e) => {
      const n = (viewer === 'player' ? playerItem(e.item, e.view) : e.item).name;
      return `${e.quantity} x ${n}${e.equipped ? ' (equipped)' : ''}${e.attuned ? ' (attuned)' : ''}`;
    }).join('\n'),
    'app.notes': c.details.notes,
  };
  for (const a of ABILITIES) {
    v[`app.score.${a}`] = String(sheet.scores[a]);
    v[`app.mod.${a}`] = signed(sheet.mods[a]);
    v[`app.save.${a}`] = signed(sheet.saves[a].bonus);
  }
  for (const s of SKILLS) v[`app.skill.${s}`] = signed(sheet.skills[s].bonus);
  for (const k of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) v[`app.currency.${k}`] = String(c.currency[k]);
  return clean(v);
}

/** Visible values of the item card. What it prints is exactly what the item holds: pass `playerItem(...)` for a player. */
export function itemFieldValues(item: ItemDef): Record<string, string> {
  const bonus = Object.entries(item.bonuses ?? {}).map(([k, n]) => `${k} ${signed(n)}`).join(', ');
  const details = [
    item.weapon && `Weapon: ${item.weapon.damage} ${item.weapon.damageType}${item.weapon.versatile ? ` (versatile ${item.weapon.versatile})` : ''}${item.weapon.properties.length ? `; ${item.weapon.properties.join(', ')}` : ''}`,
    item.armor && `Armor: AC ${item.armor.ac}${item.armor.dexCap !== undefined ? `, Dex cap ${item.armor.dexCap}` : ''}`,
    item.weight !== undefined && `Weight: ${item.weight} lb`,
    item.costCp !== undefined && `Cost: ${item.costCp / 100} gp`,
    item.attunement && `Attunement: ${item.attunement === true ? 'required' : item.attunement}`,
    bonus && `Bonuses: ${bonus}`,
    item.charges && `Charges: ${item.charges.max}, recharge ${item.charges.recharge}`,
  ].filter(Boolean).join('\n');
  const text = richToPlain(item.text) + (item.curse ? `\n\nCurse: ${richToPlain(item.curse)}` : '');
  return clean({ 'app.item.name': item.name, 'app.item.type': cap(item.type), 'app.item.rarity': cap(item.rarity ?? ''), 'app.item.details': details, 'app.item.text': text });
}

// The hidden field's payload: base64 of the UTF-8 JSON envelope.
export interface Envelope { format: 'dnd-app-character' | 'dnd-app-item'; version: 1; data: unknown; settings?: CampaignSettings; viewer?: Viewer; cuts?: Record<string, number> }
export function encodeEnvelope(e: Envelope): string {
  const bytes = new TextEncoder().encode(JSON.stringify(e));
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); // chunked: spread has an argument limit
  return btoa(s);
}
export function decodeEnvelope(b64: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(b64.trim()), (ch) => ch.charCodeAt(0))));
}

// ---- drawing ----

const W = 612, H = 792, M = 36;
const GREY = [0.35, 0.35, 0.35] as const;

/** One page's drawing helpers. `top` is the distance from the top edge, which is easier to lay out than PDF's bottom-left origin. */
/** What did not fit: the text for the extra pages, and for each cut field where its text was cut (an offset into its value). */
type Overflow = { pages: { title: string; text: string }[]; cuts: Record<string, number> };
const MIN_SIZE = 6;
/** The last line of a cut field. The text after it is on the extra pages. */
export const MARKER = '(continued on next page)';
/** A field's value as the PDF shows it when it was cut at `cut`: the text up to there, then the marker. */
export const cutShown = (full: string, cut: number): string => `${full.slice(0, cut)}\n${MARKER}`;
/** The user's edit of a cut field with the marker line removed (it is not part of the text). */
export const withoutMarker = (shown: string): string => shown.replace(/\n?\(continued on next page\)\s*$/, '');

// pdf-lib's widthOfTextAtSize is slow, and width is linear in size, so each word is measured once at size 1 per font.
const unitWidths = new WeakMap<import('pdf-lib').PDFFont, Map<string, number>>();
const unitWidth = (font: import('pdf-lib').PDFFont, s: string): number => {
  let m = unitWidths.get(font);
  if (!m) unitWidths.set(font, (m = new Map()));
  let w = m.get(s);
  if (w === undefined) m.set(s, (w = font.widthOfTextAtSize(s, 1)));
  return w;
};

/** `text` broken into lines no wider than `width` at `size` (words, hard newlines; a word too long for a line is split). Widths add up per word, ignoring kerning across spaces. */
function wrap(font: import('pdf-lib').PDFFont, text: string, width: number, size: number): string[] {
  const out: string[] = [];
  const max = width / size, space = unitWidth(font, ' ');
  for (const para of text.split('\n')) {
    let line = '', w = 0, started = false;
    for (const word of para.split(' ')) {
      const ww = unitWidth(font, word);
      if (!started) { line = word; w = ww; started = true; }
      else if (w + space + ww <= max) { line += ' ' + word; w += space + ww; continue; }
      else { out.push(line); line = word; w = ww; }
      while (line.length > 1 && w > max) {
        let n = line.length - 1;
        while (n > 1 && unitWidth(font, line.slice(0, n)) > max) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
        w = unitWidth(font, line);
      }
    }
    out.push(line);
  }
  return out;
}

/** Where each wrapped line of `text` ends in `text` (a line is a piece of the text; one space or newline sits between lines). */
function lineEnds(text: string, lines: string[]): number[] {
  let pos = 0;
  return lines.map((l) => {
    const i = text.startsWith(l, pos) ? pos : Math.max(pos, text.indexOf(l, pos));
    const end = i + l.length;
    pos = end + (text[end] === ' ' || text[end] === '\n' ? 1 : 0);
    return end;
  });
}

/**
 * The largest size from `max` down to MIN_SIZE at which `text` fits the box. If even MIN_SIZE is too big, `cut` says where to cut the
 * text: after the first k lines, where k leaves room for the marker line and one spare line under this layout model. The viewer's
 * own wrapping is not exactly ours, which is why the field must hold only those lines, not the whole text.
 */
function fit(font: import('pdf-lib').PDFFont, text: string, w: number, h: number, max: number): { size: number; cut?: number } {
  // Conservative against a reader's own wrapping: 4 pt of padding each side, and 1.2 line height.
  const availW = w - 8, availH = h - 8;
  for (let size = max; size >= MIN_SIZE; size -= 0.25) {
    if (wrap(font, text, availW, size).length * size * 1.2 <= availH) return { size };
  }
  const lines = wrap(font, text, availW, MIN_SIZE);
  const k = Math.max(1, Math.floor(availH / (MIN_SIZE * 1.2)) - 2);
  return { size: MIN_SIZE, cut: lineEnds(text, lines)[k - 1] };
}

function painter(lib: Lib, doc: import('pdf-lib').PDFDocument, page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont, bold: import('pdf-lib').PDFFont, values: Record<string, string>, overflow: Overflow) {
  const { rgb, TextAlignment } = lib;
  const form = doc.getForm();
  const text = (s: string, x: number, top: number, size = 8, b = false, grey = true) =>
    page.drawText(toWinAnsi(s), { x, y: H - top - size, size, font: b ? bold : font, color: grey ? rgb(...GREY) : rgb(0, 0, 0) });
  return {
    title: (s: string, sub: string) => { text(s, M, M, 16, true, false); text(sub, W - M - 150, M + 8, 8); },
    heading: (s: string, x: number, top: number) => text(s.toUpperCase(), x, top, 7.5, true),
    label: (s: string, x: number, top: number) => text(s, x, top, 6.5),
    row: (s: string, x: number, top: number) => text(s, x, top, 8, false, false),
    /** A form field named `name`, filled with its value from `values`. */
    field(name: string, x: number, top: number, width: number, height: number, o: { multi?: boolean; size?: number; center?: boolean; title?: string } = {}) {
      const f = form.createTextField(name);
      let value = values[name] ?? '';
      let size = o.size ?? (o.multi ? 7.5 : 9);
      if (o.multi) { // shrink to fit; past the 6 pt floor, the field holds the first lines and the extra pages the rest
        const r = fit(font, value, width, height, size);
        size = r.size;
        if (r.cut !== undefined) {
          overflow.pages.push({ title: o.title ?? name, text: value.slice(r.cut).replace(/^[ \n]/, '') });
          overflow.cuts[name] = r.cut;
          value = cutShown(value, r.cut);
        }
      }
      f.setText(value);
      if (o.multi) f.enableMultiline();
      if (o.center) f.setAlignment(TextAlignment.Center);
      f.addToPage(page, { x, y: H - top - height, width, height, font, borderWidth: 0.75, borderColor: rgb(0.5, 0.5, 0.5), backgroundColor: rgb(0.97, 0.97, 0.97) });
      f.setFontSize(size); // after addToPage: it needs the default appearance that call creates
    },
    /** A small caption over a field. */
    boxed(label: string, name: string, x: number, top: number, w: number, h: number, o: { multi?: boolean; size?: number; center?: boolean } = {}) {
      text(label, x, top - 9, 6.5);
      this.field(name, x, top, w, h, { ...o, title: label });
    },
  };
}

export async function drawCharacter(lib: Lib, doc: import('pdf-lib').PDFDocument, values: Record<string, string>): Promise<{ page: import('pdf-lib').PDFPage; cuts: Record<string, number> }> {
  const font = await doc.embedFont(lib.StandardFonts.Helvetica), bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const sub = `${APP_NAME} character sheet`;
  const overflow: Overflow = { pages: [], cuts: {} };
  const first = doc.addPage([W, H]);
  const p = painter(lib, doc, first, font, bold, values, overflow);
  p.title('Character', sub);
  p.boxed('Name', 'app.name', M, 70, 250, 22, { size: 12 });
  p.boxed('Class and level', 'app.classLevels', 292, 70, 284, 22);
  p.boxed('Race', 'app.race', M, 112, 190, 20);
  p.boxed('Background', 'app.background', 232, 112, 190, 20);
  p.boxed('Alignment', 'app.alignment', 428, 112, 148, 20);
  // Abilities
  p.heading('Abilities', M, 144);
  ABILITIES.forEach((a, i) => {
    const top = 168 + i * 58;
    p.boxed(ABILITY_LABEL[a], `app.score.${a}`, M, top, 52, 30, { size: 14, center: true });
    p.boxed('Modifier', `app.mod.${a}`, M + 58, top, 40, 30, { size: 11, center: true });
  });
  // Saves and skills
  p.heading('Saving throws', 150, 144);
  ABILITIES.forEach((a, i) => { p.field(`app.save.${a}`, 150, 156 + i * 17, 34, 14, { size: 8, center: true }); p.row(ABILITY_LABEL[a], 190, 159 + i * 17); });
  p.heading('Skills', 150, 268);
  SKILLS.forEach((s, i) => { p.field(`app.skill.${s}`, 150, 280 + i * 16.5, 34, 14, { size: 8, center: true }); p.row(`${skillLabel(s)} (${SKILL_ABILITY[s].toUpperCase()})`, 190, 283 + i * 16.5); });
  // Combat
  const stat: [string, string][] = [['Armor class', 'app.ac'], ['Initiative', 'app.init'], ['Speed', 'app.speed'], ['Proficiency', 'app.prof'], ['Passive Perc.', 'app.passive']];
  stat.forEach(([l, n], i) => p.boxed(l, n, 300 + i * 56, 168, 50, 30, { size: 12, center: true }));
  p.boxed('Max HP', 'app.hpMax', 300, 222, 80, 28, { size: 12, center: true });
  p.boxed('Current HP', 'app.hp', 390, 222, 80, 28, { size: 12, center: true });
  p.boxed('Hit dice', 'app.hitDice', 480, 222, 96, 28, { size: 10, center: true });
  p.boxed('Attacks', 'app.attacks', 300, 274, 276, 100, { multi: true });
  p.boxed('Proficiencies and languages', 'app.profs', 300, 392, 276, 100, { multi: true });
  p.boxed('Features and traits', 'app.features', 300, 510, 276, 242, { multi: true });
  // Spells and slots
  const second = doc.addPage([W, H]);
  const q = painter(lib, doc, second, font, bold, values, overflow);
  q.title('Spells and slots', sub);
  q.boxed('Spells (* = prepared)', 'app.spells', M, 70, 540, 520, { multi: true, size: 8 });
  q.boxed('Spell slots (remaining/total)', 'app.slots', M, 614, 540, 110, { multi: true, size: 8 });
  // Inventory, currency, notes
  const third = doc.addPage([W, H]);
  const r = painter(lib, doc, third, font, bold, values, overflow);
  r.title('Inventory and notes', sub);
  r.boxed('Inventory', 'app.inventory', M, 70, 540, 290, { multi: true, size: 8 });
  (['cp', 'sp', 'ep', 'gp', 'pp'] as const).forEach((k, i) => r.boxed(k.toUpperCase(), `app.currency.${k}`, M + i * 70, 392, 60, 22, { center: true }));
  r.boxed('Notes', 'app.notes', M, 446, 540, 306, { multi: true, size: 8 });
  drawOverflow(lib, doc, font, bold, overflow);
  return { page: first, cuts: overflow.cuts };
}

export async function drawItem(lib: Lib, doc: import('pdf-lib').PDFDocument, values: Record<string, string>): Promise<import('pdf-lib').PDFPage> {
  const font = await doc.embedFont(lib.StandardFonts.Helvetica), bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const overflow: Overflow = { pages: [], cuts: {} };
  const page = doc.addPage([W, H]);
  const p = painter(lib, doc, page, font, bold, values, overflow);
  p.title('Item', `${APP_NAME} item card`);
  p.boxed('Name', 'app.item.name', M, 70, 540, 24, { size: 12 });
  p.boxed('Type', 'app.item.type', M, 116, 260, 20);
  p.boxed('Rarity', 'app.item.rarity', 316, 116, 260, 20);
  p.boxed('Details', 'app.item.details', M, 160, 540, 130, { multi: true, size: 8 });
  p.boxed('Description', 'app.item.text', M, 314, 540, 430, { multi: true, size: 8 });
  drawOverflow(lib, doc, font, bold, overflow);
  return page;
}

/** Extra pages for text that did not fit its box: plain drawn text under "<Field> (continued)". The form fields stay the source of what is read back. */
function drawOverflow(lib: Lib, doc: import('pdf-lib').PDFDocument, font: import('pdf-lib').PDFFont, bold: import('pdf-lib').PDFFont, overflow: Overflow): void {
  const size = 8, lead = 10.5, perPage = Math.floor((H - 2 * M - 40) / lead);
  for (const { title, text } of overflow.pages) {
    const lines = wrap(font, text, W - 2 * M, size);
    for (let i = 0; i < lines.length; i += perPage) {
      const page = doc.addPage([W, H]);
      page.drawText(toWinAnsi(`${title} (continued)`), { x: M, y: H - M - 14, size: 12, font: bold, color: lib.rgb(0, 0, 0) });
      lines.slice(i, i + perPage).forEach((l, j) => page.drawText(l, { x: M, y: H - M - 40 - j * lead, size, font, color: lib.rgb(0, 0, 0) }));
    }
  }
}

/**
 * The hidden field that carries the full data. The payload is set as a plain PDF string, never through pdf-lib's `setText` / `getText`:
 * those decode with `String.fromCodePoint(...all)`, which overflows the stack for a payload of about 100 KB, and a character with
 * its embedded content is bigger than that. The field has no visible text, so it has no appearance to build either.
 */
export function addDataField(lib: Lib, doc: import('pdf-lib').PDFDocument, page: import('pdf-lib').PDFPage, payload: string): void {
  const f = doc.getForm().createTextField('app.data');
  f.addToPage(page, { x: 0, y: 0, width: 1, height: 1, hidden: true, borderWidth: 0 });
  f.acroField.setValue(lib.PDFString.of(payload)); // base64 is plain ASCII with nothing to escape
}

/** The text of a field, read without pdf-lib's decoder when the value is a plain string (as addDataField writes it). */
export function readPayload(f: import('pdf-lib').PDFTextField): string {
  const v = f.acroField.getValue() as { asBytes?: () => Uint8Array } | undefined;
  const bytes = v?.asBytes?.();
  if (bytes && !(bytes[0] === 0xfe && bytes[1] === 0xff)) return new TextDecoder('latin1').decode(bytes); // no UTF-16 mark: bytes are the characters
  return f.getText() ?? ''; // text written by another tool as UTF-16
}
