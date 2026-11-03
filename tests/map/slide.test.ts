// Route moves, Task 3: where a sliding token is drawn at a given time, and which squares it slides along.
import { describe, expect, test } from 'vitest';
import { slidePoint, slideSquares, SQUARE_MS } from '../../src/ui/map/slide.ts';
import { cellCenter } from '../../src/lib/map/grid.ts';
import type { Grid } from '../../src/lib/types.ts';

const sq: Grid = { type: 'square', size: 50, offsetX: 0, offsetY: 0, color: '#000000', opacity: 1, feet: 5 };
const P = (q: number, r: number) => cellCenter(sq, { q, r });
const from = P(0, 0), route = [P(1, 0), P(2, 0), P(2, 1)];

describe('slidePoint', () => {
  test('starts at the start, ends on the last square, and is done only then', () => {
    expect(slidePoint(from, route, 1000, 1000, SQUARE_MS)).toEqual({ at: from, done: false });
    expect(slidePoint(from, route, 1000, 1000 + 3 * SQUARE_MS, SQUARE_MS)).toEqual({ at: P(2, 1), done: true });
    expect(slidePoint(from, route, 1000, 99999, SQUARE_MS).at).toEqual(P(2, 1));
  });
  test('is on each square at the end of its slot and halfway between at the middle of one (ease-in-out is symmetric)', () => {
    expect(slidePoint(from, route, 0, SQUARE_MS, SQUARE_MS).at).toEqual(P(1, 0));
    expect(slidePoint(from, route, 0, 2 * SQUARE_MS, SQUARE_MS).at).toEqual(P(2, 0));
    const mid = slidePoint(from, route, 0, SQUARE_MS * 1.5, SQUARE_MS).at;
    expect(mid.x).toBeCloseTo((P(1, 0).x + P(2, 0).x) / 2);
  });
  test('eases: slower than linear near a square start, never goes backward', () => {
    const early = slidePoint(from, route, 0, SQUARE_MS * 0.25, SQUARE_MS).at.x - from.x;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.25 * 50);
    let last = -1;
    for (let t = 0; t <= 3 * SQUARE_MS; t += 5) { const x = slidePoint(from, route, 0, t, SQUARE_MS).at.x; expect(x).toBeGreaterThanOrEqual(last); last = x; }
  });
  test('a time before the start or an empty route is just the start', () => {
    expect(slidePoint(from, route, 1000, 500, SQUARE_MS).at).toEqual(from);
    expect(slidePoint(from, [], 0, 0, SQUARE_MS)).toEqual({ at: from, done: true });
  });
});

describe('slideSquares', () => {
  test('follows the trail when it ends at the new position and starts one square from the old', () => {
    const trail = [P(1, 1), P(2, 1), P(3, 1)];
    expect(slideSquares(sq, P(0, 0), P(3, 1), trail, 'M')).toEqual(trail);
  });
  test('a trail that ends elsewhere or does not start beside the old position is ignored: straight steps instead', () => {
    expect(slideSquares(sq, P(0, 0), P(3, 0), [P(1, 1), P(2, 1)], 'M')).toEqual([P(1, 0), P(2, 0), P(3, 0)]);
    expect(slideSquares(sq, P(0, 0), P(3, 0), [P(2, 0), P(3, 0)], 'M')).toEqual([P(1, 0), P(2, 0), P(3, 0)]);
    expect(slideSquares(sq, P(0, 0), P(2, 2), undefined, 'M')).toEqual([P(1, 1), P(2, 2)]);
  });
  test('no move: no squares', () => {
    expect(slideSquares(sq, P(1, 1), P(1, 1), [P(1, 1)], 'M')).toEqual([]);
  });
});
