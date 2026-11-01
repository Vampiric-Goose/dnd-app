import { describe, expect, test } from 'vitest';
import { addCombatants, newCombat, next, prev, start } from '../../src/lib/combat/combat.ts';
import { actionsLeft, BLOCKING, CONDITION_TEXT, grantAction, setPip, spend, useProblem } from '../../src/lib/combat/economy.ts';
import { CONDITIONS } from '../../src/lib/rules/constants.ts';
import type { Combatant } from '../../src/lib/types.ts';

const cb = (id: string, o: Partial<Combatant> = {}): Combatant => ({ id, kind: 'monster', name: id, init: 10, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });

describe('turn economy', () => {
  test('one Action a turn; a second action use is refused (RF1)', () => {
    const x = cb('a');
    expect(actionsLeft(x)).toBe(1);
    const y = spend(x, 'action');
    expect(actionsLeft(y)).toBe(0);
    expect(useProblem(y, 'action', [], true)).toBe('no Action left');
  });

  test('Extra Attack: the 2nd attack of the Attack action needs no new Action, the 3rd does (RF2)', () => {
    const per = { perAction: 2 };
    let x = spend(cb('a'), 'action', per);
    expect(useProblem(x, 'action', [], true, per)).toBeUndefined();
    x = spend(x, 'action', per);
    expect(x.economy).toMatchObject({ used: 1, attacks: 2 });
    expect(useProblem(x, 'action', [], true, per)).toBe('no Action left');
    x = grantAction(x); // Action Surge, Haste
    expect(useProblem(x, 'action', [], true, per)).toBeUndefined();
    x = spend(x, 'action', per);
    expect(x.economy).toMatchObject({ used: 2, attacks: 1 });
  });

  test('a non-attack action ends the Attack action', () => {
    const per = { perAction: 2 };
    let x = grantAction(spend(cb('a'), 'action', per));
    x = spend(x, 'action'); // Dash
    expect(x.economy).toMatchObject({ used: 2, attacks: 0 });
    expect(useProblem(x, 'action', [], true, per)).toBe('no Action left');
  });

  test('the Bonus action is its own, one a turn, and extra Actions never add one', () => {
    let x = grantAction(grantAction(cb('a')));
    x = spend(x, 'bonus');
    expect(useProblem(x, 'bonus', [], true)).toBe('no Bonus action left');
    expect(actionsLeft(x)).toBe(3);
  });

  test('off its turn a creature can use only its Reaction (RF3)', () => {
    const x = cb('a');
    expect(useProblem(x, 'action', [], false)).toBe('not your turn');
    expect(useProblem(x, 'bonus', [], false)).toBe('not your turn');
    expect(useProblem(x, 'reaction', [], false)).toBeUndefined();
    expect(useProblem(spend(x, 'reaction'), 'reaction', [], false)).toBe('no Reaction left');
    expect(useProblem(x, 'none', [], false)).toBe('not your turn');
  });

  test('blocking conditions stop all three; Prone does not (RF4)', () => {
    const x = cb('a');
    for (const c of ['action', 'bonus', 'reaction'] as const) {
      expect(useProblem(x, c, ['Prone'], true)).toBeUndefined();
      expect(useProblem(x, c, ['Incapacitated'], true)).toBe('Incapacitated');
      expect(useProblem(x, c, ['stunned'], true)).toBe('stunned');
    }
    expect(BLOCKING).toEqual(['incapacitated', 'stunned', 'paralyzed', 'petrified', 'unconscious']);
  });

  test('every condition has a short effect text', () => {
    for (const c of CONDITIONS) expect(CONDITION_TEXT[c]).toBeTruthy();
    expect(CONDITION_TEXT.Grappled).toBe('speed 0');
  });

  test('the DM sets or clears a pip', () => {
    let x = setPip(cb('a'), 'action', true);
    expect(actionsLeft(x)).toBe(0);
    x = setPip(x, 'action', false);
    expect(actionsLeft(x)).toBe(1);
    expect(setPip(cb('a'), 'bonus', true).economy?.bonus).toBe(true);
    expect(setPip(cb('a'), 'reaction', true).reactionUsed).toBe(true);
  });

  test('pips reset where the creature own turn starts, once (Next, Previous, Next)', () => {
    let c = start(addCombatants(newCombat('c1'), [cb('a', { init: 20 }), cb('b', { init: 10 })])).combat;
    c = { ...c, combatants: c.combatants.map((x) => (x.id === 'a' ? spend(spend(x, 'action'), 'reaction') : x)) };
    c = next(c).combat; // b's turn
    expect(c.combatants.find((x) => x.id === 'a')?.economy).toBeTruthy();
    c = { ...c, combatants: c.combatants.map((x) => (x.id === 'b' ? spend(x, 'action') : x)) };
    c = next(prev(c)).combat; // back to a? no: prev to a, next to b again (already started): b keeps its spent Action
    expect(c.turn).toBe('b');
    expect(actionsLeft(c.combatants.find((x) => x.id === 'b')!)).toBe(0);
    c = next(c).combat; // round 2, a's turn starts: fresh
    const a = c.combatants.find((x) => x.id === 'a')!;
    expect(a.economy).toBeUndefined();
    expect(a.reactionUsed).toBe(false);
  });
});
