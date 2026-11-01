// The Join page's code box: a typed code (any case, spaces, dashes) or a pasted link both give the bare code.
import { expect, test } from 'vitest';
import { codeFrom } from '../../src/lib/sync/code.ts';

test('codeFrom reads a typed code or a pasted join link', () => {
  expect(codeFrom('g5tk27yxa8fq')).toBe('G5TK27YXA8FQ');
  expect(codeFrom(' G5TK 27YX-A8FQ ')).toBe('G5TK27YXA8FQ');
  expect(codeFrom('https://vampiric-goose.github.io/dnd-app/#/join/G5TK27YXA8FQ')).toBe('G5TK27YXA8FQ');
  expect(codeFrom('G5TK27YXA8F')).toBe(''); // 11 characters
  expect(codeFrom('G5TK27YXA8F0')).toBe(''); // 0 is not in the code alphabet
  expect(codeFrom('')).toBe('');
});
