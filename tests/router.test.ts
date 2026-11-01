import { expect, test } from 'vitest';
import { dmOnly, guardedHash, leaveGuard, parseHash, redirected } from '../src/lib/router.svelte.ts';

test('players get no Compendium, Items or Monsters (links or pages); the DM keeps everything', () => {
  for (const page of ['compendium', 'items', 'monsters']) {
    expect(dmOnly('player', page)).toBe(true);
    expect(dmOnly('dm', page)).toBe(false);
  }
  for (const page of ['', 'characters', 'combat', 'map', 'packs', 'settings', 'about', 'join']) expect(dmOnly('player', page)).toBe(false);
});

test('the old Loot address moves to Items > Unassigned; nothing else is redirected', () => {
  expect(redirected('#/loot')).toBe('#/items?tab=unassigned');
  expect(redirected('#/loot/')).toBe('#/items?tab=unassigned');
  expect(redirected('#/loot?x=1')).toBe('#/items?tab=unassigned');
  expect(redirected('#/items')).toBeUndefined();
  expect(redirected('#/items?tab=unassigned')).toBeUndefined(); // the target is stable, so no loop
  expect(redirected('')).toBeUndefined();
  expect(redirected('#/constructor')).toBeUndefined();
});

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
