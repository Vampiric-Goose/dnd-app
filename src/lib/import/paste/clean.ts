import { spellLine } from '../../monsters/library.ts';
import type { Block, RichText } from '../../types.ts';

// Pure (no Svelte/Vite/DOM): tidies text pasted from a PDF or web page before a paste parser reads it.

// A line ending in one of these words (or a comma) stopped mid-sentence, so the next line continues it.
const OPEN_END = /(,|\b(?:a|an|the|of|and|or|to|with|its|their|in|on|by|for|from|that|than|as|at|is|are|be|can|must|takes?|deals?))$/i;

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
