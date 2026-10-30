import { expect, test } from 'vitest';
import { natD20 } from '../src/lib/rolls.svelte.ts';

test('natD20 reads the kept d20', () => {
  expect(natD20('1d20 (20) + 5')).toBe('nat20');
  expect(natD20('1d20 (1)')).toBe('nat1');
  expect(natD20('1d20 (13) + 5')).toBeUndefined();
  expect(natD20('2d20kh1 (1, 20) + 5')).toBe('nat20'); // advantage keeps the 20
  expect(natD20('2d20kh1 (1, 7) + 5')).toBeUndefined(); // advantage kept the 7, so the 1 is not a nat 1
  expect(natD20('2d20kl1 (1, 20)')).toBe('nat1'); // disadvantage keeps the 1
  expect(natD20('2d6 (6, 6) + 3')).toBeUndefined(); // no d20
  expect(natD20('1d100 (20)')).toBeUndefined(); // 'd100' is not a d20
});
