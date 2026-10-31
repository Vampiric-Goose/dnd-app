import { MARK, redactionIds, textToRich } from '../content/richtext.ts';
import type { RichText } from '../types.ts';

// Pure (no Svelte/Vite/DOM): the plain-text form of a RichText that the item editor's text areas show.
// Blocks are separated by blank lines; `- ` lines are a list, `| a | b |` rows a table (first row = head),
// `## H` starts a header that owns the blocks after it up to the next `## `.
// ponytail: a table caption, a header nested in a header and a paragraph that itself starts with "- ", "|" or "## "
// don't survive the round trip; adjacent lists (or tables) merge. Homebrew text rarely has any of these.

export function richToEditable(r: RichText): string {
  return r.map((b): string =>
    'p' in b ? b.p
    : 'list' in b ? b.list.map(x => `- ${x}`).join('\n')
    : 'table' in b ? [b.table.head, ...b.table.rows].map(row => `| ${row.join(' | ')} |`).join('\n')
    : [`## ${b.h}`, richToEditable(b.blocks)].filter(Boolean).join('\n\n'),
  ).join('\n\n');
}

export function editableToRich(s: string): RichText {
  const out: RichText = [];
  let run: string[] = []; // the plain lines since the last header
  let head: { h: string; blocks: RichText } | undefined;
  const flush = () => {
    const blocks = textToRich(run);
    if (head) head.blocks = blocks;
    else out.push(...blocks);
    run = [];
  };
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      flush();
      head = { h: line.slice(3).trim(), blocks: [] };
      out.push(head);
    } else run.push(line);
  }
  flush();
  return out;
}

/** Wraps `s[start, end)` in a redaction. Returns `s` unchanged for an empty range or one that touches an existing marker. */
export function wrapRedaction(s: string, start: number, end: number, id: string): string {
  if (!(start < end)) return s;
  for (const m of s.matchAll(MARK)) if (m.index < end && m.index + m[0].length > start) return s;
  return `${s.slice(0, start)}{{redact:${id}}}${s.slice(start, end)}{{/redact}}${s.slice(end)}`;
}

const idNumber = (id: string): number => Number(/^r(\d+)$/.exec(id)?.[1] ?? 0);

/**
 * `r1`, `r2`, ...: one past the highest numbered redaction id in `r` or in `taken`. Pass the view's revealed ids as
 * `taken`: a new redaction must never reuse an id the player already has revealed, or it would show at once.
 */
export const nextRedactionId = (r: RichText, taken: readonly string[] = []): string =>
  `r${Math.max(0, ...redactionIds(r).map(idNumber), ...taken.map(idNumber)) + 1}`;

// A 5etools `{@tag a||b}` is one opaque token: its `||` separate the tag's own parts. ponytail: a tag nested inside a tag
// ends the outer one early; homebrew text typed by hand never nests them.
const TOKEN = new RegExp(`${MARK.source}|\\{@[^{}]*\\}|\\|\\|`, 'g');

/**
 * The `||secret||` shorthand: each pair becomes `{{redact:rN}}secret{{/redact}}`, ids continuing after the highest in
 * `s` and `taken`. A lone `||`, an empty `||||`, any `||` inside an existing redaction and any inside a `{@tag}` stay as typed.
 * `caret` (an offset in `s`) is mapped into the result; a caret inside a pair lands in its secret, never inside a marker.
 */
export function expandWithCaret(s: string, taken: readonly string[], caret = s.length): { text: string; caret: number } {
  let depth = 0, open: number | undefined;
  const pairs: [number, number][] = [];
  for (const m of s.matchAll(TOKEN)) {
    if (m[0].startsWith('{@')) continue;
    if (m[0] !== '||') depth = m[1] === undefined ? Math.max(0, depth - 1) : depth + 1;
    else if (depth === 0) {
      if (open === undefined) open = m.index;
      else if (m.index > open + 2) { pairs.push([open, m.index]); open = undefined; }
      else open = m.index; // `||||`: not a span; this one may open the next
    }
  }
  if (!pairs.length) return { text: s, caret };
  let n = idNumber(nextRedactionId([{ p: s }], taken)) - 1, out = '', at = 0, to = caret;
  for (const [a, b] of pairs) {
    out += s.slice(at, a);
    const opener = `{{redact:r${++n}}}`;
    if (caret > a && caret < b + 2) to = out.length + opener.length + Math.min(Math.max(caret - a - 2, 0), b - a - 2);
    out += `${opener}${s.slice(a + 2, b)}{{/redact}}`;
    at = b + 2;
    if (caret >= at) to = caret + out.length - at;
  }
  return { text: out + s.slice(at), caret: to };
}

export const expandShorthand = (s: string, taken: readonly string[]): string => expandWithCaret(s, taken).text;
