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
test('redaction fails closed: nested', () => {
  const t = [{ p: 'A {{redact:a}}x {{redact:b}}SECRETB{{/redact}} SECRETA{{/redact}} end' }];
  expect(redact(t, new Set())).toEqual([{ p: 'A ██████ end' }]);
  expect(redact(t, new Set(['a']))).toEqual([{ p: 'A x ██████ SECRETA end' }]);
  expect(redact(t, new Set(['b']))).toEqual([{ p: 'A ██████ end' }]); // inner alone can't open the outer
  expect(redact(t, new Set(['a', 'b']))).toEqual([{ p: 'A x SECRETB SECRETA end' }]);
  expect(redactionIds(t)).toEqual(['a', 'b']);
});
test('redaction fails closed: unclosed, stray closer, unterminated opener', () => {
  expect(redact([{ p: 'pre {{redact:r1}}SECRET never closed' }], new Set())).toEqual([{ p: 'pre ██████' }]);
  expect(redact([{ p: 'pre {{redact:r1}}SECRET never closed' }], new Set(['r1']))).toEqual([{ p: 'pre SECRET never closed' }]);
  expect(redact([{ p: 'a{{/redact}}b' }], new Set())).toEqual([{ p: 'ab' }]);
  expect(redact([{ p: 'pre {{redact:r1 SECRET' }], new Set())).toEqual([{ p: 'pre ██████' }]);
  expect(redact([{ p: 'x {{redact:}}S{{/redact}} y' }], new Set())).toEqual([{ p: 'x ██████ y' }]);
});
test('redaction fails closed: across blocks', () => {
  const t = [{ p: '{{redact:r1}}SEC' }, { p: 'RET{{/redact}} shown' }];
  expect(redact(t, new Set())).toEqual([{ p: '██████' }, { p: '██████ shown' }]);
  expect(redact(t, new Set(['r1']))).toEqual([{ p: 'SEC' }, { p: 'RET shown' }]);
  expect(redactionIds(t)).toEqual(['r1']);
});
test('redaction in table cells, captions and headings', () => {
  const t = [{ h: 'H {{redact:h1}}hid{{/redact}}', blocks: [{ table: { caption: 'C {{redact:c1}}cap{{/redact}}', head: ['a', '{{redact:t1}}b{{/redact}}'], rows: [['{{redact:t2}}1{{/redact}}', '2']] } }] }];
  expect(redact(t, new Set())).toEqual([{ h: 'H ██████', blocks: [{ table: { caption: 'C ██████', head: ['a', '██████'], rows: [['██████', '2']] } }] }]);
  expect(redact(t, new Set(['h1', 'c1', 't1', 't2']))).toEqual([{ h: 'H hid', blocks: [{ table: { caption: 'C cap', head: ['a', 'b'], rows: [['1', '2']] } }] }]);
  expect(redactionIds(t)).toEqual(['h1', 'c1', 't1', 't2']);
  expect(richToPlain(t)).toBe('H hid\nC cap\na | b\n1 | 2');
});
test('tag display parts, one row per DISPLAY_AT entry plus fallbacks', () => {
  const rows: [string, string][] = [
    ['{@dice 1d20+5|+5|Perception}', '+5'],
    ['{@damage 1d6+3|1d6 + 3}', '1d6 + 3'],
    ['{@filter cantrips|spells|level=0}', 'cantrips'],
    ["{@book Player's Handbook|PHB|3|Wizard}", "Player's Handbook"],
    ['{@adventure Curse of Strahd|CoS|2}', 'Curse of Strahd'],
    ['{@link the site|https://example.com|x}', 'the site'],
    ['{@footnote the gem|It glows faintly.|Gem lore}', 'the gem'],
    ['{@area Cellar|3a|CoS}', 'Cellar'],
    ['{@deity Pelor|Greyhawk|PHB|the Sun God}', 'the Sun God'],
    ['{@deity Pelor|Greyhawk|PHB}', 'Pelor'],
    ['{@classFeature Rage|Barbarian||1||Raging}', 'Raging'],
    ['{@classFeature Rage|Barbarian|PHB|1}', 'Rage'],
    ['{@subclassFeature Frenzy|Barbarian||Berserker||3||Frenzied}', 'Frenzied'],
    ['{@subclassFeature Frenzy|Barbarian|PHB|Berserker|PHB|3}', 'Frenzy'],
    ['{@quickref Cover||3||half cover}', 'half cover'],
    ['{@quickref difficult terrain||3}', 'difficult terrain'],
    ['{@card Ghost|Tarokka Deck|CoS|the Ghost}', 'the Ghost'],
    ['{@card Ghost|Tarokka Deck|CoS}', 'Ghost'],
    ["{@subclass Berserker|Barbarian|XPHB|XPHB|Berserker's}", "Berserker's"],
    ['{@subclass Berserker|Barbarian|PHB|PHB}', 'Berserker'],
    ['{@subclass Berserker|Barbarian|PHB}', 'Berserker'],
  ];
  for (const [input, out] of rows) expect(renderTags(input), input).toBe(out);
});
