// Grid detection on synthetic battle maps: textured parchment with a printed square grid (dark, light or anti-aliased lines,
// fractional cell sizes, a grid over only part of the map), and plain texture that must not be mistaken for a grid.
import { describe, expect, test } from 'vitest';
import { detectSquareGrid } from '../../src/lib/map/detectGrid.ts';

/** A seeded pseudo-random generator, so the textures are the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

interface Opts { w: number; h: number; size: number; ox: number; oy: number; line?: number; width?: number; area?: [number, number, number, number]; noise?: number; seed?: number }

/** Parchment-like noise and blotches, with grid lines drawn (anti-aliased) inside `area` (x0, y0, x1, y1 as fractions). */
function map(o: Opts): Float32Array {
  const r = rng(o.seed ?? 1), g = new Float32Array(o.w * o.h);
  const blots = Array.from({ length: 30 }, () => [r() * o.w, r() * o.h, 20 + r() * 120, (r() - 0.5) * 80]);
  const [ax0, ay0, ax1, ay1] = o.area ?? [0, 0, 1, 1];
  const half = (o.width ?? 1) / 2;
  const dist = (v: number, off: number) => { const d = (((v - off) % o.size) + o.size) % o.size; return Math.min(d, o.size - d); };
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    let v = 180 + (r() - 0.5) * (o.noise ?? 40);
    for (const [bx, by, br, bv] of blots) if ((x - bx) ** 2 + (y - by) ** 2 < br * br) v += bv;
    if (x >= ax0 * o.w && x < ax1 * o.w && y >= ay0 * o.h && y < ay1 * o.h) {
      const d = Math.min(dist(x + 0.5, o.ox), dist(y + 0.5, o.oy));
      const cover = Math.max(0, Math.min(1, half + 0.5 - d));
      v = v * (1 - cover) + (o.line ?? 90) * cover;
    }
    g[y * o.w + x] = v;
  }
  return g;
}

/** The detected offset matches the true one modulo the cell size (a grid line is a grid line). */
const offsetErr = (got: number, want: number, size: number) => { const d = Math.abs(got - want) % size; return Math.min(d, size - d); };

describe('detectSquareGrid', () => {
  test.each([
    ['small fractional cells', { w: 640, h: 480, size: 23.4, ox: 7.2, oy: 15.6 }],
    ['large cells, light lines on a dark map', { w: 800, h: 600, size: 70, ox: 31, oy: 12, line: 245 }],
    ['2-px anti-aliased lines', { w: 700, h: 500, size: 41.7, ox: 3.3, oy: 29.1, width: 2 }],
    ['grid over only the middle of the map', { w: 900, h: 640, size: 28.2, ox: 11, oy: 4, area: [0.25, 0.2, 0.85, 0.9] as [number, number, number, number] }],
  ])('%s', (_, o) => {
    const g = detectSquareGrid(map(o), o.w, o.h);
    expect(g).toBeDefined();
    expect(Math.abs(g!.size - o.size)).toBeLessThan(0.1);
    // The offset must keep lines aligned across the whole map: compare the far edge, where size drift adds up.
    expect(offsetErr(g!.offsetX, o.ox, o.size)).toBeLessThan(0.75);
    expect(offsetErr(g!.offsetY, o.oy, o.size)).toBeLessThan(0.75);
    const cells = o.w / o.size;
    expect(Math.abs(g!.size - o.size) * cells).toBeLessThan(2); // under 2 px drift at the far edge
  });

  test('plain texture with blotches has no grid', () => {
    const r = rng(7), w = 640, h = 480, g = new Float32Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = 160 + (r() - 0.5) * 60;
    expect(detectSquareGrid(g, w, h)).toBeUndefined();
    const o = { w, h, size: 30, ox: 0, oy: 0, area: [0, 0, 0, 0] as [number, number, number, number], seed: 3 };
    expect(detectSquareGrid(map(o), w, h)).toBeUndefined();
  });
});
