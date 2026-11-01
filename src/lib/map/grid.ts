// Pure grid math for the battle map: cells, centres, snapping, footprints, distances. Square cells are (column, row); hexes are axial,
// with `size` the distance between neighbouring centres (the width across flats).
import type { Grid, Size } from '../types.ts';

export interface Pt { x: number; y: number }
export interface Cell { q: number; r: number }

export const SIZE_CELLS: Record<Size, number> = { T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4 };

const EPS = 1e-6;
const R3_2 = Math.sqrt(3) / 2;

/** Rounds fractional axial coordinates to the nearest hex (cube rounding). */
function hexRound(fq: number, fr: number): Cell {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 }; // + 0: no -0
}

export function cellAt(g: Grid, p: Pt): Cell {
  const x = p.x - g.offsetX, y = p.y - g.offsetY;
  if (g.type === 'square') return { q: Math.floor(x / g.size + EPS), r: Math.floor(y / g.size + EPS) };
  if (g.type === 'hex-pointy') { const r = y / (g.size * R3_2); return hexRound(x / g.size - r / 2, r); }
  const q = x / (g.size * R3_2);
  return hexRound(q, y / g.size - q / 2);
}

export function cellCenter(g: Grid, c: Cell): Pt {
  if (g.type === 'square') return { x: g.offsetX + (c.q + 0.5) * g.size, y: g.offsetY + (c.r + 0.5) * g.size };
  if (g.type === 'hex-pointy') return { x: g.offsetX + g.size * (c.q + c.r / 2), y: g.offsetY + g.size * R3_2 * c.r };
  return { x: g.offsetX + g.size * R3_2 * c.q, y: g.offsetY + g.size * (c.r + c.q / 2) };
}

/** Cells whose centre lies in the box (drawing culls with it). */
export function cellsIn(g: Grid, x0: number, y0: number, x1: number, y1: number): Cell[] {
  const out: Cell[] = [];
  const inBox = (c: Cell) => { const p = cellCenter(g, c); return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; };
  const s = g.size, ox = g.offsetX, oy = g.offsetY;
  if (g.type === 'square') {
    for (let r = Math.ceil((y0 - oy) / s - 0.5) + 0; r <= Math.floor((y1 - oy) / s - 0.5); r++)
      for (let q = Math.ceil((x0 - ox) / s - 0.5) + 0; q <= Math.floor((x1 - ox) / s - 0.5); q++) out.push({ q, r });
    return out;
  }
  const h = s * R3_2;
  if (g.type === 'hex-pointy') {
    for (let r = Math.floor((y0 - oy) / h) - 1; r <= Math.ceil((y1 - oy) / h) + 1; r++)
      for (let q = Math.floor((x0 - ox) / s - r / 2) - 1; q <= Math.ceil((x1 - ox) / s - r / 2) + 1; q++) if (inBox({ q, r })) out.push({ q, r });
  } else {
    for (let q = Math.floor((x0 - ox) / h) - 1; q <= Math.ceil((x1 - ox) / h) + 1; q++)
      for (let r = Math.floor((y0 - oy) / s - q / 2) - 1; r <= Math.ceil((y1 - oy) / s - q / 2) + 1; r++) if (inBox({ q, r })) out.push({ q, r });
  }
  return out;
}

/** The six corners of a hex, for drawing. */
export function hexCorners(g: Grid, c: Cell): Pt[] {
  const p = cellCenter(g, c), rad = g.size / Math.sqrt(3), start = g.type === 'hex-pointy' ? 30 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((start + 60 * i) * Math.PI) / 180;
    return { x: p.x + rad * Math.cos(a), y: p.y + rad * Math.sin(a) };
  });
}

/** In cells. Square: 5-5-5 is the longer axis; 5-10-5 makes every second diagonal cost double. Hex ignores the rule. */
export function cellDistance(g: Grid, a: Cell, b: Cell, diagonal: '5-5-5' | '5-10-5'): number {
  const dq = b.q - a.q, dr = b.r - a.r;
  if (g.type !== 'square') return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  const hi = Math.max(Math.abs(dq), Math.abs(dr)), lo = Math.min(Math.abs(dq), Math.abs(dr));
  return diagonal === '5-5-5' ? hi : hi + Math.floor(lo / 2);
}

export const feetBetween = (g: Grid, a: Pt, b: Pt, diagonal: '5-5-5' | '5-10-5'): number => cellDistance(g, cellAt(g, a), cellAt(g, b), diagonal) * g.feet;

/** Square: odd or fractional cell counts (T, S, M, H) snap to a cell centre, even ones (L, G) to the nearest vertex. Hex: always a centre. */
export function snap(g: Grid, p: Pt, size: Size): Pt {
  if (g.type === 'square' && SIZE_CELLS[size] % 2 === 0) {
    return { x: g.offsetX + Math.round((p.x - g.offsetX) / g.size) * g.size, y: g.offsetY + Math.round((p.y - g.offsetY) / g.size) * g.size };
  }
  return cellCenter(g, cellAt(g, p));
}

/** The cells a token covers. Square: the n×n block around its centre; hex: hexes whose centre is within n·size/2. */
export function footprint(g: Grid, t: Pt & { size: Size }): Cell[] {
  const n = SIZE_CELLS[t.size];
  if (g.type === 'square') {
    if (n <= 1) return [cellAt(g, t)];
    const q0 = Math.round((t.x - (n * g.size) / 2 - g.offsetX) / g.size), r0 = Math.round((t.y - (n * g.size) / 2 - g.offsetY) / g.size);
    const out: Cell[] = [];
    for (let r = r0; r < r0 + n; r++) for (let q = q0; q < q0 + n; q++) out.push({ q, r });
    return out;
  }
  const rad = (n * g.size) / 2 + EPS;
  return cellsIn(g, t.x - rad, t.y - rad, t.x + rad, t.y + rad).filter((c) => { const p = cellCenter(g, c); return Math.hypot(p.x - t.x, p.y - t.y) <= rad; });
}
