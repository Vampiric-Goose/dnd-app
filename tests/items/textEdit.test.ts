import { expect, test } from 'vitest';
import { redactionTexts } from '../../src/lib/content/richtext.ts';
import { revealedView } from '../../src/lib/items/playerView.ts';
import { editableToRich, nextRedactionId, richToEditable, wrapRedaction } from '../../src/lib/items/textEdit.ts';
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

test('redactionTexts gives each span its hidden text', () => {
  const r: RichText = [{ p: 'a {{redact:r1}}secret{{/redact}} b' }, { list: ['{{redact:r2}}x', 'y{{/redact}}'] }];
  expect([...redactionTexts(r)]).toEqual([['r1', 'secret'], ['r2', 'x y']]);
});

test('R39: revealedView reveals every redaction in text and curse, with no cover', () => {
  const item = { text: [{ p: '{{redact:r1}}a{{/redact}}' }], curse: [{ p: '{{redact:r2}}b{{/redact}}' }] } as ItemDef;
  expect(revealedView(item)).toEqual({ hidden: [], revealed: ['r1', 'r2'] });
});
