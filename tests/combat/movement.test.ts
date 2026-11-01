// Map ↔ combat, Task A1: the movement budget model, its reset at each combatant's own turn start, and the drag clamp.
import { describe, expect, test } from 'vitest';
import { currentRun, newCombat, next, prev, removeStep, start } from '../../src/lib/combat/combat.ts';
import {
  addDash, budgetApplies, clampMove, combatantForToken, effectiveSpeed, recordMove, remainingFeet, resetMovement, undoDash,
} from '../../src/lib/combat/movement.ts';
import { cellAt, cellCenter, feetBetween } from '../../src/lib/map/grid.ts';
import type { Combat, Combatant, Grid } from '../../src/lib/types.ts';

const cb = (id: string, init: number, o: Partial<Combatant> = {}): Combatant => ({ id, kind: 'monster', name: id, init, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (o: Partial<Combat> = {}): Combat => ({ ...newCombat('c1'), combatants: [cb('A', 20), cb('B', 15), cb('C', 10)], ...o });
const mv = (feet: number, dashes = 0) => ({ feet, dashes });

describe('speed and budget', () => {
  test('effectiveSpeed: stop conditions, exhaustion', () => {
    expect(effectiveSpeed(30, ['Grappled'])).toBe(0);
    expect(effectiveSpeed(30, [], 5)).toBe(0);
    expect(effectiveSpeed(30, [], 2)).toBe(15);
    expect(effectiveSpeed(25, [], 3)).toBe(10);
    expect(effectiveSpeed(30, ['prone'])).toBe(30);
    expect(effectiveSpeed(30, [], 1)).toBe(30);
  });
  test('remainingFeet', () => {
    expect(remainingFeet(30, undefined)).toBe(30);
    expect(remainingFeet(30, mv(20, 1))).toBe(40);
    expect(remainingFeet(30, mv(45))).toBe(0);
  });
  test('budgetApplies: a running fight without free movement', () => {
    expect(budgetApplies(fight({ round: 1 }), { freeMovement: false })).toBe(true);
    expect(budgetApplies(fight({ round: 1 }), { freeMovement: true })).toBe(false);
    expect(budgetApplies(fight(), { freeMovement: false })).toBe(false);
    expect(budgetApplies(undefined, { freeMovement: false })).toBe(false);
  });
  test('combatantForToken', () => {
    const c = fight({ combatants: [cb('pc:t', 20, { kind: 'pc', characterId: 't' }), cb('g1', 12)] });
    expect(combatantForToken(c, { characterId: 't' })?.id).toBe('pc:t');
    expect(combatantForToken(c, { combatantId: 'g1' })?.id).toBe('g1');
    expect(combatantForToken(c, { characterId: 'x' })).toBeUndefined();
    expect(combatantForToken(c, {})).toBeUndefined();
  });
});

describe('records', () => {
  test('recordMove accumulates, creates the entry, ignores negatives', () => {
    const a = recordMove(fight(), 'B', 10);
    expect(a.movement).toEqual({ B: mv(10) });
    expect(recordMove(a, 'B', 15).movement).toEqual({ B: mv(25) });
    expect(recordMove(a, 'B', -5)).toBe(a);
    expect(recordMove(a, 'B', NaN)).toBe(a);
  });
  test('addDash, undoDash only while the extra movement is unused, resetMovement', () => {
    const c = addDash(fight({ movement: { B: mv(25) } }), 'B');
    expect(c.movement!.B).toEqual(mv(25, 1));
    expect(undoDash(c, 'B', 30).movement!.B).toEqual(mv(25));
    const used = fight({ movement: { B: mv(35, 1) } });
    expect(undoDash(used, 'B', 30)).toBe(used);
    const none = fight({ movement: { B: mv(5) } });
    expect(undoDash(none, 'B', 30)).toBe(none);
    expect(resetMovement(c, 'B').movement).toEqual({});
  });
});

describe('turn reset', () => {
  const moved = { A: mv(10), B: mv(5), C: mv(15) };
  test('start drops the first combatant\'s movement', () => {
    expect(start(fight({ movement: moved })).combat.movement).toEqual({ B: mv(5), C: mv(15) });
  });
  test('next resets only the new run', () => {
    const c = next(start(fight({ movement: moved })).combat).combat;
    expect(c.turn).toBe('B');
    expect(c.movement).toEqual({ C: mv(15) });
  });
  test('next, prev, next resets the returning combatant once (the done guard); prev alone changes nothing', () => {
    const b = recordMove(next(start(fight()).combat).combat, 'B', 10);
    const back = prev(b);
    expect(back.movement).toBe(b.movement);
    const again = next(back).combat;
    expect(again.turn).toBe('B');
    expect(again.movement).toEqual({ B: mv(10) });
  });
  test('a grouped run: each member has its own entry, all reset at the run\'s turn start', () => {
    const cs = [cb('A', 20), cb('g1', 15, { group: 'gob' }), cb('g2', 15, { group: 'gob' })];
    let c = start(fight({ combatants: cs })).combat;
    c = recordMove(recordMove(c, 'g1', 10), 'g2', 20);
    expect(c.movement).toEqual({ g1: mv(10), g2: mv(20) });
    c = next(c).combat;
    expect([...currentRun(c)]).toEqual(['g1', 'g2']);
    expect(c.movement).toEqual({});
  });
  test('removeStep drops the removed entry (and passing the turn resets the next run)', () => {
    const c = start(fight()).combat;
    expect(removeStep({ ...c, movement: moved }, 'C').combat.movement).toEqual({ A: mv(10), B: mv(5) });
    expect(removeStep({ ...c, movement: moved }, 'A').combat.movement).toEqual({ C: mv(15) });
  });
  test('currentRun: empty in setup', () => {
    expect(currentRun(fight()).size).toBe(0);
    expect([...currentRun(start(fight()).combat)]).toEqual(['A']);
  });
});

describe('clampMove (Review Focus 3)', () => {
  const sq: Grid = { type: 'square', size: 50, offsetX: 0, offsetY: 0, color: '#000000', opacity: 1, feet: 5 };
  const at = (g: Grid, q: number, r: number) => cellCenter(g, { q, r });
  test('square: stops on the last reachable cell', () => {
    expect(cellAt(sq, clampMove(sq, at(sq, 0, 0), at(sq, 10, 0), 'M', 30, '5-5-5'))).toEqual({ q: 6, r: 0 });
    expect(clampMove(sq, at(sq, 0, 0), at(sq, 10, 0), 'M', 0, '5-5-5')).toEqual(at(sq, 0, 0));
    expect(clampMove(sq, { x: 30, y: 20 }, { x: 160, y: 40 }, 'M', 30, '5-5-5')).toEqual(at(sq, 3, 0));
  });
  test('square diagonal 5-10-5: lands at exactly 30 ft, never 35', () => {
    const p = clampMove(sq, at(sq, 0, 0), at(sq, 10, 10), 'M', 30, '5-10-5');
    expect(feetBetween(sq, at(sq, 0, 0), p, '5-10-5')).toBe(30);
  });
  test('hex-flat: never past the budget', () => {
    const hex: Grid = { ...sq, type: 'hex-flat' };
    for (const to of [{ x: 600, y: 300 }, { x: 37, y: 512 }, { x: 410, y: 10 }]) {
      const p = clampMove(hex, { x: 0, y: 0 }, to, 'M', 15, '5-5-5');
      expect(feetBetween(hex, { x: 0, y: 0 }, p, '5-5-5')).toBe(15);
    }
  });
});
