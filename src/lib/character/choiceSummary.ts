import { richToPlain } from '../content/richtext.ts';
import type { RichText } from '../types.ts';

// Pure (no Svelte/Vite/DOM): the one-line summary an option card shows under its name.

const firstLine = (r: RichText): string | undefined => {
  for (const b of r) {
    const s = 'p' in b ? b.p : 'list' in b ? b.list[0] : 'h' in b ? firstLine(b.blocks) : undefined; // a table is no summary
    if (s?.trim()) return s;
  }
};

// A sentence ends at . ! or ? before a space or the end; "e.g." and "i.e." don't end one.
const SENTENCE = /^.+?(?<!\b(?:e\.g|i\.e))[.!?](?=\s|$)/s;

/**
 * The first sentence of `text` (marks stripped, a list's first item, a header's first block), cut to about `max`
 * characters at a word with an ellipsis. With no text it is the `prerequisite`, or '' when there is neither.
 */
export function choiceSummary(text: RichText | undefined, prerequisite?: string, max = 120): string {
  const line = text && firstLine(text);
  const plain = line ? richToPlain([{ p: line }]).replace(/\s+/g, ' ').trim() : '';
  if (!plain) return prerequisite?.trim() ?? '';
  const sentence = SENTENCE.exec(plain)?.[0] ?? plain;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max >> 1)).replace(/[\s,;:.]+$/, '')}…`;
}
