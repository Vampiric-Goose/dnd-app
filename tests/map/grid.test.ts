import { describe, expect, test } from 'vitest';
import { cellAt, cellCenter, cellDistance, cellsIn, feetBetween, footprint, hexCorners, snap } from '../../src/lib/map/grid.ts';
import type { Grid } from '../../src/lib/types.ts';

const sq = (o: Partial<Grid> = {}): Grid => ({ type: 'square', size: 50, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.35, feet: 5, ...o });
const hex = (type: 'hex-flat' | 'hex-pointy', size = 60): Grid => sq({ type, size });
const R3_2 = Math.sqrt(3) / 2;

describe('square cells and snapping', () => {
  test('cells and centres', () => {
    expect(cellAt(sq(), { x: 75, y: 20 })).toEqual({ q: 1, r: 0 });
    expect(cellCenter(sq(), { q: 1, r: 0 })).toEqual({ x: 75, y: 25 });
  });
  test('offset', () => {
    const g = sq({ offsetX: 10, offsetY: 20 });
    expect(cellAt(g, { x: 10, y: 20 })).toEqual({ q: 0, r: 0 });
    expect(cellAt(g, { x: 9, y: 20 })).toEqual({ q: -1, r: 0 });
  });
  test('odd sizes snap to centres, even ones to vertices', () => {
    expect(snap(sq(), { x: 60, y: 99 }, 'M')).toEqual({ x: 75, y: 75 });
    expect(snap(sq(), { x: 60, y: 99 }, 'L')).toEqual({ x: 50, y: 100 });
    expect(snap(sq(), { x: 60, y: 99 }, 'T')).toEqual({ x: 75, y: 75 });
    expect(snap(sq(), { x: 60, y: 99 }, 'H')).toEqual({ x: 75, y: 75 });
    expect(snap(sq(), { x: 60, y: 99 }, 'G')).toEqual({ x: 50, y: 100 });
  });
});

describe('square distances', () => {
  const d = (q: number, r: number, rule: '5-5-5' | '5-10-5', g = sq()) => cellDistance(g, { q: 0, r: 0 }, { q, r }, rule) * g.feet;
  test('both rules', () => {
    expect(d(3, 3, '5-5-5')).toBe(15);
    expect(d(3, 3, '5-10-5')).toBe(20);
    expect(d(2, 2, '5-10-5')).toBe(15);
    expect(d(1, 1, '5-10-5')).toBe(5);
    expect(d(4, 1, '5-5-5')).toBe(20);
    expect(d(4, 1, '5-10-5')).toBe(20);
    expect(d(5, 5, '5-10-5')).toBe(35);
    expect(d(3, 3, '5-5-5', sq({ feet: 10 }))).toBe(30);
  });
  test('feetBetween two L vertices', () => {
    expect(feetBetween(sq(), { x: 50, y: 50 }, { x: 150, y: 150 }, '5-5-5')).toBe(10);
  });
});

describe('hex cells', () => {
  test('pointy', () => {
    const g = hex('hex-pointy');
    expect(cellCenter(g, { q: 1, r: 0 })).toEqual({ x: 60, y: 0 });
    const c = cellCenter(g, { q: 0, r: 1 });
    expect(c.x).toBeCloseTo(30);
    expect(c.y).toBeCloseTo(60 * R3_2);
    expect(cellAt(g, { x: 58, y: 3 })).toEqual({ q: 1, r: 0 });
  });
  test('flat', () => {
    const g = hex('hex-flat');
    const c = cellCenter(g, { q: 1, r: 0 });
    expect(c.x).toBeCloseTo(60 * R3_2);
    expect(c.y).toBeCloseTo(30);
    expect(cellCenter(g, { q: 0, r: 1 })).toEqual({ x: 0, y: 60 });
  });
  test('every centre maps back to its own cell', () => {
    for (const type of ['hex-flat', 'hex-pointy'] as const) {
      const g = hex(type);
      const cells = cellsIn(g, -200, -200, 200, 200);
      expect(cells.length).toBeGreaterThan(30);
      for (const c of cells) {
        const p = cellCenter(g, c);
        expect(p.x >= -200 && p.x <= 200 && p.y >= -200 && p.y <= 200).toBe(true);
        expect(cellAt(g, p)).toEqual(c);
      }
      expect(hexCorners(g, { q: 0, r: 0 })).toHaveLength(6);
    }
  });
  test('cellsIn on a square grid', () => {
    expect(cellsIn(sq(), 0, 0, 100, 50)).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
  });
});

test('hex distances ignore the diagonal rule', () => {
  const g = hex('hex-pointy');
  for (const rule of ['5-5-5', '5-10-5'] as const) {
    expect(cellDistance(g, { q: 0, r: 0 }, { q: 2, r: -1 }, rule)).toBe(2);
    expect(feetBetween(g, cellCenter(g, { q: 0, r: 0 }), cellCenter(g, { q: 2, r: -1 }), rule)).toBe(10);
    expect(feetBetween(g, cellCenter(g, { q: 0, r: 0 }), cellCenter(g, { q: 3, r: 0 }), rule)).toBe(15);
  }
});

describe('footprints', () => {
  test('square', () => {
    expect(footprint(sq(), { x: 50, y: 50, size: 'L' })).toEqual([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }]);
    expect(footprint(sq(), { x: 75, y: 75, size: 'M' })).toEqual([{ q: 1, r: 1 }]);
    expect(footprint(sq(), { x: 75, y: 75, size: 'T' })).toEqual([{ q: 1, r: 1 }]);
    expect(footprint(sq(), { x: 75, y: 75, size: 'H' })).toHaveLength(9);
  });
  test('hex', () => {
    const g = hex('hex-pointy', 50);
    expect(footprint(g, { x: 0, y: 0, size: 'M' })).toHaveLength(1);
    expect(footprint(g, { x: 0, y: 0, size: 'L' })).toHaveLength(7);
    // M1: Huge is bigger than Large on hex too; Tiny and Gargantuan as before
    expect(footprint(g, { x: 0, y: 0, size: 'H' })).toHaveLength(13);
    expect(footprint(g, { x: 0, y: 0, size: 'G' })).toHaveLength(19);
    expect(footprint(g, { x: 0, y: 0, size: 'T' })).toHaveLength(1);
    expect(footprint(hex('hex-flat', 50), { x: 0, y: 0, size: 'H' })).toHaveLength(13);
  });
});
