// Route moves: how a token that changed position is drawn on its way there (MapCanvas runs this each frame).
import { stepsBetween } from '../../lib/combat/movement.ts';
import type { Pt } from '../../lib/map/grid.ts';
import type { Grid, Size } from '../../lib/types.ts';

/** About how long each square takes. */
export const SQUARE_MS = 100;

const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f)); // ease-in-out

/** Where a token that left `from` at time `t0` and walks `squares` (`ms` each, eased per square) is drawn at `now`; done once it stands on the last. */
export function slidePoint(from: Pt, squares: Pt[], t0: number, now: number, ms: number): { at: Pt; done: boolean } {
  const n = squares.length, k = Math.max(0, now - t0) / ms;
  if (!n || k >= n) return { at: squares[n - 1] ?? from, done: true };
  const i = Math.floor(k), a = i ? squares[i - 1] : from, b = squares[i], f = ease(k - i);
  return { at: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, done: false };
}

/** The squares a token slides along from `old` to `to`: its `trail` (the walk that was written) when that ends at `to` and starts one square from `old`, else straight steps. */
export function slideSquares(g: Grid, old: Pt, to: Pt, trail: Pt[] | undefined, size: Size): Pt[] {
  const straight = stepsBetween(g, old, to, size);
  if (!straight.length) return [];
  const end = trail?.at(-1), ok = trail && end && stepsBetween(g, end, to, size).length === 0 && stepsBetween(g, old, trail[0], size).length === 1;
  return ok ? trail : straight;
}
