import { expect, test } from 'vitest';
import { redactionTexts } from '../../src/lib/content/richtext.ts';
import { pruneRevealed, revealedView } from '../../src/lib/items/playerView.ts';
import { editableToRich, expandShorthand, expandWithCaret, nextRedactionId, richToEditable, wrapRedaction } from '../../src/lib/items/textEdit.ts';
import type { ItemDef, RichText } from '../../src/lib/types.ts';

test('editable text round-trips', () => {
  const r: RichText = [{ p: 'Para one' }, { list: ['a', 'b'] }, { table: { head: ['d6', 'x'], rows: [['1', 'y']] } }, { h: 'Head', blocks: [{ p: 'inner' }] }];
  expect(editableToRich(richToEditable(r))).toEqual(r);
  expect(editableToRich('Para one\n\n- a\n- b')).toEqual([{ p: 'Para one' }, { list: ['a', 'b'] }]);
});

test('wrapRedaction', () => {
  expect(wrapRedaction('abc def', 4, 7, 'r1')).toBe('abc {{redact:r1}}def{{/redact}}');
  const once = wrapRedaction('abc def', 4, 7, 'r1');
  expect(wrapRedaction(once, 2, 10, 'r2')).toBe(once);
  expect(wrapRedaction('abc', 1, 1, 'r1')).toBe('abc');
  expect(nextRedactionId([{ p: '{{redact:r1}}x{{/redact}} {{redact:r3}}y{{/redact}}' }])).toBe('r4');
  expect(nextRedactionId([])).toBe('r1');
});

test('editableToRich edge cases', () => {
  expect(editableToRich('a\r\n\r\n- b\r\n\r\n')).toEqual([{ p: 'a' }, { list: ['b'] }]);
  expect(editableToRich('')).toEqual([]);
  expect(editableToRich('   \n\n')).toEqual([]);
  // A ragged table row stays as typed (no padding or truncating).
  expect(editableToRich('| a | b |\n| 1 |\n| 1 | 2 | 3 |')).toEqual([{ table: { head: ['a', 'b'], rows: [['1'], ['1', '2', '3']] } }]);
  expect(richToEditable([])).toBe('');
});

test('R41/2: nextRedactionId counts taken (revealed) ids', () => {
  expect(nextRedactionId([], ['r1'])).toBe('r2');
  expect(nextRedactionId([{ p: '{{redact:r1}}x{{/redact}}' }], ['r4', 'other'])).toBe('r5');
});

test('pruneRevealed drops ids that no longer appear', () => {
  const item = { text: [{ p: 'plain' }], curse: [{ p: '{{redact:r2}}b{{/redact}}' }] } as ItemDef;
  expect(pruneRevealed(item, { hidden: ['rarity'], revealed: ['r1', 'r2'] })).toEqual({ hidden: ['rarity'], revealed: ['r2'] });
  expect(pruneRevealed(item, { hidden: [], revealed: ['r1'], text: [{ p: '{{redact:r1}}x{{/redact}}' }] }).revealed).toEqual(['r1']);
});

test('R42: expandShorthand turns ||x|| into id-based redactions', () => {
  expect(expandShorthand('a ||b|| c ||d||', [])).toBe('a {{redact:r1}}b{{/redact}} c {{redact:r2}}d{{/redact}}');
  expect(expandShorthand('||a\n\nb||', [])).toBe('{{redact:r1}}a\n\nb{{/redact}}');
  expect(expandShorthand('a || b', [])).toBe('a || b'); // lone || stays literal
  expect(expandShorthand('||a|| ||b', [])).toBe('{{redact:r1}}a{{/redact}} ||b');
  expect(expandShorthand('||||', [])).toBe('||||'); // empty span stays literal
  expect(expandShorthand('{{redact:r3}}x{{/redact}} ||y||', [])).toBe('{{redact:r3}}x{{/redact}} {{redact:r4}}y{{/redact}}');
  expect(expandShorthand('||y||', ['r1', 'r2'])).toBe('{{redact:r3}}y{{/redact}}'); // revealed ids are taken
  const inside = '{{redact:r1}}a || b || c{{/redact}}';
  expect(expandShorthand(inside, [])).toBe(inside); // inside an existing span: left alone
  expect(expandShorthand('plain', [])).toBe('plain');
});

test('expandShorthand leaves || inside a {@tag} alone', () => {
  const tag = 'see {@spell fireball||Fireball} and {@filter x|y||z} here';
  expect(expandShorthand(tag, [])).toBe(tag);
  expect(expandShorthand(`||${tag}||`, [])).toBe(`{{redact:r1}}${tag}{{/redact}}`); // a pair around a tag still pairs
  expect(expandShorthand('{@tag a||b} ||c|| {@tag d||e}', [])).toBe('{@tag a||b} {{redact:r1}}c{{/redact}} {@tag d||e}');
  expect(expandShorthand('{@tag open||x', [])).toBe('{@tag open||x'); // unclosed tag: its lone || stays literal
});

test('expandWithCaret keeps the caret out of the markers', () => {
  // Typing || in front of a lone || makes a pair that ends after the caret: the caret goes after the opener.
  expect(expandWithCaret('||x ||y', [], 2)).toEqual({ text: '{{redact:r1}}x {{/redact}}y', caret: 13 });
  expect(expandWithCaret('a ||b||', [], 7)).toEqual({ text: 'a {{redact:r1}}b{{/redact}}', caret: 27 }); // typed the closer: caret at the end
  expect(expandWithCaret('||b|| tail', [], 10)).toEqual({ text: '{{redact:r1}}b{{/redact}} tail', caret: 30 });
  expect(expandWithCaret('||abc|| z', [], 4)).toEqual({ text: '{{redact:r1}}abc{{/redact}} z', caret: 15 }); // inside the secret: same place in its text ("ab|c")
  expect(expandWithCaret('p ||b|| q', [], 1).caret).toBe(1); // before the pair: unchanged
  expect(expandWithCaret('no pair', [], 3)).toEqual({ text: 'no pair', caret: 3 });
});

test('redactionTexts gives each span its hidden text', () => {
  const r: RichText = [{ p: 'a {{redact:r1}}secret{{/redact}} b' }, { list: ['{{redact:r2}}x', 'y{{/redact}}'] }];
  expect([...redactionTexts(r)]).toEqual([['r1', 'secret'], ['r2', 'x y']]);
});

test('R39: revealedView reveals every redaction in text and curse, with no cover', () => {
  const item = { text: [{ p: '{{redact:r1}}a{{/redact}}' }], curse: [{ p: '{{redact:r2}}b{{/redact}}' }] } as ItemDef;
  expect(revealedView(item)).toEqual({ hidden: [], revealed: ['r1', 'r2'] });
});
