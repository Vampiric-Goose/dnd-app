// Pure (no Svelte/Vite/DOM): the movement budget (spec 1). Combat.movement holds each combatant's feet used and Dashes taken this turn;
// combat.ts drops an entry where its own turn starts.
import { feetBetween, snap, type Pt } from '../map/grid.ts';
import type { Combat, Combatant, Grid, Movement, Size } from '../types.ts';

/** 2014 conditions that set speed to 0. */
export const STOP_CONDITIONS: readonly string[] = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'];

/** Walk speed after conditions and exhaustion (computeSheet applies neither): 0 when stopped or at exhaustion 5+, halved at 2–4. */
export function effectiveSpeed(walk: number, conditions: readonly string[], exhaustion = 0): number {
  if (exhaustion >= 5 || conditions.some((n) => STOP_CONDITIONS.includes(n.toLowerCase()))) return 0;
  return exhaustion >= 2 ? Math.floor(walk / 10) * 5 : walk;
}

/** Budget = speed × (1 + Dashes), less the feet used. */
export const remainingFeet = (speed: number, m: Movement | undefined): number => Math.max(0, speed * (1 + (m?.dashes ?? 0)) - (m?.feet ?? 0));

/** A monster token's linked combatant, or a character's. */
export const combatantForToken = (c: Combat, t: { characterId?: string; combatantId?: string }): Combatant | undefined =>
  c.combatants.find((x) => (t.combatantId !== undefined ? x.id === t.combatantId : t.characterId !== undefined && x.characterId === t.characterId));

/** No budget with free movement on, outside combat or in setup (round 0). */
export const budgetApplies = (c: Combat | undefined, settings: { freeMovement: boolean }): boolean => !!c && c.round >= 1 && !settings.freeMovement;

const entry = (c: Combat, id: string): Movement => c.movement?.[id] ?? { feet: 0, dashes: 0 };
const withEntry = (c: Combat, id: string, m: Movement): Combat => ({ ...c, movement: { ...c.movement, [id]: m } });

/** Adds a move's feet (moving back costs too). Nothing, negative or NaN returns `c`, so db.combat.update writes nothing. */
export const recordMove = (c: Combat, combatantId: string, feet: number): Combat =>
  feet > 0 ? withEntry(c, combatantId, { ...entry(c, combatantId), feet: entry(c, combatantId).feet + feet }) : c;

/** Dashes a turn: a player's own Dash button gives one; the DM may add more (Cunning Action, Action Surge) up to MAX_DASHES in all. */
export const PLAYER_DASHES = 1, MAX_DASHES = 3;

/** One more Dash, unless the combatant already has `max` this turn (then `c`). */
export const addDash = (c: Combat, combatantId: string, max = MAX_DASHES): Combat =>
  entry(c, combatantId).dashes >= max ? c : withEntry(c, combatantId, { ...entry(c, combatantId), dashes: entry(c, combatantId).dashes + 1 });

/** The DM's turn-bar Dash: one for every combatant of the current run (a grouped monster turn moves as one, each token on its own budget). */
export const dashRun = (c: Combat, ids: Iterable<string>): Combat => { for (const id of ids) c = addDash(c, id); return c; };

/** Takes back a mistaken Dash, only while its extra movement is unused; otherwise returns `c`. */
export function undoDash(c: Combat, combatantId: string, speed: number): Combat {
  const m = c.movement?.[combatantId];
  return m && m.dashes >= 1 && m.feet <= speed * m.dashes ? withEntry(c, combatantId, { ...m, dashes: m.dashes - 1 }) : c;
}

/** The DM's Reset movement (P2): feet 0, no Dashes. */
export const resetMovement = (c: Combat, combatantId: string): Combat =>
  c.movement && Object.hasOwn(c.movement, combatantId) ? { ...c, movement: Object.fromEntries(Object.entries(c.movement).filter(([id]) => id !== combatantId)) } : c;

/**
 * The drop point of a drag from `from` toward `to` with `left` feet: the snapped target when it is within budget, else the last snapped
 * sample along the line (every quarter cell) within budget.
 */
export function clampMove(g: Grid, from: Pt, to: Pt, size: Size, left: number, diagonal: '5-5-5' | '5-10-5'): Pt {
  const a = snap(g, from, size), end = snap(g, to, size);
  if (feetBetween(g, a, end, diagonal) <= left) return end;
  const n = Math.ceil(Math.hypot(to.x - a.x, to.y - a.y) / (g.size / 4));
  let best = a;
  for (let i = 1; i <= n; i++) {
    const p = snap(g, { x: a.x + ((to.x - a.x) * i) / n, y: a.y + ((to.y - a.y) * i) / n }, size);
    if (feetBetween(g, a, p, diagonal) <= left) best = p;
  }
  return best;
}
