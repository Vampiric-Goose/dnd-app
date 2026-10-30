import { expect, test } from 'vitest';
import { visibleRange } from '../src/lib/virtual.ts';

test('visibleRange', () => {
  expect(visibleRange(0, 440, 44, 1000, 5)).toEqual([0, 15]);
  expect(visibleRange(4400, 440, 44, 1000, 5)).toEqual([95, 115]);
  expect(visibleRange(43_800, 440, 44, 1000, 5)).toEqual([990, 1000]);
});

test('visibleRange handles empty and short lists', () => {
  expect(visibleRange(0, 440, 44, 0, 5)).toEqual([0, 0]);
  expect(visibleRange(0, 440, 44, 3, 5)).toEqual([0, 3]);
});
