import { expect, test } from 'vitest';
import type { AimPlan } from '../src/lib/combat/aiming.ts';
import { rollLog } from '../src/lib/rolls.svelte.ts';
import { reveal, rollAim } from '../src/ui/map/aimRoll.ts';

// A player's aimed roll: two d20 faces go to the DM's device even when one was asked for (it may see a disadvantage the player's map
// can't, behind fog); only the asked-for d20 is logged; damage waits for the result (shown on a hit, dropped on a miss).
const sword: AimPlan = { reach: { melee: 5 }, line: false, attack: true, toHit: 5, dice: [{ expr: '1d8+3', type: 'slashing' }] };

test('two d20 faces sent, one logged; the damage shows only on a hit', () => {
  rollLog.length = 0;
  const r = rollAim('Longsword', sword);
  expect(r.rolled.d20).toHaveLength(2);
  expect(r.rolled.mode).toBeUndefined();
  expect(rollLog.map((e) => e.label)).toEqual(['Longsword: attack']);
  reveal(r.held, false);
  expect(rollLog).toHaveLength(1);
  reveal(r.held, true);
  expect(rollLog.map((e) => e.label)).toEqual(['Longsword: slashing damage', 'Longsword: attack']);
});

test('a forced disadvantage rolls and logs both d20s', () => {
  rollLog.length = 0;
  const r = rollAim('Longbow', { ...sword, line: true }, 'long range');
  expect(r.rolled.d20).toHaveLength(2);
  expect(rollLog[0].detail).toMatch(/2d20kl1/);
});
