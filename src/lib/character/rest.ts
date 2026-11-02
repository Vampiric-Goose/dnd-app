import { rechargeEntry } from '../items/inventory.ts';
import { SPELL_EFFECTS } from '../rules/constants.ts';
import type { Character, Sheet } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts. Every function returns a new Character.

type State = Character['state'];
const withState = (c: Character, s: Partial<State>): Character => ({ ...c, state: { ...c.state, ...s } });
const NO_SAVES = { success: 0, fail: 0 };

/** Clears used resources and restores item charges (rolled, through rechargeEntry); a long rest also covers short-rest ones. */
function recharge(c: Character, sheet: Sheet, event: 'short' | 'long', rng?: () => number): Pick<Character, 'inventory'> & { resourcesUsed: State['resourcesUsed'] } {
  const reset = new Set(sheet.resources.filter(r => r.recharge === 'short' || r.recharge === event).map(r => r.name));
  return {
    resourcesUsed: Object.fromEntries(Object.entries(c.state.resourcesUsed).filter(([n]) => !reset.has(n))),
    inventory: c.inventory.map(e => rechargeEntry(e, event, rng)),
  };
}

/** Spends hit dice (never more than are left); each heals max(0, roll + Con mod). Pact slots and short-rest resources/items recharge. */
export function shortRest(c: Character, spent: { die: number; rolls: number[] }[], sheet: Sheet, rng?: () => number): Character {
  if (c.state.dead) return c; // the dead get no benefit from a rest
  const used = { ...c.state.hitDiceUsed };
  let heal = 0;
  for (const { die, rolls } of spent) {
    const left = (sheet.hitDice.find(h => h.die === die)?.total ?? 0) - (used[die] ?? 0);
    const taken = rolls.slice(0, Math.max(0, left));
    used[die] = (used[die] ?? 0) + taken.length;
    for (const r of taken) heal += Math.max(0, r + sheet.mods.con);
  }
  const { resourcesUsed, inventory } = recharge(c, sheet, 'short', rng);
  return applyHealing({ ...withState(c, { hitDiceUsed: used, pactSlotsUsed: 0, resourcesUsed }), inventory }, heal, sheet);
}

/** Full HP, half the hit dice back (largest first, at least 1), all slots and short/long resources and items, one less exhaustion.
 *  R26: no benefit when dead or below 1 HP (PHB p.186); the character comes back unchanged. */
export function longRest(c: Character, sheet: Sheet, rng?: () => number): Character {
  if (c.state.dead || c.state.hp <= 0) return c;
  const used = { ...c.state.hitDiceUsed };
  let regain = Math.max(1, Math.floor(sheet.totalLevel / 2));
  for (const { die } of sheet.hitDice) { // sorted largest die first
    const n = Math.min(regain, used[die] ?? 0);
    if (used[die] !== undefined) used[die] -= n;
    regain -= n;
  }
  const { resourcesUsed, inventory } = recharge(c, sheet, 'long', rng);
  return {
    ...withState(c, {
      hp: sheet.maxHp, tempHp: 0, hitDiceUsed: used, slotsUsed: [], pactSlotsUsed: 0, resourcesUsed,
      exhaustion: Math.max(0, c.state.exhaustion - 1), deathSaves: NO_SAVES, stable: false, conditions: c.state.conditions.filter((n) => !SPELL_EFFECTS[n]),
    }),
    inventory,
  };
}

/** Temp HP first. At 0 HP every hit is a death-save failure (2 on a crit); leftover damage of at least max HP kills outright. */
export function applyDamage(c: Character, amount: number, sheet: Sheet, crit = false): Character {
  if (amount <= 0 || c.state.dead) return c;
  const tempHp = Math.max(0, c.state.tempHp - amount);
  const rest = amount - (c.state.tempHp - tempHp);
  if (rest === 0) return withState(c, { tempHp });
  if (c.state.hp > 0) {
    const hp = c.state.hp - rest;
    return withState(c, { tempHp, hp: Math.max(0, hp), ...(-hp >= sheet.maxHp && { dead: true }) });
  }
  const fail = Math.min(3, c.state.deathSaves.fail + (crit ? 2 : 1));
  return withState(c, { tempHp, stable: false, deathSaves: { ...c.state.deathSaves, fail }, ...((fail >= 3 || rest >= sheet.maxHp) && { dead: true }) });
}

/** Caps at max HP; any healing at 0 HP clears death saves and `stable`. The dead stay dead. */
export function applyHealing(c: Character, amount: number, sheet: Sheet): Character {
  if (amount <= 0 || c.state.dead) return c;
  const hp = Math.min(sheet.maxHp, c.state.hp + amount);
  return withState(c, { hp, ...(c.state.hp === 0 && { deathSaves: NO_SAVES, stable: false }) });
}

/** Only while dying (0 HP, not stable or dead). 20: back to 1 HP. 1: two failures. 3 successes: stable (saves reset, PHB p.197). */
export function rollDeathSave(c: Character, d20: number): Character {
  const s = c.state;
  if (s.hp > 0 || s.dead || s.stable) return c;
  if (d20 >= 20) return withState(c, { hp: 1, deathSaves: NO_SAVES });
  const success = s.deathSaves.success + (d20 >= 10 ? 1 : 0);
  const fail = Math.min(3, s.deathSaves.fail + (d20 <= 1 ? 2 : d20 < 10 ? 1 : 0));
  if (fail >= 3) return withState(c, { deathSaves: { success, fail }, dead: true });
  if (success >= 3) return withState(c, { deathSaves: NO_SAVES, stable: true });
  return withState(c, { deathSaves: { success, fail } });
}
