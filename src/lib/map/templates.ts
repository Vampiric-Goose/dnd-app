// Pure area templates (PHB p.204) by a cell-centre test (spec 3.8). The map puts a template's origin on the centre of the cell under
// the pointer (as a Medium token), so areas centre on that square.
import type { Grid, Token } from '../types.ts';
import { cellCenter, cellsIn, footprint, type Cell, type Pt } from './grid.ts';

export type Shape = 'cone' | 'sphere' | 'cube' | 'line' | 'cylinder';
/** `feet`: a cone's or line's length, a sphere's or cylinder's radius, a cube's side. `width`: a line's, in ft (default 5). */
export interface Template { shape: Shape; origin: Pt; aim: Pt /* direction point */; feet: number; width?: number }

const EPS = 1e-6;
const CONE_HALF = Math.atan(0.5); // a cone is as wide as it is far (PHB p.204): ±26.6° about its aim

/**
 * Whether the cell centred at `p` is in the template, the origin being a cell centre (as a Medium token stands):
 * - sphere / cylinder: a circle of the radius around the origin cell, read the way a drawn circle covers squares (a centre within the
 *   radius plus half a cell), so a 20 ft sphere is a round 9-cell-wide blob with the origin in the middle;
 * - cube: a square of side / grid-feet cells centred on the origin cell (an even side reaches one cell further toward the aim);
 * - cone: from the origin cell (left out), out to its length (plus half a cell, as the sphere), within ±26.6° of the aim;
 * - line: from the origin cell (left out), its width about the aim.
 */
export function inTemplate(t: Template, g: Grid, p: Pt): boolean {
  const ppf = g.size / g.feet, L = t.feet * ppf, half = g.size / 2;
  const vx = p.x - t.origin.x, vy = p.y - t.origin.y, d = Math.hypot(vx, vy);
  if (t.shape === 'sphere' || t.shape === 'cylinder') return d <= L + half + EPS;
  const ax = t.aim.x - t.origin.x, ay = t.aim.y - t.origin.y, n = Math.hypot(ax, ay);
  const [ux, uy] = n ? [ax / n, ay / n] : [1, 0]; // aim on the origin: +x
  if (t.shape === 'cube') {
    const cells = Math.max(1, Math.round(t.feet / g.feet));
    if (g.type !== 'square') return d <= Math.ceil((cells - 1) / 2) * g.size + EPS; // hexes: the hexagon of that many rings
    const span = (v: number, aim: number) => { // the cells this axis covers, in cells from the origin
      const lo = -Math.floor((cells - 1) / 2) - (cells % 2 === 0 && aim < -EPS ? 1 : 0), k = Math.round(v / g.size);
      return k >= lo && k <= lo + cells - 1;
    };
    return span(vx, ux) && span(vy, uy);
  }
  const along = vx * ux + vy * uy, s = vx * uy - vy * ux;
  if (d < EPS) return false; // the origin cell (a cone or line starts from its caster)
  if (t.shape === 'cone') return d <= L + half + EPS && along > EPS && Math.atan2(Math.abs(s), along) <= CONE_HALF + 1e-3;
  const w = ((t.width ?? 5) * ppf) / 2;
  // one side edge is open, so an edge running through a row of centres doesn't add that row
  return along > EPS && along <= L + EPS && s > -w + EPS && s <= w + EPS;
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
