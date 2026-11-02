// Targeting: an aimed use rolled on this device. The d20 is logged at once (the roller knows their roll); the damage dice are held until
// the result says it hit (a save's damage, which lands hit or miss, can be shown at once).
import type { AimPlan } from '../../lib/combat/aiming.ts';
import { finalMode, type Disadvantage } from '../../lib/combat/targeting.ts';
import { rollDice } from '../../lib/dice.ts';
import { natD20, publish, roll, rollMode, type RollEntry } from '../../lib/rolls.svelte.ts';
import { signed } from '../creator/labels.ts';

export interface AimRoll {
  /** The raw faces to send. `mode`: the roller's own advantage pick; the DM's device adds any forced disadvantage itself. */
  rolled: { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[][] };
  /** The damage rolls, not yet logged: `hit` the attack's part, `save` the part that lands either way. */
  held: { entry: RollEntry; part: 'hit' | 'save' }[];
}

export function rollAim(name: string, plan: AimPlan, forced?: Disadvantage): AimRoll {
  const pick = rollMode.value === 'normal' ? undefined : rollMode.value;
  const mode = plan.attack ? finalMode(pick, forced) : undefined;
  const d20 = plan.attack ? roll(`${name}: attack`, `1d20${signed(plan.toHit ?? 0)}`, { mode: mode ?? 'normal', shareAs: 'Attack' }) : undefined;
  const crit = !!d20 && natD20(d20.detail) === 'nat20';
  const dmg = plan.dice.map((d) => ({ d, r: roll(`${name}: ${d.type} damage`, d.expr, { crit: crit && d.on !== 'save', hold: true }) }));
  rollMode.value = 'normal';
  return {
    // two d20s always (the second unshown when none was asked for): the DM's device may see a disadvantage this one can't (fog)
    rolled: { ...(d20 && { d20: d20.faces.length > 1 ? d20.faces : [...d20.faces, ...rollDice('1d20').faces] }), ...(pick && { mode: pick }), dmg: dmg.map(({ r }) => r.faces) },
    held: dmg.map(({ d, r }) => ({ entry: r, part: d.on === 'save' || (plan.read && !plan.read.attack) ? 'save' : 'hit' })),
  };
}

/** Shows the held damage the result allows: the hit part only on a hit, the save part always. */
export function reveal(held: AimRoll['held'], hit: boolean | undefined, shareAs?: string): void {
  for (const h of held) if (h.part === 'save' || hit) publish(h.entry, shareAs);
}
