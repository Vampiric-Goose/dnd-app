// The tracker page's reorder: during a fight a move never carries a combatant past the current turn.
import { expect, test } from 'vitest';
import type { Combat, Combatant } from '../../src/lib/types.ts';
import { reorder, sortAround } from '../../src/ui/initiative/order.ts';

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

test('final I1: the current combatant stays put during a fight (scenario A: dragging A to the bottom would skip B and C)', () => {
  const c = fight(['a', 'b', 'c'], 1, 'a');
  expect(reorder(c, 'a', 2)).toBe(c);
  expect(reorder(fight(['a', 'b', 'c'], 1, 'b'), 'b', 0).combatants.map((x) => x.id).join('')).toBe('abc');
});

test('final I1: no member of a grouped current run moves (scenario B: G2 to the bottom would act twice)', () => {
  const c = fight([['g1', 'g'], ['g2', 'g'], ['g3', 'g'], 'x'], 1, 'g1');
  expect(reorder(c, 'g2', 3)).toBe(c);
  expect(reorder(c, 'g1', 3)).toBe(c);
});

test('an unknown id changes nothing', () => {
  const c = fight(['a', 'b'], 1, 'a');
  expect(reorder(c, 'zz', 0)).toBe(c);
});

test('final M1: Sort during a fight sorts each side of the current run and leaves the run where it is', () => {
  const at = (id: string, init?: number) => ({ ...cb(id), ...(init !== undefined && { init }) });
  // round 2, m (15) has the turn; p (18) rolled late and sits after m; d (5) and e (20) are still to act
  const c: Combat = { ...fight([], 2, 'm'), combatants: [at('b', 10), at('a', 12), at('m', 15), at('p', 18), at('d', 5), at('e', 20)], reordered: true };
  const s = sortAround(c);
  expect(order(s)).toBe('abmepd');
  expect(s.turn).toBe('m');
  expect(s.reordered).toBe(false);
  expect(order(sortAround({ ...c, round: 0, turn: undefined }))).toBe('epmabd');
});

test('a grouped current turn is one block: nobody lands inside it', () => {
  const c = fight(['a', ['g1', 'g'], ['g2', 'g'], 'd'], 1, 'g1');
  expect(order(reorder(c, 'd', 1))).toBe('ag1g2d');
  expect(order(reorder(c, 'a', 2))).toBe('ag1g2d');
});
