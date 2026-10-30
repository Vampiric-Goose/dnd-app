import { expect, test } from 'vitest';
import { entriesToRich, parseInline, redact, redactionIds, renderTags, richToPlain, textToRich } from '../../src/lib/content/richtext.ts';

test('tags', () => {
  expect(renderTags('{@spell fireball}')).toBe('fireball');
  expect(renderTags('{@spell fireball|phb|Fireball!}')).toBe('Fireball!');
  expect(renderTags('{@damage 2d6} {@dice 1d4+1}')).toBe('2d6 1d4+1');
  expect(renderTags('{@hit 5} {@hit -1} {@dc 15}')).toBe('+5 -1 DC 15');
  expect(renderTags('{@atk mw} {@atk rs} {@h}x')).toBe('*Melee Weapon Attack:* *Ranged Spell Attack:* *Hit:* x');
  expect(renderTags('{@recharge 5} {@recharge}')).toBe('(Recharge 5–6) (Recharge 6)');
  expect(renderTags('{@b bold {@i nested}}')).toBe('**bold *nested***');
  expect(renderTags('{@chance 25} {@filter cantrips|spells|level=0} {@foo bar|x}')).toBe('25 percent cantrips bar');
});
test('entries', () => {
  expect(entriesToRich(['a', { type: 'entries', name: 'Sub', entries: ['b'] },
    { type: 'list', items: ['x', { type: 'item', name: 'N', entry: 'y' }] },
    { type: 'table', caption: 'T', colLabels: ['d6', 'Effect'], rows: [[{ roll: { min: 1, max: 3 } }, '{@b x}'], [{ roll: { exact: 4 } }, 'z']] },
    { type: 'inset', name: 'Box', entries: ['c'] }, { type: 'refClassFeature', classFeature: 'X|Y||1' }, { type: 'image', href: {} }]))
    .toEqual([{ p: 'a' }, { h: 'Sub', blocks: [{ p: 'b' }] }, { list: ['x', '**N.** y'] },
      { table: { caption: 'T', head: ['d6', 'Effect'], rows: [['1–3', '**x**'], ['4', 'z']] } }, { h: 'Box', blocks: [{ p: 'c' }] }]);
});
test('SRD text with a table', () => {
  expect(textToRich(['Para', '| a | b |', '|---|---|', '| 1 | 2 |'])).toEqual([{ p: 'Para' }, { table: { head: ['a', 'b'], rows: [['1', '2']] } }]);
});
test('redaction', () => {
  const t = [{ p: 'Cures {{redact:r1}}nothing{{/redact}} and {{redact:r2}}poisons{{/redact}}.' }, { list: ['{{redact:r3}}x{{/redact}}'] }];
  expect(redact(t, new Set(['r1']))).toEqual([{ p: 'Cures nothing and ██████.' }, { list: ['██████'] }]);
  expect(redactionIds(t)).toEqual(['r1', 'r2', 'r3']);
});
test('SRD text with lists, and plain text', () => {
  const r = textToRich(['Intro', '- one', '* two', 'Outro']);
  expect(r).toEqual([{ p: 'Intro' }, { list: ['one', 'two'] }, { p: 'Outro' }]);
  expect(richToPlain([{ p: 'a **b**' }, { list: ['x'] }, { table: { head: ['h'], rows: [['1']] } }, { h: 'H', blocks: [{ p: 'c' }] }]))
    .toBe('a b\nx\nh\n1\nH\nc');
});
test('inline marks', () => {
  expect(parseInline('a **b *c*** d')).toEqual([{ t: 'a ', b: false, i: false }, { t: 'b ', b: true, i: false }, { t: 'c', b: true, i: true }, { t: ' d', b: false, i: false }]);
  expect(parseInline('5 * 3')).toEqual([{ t: '5 * 3', b: false, i: false }]);
});
