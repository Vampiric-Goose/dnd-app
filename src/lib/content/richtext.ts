import type { Block, RichText } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts and the 5etools importer.

const BAR = '██████'; // fixed width, so the bar doesn't leak the hidden text's length
// An opener (group 1 = id; the closing braces are optional so a malformed opener still counts) or a closer.
// A /g regex keeps `lastIndex` between calls: use it only with `matchAll` or `replace`, never `test` or `exec`.
export const MARK = /\{\{redact:([^}]*)(?:\}\})?|\{\{\/redact\}\}/g;
const TAG = /\{@(\w+)(?:\s+([^{}]*))?\}/g;

const ATK: Record<string, string> = {
  m: 'Melee', r: 'Ranged', mw: 'Melee Weapon', rw: 'Ranged Weapon', ms: 'Melee Spell', rs: 'Ranged Spell', 'mw,rw': 'Melee or Ranged Weapon',
};
// Index of the display-text part when it isn't the third one (default 2). Used only when that part
// exists and is non-empty; otherwise the tag shows part 0.
const DISPLAY_AT: Record<string, number> = {
  dice: 1, damage: 1, filter: 0, book: 0, adventure: 0, link: 0, footnote: 0, area: 0,
  deity: 3, card: 3, classFeature: 5, subclassFeature: 7, quickref: 4, subclass: 4,
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

const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

/**
 * Is `b` a well-formed Block: `{p}`, `{list}`, `{table: {caption?, head, rows}}` or `{h, blocks}` with every string a string and every
 * nested block valid? Everything that reads rich text (`lines`, `redact`, the renderers) assumes this, so data from a file or storage
 * must pass it first. `depth` stops a hostile, deeply nested file from running the stack out.
 */
export function isBlock(b: unknown, depth = 0): b is Block {
  if (typeof b !== 'object' || b === null || Array.isArray(b) || depth > 32) return false;
  const o = b as Record<string, unknown>;
  if ('p' in o) return typeof o.p === 'string';
  if ('list' in o) return strs(o.list);
  if ('table' in o) {
    const t = o.table as Record<string, unknown> | null;
    return typeof t === 'object' && t !== null && strs(t.head) && Array.isArray(t.rows) && t.rows.every(strs) && (t.caption === undefined || typeof t.caption === 'string');
  }
  return typeof o.h === 'string' && Array.isArray(o.blocks) && o.blocks.every(x => isBlock(x, depth + 1));
}

export const isRichText = (r: unknown): r is RichText => Array.isArray(r) && r.every(b => isBlock(b));

/** Marks stripped; redaction markers dropped but their text kept, so pass redacted text for player-facing output. */
export const richToPlain = (r: RichText): string =>
  lines(r).map(l => l.replace(MARK, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')).join('\n');

/**
 * The one redaction scanner. `open` is the stack of redactions still open, shared by every string of a
 * RichText in document order, so a span that is nested, unclosed or crosses blocks stays hidden until its
 * closer (or the end). Text shows only if every open redaction is revealed. A run of hidden text becomes
 * one bar; stray closers are dropped. Opened ids are added to `ids`.
 */
const scan = (s: string, open: string[], revealed: ReadonlySet<string>, ids?: Set<string>): string => {
  let out = '', barred = false, at = 0;
  const text = (t: string) => {
    if (open.every(id => revealed.has(id))) {
      out += t;
      if (t) barred = false;
    } else if (!barred) {
      out += BAR;
      barred = true;
    }
  };
  for (const m of s.matchAll(MARK)) {
    text(s.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] === undefined) open.pop();
    else {
      open.push(m[1]);
      ids?.add(m[1]);
    }
  }
  text(s.slice(at));
  return out;
};

export const redact = (r: RichText, revealed: ReadonlySet<string>): RichText => {
  const open: string[] = [];
  return mapText(r, s => scan(s, open, revealed));
};

export const redactionIds = (r: RichText): string[] => {
  const open: string[] = [], ids = new Set<string>();
  for (const l of lines(r)) scan(l, open, new Set(), ids);
  return [...ids];
};

/** The text inside each redaction (id -> hidden text), for the DM's list of redactions. Nested spans count in their outer ones; blocks are joined with a space. */
export const redactionTexts = (r: RichText): Map<string, string> => {
  const open: string[] = [], out = new Map<string, string>();
  const add = (t: string) => { for (const id of open) out.set(id, [out.get(id), t].filter(Boolean).join(' ')); };
  for (const l of lines(r)) {
    let at = 0;
    for (const m of l.matchAll(MARK)) {
      add(l.slice(at, m.index));
      at = m.index + m[0].length;
      if (m[1] === undefined) open.pop();
      else {
        open.push(m[1]);
        if (!out.has(m[1])) out.set(m[1], '');
      }
    }
    add(l.slice(at));
  }
  return out;
};

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
