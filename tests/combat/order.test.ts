// The tracker page's reorder: during a fight a move never carries a combatant past the current turn.
import { expect, test } from 'vitest';
import type { Combat, Combatant } from '../../src/lib/types.ts';
import { reorder } from '../../src/ui/initiative/order.ts';

const cb = (id: string, group?: string): Combatant => ({ id, kind: 'monster', name: id, initMod: 0, dex: 10, tie: 0, conSave: 0, ...(group && { group }) });
const fight = (ids: (string | [string, string])[], round: number, turn?: string): Combat =>
  ({ campaignId: 'c', combatants: ids.map((x) => (typeof x === 'string' ? cb(x) : cb(x[0], x[1]))), round, turn, groupMonsters: false, updatedAt: 0 });
const order = (c: Combat) => c.combatants.map((x) => x.id).join('');

test('in setup any move goes, and marks the order as the DM made it', () => {
  const c = reorder(fight(['a', 'b', 'c', 'd'], 0), 'd', 0);
  expect(order(c)).toBe('dabc');
  expect(c.reordered).toBe(true);
});

test('one who already acted stays before the current turn; one still to act stays after it', () => {
  const c = fight(['a', 'b', 'c', 'd', 'e'], 1, 'c');
  expect(order(reorder(c, 'a', 4))).toBe('bacde'); // clamped to just before c
  expect(order(reorder(c, 'b', 0))).toBe('bacde'); // free on its own side
  expect(order(reorder(c, 'e', 0))).toBe('abced'); // clamped to just after c
  expect(order(reorder(c, 'd', 4))).toBe('abced');
});

test('the current combatant itself moves freely and keeps the turn', () => {
  const c = reorder(fight(['a', 'b', 'c'], 1, 'b'), 'b', 0);
  expect(order(c)).toBe('bac');
  expect(c.turn).toBe('b');
});

test('a grouped current turn is one block: nobody lands inside it', () => {
  const c = fight(['a', ['g1', 'g'], ['g2', 'g'], 'd'], 1, 'g1');
  expect(order(reorder(c, 'd', 1))).toBe('ag1g2d');
  expect(order(reorder(c, 'a', 2))).toBe('ag1g2d');
});
