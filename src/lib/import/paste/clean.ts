import { spellLine } from '../../monsters/library.ts';
import type { Block, RichText } from '../../types.ts';

// Pure (no Svelte/Vite/DOM): tidies text pasted from a PDF or web page before a paste parser reads it.

// A line ending in one of these words (or a comma) stopped mid-sentence, so the next line continues it.
const OPEN_END = /(,|\b(?:a|an|the|of|and|or|to|with|its|their|in|on|by|for|from|that|than|as|at|is|are|be|can|must|takes?|deals?))$/i;

/** I3: a stat block is under 10 KB; more than this is a whole page or book, which the parsers must not chew on the main thread. */
export const MAX_PASTE = 50_000;

/**
 * Why a paste is refused before it is read, else undefined: too long to be one entry (I3), or R8: laid out like the 2024 books
 * ("AC 15 Initiative +2", "CR 1/4 (XP 50; PB +2)", a "MOD SAVE" score table; "Level 2 Evocation", "Using a Higher-Level Spell
 * Slot"). Items look the same in both editions, so only their length is checked.
 */
export function refusal(s: string, kind: 'monster' | 'spell' | 'item'): string | undefined {
  if (s.length > MAX_PASTE) return 'That is more than one entry. Paste one stat block, spell or item at a time.';
  // \s+ (which also matches non-breaking spaces and line breaks): a label and its value may sit on separate lines in a PDF copy.
  const sign = '[+\\-−–]';
  if (kind === 'monster' && ((/^\s*AC\s+\d+/m.test(s) && new RegExp(`Initiative\\s+${sign}\\s*\\d`).test(s)) || /\bCR\s+\S+\s+\(XP\s+[\d,]+;\s*PB/.test(s) || /\bMOD\s+SAVE\b/.test(s))) {
    return 'This looks like a 2024 stat block, which this app does not use.';
  }
  // The 2024 "Level 2 Evocation" line is the header, so look for it only in the first three lines, not in a wrapped description.
  const head = s.trim().split('\n').slice(0, 3).join('\n');
  if (kind === 'spell' && (/^\s*Level\s+\d\s+\w+/m.test(head) || /Using\s+a\s+Higher-Level\s+Spell\s+Slot/i.test(s))) return 'This looks like a 2024 spell, which this app does not use.';
  return undefined;
}

/**
 * NFKC (so ligatures such as 'ﬁ' become 'fi'), minus signs and dashes before a number become '-', spaces collapsed, and a line
 * broken mid-sentence joined to the next: one ending in a hyphen, a comma or an unfinished word ("the", "of"), or followed by a
 * line that starts in lower case. Blank lines are dropped; the result is trimmed.
 */
export function cleanPasted(s: string): string {
  const lines = s.normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[−–—](?=\s?\d)/g, '-')
    .replace(/[\t  ]+/g, ' ')
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /[a-z]-$/.test(prev) && /^[a-z]/.test(l)) out[out.length - 1] = prev.slice(0, -1) + l; // "attack-" / "ing"
    else if (prev !== undefined && (/^[a-z]/.test(l) || OPEN_END.test(prev))) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out.join('\n');
}

/** Lines of text as paragraphs: a line that doesn't end a sentence runs on into the next one. `breakBefore` forces a new paragraph. */
export function paragraphs(lines: string[], breakBefore: (l: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && !/[.!?:)]$/.test(prev) && !breakBefore(l)) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  }
  return out;
}

const BULLET = /^[•●▪-] /;
/** Paragraphs, with spell groups on their own lines and runs of bulleted lines as a list. */
export function rich(lines: string[]): RichText {
  const out: Block[] = [];
  for (const p of paragraphs(lines, (l) => !!spellLine(l) || BULLET.test(l))) {
    const prev = out[out.length - 1];
    if (!BULLET.test(p)) out.push({ p });
    else if (prev && 'list' in prev) prev.list.push(p.replace(BULLET, ''));
    else out.push({ list: [p.replace(BULLET, '')] });
  }
  return out;
}
