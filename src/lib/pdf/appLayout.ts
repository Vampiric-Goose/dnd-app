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
export const skillLabel = (s: Skill) => s.replace(/-/g, ' ').replace(/(^|\s)\p{Ll}/gu, (m) => m.toUpperCase());
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
    }).join('\n\n'),
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
  return Object.fromEntries(Object.entries(v).map(([k, s]) => [k, toWinAnsi(s)]));
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
  return Object.fromEntries(Object.entries({
    'app.item.name': item.name, 'app.item.type': item.type, 'app.item.rarity': item.rarity ?? '', 'app.item.details': details, 'app.item.text': text,
  }).map(([k, s]) => [k, toWinAnsi(s)]));
}

// The hidden field's payload: base64 of the UTF-8 JSON envelope.
export interface Envelope { format: 'dnd-app-character' | 'dnd-app-item'; version: 1; data: unknown; settings?: CampaignSettings; viewer?: Viewer }
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
function painter(lib: Lib, doc: import('pdf-lib').PDFDocument, page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont, bold: import('pdf-lib').PDFFont, values: Record<string, string>) {
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
    field(name: string, x: number, top: number, width: number, height: number, o: { multi?: boolean; size?: number; center?: boolean } = {}) {
      const f = form.createTextField(name);
      f.setText(values[name] ?? '');
      if (o.multi) f.enableMultiline();
      if (o.center) f.setAlignment(TextAlignment.Center);
      f.addToPage(page, { x, y: H - top - height, width, height, font, borderWidth: 0.75, borderColor: rgb(0.5, 0.5, 0.5), backgroundColor: rgb(0.97, 0.97, 0.97) });
      f.setFontSize(o.size ?? (o.multi ? 7.5 : 9)); // after addToPage: it needs the default appearance that call creates
    },
    /** A small caption over a field. */
    boxed(label: string, name: string, x: number, top: number, w: number, h: number, o: { multi?: boolean; size?: number; center?: boolean } = {}) {
      text(label, x, top - 9, 6.5);
      this.field(name, x, top, w, h, o);
    },
  };
}

export async function drawCharacter(lib: Lib, doc: import('pdf-lib').PDFDocument, values: Record<string, string>): Promise<import('pdf-lib').PDFPage> {
  const font = await doc.embedFont(lib.StandardFonts.Helvetica), bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const sub = `${APP_NAME} character sheet`;
  const first = doc.addPage([W, H]);
  const p = painter(lib, doc, first, font, bold, values);
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
  const q = painter(lib, doc, second, font, bold, values);
  q.title('Spells and slots', sub);
  q.boxed('Spells (* = prepared)', 'app.spells', M, 70, 540, 520, { multi: true, size: 8 });
  q.boxed('Spell slots (remaining/total)', 'app.slots', M, 614, 540, 110, { multi: true, size: 8 });
  // Inventory, currency, notes
  const third = doc.addPage([W, H]);
  const r = painter(lib, doc, third, font, bold, values);
  r.title('Inventory and notes', sub);
  r.boxed('Inventory', 'app.inventory', M, 70, 540, 380, { multi: true, size: 8 });
  (['cp', 'sp', 'ep', 'gp', 'pp'] as const).forEach((k, i) => r.boxed(k.toUpperCase(), `app.currency.${k}`, M + i * 70, 480, 60, 22, { center: true }));
  r.boxed('Notes', 'app.notes', M, 534, 540, 218, { multi: true, size: 8 });
  return first;
}

export async function drawItem(lib: Lib, doc: import('pdf-lib').PDFDocument, values: Record<string, string>): Promise<import('pdf-lib').PDFPage> {
  const font = await doc.embedFont(lib.StandardFonts.Helvetica), bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const page = doc.addPage([W, H]);
  const p = painter(lib, doc, page, font, bold, values);
  p.title('Item', `${APP_NAME} item card`);
  p.boxed('Name', 'app.item.name', M, 70, 540, 24, { size: 12 });
  p.boxed('Type', 'app.item.type', M, 116, 260, 20);
  p.boxed('Rarity', 'app.item.rarity', 316, 116, 260, 20);
  p.boxed('Details', 'app.item.details', M, 160, 540, 130, { multi: true, size: 8 });
  p.boxed('Description', 'app.item.text', M, 314, 540, 430, { multi: true, size: 8 });
  return page;
}

/** The hidden field that carries the full data. Its text is never drawn and has no appearance worth rendering. */
export function addDataField(lib: Lib, doc: import('pdf-lib').PDFDocument, page: import('pdf-lib').PDFPage, payload: string): void {
  const f = doc.getForm().createTextField('app.data');
  f.setText(payload);
  f.addToPage(page, { x: 0, y: 0, width: 1, height: 1, hidden: true, borderWidth: 0 });
}