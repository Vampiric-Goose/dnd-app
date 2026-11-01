// Map ↔ combat, Task A1: the movement budget model, its reset at each combatant's own turn start, and the drag clamp.
import { describe, expect, test } from 'vitest';
import { currentRun, newCombat, next, prev, removeStep, start } from '../../src/lib/combat/combat.ts';
import {
  addDash, budgetApplies, budgetFeet, clampMove, combatantForToken, dashRun, effectiveSpeed, MAX_DASHES, originOf, PLAYER_DASHES, recordMove, remainingFeet,
  resetMovement, undoDash, usedFeet,
} from '../../src/lib/combat/movement.ts';
import { cellAt, cellCenter, feetBetween, snap } from '../../src/lib/map/grid.ts';
import type { Combat, Combatant, Grid, Movement } from '../../src/lib/types.ts';

const cb = (id: string, init: number, o: Partial<Combatant> = {}): Combatant => ({ id, kind: 'monster', name: id, init, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (o: Partial<Combat> = {}): Combat => ({ ...newCombat('c1'), combatants: [cb('A', 20), cb('B', 15), cb('C', 10)], ...o });
/** An entry whose turn origin is (x, 0). */
const mv = (x: number, dashes = 0) => ({ from: { x, y: 0 }, dashes });
const sq: Grid = { type: 'square', size: 50, offsetX: 0, offsetY: 0, color: '#000000', opacity: 1, feet: 5 };
const at = (g: Grid, q: number, r: number) => cellCenter(g, { q, r });

describe('speed and budget', () => {
  test('effectiveSpeed: stop conditions, exhaustion', () => {
    expect(effectiveSpeed(30, ['Grappled'])).toBe(0);
    expect(effectiveSpeed(30, [], 5)).toBe(0);
    expect(effectiveSpeed(30, [], 2)).toBe(15);
    expect(effectiveSpeed(25, [], 3)).toBe(10);
    expect(effectiveSpeed(30, ['prone'])).toBe(30);
    expect(effectiveSpeed(30, [], 1)).toBe(30);
  });
  test('refundable: used = grid distance from the turn origin to the token now; moving back gives it back', () => {
    const m = { from: at(sq, 0, 0), dashes: 0 };
    expect(remainingFeet(30, undefined, at(sq, 3, 0), sq, '5-5-5')).toBe(30); // no origin yet: nothing used
    expect(usedFeet(m, at(sq, 4, 0), sq, '5-5-5')).toBe(20);
    expect(remainingFeet(30, m, at(sq, 4, 0), sq, '5-5-5')).toBe(10);
    expect(remainingFeet(30, m, at(sq, 1, 0), sq, '5-5-5')).toBe(25); // walked back toward the origin
    expect(remainingFeet(30, m, at(sq, 0, 0), sq, '5-5-5')).toBe(30); // back where it began: all of it again
    expect(remainingFeet(30, { ...m, dashes: 1 }, at(sq, 4, 0), sq, '5-5-5')).toBe(40);
    expect(remainingFeet(30, m, at(sq, 9, 0), sq, '5-5-5')).toBe(0);
    expect(remainingFeet(30, m, at(sq, 4, 4), sq, '5-10-5')).toBe(0); // the campaign's diagonal rule: 30 ft
    expect(budgetFeet(30, { dashes: 2 })).toBe(90);
  });
  test('an old saved fight\'s entry ({ feet, dashes }, no origin) does not crash: no origin, its Dashes kept', () => {
    const old = { feet: 20, dashes: 1 } as unknown as Movement;
    expect(originOf(old)).toBeUndefined();
    expect(remainingFeet(30, old, at(sq, 4, 0), sq, '5-5-5')).toBe(60);
    const c = fight({ round: 1, movement: { B: old } });
    expect(addDash(c, 'B').movement!.B).toEqual({ dashes: 2 });
    expect(recordMove(c, 'B', at(sq, 2, 0)).movement!.B).toEqual({ from: at(sq, 2, 0), dashes: 1 });
    expect(originOf({ from: { x: NaN, y: 0 }, dashes: 0 })).toBeUndefined();
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
  test('recordMove: the turn\'s first move sets the origin (where the token stood); later moves keep it', () => {
    const a = recordMove(fight(), 'B', { x: 10, y: 0 });
    expect(a.movement).toEqual({ B: mv(10) });
    expect(recordMove(a, 'B', { x: 25, y: 0 })).toBe(a);
    expect(recordMove(fight(), 'B', { x: NaN, y: 0 }).movement).toBeUndefined();
    expect(recordMove(addDash(fight(), 'B'), 'B', { x: 10, y: 0 }).movement!.B).toEqual(mv(10, 1));
  });
  test('addDash, undoDash only while the extra movement is unused, resetMovement', () => {
    const c = addDash(fight({ movement: { B: mv(0) } }), 'B');
    expect(c.movement!.B).toEqual(mv(0, 1));
    expect(undoDash(c, 'B', 30, 25).movement!.B).toEqual(mv(0));
    expect(undoDash(c, 'B', 30, 35)).toBe(c);
    const none = fight({ movement: { B: mv(5) } });
    expect(undoDash(none, 'B', 30, 0)).toBe(none);
    expect(resetMovement(c, 'B').movement).toEqual({});
  });
});

describe('Dash on a grouped monster turn (the turn bar Dashes the whole run)', () => {
  test('dashRun gives every member of the run a Dash, so each grouped token gets the doubled budget', () => {
    const cs = [cb('A', 20), cb('g1', 15, { group: 'gob' }), cb('g2', 15, { group: 'gob' })];
    const c = next(start(fight({ combatants: cs })).combat).combat;
    const d = dashRun(c, currentRun(c));
    expect(d.movement).toEqual({ g1: { dashes: 1 }, g2: { dashes: 1 } });
    expect(remainingFeet(30, d.movement!.g2)).toBe(60);
  });
});

describe('Dash limits', () => {
  test('addDash stops at MAX_DASHES (3), or at the cap passed (a player: PLAYER_DASHES, 1)', () => {
    expect([PLAYER_DASHES, MAX_DASHES]).toEqual([1, 3]);
    let c = fight();
    for (let i = 0; i < 5; i++) c = addDash(c, 'B');
    expect(c.movement!.B.dashes).toBe(3);
    const one = addDash(fight(), 'B', PLAYER_DASHES);
    expect(addDash(one, 'B', PLAYER_DASHES)).toBe(one);
    expect(addDash(one, 'B').movement!.B.dashes).toBe(2); // the DM may add more
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
    const b = recordMove(next(start(fight()).combat).combat, 'B', { x: 10, y: 0 });
    const back = prev(b);
    expect(back.movement).toBe(b.movement);
    const again = next(back).combat;
    expect(again.turn).toBe('B');
    expect(again.movement).toEqual({ B: mv(10) });
  });
  test('a grouped run: each member has its own entry, all reset at the run\'s turn start', () => {
    const cs = [cb('A', 20), cb('g1', 15, { group: 'gob' }), cb('g2', 15, { group: 'gob' })];
    let c = start(fight({ combatants: cs })).combat;
    c = recordMove(recordMove(c, 'g1', { x: 10, y: 0 }), 'g2', { x: 20, y: 0 });
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
  test('from the turn origin: the reach is a circle around it, wherever the token is now (a slip can be walked back)', () => {
    const o = at(sq, 0, 0);
    // the token stands 4 cells out (20 of 30 ft used): dragging on stops at 30 ft from the origin, dragging back is free
    expect(cellAt(sq, clampMove(sq, at(sq, 4, 0), at(sq, 10, 0), 'M', 30, '5-5-5', o))).toEqual({ q: 6, r: 0 });
    expect(clampMove(sq, at(sq, 4, 0), at(sq, -2, 0), 'M', 30, '5-5-5', o)).toEqual(at(sq, -2, 0));
    expect(cellAt(sq, clampMove(sq, at(sq, 4, 0), at(sq, -9, 0), 'M', 30, '5-5-5', o))).toEqual({ q: -6, r: 0 });
  });
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
  test('hex-flat: the farthest legal cell along the line (no legal cell past it)', () => {
    const hex: Grid = { ...sq, type: 'hex-flat' }, a = { x: 0, y: 0 }, left = 20;
    for (const to of [{ x: 600, y: 300 }, { x: 37, y: 512 }, { x: 410, y: 10 }, { x: 300, y: 520 }]) {
      const p = clampMove(hex, a, to, 'M', left, '5-5-5');
      const n = 2000, along = Array.from({ length: n + 1 }, (_, i) => snap(hex, { x: (to.x * i) / n, y: (to.y * i) / n }, 'M'));
      const last = along.map((q) => q.x === p.x && q.y === p.y).lastIndexOf(true);
      expect(last).toBeGreaterThan(0);
      expect(along.slice(last + 1).every((q) => feetBetween(hex, a, q, '5-5-5') > left)).toBe(true);
    }
  });
});
