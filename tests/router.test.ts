import { expect, test } from 'vitest';
import { guardedHash, leaveGuard, parseHash } from '../src/lib/router.svelte.ts';

test('leave guard keeps the old hash when it says no, and ignores query-only changes', () => {
  let asked = 0;
  leaveGuard.fn = () => (asked++, false);
  expect(guardedHash('#/items/new', '#/items')).toBe('#/items/new'); // refused: stay
  expect(guardedHash('#/items/new', '#/items/new?tab=x')).toBe('#/items/new?tab=x'); // same page: no prompt
  expect(asked).toBe(1);
  leaveGuard.fn = () => true;
  expect(guardedHash('#/items/new', '#/items')).toBe('#/items'); // allowed: go
  leaveGuard.fn = undefined;
  expect(guardedHash('#/a', '#/b')).toBe('#/b'); // no guard
});
test('parseHash splits path and query', () => {
  const r = parseHash('#/characters/x1?tab=spells');
  expect(r.path).toEqual(['characters', 'x1']);
  expect(r.query.get('tab')).toBe('spells');
  expect(parseHash('').path).toEqual([]);
  expect(parseHash('#/').path).toEqual([]);
});
