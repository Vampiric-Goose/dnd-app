import { expect, test } from 'vitest';
import { choiceSummary } from '../../src/lib/character/choiceSummary.ts';

test('choiceSummary: first sentence, marks stripped, capped, prerequisite as fallback', () => {
  expect(choiceSummary([{ p: 'You gain a +2 bonus to attack rolls. It stacks with nothing.' }])).toBe('You gain a +2 bonus to attack rolls.');
  expect(choiceSummary([{ p: 'You gain a *+1* bonus' }, { p: 'Second paragraph.' }])).toBe('You gain a +1 bonus'); // no full stop: the whole line
  expect(choiceSummary([{ p: '**Bold.** Then more.' }])).toBe('Bold.');
  expect(choiceSummary([{ p: 'Pick something, e.g. a tool, and go. More.' }])).toBe('Pick something, e.g. a tool, and go.');
  expect(choiceSummary([{ list: ['Druid 3: Hold Person', 'Druid 5: Slow'] }])).toBe('Druid 3: Hold Person');
  expect(choiceSummary([{ h: 'Head', blocks: [{ p: 'Inside the header.' }] }])).toBe('Inside the header.');
  expect(choiceSummary([{ table: { head: ['a'], rows: [] } }, { p: 'After the table.' }])).toBe('After the table.');

  const long = `${'word '.repeat(60)}end.`;
  const cut = choiceSummary([{ p: long }]);
  expect(cut.length).toBeLessThanOrEqual(120);
  expect(cut.endsWith('word…')).toBe(true);

  expect(choiceSummary([], 'Pact of the Blade')).toBe('Pact of the Blade');
  expect(choiceSummary(undefined, 'Level 5')).toBe('Level 5');
  expect(choiceSummary([{ p: '  ' }], undefined)).toBe('');
  expect(choiceSummary([{ p: 'Has text.' }], 'Ignored prerequisite')).toBe('Has text.');
});
