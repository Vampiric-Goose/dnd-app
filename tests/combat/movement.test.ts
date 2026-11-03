// Map ↔ combat, Task A1: the movement budget model, its reset at each combatant's own turn start, and the drag clamp.
import { describe, expect, test } from 'vitest';
import { currentRun, newCombat, next, prev, removeStep, start } from '../../src/lib/combat/combat.ts';
import {
  addDash, affordable, budgetApplies, budgetFeet, clampMove, chargeRoute, combatantForToken, effectiveSpeed, extendRoute, MAX_DASHES, originOf, reachableCells, recordMove, remainingFeet,
  monsterSpeed, moveSpeed, resetMovement, routeFeet, stepsBetween, usedFeet,
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
  test('effectiveSpeed: a condition that names a speed cut (Ray of Frost) takes it off; cuts add up, never below 0', () => {
    expect(effectiveSpeed(30, ['Ray of Frost (speed −10 ft)'])).toBe(20);
    expect(effectiveSpeed(30, ['Ray of Frost (speed −10 ft)', 'Other (speed −15 ft)'])).toBe(5);
    expect(effectiveSpeed(10, ['Ray of Frost (speed −10 ft)', 'Other (speed −15 ft)'])).toBe(0);
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
  test('addDash, resetMovement', () => {
    const c = addDash(fight({ movement: { B: mv(0) } }), 'B');
    expect(c.movement!.B).toEqual(mv(0, 1));
    expect(resetMovement(c, 'B').movement).toEqual({});
  });
});

describe('Dash limits', () => {
  test('addDash stops at MAX_DASHES (3)', () => {
    expect(MAX_DASHES).toBe(3);
    let c = fight();
    for (let i = 0; i < 5; i++) c = addDash(c, 'B');
    expect(c.movement!.B.dashes).toBe(3);
    expect(remainingFeet(30, c.movement!.B)).toBe(120);
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

test('reachableCells: the squares a token can reach with the feet left (the highlight), by the grid rule, inside the scene', () => {
  const g = { type: 'square', size: 70, feet: 5, offsetX: 0, offsetY: 0 } as Grid;
  expect(reachableCells(g, { x: 35, y: 35 }, 10, '5-5-5', 700, 700)).toHaveLength(9); // a corner: 3 × 3
  expect(reachableCells(g, { x: 35, y: 35 }, 10, '5-10-5', 700, 700)).toHaveLength(8); // the far diagonal costs 15 ft
  expect(reachableCells(g, { x: 35, y: 35 }, 0, '5-5-5', 700, 700)).toEqual([]);
  expect(reachableCells(g, { x: 350, y: 350 }, 5, '5-5-5', 700, 700)).toHaveLength(9);
});

// A monster moves by its stat block's fastest of walk and fly, with the spells it holds (Fly's 60 feet, Longstrider's +10 walk).
test('a monster\'s moving speed: its wings, a Fly spell, Longstrider', () => {
  const mon = (speed: object) => ({ speed }) as never;
  expect([monsterSpeed(mon({ walk: 30 }), []), monsterSpeed(mon({ walk: 40, fly: 80 }), []), monsterSpeed(mon({ walk: 30 }), ['Fly']), monsterSpeed(mon({ walk: 30 }), ['Longstrider'])]).toEqual([30, 80, 60, 40]);
  expect(moveSpeed({ walk: 30, fly: 60 })).toBe(60);
});

describe('routes', () => {
  const g70: Grid = { ...sq, size: 70 }, P = (q: number, r: number) => at(g70, q, r), o = P(0, 0);
  const adj = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) === 70;
  test('stepsBetween fills a jump of three squares with king steps', () => {
    const s = stepsBetween(g70, o, P(3, 1), 'M');
    expect(s).toHaveLength(3);
    expect(s[2]).toEqual(P(3, 1));
    expect([o, ...s].every((p, i, a) => i === 0 || adj(a[i - 1], p))).toBe(true);
    expect(stepsBetween(g70, o, o, 'M')).toEqual([]);
  });
  test('stepsBetween keeps a large token on its vertices, and walks hexes one neighbour at a time', () => {
    const s = stepsBetween(g70, snap(g70, { x: 70, y: 70 }, 'L'), snap(g70, { x: 280, y: 70 }, 'L'), 'L');
    expect(s.map((p) => p.x)).toEqual([140, 210, 280]);
    const hx: Grid = { ...g70, type: 'hex-pointy' };
    const h = stepsBetween(hx, cellCenter(hx, { q: 0, r: 0 }), cellCenter(hx, { q: 3, r: -1 }), 'M');
    expect(h).toHaveLength(3);
    expect(routeFeet(hx, cellCenter(hx, { q: 0, r: 0 }), h, '5-10-5').feet).toBe(15);
  });
  test('extendRoute cuts back when the pointer returns to an earlier square, and to nothing at the start', () => {
    const r1 = extendRoute(g70, o, [], P(1, 0), 'M'), r2 = extendRoute(g70, o, r1, P(2, 0), 'M'), r3 = extendRoute(g70, o, r2, P(2, 1), 'M');
    expect(r3).toEqual([P(1, 0), P(2, 0), P(2, 1)]);
    expect(extendRoute(g70, o, r3, P(2, 1), 'M')).toEqual(r3); // same square: unchanged
    expect(extendRoute(g70, o, r3, P(1, 0), 'M')).toEqual([P(1, 0)]);
    expect(extendRoute(g70, o, r3, P(0, 0), 'M')).toEqual([]);
    expect(extendRoute(g70, o, [], P(3, 1), 'M')).toHaveLength(3); // a skipped stretch is filled in
  });
  test('routeFeet 5-10-5 counts every second diagonal as 10, carrying diagonals from earlier this turn', () => {
    const two = [P(1, 1), P(2, 2)];
    expect(routeFeet(g70, o, two, '5-10-5')).toEqual({ feet: 15, diags: 2 });
    expect(routeFeet(g70, o, [P(1, 1)], '5-10-5', 1)).toEqual({ feet: 10, diags: 1 });
    expect(routeFeet(g70, o, two, '5-5-5').feet).toBe(10);
    expect(routeFeet(g70, o, [P(1, 0), P(2, 0), P(2, 1)], '5-10-5')).toEqual({ feet: 15, diags: 0 });
    expect(routeFeet(g70, o, [], '5-10-5')).toEqual({ feet: 0, diags: 0 });
  });
  test('affordable stops the route where the feet run out', () => {
    const line = [P(1, 0), P(2, 0), P(3, 0), P(4, 0)], diag = [P(1, 1), P(2, 2), P(3, 3)]; // 5, 10, 5
    expect(affordable(g70, o, line, 15, '5-10-5')).toEqual(line.slice(0, 3));
    expect(affordable(g70, o, line, 4, '5-10-5')).toEqual([]);
    expect(affordable(g70, o, line, 99, '5-10-5')).toEqual(line);
    expect(affordable(g70, o, diag, 10, '5-10-5')).toEqual(diag.slice(0, 1));
    expect(affordable(g70, o, diag, 15, '5-10-5')).toEqual(diag.slice(0, 2));
    expect(affordable(g70, o, diag, 10, '5-10-5', 1)).toEqual(diag.slice(0, 1)); // first costs 10 now, the next 5
    expect(affordable(g70, o, diag, 15, '5-10-5', 1)).toEqual(diag.slice(0, 2));
  });
  test('chargeRoute adds to used and keeps the first origin; usedFeet falls back to the origin distance for an old entry', () => {
    const c = fight({ round: 1 }), a = chargeRoute(c, 'B', o, { feet: 10, diags: 1 }), b = chargeRoute(a, 'B', P(5, 5), { feet: 15, diags: 2 });
    expect(a.movement!.B).toEqual({ from: o, dashes: 0, used: 10, diags: 1 });
    expect(b.movement!.B).toEqual({ from: o, dashes: 0, used: 25, diags: 3 });
    expect(usedFeet(b.movement!.B, P(0, 0), g70, '5-5-5')).toBe(25); // walking back refunds nothing
    expect(remainingFeet(30, b.movement!.B, P(0, 0), g70)).toBe(5);
    expect(usedFeet({ from: o, dashes: 0 }, P(4, 0), g70, '5-5-5')).toBe(20); // an old entry: origin distance
    expect(addDash(b, 'B').movement!.B).toMatchObject({ used: 25, diags: 3, dashes: 1 }); // entry() keeps them
    expect(chargeRoute(c, 'B', { x: NaN, y: 0 }, { feet: 5, diags: 0 }).movement?.B?.from).toBeUndefined();
  });
  test('reachableCells with diagonals already walked matches routeFeet', () => {
    const w = 700, key = (cs: { q: number; r: number }[]) => cs.map((c) => `${c.q},${c.r}`);
    const near = key(reachableCells(g70, P(5, 5), 10, '5-10-5', w, w, 1));
    expect(near).toContain('6,6'); // one diagonal: 10 ft
    expect(near).not.toContain('7,7'); // 10 + 5 = 15 ft
    expect(near).toContain('7,5');
    expect(key(reachableCells(g70, P(5, 5), 5, '5-10-5', w, w))).toContain('6,6'); // fresh: the first diagonal is 5
    expect(key(reachableCells(g70, P(5, 5), 5, '5-10-5', w, w, 1))).not.toContain('6,6'); // after one: 10
  });
});
