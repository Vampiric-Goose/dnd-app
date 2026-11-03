// Pure (no Svelte/Vite/DOM): the movement budget (spec 1). Combat.movement holds each combatant's turn origin (where its token stood
// when its turn's movement began) and Dashes taken this turn; movement used = grid distance origin → token. combat.ts drops an entry where its own turn starts.
import { cellAt, cellCenter, cellDistance, cellsIn, feetBetween, snap, type Cell, type Pt } from '../map/grid.ts';
import type { Combat, Combatant, Grid, MonsterDef, Movement, Size, Speeds } from '../types.ts';
import { spellMods } from './spellEffects.ts';

/** 2014 conditions that set speed to 0. */
export const STOP_CONDITIONS: readonly string[] = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'];

/** Walk speed after conditions and exhaustion (computeSheet applies neither): 0 when stopped or at exhaustion 5+, halved at 2–4. */
export function effectiveSpeed(walk: number, conditions: readonly string[], exhaustion = 0): number {
  if (exhaustion >= 5 || conditions.some((n) => STOP_CONDITIONS.includes(n.toLowerCase()))) return 0;
  // a spell's slow is a condition that names its cut: "Ray of Frost (speed −10 ft)"
  const cut = conditions.reduce((n, c) => n + Number(/speed [−-](\d+) ft/i.exec(c)?.[1] ?? 0), 0), w = Math.max(0, walk - cut);
  return exhaustion >= 2 ? Math.floor(w / 10) * 5 : w;
}

/** The speed a creature moves by on the map: its walk, or its fly speed when that's faster (Fly, wings). ponytail: the map has no altitude. */
export const moveSpeed = (s: Speeds): number => Math.max(s.walk, s.fly ?? 0);

/** A monster's moving speed: its stat block's, with the spells it holds (Longstrider's +10 walk, Fly's 60 feet). */
export function monsterSpeed(m: Pick<MonsterDef, 'speed'>, held: readonly string[]): number {
  const sp = spellMods(held);
  return moveSpeed({ walk: m.speed.walk + sp.speed, fly: Math.max(m.speed.fly ?? 0, sp.fly ?? 0) });
}

/** Where the token stood when its turn's movement began, if sound (an old saved fight's `{ feet, dashes }` entry has none). */
export const originOf = (m: Movement | undefined): Pt | undefined =>
  m?.from && Number.isFinite(m.from.x) && Number.isFinite(m.from.y) ? { x: m.from.x, y: m.from.y } : undefined;

/** Movement used this turn: the running total of feet walked (`used`), else (an old saved fight) the grid distance from the turn's origin to the token now. */
export const usedFeet = (m: Movement | undefined, at: Pt | undefined, g: Grid | undefined, diagonal: '5-5-5' | '5-10-5'): number => {
  if (typeof m?.used === 'number' && Number.isFinite(m.used)) return m.used;
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

/** Feet of the cheapest walk from cell a to b with `d` diagonals already walked this turn (square: every diagonal it can; 5-10-5 makes every second one cost double), and the diagonals in it. */
const walk = (g: Grid, a: Cell, b: Cell, diagonal: '5-5-5' | '5-10-5', d: number): { feet: number; diags: number } => {
  if (g.type !== 'square') return { feet: cellDistance(g, a, b, diagonal) * g.feet, diags: 0 };
  const dq = Math.abs(b.q - a.q), dr = Math.abs(b.r - a.r), hi = Math.max(dq, dr), lo = Math.min(dq, dr);
  return { feet: (hi + (diagonal === '5-10-5' ? Math.floor((d + lo) / 2) - Math.floor(d / 2) : 0)) * g.feet, diags: lo };
};

/** The cells `feet` pays for from `origin`'s cell (`diags`: diagonals already walked this turn, for 5-10-5), inside the w × h scene: the squares a token can reach (the highlight). */
export function reachableCells(g: Grid, origin: Pt, feet: number, diagonal: '5-5-5' | '5-10-5', w: number, h: number, diags = 0): Cell[] {
  if (!(feet > 0)) return [];
  const reach = (feet / g.feet + 1) * g.size, o = cellAt(g, origin);
  const x0 = Math.max(0, origin.x - reach), y0 = Math.max(0, origin.y - reach), x1 = Math.min(w, origin.x + reach), y1 = Math.min(h, origin.y + reach);
  if (x0 >= x1 || y0 >= y1) return [];
  return cellsIn(g, x0, y0, x1, y1).filter((c) => walk(g, o, c, diagonal, diags).feet <= feet);
}

/** A monster token's linked combatant, or a character's. */
export const combatantForToken = (c: Combat, t: { characterId?: string; combatantId?: string }): Combatant | undefined =>
  c.combatants.find((x) => (t.combatantId !== undefined ? x.id === t.combatantId : t.characterId !== undefined && x.characterId === t.characterId));

/** No budget with free movement on, outside combat or in setup (round 0). */
export const budgetApplies = (c: Combat | undefined, settings: { freeMovement: boolean }): boolean => !!c && c.round >= 1 && !settings.freeMovement;

/** The entry rebuilt from its known fields (an old `feet` goes). */
const entry = (c: Combat, id: string): Movement => {
  const m = c.movement?.[id], from = originOf(m), dashes = m?.dashes, mult = m?.mult, num = (n: number | undefined) => typeof n === 'number' && n >= 0 && Number.isFinite(n);
  return { ...(from && { from }), ...(num(m?.used) && { used: m!.used }), ...(num(m?.diags) && { diags: m!.diags }), dashes: typeof dashes === 'number' && dashes >= 0 ? dashes : 0, ...(mult === 0 || mult === 2 ? { mult } : {}), ...(m?.stood === true && { stood: true as const }) };
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

const key = (g: Grid, p: Pt): string => { const c = cellAt(g, p); return `${c.q},${c.r}`; };
/** Where a step from cell `a` toward `b` lands: the king (hex: neighbour) step that gets nearest, the straighter one on a tie. */
const stepToward = (g: Grid, a: Cell, b: Cell): Cell => {
  const dirs = g.type === 'square' ? [-1, 0, 1].flatMap((q) => [-1, 0, 1].map((r) => ({ q, r }))) : [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 }];
  const t = cellCenter(g, b);
  let best = a, bd = Infinity, be = Infinity;
  for (const d of dirs) {
    if (!d.q && !d.r) continue;
    const n = { q: a.q + d.q, r: a.r + d.r }, p = cellCenter(g, n), nd = cellDistance(g, n, b, '5-5-5'), e = Math.hypot(p.x - t.x, p.y - t.y);
    if (nd < bd || (nd === bd && e < be)) { best = n; bd = nd; be = e; }
  }
  return best;
};

/** The squares from cell a to cell b, one king step at a time (b included, a not). Positions are token centres for `size` (see snap). */
export function stepsBetween(g: Grid, a: Pt, b: Pt, size: Size): Pt[] {
  const sa = snap(g, a, size), ca = cellAt(g, sa), cb = cellAt(g, snap(g, b, size)), c0 = cellCenter(g, ca), out: Pt[] = [];
  for (let c = ca; (c.q !== cb.q || c.r !== cb.r) && out.length < 1000; ) { // 1000: a guard, never reached
    c = stepToward(g, c, cb);
    const p = cellCenter(g, c);
    out.push({ x: sa.x + p.x - c0.x, y: sa.y + p.y - c0.y });
  }
  return out;
}

/** The route with `to` reached from its last square: steps filled in; landing on a square already in it cuts it back there (the start included). */
export function extendRoute(g: Grid, start: Pt, route: Pt[], to: Pt, size: Size): Pt[] {
  const s = snap(g, start, size), t = snap(g, to, size), k = key(g, t);
  if (k === key(g, s)) return [];
  const i = route.findIndex((p) => key(g, p) === k);
  return i >= 0 ? route.slice(0, i + 1) : [...route, ...stepsBetween(g, route.at(-1) ?? s, t, size)];
}

/** Feet for walking `route` from `start`, with `diags` diagonals already walked this turn (5-10-5: every second diagonal costs 10); `diags` returned: those this route walks. */
export function routeFeet(g: Grid, start: Pt, route: Pt[], diagonal: '5-5-5' | '5-10-5', diags = 0): { feet: number; diags: number } {
  let feet = 0, d = 0, a = cellAt(g, start);
  for (const p of route) {
    const b = cellAt(g, p), w = walk(g, a, b, diagonal, diags + d);
    feet += w.feet; d += w.diags; a = b;
  }
  return { feet, diags: d };
}

/** The route cut to what `feet` left pays for. */
export function affordable(g: Grid, start: Pt, route: Pt[], feet: number, diagonal: '5-5-5' | '5-10-5', diags = 0): Pt[] {
  let used = 0, d = 0, a = cellAt(g, start);
  for (let i = 0; i < route.length; i++) {
    const b = cellAt(g, route[i]), w = walk(g, a, b, diagonal, diags + d);
    if (used + w.feet > feet) return route.slice(0, i);
    used += w.feet; d += w.diags; a = b;
  }
  return route;
}

/** A walked route charged to the combatant's Movement: sets the origin on the first move, adds `used` feet and `diags`. ponytail: an old mid-turn entry (no `used`) starts counting from 0. */
export const chargeRoute = (c: Combat, combatantId: string, from: Pt, cost: { feet: number; diags: number }): Combat => {
  const e = entry(c, combatantId), o = recordMove(c, combatantId, from);
  const m = entry(o, combatantId);
  return withEntry(o, combatantId, { ...m, used: (e.used ?? 0) + cost.feet, diags: (e.diags ?? 0) + cost.diags });
};
