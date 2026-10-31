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

/** `r1`, `r2`, ...: one past the highest numbered redaction id in `r`. */
export const nextRedactionId = (r: RichText): string =>
  `r${Math.max(0, ...redactionIds(r).map(id => Number(/^r(\d+)$/.exec(id)?.[1] ?? 0))) + 1}`;
