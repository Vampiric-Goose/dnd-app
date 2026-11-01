import { expect, test } from 'vitest';
import { fit, MAX_SCALE, MIN_SCALE, pinch, toScreen, toWorld, zoomAt } from '../../src/lib/map/view.ts';

const id = { x: 0, y: 0, scale: 1 };

test('zoomAt keeps the point under the pointer, clamped', () => {
  expect(zoomAt(id, { x: 100, y: 100 }, 2)).toEqual({ x: -100, y: -100, scale: 2 });
  expect(zoomAt(id, { x: 100, y: 100 }, 1000).scale).toBe(MAX_SCALE);
  expect(zoomAt(id, { x: 100, y: 100 }, 0.0001).scale).toBe(MIN_SCALE);
  expect(MAX_SCALE).toBe(8);
  expect(MIN_SCALE).toBe(0.05);
});

test('pinch', () => {
  expect(pinch(id, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 200, y: 0 })).toEqual({ x: 0, y: 0, scale: 2 });
  expect(pinch(id, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 0 }, { x: 150, y: 0 })).toEqual({ x: 50, y: 0, scale: 1 });
  expect(pinch(id, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 })).toEqual(id); // fingers on one spot: no NaN
});

test('fit', () => {
  expect(fit(2000, 1000, 400, 800)).toEqual({ x: 0, y: 300, scale: 0.2 });
});

test('toWorld undoes toScreen', () => {
  const v = { x: 13, y: -40, scale: 0.37 };
  const w = toWorld(v, toScreen(v, { x: 321, y: 77 }));
  expect(w.x).toBeCloseTo(321);
  expect(w.y).toBeCloseTo(77);
});
