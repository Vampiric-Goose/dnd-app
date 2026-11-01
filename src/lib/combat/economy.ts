// Pure (no Svelte/Vite/DOM): a combatant's turn economy (turn panel spec). Combatant.economy holds the Actions used and extra
// Actions granted (Action Surge, Haste), the Bonus action, and the attacks made in the current Attack action; reactionUsed is the
// Reaction. combat.ts drops economy where the combatant's own turn starts.
import type { Combatant } from '../types.ts';

export type Cost = 'action' | 'bonus' | 'reaction' | 'none';
type Economy = NonNullable<Combatant['economy']>;

/** Conditions that leave a creature no Action, Bonus action or Reaction (2014: incapacitated, or a condition that includes it). */
export const BLOCKING: readonly string[] = ['incapacitated', 'stunned', 'paralyzed', 'petrified', 'unconscious'];

/** What each condition does in the moment, short (2014). */
export const CONDITION_TEXT: Record<string, string> = {
  Blinded: "can't see; your attacks have disadvantage, attacks against you advantage",
  Charmed: "can't attack the charmer; it has advantage on social checks with you",
  Deafened: "can't hear",
  Frightened: "disadvantage while the source is in sight; can't move closer to it",
  Grappled: 'speed 0',
  Hasted: 'speed doubled, +2 AC, advantage on Dex saves; the extra Action is only one weapon attack, Dash, Disengage, Hide or Use an Object',
  Incapacitated: 'no actions or reactions',
  Invisible: 'your attacks have advantage, attacks against you disadvantage',
  Paralyzed: 'no actions, reactions or movement; hits within 5 ft are critical',
  Petrified: 'no actions, reactions or movement; resistance to all damage',
  Poisoned: 'disadvantage on attacks and ability checks',
  Prone: 'crawling costs double; melee attacks against you have advantage',
  Restrained: 'speed 0; your attacks and Dex saves have disadvantage',
  Stunned: 'no actions, reactions or movement; fail Str and Dex saves',
  Unconscious: 'no actions, reactions or movement; hits within 5 ft are critical',
};

const econ = (x: Combatant): Economy => ({ used: 0, extra: 0, bonus: false, attacks: 0, ...x.economy });

export const actionsLeft = (x: Combatant): number => { const e = econ(x); return Math.max(0, 1 + e.extra - e.used); };

/**
 * Why the creature can't use something of this cost now, or undefined. `onTurn`: it is acting (off its turn only the Reaction);
 * `attack`: an attack, which continues an Attack action that has attacks left without needing another Action.
 */
export function useProblem(x: Combatant, cost: Cost, conditions: readonly string[], onTurn: boolean, attack?: { perAction: number }): string | undefined {
  if (cost === 'none') return undefined; // no pip: also off its turn (Indomitable on an enemy's turn)
  if (cost !== 'reaction' && !onTurn) return 'not your turn';
  const block = conditions.find((c) => BLOCKING.includes(c.toLowerCase()));
  if (block) return block;
  const e = econ(x);
  if (cost === 'reaction') return x.reactionUsed ? 'no Reaction left' : undefined;
  if (cost === 'bonus') return e.bonus ? 'no Bonus action left' : undefined;
  if (attack && e.attacks > 0 && e.attacks < attack.perAction) return undefined;
  return actionsLeft(x) > 0 ? undefined : 'no Action left';
}

/** Spends it (check useProblem first). An attack within an Attack action that has attacks left uses no new Action. */
export function spend(x: Combatant, cost: Cost, attack?: { perAction: number }): Combatant {
  const e = econ(x);
  if (cost === 'reaction') return { ...x, reactionUsed: true };
  if (cost === 'bonus') return { ...x, economy: { ...e, bonus: true } };
  if (cost !== 'action') return x;
  if (attack && e.attacks > 0 && e.attacks < attack.perAction) return { ...x, economy: { ...e, attacks: e.attacks + 1 } };
  return { ...x, economy: { ...e, used: e.used + 1, attacks: attack ? 1 : 0 } };
}

/** One more Action this turn (Action Surge). Never a Bonus action. */
export const grantAction = (x: Combatant): Combatant => ({ ...x, economy: { ...econ(x), extra: econ(x).extra + 1 } });

/** The DM's fix: mark a pip used or unused (an Action: one more or one fewer used, within the Actions this turn has). */
export function setPip(x: Combatant, pip: 'action' | 'bonus' | 'reaction', used: boolean): Combatant {
  if (pip === 'reaction') return { ...x, reactionUsed: used };
  const e = econ(x);
  if (pip === 'bonus') return { ...x, economy: { ...e, bonus: used } };
  const n = Math.max(0, Math.min(1 + e.extra, e.used + (used ? 1 : -1)));
  return { ...x, economy: { ...e, used: n, attacks: used ? e.attacks : 0 } };
}
