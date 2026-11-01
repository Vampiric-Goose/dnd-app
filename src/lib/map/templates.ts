// Pure area templates (PHB p.204), by the cell-centre test spec 3.8 allows: a cell is affected when its centre is inside the shape.
// The map puts a template's origin on the centre of the cell under the pointer (as a Medium token), so areas measure from there.
import type { Grid, Token } from '../types.ts';
import { cellCenter, cellsIn, footprint, type Cell, type Pt } from './grid.ts';

export type Shape = 'cone' | 'sphere' | 'cube' | 'line' | 'cylinder';
/** `feet`: a cone's or line's length, a sphere's or cylinder's radius, a cube's side. `width`: a line's, in ft (default 5). */
export interface Template { shape: Shape; origin: Pt; aim: Pt /* direction point */; feet: number; width?: number }

const EPS = 1e-6;

export function inTemplate(t: Template, g: Grid, p: Pt): boolean {
  const ppf = g.size / g.feet, L = t.feet * ppf;
  const vx = p.x - t.origin.x, vy = p.y - t.origin.y;
  if (t.shape === 'sphere' || t.shape === 'cylinder') return Math.hypot(vx, vy) <= L + EPS;
  const ax = t.aim.x - t.origin.x, ay = t.aim.y - t.origin.y, n = Math.hypot(ax, ay);
  const [ux, uy] = n ? [ax / n, ay / n] : [1, 0]; // aim on the origin: +x
  const along = vx * ux + vy * uy, s = vx * uy - vy * ux;
  if (t.shape === 'cone') return along > EPS && along <= L + EPS && Math.abs(s) <= along / 2 + EPS;
  const half = t.shape === 'cube' ? L / 2 : ((t.width ?? 5) * ppf) / 2;
  // The origin is a cell centre (the map snaps it there): its own cell is not in a cube or line (PHB p.204), and one side edge is open,
  // so an edge running through a row of centres doesn't add that row (a 10 ft cube covers 2 × 2 cells, not 2 × 3).
  return along > EPS && along <= L + EPS && s > -half + EPS && s <= half + EPS;
}

/** Cells inside the scene (w × h) whose centre is inside the template. */
export function affectedCells(t: Template, g: Grid, w: number, h: number): Cell[] {
  const ppf = g.size / g.feet;
  const reach = (t.feet + (t.width ?? 5)) * ppf * 1.2 + g.size; // covers every shape's farthest point (a cone's is √1.25 × L)
  const x0 = Math.max(0, t.origin.x - reach), y0 = Math.max(0, t.origin.y - reach);
  const x1 = Math.min(w, t.origin.x + reach), y1 = Math.min(h, t.origin.y + reach);
  if (x0 > x1 || y0 > y1) return [];
  return cellsIn(g, x0, y0, x1, y1).filter((c) => inTemplate(t, g, cellCenter(g, c)));
}

/** Ids of the tokens with any footprint cell affected. */
export const tokensInTemplate = (t: Template, g: Grid, tokens: Pick<Token, 'id' | 'x' | 'y' | 'size'>[]): string[] =>
  tokens.filter((k) => footprint(g, k).some((c) => inTemplate(t, g, cellCenter(g, c)))).map((k) => k.id);
