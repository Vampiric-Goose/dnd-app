import { expect, test } from 'vitest';
import { fitWithin } from '../src/lib/images.ts';

test('fitWithin', () => {
  expect(fitWithin(1024, 512, 256)).toEqual({ w: 256, h: 128 });
  expect(fitWithin(100, 300, 256)).toEqual({ w: 85, h: 256 });
  expect(fitWithin(100, 50, 256)).toEqual({ w: 100, h: 50 });
  expect(fitWithin(10000, 10, 256)).toEqual({ w: 256, h: 1 }); // never rounds a side to 0
});
