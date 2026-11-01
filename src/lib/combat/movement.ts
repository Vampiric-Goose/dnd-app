// Pure (no Svelte/Vite/DOM): the movement budget (spec 1). Combat.movement holds each combatant's turn origin (where its token stood
// when its turn's movement began) and Dashes taken this turn; movement used = grid distance origin → token. combat.ts drops an entry where its own turn starts.
import { cellAt, cellDistance, cellsIn, feetBetween, snap, type Cell, type Pt } from '../map/grid.ts';
import type { Combat, Combatant, Grid, Movement, Size } from '../types.ts';

/** 2014 conditions that set speed to 0. */
export const STOP_CONDITIONS: readonly string[] = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'];

/** Walk speed after conditions and exhaustion (computeSheet applies neither): 0 when stopped or at exhaustion 5+, halved at 2–4. */
export function effectiveSpeed(walk: number, conditions: readonly string[], exhaustion = 0): number {
  if (exhaustion >= 5 || conditions.some((n) => STOP_CONDITIONS.includes(n.toLowerCase()))) return 0;
  return exhaustion >= 2 ? Math.floor(walk / 10) * 5 : walk;
}

/** Where the token stood when its turn's movement began, if sound (an old saved fight's `{ feet, dashes }` entry has none). */
export const originOf = (m: Movement | undefined): Pt | undefined =>
  m?.from && Number.isFinite(m.from.x) && Number.isFinite(m.from.y) ? { x: m.from.x, y: m.from.y } : undefined;

/** Movement used this turn: the grid distance from the turn's origin to where the token stands now (moving back gives it back). */
export const usedFeet = (m: Movement | undefined, at: Pt | undefined, g: Grid | undefined, diagonal: '5-5-5' | '5-10-5'): number => {
  const o = originOf(m);
  return o && at && g ? feetBetween(g, o, at, diagonal) : 0;
};

/** Budget = speed × (1 + Dashes). */
export const budgetFeet = (speed: number, m: Movement | undefined): number => {
  const s = speed * (m?.mult ?? 1);
  return Math.max(0, s * (1 + (m?.dashes ?? 0)) - (m?.stood ? Math.floor(s / 2) : 0)); // standing up costs half the speed (SRD 5.1)
};

/** The budget less the movement used (token at `at` on grid `g`; without them none is counted as used). */
export const remainingFeet = (speed: number, m: Movement | undefined, at?: Pt, g?: Grid, diagonal: '5-5-5' | '5-10-5' = '5-5-5'): number =>
  Math.max(0, budgetFeet(speed, m) - usedFeet(m, at, g, diagonal));

/** The cells within `feet` of `origin`'s cell by the grid's distance rule, inside the w × h scene: the squares a token can reach (the highlight). */
export function reachableCells(g: Grid, origin: Pt, feet: number, diagonal: '5-5-5' | '5-10-5', w: number, h: number): Cell[] {
  if (!(feet > 0)) return [];
  const reach = (feet / g.feet + 1) * g.size, o = cellAt(g, origin);
  const x0 = Math.max(0, origin.x - reach), y0 = Math.max(0, origin.y - reach), x1 = Math.min(w, origin.x + reach), y1 = Math.min(h, origin.y + reach);
  if (x0 >= x1 || y0 >= y1) return [];
  return cellsIn(g, x0, y0, x1, y1).filter((c) => cellDistance(g, o, c, diagonal) * g.feet <= feet);
}

/** A monster token's linked combatant, or a character's. */
export const combatantForToken = (c: Combat, t: { characterId?: string; combatantId?: string }): Combatant | undefined =>
  c.combatants.find((x) => (t.combatantId !== undefined ? x.id === t.combatantId : t.characterId !== undefined && x.characterId === t.characterId));

/** No budget with free movement on, outside combat or in setup (round 0). */
export const budgetApplies = (c: Combat | undefined, settings: { freeMovement: boolean }): boolean => !!c && c.round >= 1 && !settings.freeMovement;

/** The entry rebuilt from its known fields (an old `feet` goes). */
const entry = (c: Combat, id: string): Movement => {
  const m = c.movement?.[id], from = originOf(m), dashes = m?.dashes, mult = m?.mult;
  return { ...(from && { from }), dashes: typeof dashes === 'number' && dashes >= 0 ? dashes : 0, ...(mult === 0 || mult === 2 ? { mult } : {}), ...(m?.stood === true && { stood: true as const }) };
};
const withEntry = (c: Combat, id: string, m: Movement): Combat => ({ ...c, movement: { ...c.movement, [id]: m } });

/** Standing up from prone this turn (half the speed). */
export const standUp = (c: Combat, id: string): Combat => withEntry(c, id, { ...entry(c, id), stood: true });

/** A move of the combatant's token from `from`: the first of its turn sets the turn's origin; later ones return `c` (no write). */
export const recordMove = (c: Combat, combatantId: string, from: Pt): Combat =>
  originOf(c.movement?.[combatantId]) || !Number.isFinite(from.x) || !Number.isFinite(from.y) ? c
    : withEntry(c, combatantId, { ...entry(c, combatantId), from: { x: from.x, y: from.y } });

/** Dashes a turn at most (an Action, Action Surge's and Cunning Action's bonus action), each a "use" from the Turn panel. */
export const MAX_DASHES = 3;

/** One more Dash, unless the combatant already has MAX_DASHES this turn (then `c`). */
export const addDash = (c: Combat, combatantId: string): Combat =>
  entry(c, combatantId).dashes >= MAX_DASHES ? c : withEntry(c, combatantId, { ...entry(c, combatantId), dashes: entry(c, combatantId).dashes + 1 });

/** The DM's Reset movement (P2): no origin (the token's next move starts a fresh one), no Dashes. */
export const resetMovement = (c: Combat, combatantId: string): Combat =>
  c.movement && Object.hasOwn(c.movement, combatantId) ? { ...c, movement: Object.fromEntries(Object.entries(c.movement).filter(([id]) => id !== combatantId)) } : c;

/**
 * The drop point of a drag from `from` toward `to` within `budget` feet of `origin` (the turn's origin; default `from`): the snapped
 * target when it is within reach, else the last snapped sample along the line (every quarter cell) within reach (none: `from`).
 */
export function clampMove(g: Grid, from: Pt, to: Pt, size: Size, budget: number, diagonal: '5-5-5' | '5-10-5', origin?: Pt): Pt {
  const a = snap(g, from, size), end = snap(g, to, size), o = origin ?? a;
  if (feetBetween(g, o, end, diagonal) <= budget) return end;
  const n = Math.ceil(Math.hypot(to.x - a.x, to.y - a.y) / (g.size / 4));
  let best = a;
  for (let i = 1; i <= n; i++) {
    const p = snap(g, { x: a.x + ((to.x - a.x) * i) / n, y: a.y + ((to.y - a.y) * i) / n }, size);
    if (feetBetween(g, o, p, diagonal) <= budget) best = p;
  }
  return best;
}
