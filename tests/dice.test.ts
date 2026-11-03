import { expect, test } from 'vitest';
import { parseDice, rollDice } from '../src/lib/dice.ts';

const seq = (...dice: number[]) => { let i = 0; return () => (dice[i++] - 1) / 6 + 0.01; }; // d6 helper
const seq20 = (...d: number[]) => { let i = 0; return () => (d[i++] - 1) / 20 + 0.001; };

test('rollDice reports every die face it rolled, in term order (both d20s with advantage, doubled dice on a crit)', () => {
  expect(rollDice('2d6+3', { rng: seq(1, 6) })).toMatchObject({ total: 10, faces: [1, 6] });
  expect(rollDice('1d20+5', { rng: seq20(4, 18), advantage: 'adv' }).faces).toEqual([4, 18]);
  expect(rollDice('1d6+2', { rng: seq(2, 5), crit: true }).faces).toEqual([2, 5]);
});

test('dice', () => {
  expect(parseDice('2d6+3')).toEqual([{ count: 2, sides: 6, sign: 1 }, { const: 3, sign: 1 }]);
  expect(parseDice('d20 - 1')).toEqual([{ count: 1, sides: 20, sign: 1 }, { const: 1, sign: -1 }]);
  expect(parseDice('4d6dl1')).toEqual(parseDice('4d6kh3'));
  expect(() => parseDice('abc')).toThrow('Bad dice: abc');
  expect(rollDice('2d6+3', { rng: seq(4, 5) })).toMatchObject({ total: 12, detail: '2d6 (4, 5) + 3' });
  expect(rollDice('1d20+5', { rng: seq20(7, 15), advantage: 'adv' }).total).toBe(20);
  expect(rollDice('1d20+5', { rng: seq20(7, 15), advantage: 'dis' }).total).toBe(12);
  expect(rollDice('1d8+3', { rng: () => 0.2, crit: true }).total).toBe(2 + 2 + 3);
});

test('dice parsing edge cases', () => {
  expect(parseDice('4d6kh3')).toEqual([{ count: 4, sides: 6, sign: 1, keep: { highest: true, n: 3 } }]);
  expect(parseDice('2d20kl1')).toEqual([{ count: 2, sides: 20, sign: 1, keep: { highest: false, n: 1 } }]);
  expect(parseDice('-1d4+2d6 - 2')).toEqual([{ count: 1, sides: 4, sign: -1 }, { count: 2, sides: 6, sign: 1 }, { const: 2, sign: -1 }]);
  expect(parseDice('5')).toEqual([{ const: 5, sign: 1 }]);
  for (const bad of ['', '2d', 'd', '2d6+', '+', '2d6kh', '4d6kh5', '4d6dl4', '4d6kh0', '2d0', '0d6', '2d6++3', '1.5d6', '2d6*3', '9999d6'])
    expect(() => parseDice(bad), bad).toThrow('Bad dice: ' + bad);
});

test('rolling details', () => {
  expect(rollDice('4d6dl1', { rng: seq(6, 1, 4, 5) })).toMatchObject({ total: 15, detail: '4d6kh3 (6, 1, 4, 5)' });
  expect(rollDice('d20 - 1', { rng: seq20(10) })).toMatchObject({ total: 9, detail: '1d20 (10) - 1' });
  expect(rollDice('1d20+5', { rng: seq20(7, 15), advantage: 'adv' }).detail).toBe('2d20kh1 (7, 15) + 5');
  expect(rollDice('1d20+5', { rng: seq20(7, 15), advantage: 'dis' }).detail).toBe('2d20kl1 (7, 15) + 5');
  // advantage only touches the first 1d20 term; other terms are unchanged
  const raw = (...v: number[]) => { let i = 0; return () => v[i++]; };
  expect(rollDice('1d20+1d20', { rng: raw(0, 0.5, 0.9), advantage: 'adv' })).toMatchObject({ total: 11 + 19, detail: '2d20kh1 (1, 11) + 1d20 (19)' });
  expect(rollDice('2d6', { rng: () => 0, advantage: 'adv' }).total).toBe(2); // no 1d20 term: unchanged
  // crit doubles dice counts, not constants
  expect(rollDice('2d6+3', { rng: () => 0.999, crit: true })).toMatchObject({ total: 27, detail: '4d6 (6, 6, 6, 6) + 3' });
  // rng default produces an in-range result
  const r = rollDice('3d6');
  expect(r.total).toBeGreaterThanOrEqual(3);
  expect(r.total).toBeLessThanOrEqual(18);
});

test('R16: whitespace only around signs, upper-case D', () => {
  expect(parseDice('  1d20 + 5  ')).toEqual([{ count: 1, sides: 20, sign: 1 }, { const: 5, sign: 1 }]);
  expect(parseDice('2D6')).toEqual(parseDice('2d6'));
  expect(parseDice('4D6DL1')).toEqual(parseDice('4d6kh3'));
  for (const bad of ['1d20 5', '1 d20', '2 d 6', '1d20 kh1'])
    expect(() => parseDice(bad), bad).toThrow('Bad dice: ' + bad);
});

test('house rule: a crit doubles all damage, its modifiers too', () => {
  expect(rollDice('2d6+3', { rng: () => 0.999, crit: 'all' })).toMatchObject({ total: 30, detail: '4d6 (6, 6, 6, 6) + 3×2' });
  expect(rollDice('1d8-1', { rng: () => 0, crit: 'all' }).total).toBe(1 + 1 - 2);
});
