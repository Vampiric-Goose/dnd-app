// Pure: walls, low walls, arrow slits and doors on a scene (pixel endpoints), and what they do: cover by the DMG corner rule (lines from the
// attacker's best corner to the target's four corners: 1–2 blocked half, 3–4 three-quarters, every line from every corner total), fixed
// cover from a low wall (half), an arrow slit (three-quarters) or a creature (half) on the line between the centres, and blocked steps.
import type { Grid, Scene, Size } from '../types.ts';
import { SIZE_CELLS, type Pt } from './grid.ts';

export type WallKind = 'wall' | 'low' | 'slit' | 'door';
export interface Wall { id: string; a: Pt; b: Pt; kind: WallKind; /** a door's */ open?: boolean }
/** No cover, +2 (half), +5 (three-quarters), or total (it can't be targeted). */
export type Cover = 0 | 2 | 5 | 'total';

/** It blocks a line of effect (cover geometry, spell areas): a wall or a closed door. */
const sight = (w: Wall) => w.kind === 'wall' || (w.kind === 'door' && !w.open);
/** It blocks a step: those, and an arrow slit. */
const body = (w: Wall) => sight(w) || w.kind === 'slit';
const fixed = (w: Wall): 0 | 2 | 5 => (w.kind === 'low' ? 2 : w.kind === 'slit' ? 5 : 0);

const orient = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
const within = (p: Pt, a: Pt, b: Pt) => Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y);
/** Segments pq and ab cross; `touch`: touching counts too (an end on the other, or lying along it). */
function cross(p: Pt, q: Pt, a: Pt, b: Pt, touch: boolean): boolean {
  const o1 = orient(p, q, a), o2 = orient(p, q, b), o3 = orient(a, b, p), o4 = orient(a, b, q);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (!touch) return false;
  return (o1 === 0 && within(a, p, q)) || (o2 === 0 && within(b, p, q)) || (o3 === 0 && within(p, a, b)) || (o4 === 0 && within(q, a, b));
}

/** The line from p to q passes a wall or a closed door, or slips through a corner where two of them meet (a room's corner). */
export function lineBlocked(walls: readonly Wall[], p: Pt, q: Pt): boolean {
  const solid = walls.filter(sight);
  if (solid.some((w) => cross(p, q, w.a, w.b, false))) return true;
  const ends = solid.flatMap((w) => [w.a, w.b]), same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
  return ends.some((c, i) => ends.some((d, j) => j !== i && same(c, d)) && orient(p, q, c) === 0 && within(c, p, q) && !same(c, p) && !same(c, q));
}
/** A step from p to q (square centres) crosses a wall, closed door or arrow slit, or slips through where two meet. */
export const stepBlocked = (walls: readonly Wall[], p: Pt, q: Pt): boolean => walls.some((w) => body(w) && cross(p, q, w.a, w.b, true));

/** The route's squares up to the first step a wall blocks (from where the token stands). */
export function clipRoute(walls: readonly Wall[] | undefined, from: Pt, route: Pt[]): Pt[] {
  if (!walls?.length) return route;
  for (let i = 0, prev = from; i < route.length; prev = route[i++]) if (stepBlocked(walls, prev, route[i])) return route.slice(0, i);
  return route;
}

/** A creature's space as a box (its token is centred on it), shrunk by `inset` px on each side. */
function box(g: Grid, t: Pt & { size: Size }, inset: number) {
  const h = (SIZE_CELLS[t.size] * g.size) / 2 - inset;
  return { x0: t.x - h, y0: t.y - h, x1: t.x + h, y1: t.y + h };
}
const corners = (b: ReturnType<typeof box>): Pt[] => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
/** The segment pq passes through the box. */
function hits(p: Pt, q: Pt, b: ReturnType<typeof box>): boolean {
  const inside = (r: Pt) => r.x > b.x0 && r.x < b.x1 && r.y > b.y0 && r.y < b.y1, c = corners(b);
  return inside(p) || inside(q) || c.some((a, i) => cross(p, q, a, c[(i + 1) % 4], true));
}

/**
 * The target's cover against `from` (a creature, or a point: a spell area's origin), with `others` the creatures that might stand in the way.
 * Corners sit a hair inside their spaces, so a wall on a grid line blocks what is behind it, not what stands along it.
 * ponytail: on a hex grid the spaces are the same boxes (the DMG rule is drawn on squares).
 */
export function cover(g: Grid, walls: readonly Wall[] | undefined, from: Pt | (Pt & { size: Size }), to: Pt & { size: Size }, others: readonly (Pt & { size: Size })[]): Cover {
  const list = walls ?? [], inset = g.size * 0.02, far = corners(box(g, to, inset));
  const near = 'size' in from ? corners(box(g, from, inset)) : [from];
  const fewest = Math.min(...near.map((c) => far.filter((t) => lineBlocked(list, c, t)).length));
  if (fewest === 4) return 'total';
  const centre = { x: from.x, y: from.y };
  const piece = Math.max(0, ...list.filter((w) => fixed(w) && cross(centre, to, w.a, w.b, false)).map(fixed));
  const crowd = others.some((o) => hits(centre, to, box(g, o, g.size * 0.1 * SIZE_CELLS[o.size]))) ? 2 : 0;
  return Math.max(fewest >= 3 ? 5 : fewest >= 1 ? 2 : 0, piece, crowd) as 0 | 2 | 5;
}

/** The token stands beside the door: its centre within one square of the door's segment. */
export function nearDoor(g: Grid, w: Wall, t: Pt): boolean {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y, len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((t.x - w.a.x) * dx + (t.y - w.a.y) * dy) / len)) : 0;
  return Math.hypot(t.x - (w.a.x + k * dx), t.y - (w.a.y + k * dy)) <= g.size;
}

/** The scene with that door opened or closed (anything else: the same scene). */
export function toggleDoor(s: Scene, id: string): Scene {
  const d = s.walls?.find((w) => w.id === id && w.kind === 'door');
  return d ? { ...s, walls: s.walls!.map((w) => (w === d ? { ...w, open: !w.open } : w)) } : s;
}
