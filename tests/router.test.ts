import { expect, test } from 'vitest';
import { parseHash } from '../src/lib/router.svelte.ts';
test('parseHash splits path and query', () => {
  const r = parseHash('#/characters/x1?tab=spells');
  expect(r.path).toEqual(['characters', 'x1']);
  expect(r.query.get('tab')).toBe('spells');
  expect(parseHash('').path).toEqual([]);
  expect(parseHash('#/').path).toEqual([]);
});
