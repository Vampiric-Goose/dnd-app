import { rollDice } from '../dice.ts';
import type { Scores } from '../types.ts';
import { ABILITIES, POINT_BUY_COST, STANDARD_ARRAY } from './constants.ts';

/** Total point-buy cost, or null if any score is outside 8-15. */
export function pointBuyCost(s: Scores): number | null {
  let total = 0;
  for (const a of ABILITIES) {
    const c = POINT_BUY_COST[s[a]];
    if (c === undefined) return null;
    total += c;
  }
  return total;
}

export const isStandardArray = (s: Scores): boolean =>
  ABILITIES.map((a) => s[a]).sort((a, b) => b - a).join() === STANDARD_ARRAY.join();

export const roll4d6DropLowest = (rng: () => number): number => rollDice('4d6kh3', { rng }).total;
