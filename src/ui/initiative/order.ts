import { moveCombatant } from '../../lib/combat/combat.ts';
import type { Combat } from '../../lib/types.ts';

/** [first, last] index of the current turn: the combatant, or the adjacent run sharing its group (as the engine counts it). */
export function currentRun(c: Combat | undefined): [number, number] | undefined {
  const cs = c?.combatants ?? [];
  const i = cs.findIndex((x) => x.id === c?.turn);
  if (!c || c.round === 0 || i < 0) return undefined;
  const g = cs[i].group;
  let a = i, b = i;
  if (g !== undefined) {
    while (a > 0 && cs[a - 1].group === g) a--;
    while (b < cs.length - 1 && cs[b + 1].group === g) b++;
  }
  return [a, b];
}

/**
 * Drag or Move up/down (`index` as in moveTo: the place in the list without the moved one). During a fight a combatant never crosses the
 * current turn: one who already acted stays before it, one still to act stays after it, so nobody acts twice or is skipped.
 */
export function reorder(c: Combat, id: string, index: number): Combat {
  const f = c.combatants.findIndex((x) => x.id === id), run = currentRun(c);
  if (f < 0 || !run || (f >= run[0] && f <= run[1])) return moveCombatant(c, id, index);
  const [a, b] = run;
  return moveCombatant(c, id, f < a ? Math.min(index, a - 1) : Math.max(index, b + 1));
}
