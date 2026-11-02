// Targeting: an aimed use rolled on this device. The d20 is logged at once (the roller knows their roll); the damage dice are held until
// the result says it hit (a save's damage, which lands hit or miss, can be shown at once).
import type { AimPlan } from '../../lib/combat/aiming.ts';
import { combineMode, type Pickable } from '../../lib/combat/targeting.ts';
import { rollDice } from '../../lib/dice.ts';
import { natD20, publish, roll, rollMode, type RollEntry } from '../../lib/rolls.svelte.ts';
import { signed } from '../creator/labels.ts';

export interface AimRoll {
  /** The raw faces to send. `mode`: the roller's own advantage pick; the DM's device adds any forced disadvantage itself. */
  rolled: { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[][] };
  /** The damage rolls, not yet logged: `hit` the attack's part, `save` the part that lands either way; `ray`: which ray of several. */
  held: { entry: RollEntry; part: 'hit' | 'save'; ray?: number }[];
}

/**
 * `judged`: the target as judge() saw it (its advantage and disadvantage reasons, a critical by itself); for rays, beams or darts one per
 * ray, each rolled as its own attack (two d20s and the dice each, held per ray).
 */
export function rollAim(name: string, plan: AimPlan, judged?: Pickable | (Pickable | undefined)[]): AimRoll {
  if (Array.isArray(judged)) {
    const pick = rollMode.value;
    const each = judged.map((j, ray) => { rollMode.value = pick; const r = rollAim(name, { ...plan, count: undefined }, j); return { ...r, held: r.held.map((h) => ({ ...h, ray })) }; });
    return { rolled: { ...(plan.attack && { d20: each.flatMap((r) => r.rolled.d20 ?? []) }), ...(each[0]?.rolled.mode && { mode: each[0].rolled.mode }), dmg: each.flatMap((r) => r.rolled.dmg) },
      held: each.flatMap((r) => r.held) };
  }
  const pick = rollMode.value === 'normal' ? undefined : rollMode.value, j = judged?.ok ? judged : undefined;
  const mode = plan.attack ? combineMode({ adv: j?.adv ?? [], dis: j?.dis ?? (j?.disadvantage ? [j.disadvantage] : []) }, pick) : undefined;
  const d20 = plan.attack ? roll(`${name}: attack`, `1d20${signed(plan.toHit ?? 0)}`, { mode: mode ?? 'normal', shareAs: 'Attack' }) : undefined;
  const crit = !!d20 && (natD20(d20.detail) === 'nat20' || !!j?.autoCrit);
  const dmg = plan.dice.map((d) => ({ d, r: roll(`${name}: ${d.type} damage`, d.expr, { crit: crit && d.on !== 'save', hold: true }) }));
  rollMode.value = 'normal';
  return {
    // two d20s always (the second unshown when none was asked for): the DM's device may see a disadvantage this one can't (fog)
    rolled: { ...(d20 && { d20: d20.faces.length > 1 ? d20.faces : [...d20.faces, ...rollDice('1d20').faces] }), ...(pick && { mode: pick }), dmg: dmg.map(({ r }) => r.faces) },
    held: dmg.map(({ d, r }) => ({ entry: r, part: d.on === 'save' || (plan.read && !plan.read.attack) ? 'save' : 'hit' })),
  };
}

/** Shows the held damage the result allows: the hit part only on a hit (a ray's, by `hits`), the save part always. */
export function reveal(held: AimRoll['held'], hit: boolean | undefined, shareAs?: string, hits?: boolean[]): void {
  for (const h of held) if (h.part === 'save' || (hits && h.ray !== undefined ? hits[h.ray] : hit)) publish(h.entry, shareAs);
}
