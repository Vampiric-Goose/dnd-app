import type { Block, RichText } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts and the 5etools importer.

const BAR = '██████'; // fixed width, so the bar doesn't leak the hidden text's length
const REDACT = /\{\{redact:([^}]+)\}\}([\s\S]*?)\{\{\/redact\}\}/g;
const TAG = /\{@(\w+)(?:\s+([^{}]*))?\}/g;

const ATK: Record<string, string> = {
  m: 'Melee', r: 'Ranged', mw: 'Melee Weapon', rw: 'Ranged Weapon', ms: 'Melee Spell', rs: 'Ranged Spell', 'mw,rw': 'Melee or Ranged Weapon',
};
// Index of the display-text part when it isn't the third one (default 2).
const DISPLAY_AT: Record<string, number> = {
  dice: 1, damage: 1, filter: 0, book: 0, adventure: 0, link: 0, footnote: 0, area: 0, deity: 3, classFeature: 5, subclassFeature: 7,
};

const tag = (name: string, arg = ''): string => {
  const parts = arg.split('|');
  const p0 = parts[0];
  switch (name) {
    case 'b': case 'bold': return `**${arg}**`;
    case 'i': case 'italic': case 'note': return `*${arg}*`;
    case 'hit': return /^[+-]/.test(p0) ? p0 : `+${p0}`;
    case 'dc': return `DC ${p0}`;
    case 'atk': return `*${ATK[p0] ?? p0} Attack:*`;
    case 'h': return '*Hit:* ';
    case 'recharge': return p0 && +p0 < 6 ? `(Recharge ${p0}–6)` : '(Recharge 6)';
    case 'chance': return `${p0} percent`;
    default: return parts[DISPLAY_AT[name] ?? 2] || p0;
  }
};

/** Resolves 5etools `{@tag a|b|c}` markup to plain text plus our `**bold**` / `*italic*` marks. Innermost tags first. */
export function renderTags(s: string): string {
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(TAG, (_, name: string, arg?: string) => tag(name, arg));
  }
  return s;
}

// ---- walking blocks ----

/** Every text line of a RichText, marks intact (table cells joined with ' | '). */
const lines = (r: RichText): string[] => r.flatMap((b): string[] =>
  'p' in b ? [b.p]
  : 'list' in b ? b.list
  : 'table' in b ? [b.table.caption ?? '', b.table.head.join(' | '), ...b.table.rows.map(x => x.join(' | '))].filter(Boolean)
  : [b.h, ...lines(b.blocks)]);

const mapText = (r: RichText, f: (s: string) => string): RichText => r.map((b): Block =>
  'p' in b ? { p: f(b.p) }
  : 'list' in b ? { list: b.list.map(x => f(x)) }
  : 'table' in b ? { table: { ...(b.table.caption !== undefined && { caption: f(b.table.caption) }), head: b.table.head.map(x => f(x)), rows: b.table.rows.map(row => row.map(x => f(x))) } }
  : { h: f(b.h), blocks: mapText(b.blocks, f) });

/** Marks stripped; redaction markers dropped but their text kept, so pass redacted text for player-facing output. */
export const richToPlain = (r: RichText): string =>
  lines(r).map(l => l.replace(REDACT, '$2').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')).join('\n');

export const redact = (r: RichText, revealed: ReadonlySet<string>): RichText =>
  mapText(r, s => s.replace(REDACT, (_, id: string, text: string) => (revealed.has(id) ? text : BAR)));

export const redactionIds = (r: RichText): string[] =>
  [...new Set(lines(r).flatMap(l => [...l.matchAll(REDACT)].map(m => m[1])))];

export interface Span { t: string; b: boolean; i: boolean }
/** Splits one string on `**` / `*` toggles. Unbalanced marks (e.g. a literal "5 * 3") leave the string as plain text. */
export function parseInline(s: string): Span[] {
  const out: Span[] = [];
  let b = false, i = false;
  for (const t of s.split(/(\*\*|\*)/)) {
    if (t === '**') b = !b;
    else if (t === '*') i = !i;
    else if (t) out.push({ t, b, i });
  }
  return b || i ? [{ t: s, b: false, i: false }] : out;
}

// ---- SRD desc arrays ----

/** SRD `desc` paragraphs: runs of `|` rows become a table (first row = head), `- `/`* ` runs become a list. */
export function textToRich(paragraphs: string[]): RichText {
  const out: Block[] = [];
  for (const s of paragraphs) {
    const prev = out[out.length - 1];
    if (s.startsWith('|')) {
      const cells = s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (!prev || !('table' in prev)) out.push({ table: { head: cells, rows: [] } });
      else if (!cells.every(c => /^:?-+:?$/.test(c))) prev.table.rows.push(cells);
    } else if (/^[-*] /.test(s)) {
      const item = s.slice(2).trim();
      if (prev && 'list' in prev) prev.list.push(item);
      else out.push({ list: [item] });
    } else out.push({ p: s });
  }
  return out;
}

// ---- 5etools entries ----

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null;
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const flat = (r: RichText): string => lines(r).join(' ');
const HEADED = new Set<unknown>(['entries', 'inset', 'insetReadaloud']);

const cell = (c: unknown): string =>
  typeof c === 'string' || typeof c === 'number' ? renderTags(String(c))
  : isObj(c) && isObj(c.roll) ? ('exact' in c.roll ? String(c.roll.exact) : `${c.roll.min}–${c.roll.max}`)
  : isObj(c) ? flat(entriesToRich([c]))
  : '';

const itemText = (it: Obj): string => {
  const body = flat(entriesToRich(it.entry !== undefined ? [it.entry] : arr(it.entries)));
  return (typeof it.name === 'string' ? `**${renderTags(it.name)}.** ${body}` : body).trim();
};
const isItem = (x: unknown): x is Obj => isObj(x) && (x.type === 'item' || x.type === 'itemSub');

/** 5etools `entries` arrays -> RichText. Unknown types with `entries` are flattened; the rest are dropped. */
export function entriesToRich(entries: unknown[]): RichText {
  return entries.flatMap((e): Block[] => {
    if (typeof e === 'string') return [{ p: renderTags(e) }];
    if (!isObj(e)) return [];
    switch (e.type) {
      case 'list':
        return [{ list: arr(e.items).map(i => (isItem(i) ? itemText(i) : flat(entriesToRich([i])))).filter(Boolean) }];
      case 'item': case 'itemSub':
        return [{ p: itemText(e) }];
      case 'table':
        return [{ table: {
          ...(typeof e.caption === 'string' && { caption: renderTags(e.caption) }),
          head: arr(e.colLabels).map(cell),
          rows: arr(e.rows).map(row => arr(row).map(cell)),
        } }];
      default: {
        if (!Array.isArray(e.entries)) return [];
        const blocks = entriesToRich(e.entries);
        // 5etools treats a missing `type` as 'entries'
        return typeof e.name === 'string' && HEADED.has(e.type ?? 'entries') ? [{ h: renderTags(e.name), blocks }] : blocks;
      }
    }
  });
}
