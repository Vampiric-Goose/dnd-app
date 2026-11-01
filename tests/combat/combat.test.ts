import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  addCombatants, addMonsters, concentrationDc, encounterPicks, lairCombatant, MAX_COMBATANTS, monsterCombatant, monsterHp, moveCombatant, moveTo, newCombat,
  next, numberedNames, prev, removeCombatant, setInit, sortCombat, sortCombatants, start,
} from '../../src/lib/combat/combat.ts';
import { encounterProblem } from '../../src/lib/recordShape.ts';
import type { Combat, Combatant, Encounter, MonsterDef, Pack } from '../../src/lib/types.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const dragon = srd.entities.find((e) => e.id === 'monster:adult-red-dragon@SRD') as MonsterDef;
const half = () => 0.5; // d20 → 11, 2d6 → 8
const seq = () => { let i = 0; return () => ((i++ * 0.137) % 1); };

const cb = (id: string, init: number | undefined, o: Partial<Combatant> = {}): Combatant =>
  ({ id, kind: 'monster', name: id, init, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (cs: Combatant[], o: Partial<Combat> = {}): Combat => ({ ...newCombat('c1'), combatants: cs, ...o });
const names = (c: Combat | Combatant[]) => ('combatants' in c ? c.combatants : c).map((x) => x.name);
const byId = (c: Combat, id: string) => c.combatants.find((x) => x.id === id)!;

test('order: init, then lair loses ties, then Dex, then the stored tiebreak; unrolled last', () => {
  const list = [cb('A', 15, { dex: 12 }), cb('B', 15, { dex: 14 }), cb('C', 20), lairCombatant(), cb('D', undefined)];
  const sorted = sortCombatants(list);
  expect(names(sorted)).toEqual(['C', 'Lair actions', 'B', 'A', 'D']);
  expect(names(sortCombatants([...list].reverse()))).toEqual(names(sorted));
  expect(names(sortCombatants([cb('E', 12, { dex: 12, tie: 0.3 }), cb('F', 12, { dex: 12, tie: 0.7 })]))).toEqual(['F', 'E']);
});

describe('monster builders', () => {
  test('goblin, average and rolled', () => {
    expect(monsterCombatant(goblin, 'Goblin', 'average', half)).toMatchObject({ hp: 7, maxHp: 7, init: 13, dex: 14, ac: 15, conSave: 0, kind: 'monster', monsterId: goblin.id });
    expect(monsterCombatant(goblin, 'Goblin', 'roll', half).hp).toBe(8);
  });
  test('dragon: legendary, printed Con save', () => {
    expect(monsterCombatant(dragon, 'Dragon', 'average', half)).toMatchObject({ legendary: { max: 3, used: 0 }, conSave: 13, hp: 256 });
  });
  test('a {special} HP monster leaves hp unset', () => {
    const odd: MonsterDef = { ...goblin, hp: { special: 'equal to the summoner' } };
    expect(monsterCombatant(odd, 'Odd', 'roll', half).hp).toBeUndefined();
  });
});

test('numberedNames', () => {
  expect(numberedNames('Goblin', 2, [])).toEqual(['Goblin 1', 'Goblin 2']);
  expect(numberedNames('Goblin', 1, [])).toEqual(['Goblin']);
  expect(numberedNames('Goblin', 2, ['Goblin 1', 'Goblin 2'])).toEqual(['Goblin 3', 'Goblin 4']);
  expect(numberedNames('Goblin', 1, ['Goblin'])).toEqual(['Goblin 2']);
  expect(numberedNames('Goblin', 1, ['Snaggle'])).toEqual(['Goblin']);
});

describe('grouping', () => {
  test('on: copies share one roll and tiebreak, and a later copy joins them', () => {
    let c = addMonsters({ ...newCombat('c1'), groupMonsters: true }, [{ monster: goblin, count: 3 }], 'average', seq());
    expect(new Set(c.combatants.map((x) => x.init)).size).toBe(1);
    expect(new Set(c.combatants.map((x) => x.tie)).size).toBe(1);
    expect(c.combatants.every((x) => x.group === 'monster:goblin@SRD')).toBe(true);
    c = addMonsters(c, [{ monster: goblin, count: 1 }], 'average', () => 0.99);
    expect(c.combatants).toHaveLength(4);
    expect(byId(c, c.combatants.find((x) => x.name === 'Goblin 4')!.id).init).toBe(c.combatants[0].init);
  });
  test('off: no group and distinct tiebreaks', () => {
    const c = addMonsters(newCombat('c1'), [{ monster: goblin, count: 3 }], 'average', seq());
    expect(c.combatants.every((x) => x.group === undefined)).toBe(true);
    expect(new Set(c.combatants.map((x) => x.tie)).size).toBe(3);
    expect(names(c).sort()).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3']);
  });
});

test('turns and rounds', () => {
  let c = start(fight([cb('A', 18), cb('B', 15), cb('C', 10)])).combat;
  expect([c.turn, c.round]).toEqual(['A', 1]);
  for (let i = 0; i < 3; i++) c = next(c).combat;
  expect([c.turn, c.round]).toEqual(['A', 2]);
  c = prev(c);
  expect([c.turn, c.round]).toEqual(['C', 1]);
  const first = start(fight([cb('A', 18), cb('B', 15)])).combat;
  expect(prev(first)).toEqual(first);
});

test('a grouped run is one turn', () => {
  const g = (id: string) => cb(id, 14, { group: 'monster:goblin@SRD', reactionUsed: true });
  let c = start(fight([g('g1'), g('g2'), g('g3'), cb('pc', 10, { kind: 'pc' })])).combat;
  expect(c.turn).toBe('g1');
  c = next(c).combat;
  expect(c.turn).toBe('pc');
  for (const id of ['g1', 'g2', 'g3']) byId(c, id).reactionUsed = true;
  c = next(c).combat;
  expect([c.turn, c.round]).toEqual(['g1', 2]);
  expect(['g1', 'g2', 'g3'].map((id) => byId(c, id).reactionUsed)).toEqual([false, false, false]);
});

test('start-of-turn resets', () => {
  const d = { ...monsterCombatant(dragon, 'Dragon', 'average', half), id: 'd', init: 10, legendary: { max: 3, used: 2 }, reactionUsed: true };
  let c = start(fight([cb('A', 18), d])).combat;
  expect(byId(c, 'd')).toMatchObject({ legendary: { used: 2 }, reactionUsed: true });
  c = next(c).combat;
  expect(c.turn).toBe('d');
  expect(byId(c, 'd')).toMatchObject({ legendary: { max: 3, used: 0 }, reactionUsed: false });
});

describe('durations', () => {
  test('ends at the end of the turn in progress', () => {
    let c = start(fight([cb('A', 18), cb('B', 15)])).combat;
    c = { ...c, combatants: c.combatants.map((x) => x.id === 'B' ? { ...x, conditions: ['Poisoned'], durations: { Poisoned: { rounds: 1, at: 'end', of: 'A' } } } : x) };
    const s = next(c);
    expect(s.expired).toEqual([{ combatantId: 'B', condition: 'Poisoned' }]);
    expect(byId(s.combat, 'B').conditions).not.toContain('Poisoned');
  });
  test('at the start of a turn, counted twice', () => {
    let c = start(fight([cb('A', 18), cb('B', 15, { conditions: ['Restrained'], durations: { Restrained: { rounds: 2, at: 'start', of: 'B' } } })])).combat;
    c = next(c).combat; // B's first turn starts
    expect(byId(c, 'B').conditions).toContain('Restrained');
    c = next(c).combat; // A
    const s = next(c); // B's next turn starts
    expect(s.expired).toEqual([{ combatantId: 'B', condition: 'Restrained' }]);
    expect(byId(s.combat, 'B').conditions).not.toContain('Restrained');
  });
  test("a PC's duration expiring is listed and dropped", () => {
    const c = start(fight([cb('pc', 18, { kind: 'pc', characterId: 'ch', durations: { Poisoned: { rounds: 1, at: 'end', of: 'pc' } } }), cb('B', 15)])).combat;
    const s = next(c);
    expect(s.expired).toEqual([{ combatantId: 'pc', condition: 'Poisoned' }]);
    expect(byId(s.combat, 'pc').durations?.Poisoned).toBeUndefined();
  });
});

describe('mid-fight changes', () => {
  const atB = () => { const c = start(fight([cb('A', 18), cb('B', 15), cb('C', 10)])).combat; return next(c).combat; };
  test('an added combatant waits for its place', () => {
    const c = addCombatants(atB(), [cb('X', 20)]);
    expect(names(c)).toEqual(['X', 'A', 'B', 'C']);
    expect(c.turn).toBe('B');
  });
  test('removing the current combatant passes the turn', () => {
    let c = addCombatants(atB(), [cb('X', 20)]);
    c = removeCombatant(c, 'B');
    expect([c.turn, c.round]).toEqual(['C', 1]);
    c = removeCombatant(c, 'C');
    expect([c.turn, c.round]).toEqual(['X', 2]);
  });
  test('removing the combatant a duration counts on leaves the condition untimed', () => {
    let c = atB();
    c = { ...c, combatants: c.combatants.map((x) => x.id === 'B' ? { ...x, conditions: ['Poisoned'], durations: { Poisoned: { rounds: 1, at: 'end', of: 'A' } } } : x) };
    c = removeCombatant(c, 'A');
    expect(byId(c, 'B').conditions).toEqual(['Poisoned']);
    expect(byId(c, 'B').durations?.Poisoned).toBeUndefined();
    for (let i = 0; i < 4; i++) {
      const s = next(c);
      expect(s.expired).toEqual([]);
      c = s.combat;
    }
    expect(byId(c, 'B').conditions).toEqual(['Poisoned']);
  });
});

test('moveTo', () => {
  const c = start(fight([cb('A', 18), cb('B', 15), cb('C', 10)])).combat;
  const moved = { ...c, combatants: moveTo(c.combatants, 'C', 0) };
  expect(names(moved)).toEqual(['C', 'A', 'B']);
  expect(moved.turn).toBe('A');
  expect(names(moveTo(c.combatants, 'A', 99))).toEqual(['B', 'C', 'A']);
  expect(names(moveTo(c.combatants, 'C', -5))).toEqual(['C', 'A', 'B']);
});

test('monsterHp', () => {
  const g = cb('g', 10, { hp: 7, maxHp: 7, tempHp: 3 });
  expect(monsterHp(g, { damage: 5 })).toMatchObject({ hp: 5, tempHp: 0 });
  const down = monsterHp(g, { damage: 20 });
  expect(down.hp).toBe(0);
  expect(monsterHp(down, { heal: 50 }).hp).toBe(7);
  expect(monsterHp(monsterHp(g, { temp: 4 }), { temp: 2 }).tempHp).toBe(2);
});

test('concentrationDc', () => {
  expect([1, 21, 22, 25, 100].map(concentrationDc)).toEqual([10, 10, 11, 12, 50]);
});

test('encounterPicks names the missing monsters', () => {
  const e: Encounter = { id: 'e', campaignId: 'c1', name: 'Ambush', monsters: [{ monsterId: goblin.id, count: 2 }, { monsterId: 'monster:gone@X', count: 1 }], updatedAt: 0 };
  const r = encounterPicks(e, (id) => (id === goblin.id ? goblin : undefined));
  expect(r.picks).toEqual([{ monster: goblin, count: 2 }]);
  expect(r.missing).toEqual(['monster:gone@X']);
});

test('MAX_COMBATANTS', () => {
  expect(addMonsters(newCombat('c1'), [{ monster: goblin, count: 250 }], 'average', half).combatants).toHaveLength(MAX_COMBATANTS);
});

describe('fix round 1', () => {
  test('I1: the current combatant whose init changes keeps its place, and the others still act this round', () => {
    let c = start(fight([cb('A', 18), cb('B', 15), cb('C', 10)])).combat;
    c = setInit(c, 'A', 5);
    expect(names(c)).toEqual(['A', 'B', 'C']);
    expect(byId(c, 'A').init).toBe(5);
    c = next(c).combat;
    expect([c.turn, c.round]).toEqual(['B', 1]);
    c = next(c).combat;
    expect([c.turn, c.round]).toEqual(['C', 1]);
  });
  test('I1: nobody crosses the current turn', () => {
    const atB = next(start(fight([cb('A', 18), cb('B', 15), cb('C', 10), cb('D', 8)])).combat).combat;
    expect(names(setInit(atB, 'C', 25))).toEqual(['A', 'B', 'C', 'D']); // still to act: stays after B
    expect(names(setInit(atB, 'D', 12))).toEqual(['A', 'B', 'D', 'C']); // still to act: sorted among them
    expect(names(setInit(atB, 'A', 1))).toEqual(['A', 'B', 'C', 'D']); // already acted: stays before B
  });
  test('I1: a late player roll still gets its turn this round', () => {
    let c = start(fight([cb('M1', 15), cb('M2', 10), cb('P', undefined, { kind: 'pc', characterId: 'p' })])).combat;
    expect(c.turn).toBe('M1');
    c = setInit(c, 'P', 18);
    expect(names(c)).toEqual(['M1', 'P', 'M2']);
    c = next(c).combat;
    expect([c.turn, c.round]).toEqual(['P', 1]);
  });
  test('M1: Previous then Next ticks a turn boundary once', () => {
    let c = start(fight([cb('A', 18), cb('B', 15, { conditions: ['Poisoned', 'Prone'], durations: {
      Poisoned: { rounds: 2, at: 'end', of: 'A' }, Prone: { rounds: 2, at: 'start', of: 'B' } } })])).combat;
    c = next(c).combat; // A's turn ends, B's starts: 1 left of each
    c = prev(c);
    const s = next(c);
    expect(s.expired).toEqual([]);
    expect(byId(s.combat, 'B').durations).toEqual({ Poisoned: { rounds: 1, at: 'end', of: 'A' }, Prone: { rounds: 1, at: 'start', of: 'B' } });
    c = next(next(s.combat).combat).combat; // B ends, A (round 2) ends, B starts
    expect(byId(c, 'B').conditions).toEqual([]);
  });
  test('M2: setInit refuses anything but an integer from -10 to 50', () => {
    const c = fight([cb('A', 10)]);
    for (const bad of [17.5, 51, -11, NaN, Infinity]) expect(setInit(c, 'A', bad)).toBe(c);
    expect(byId(setInit(c, 'A', 50), 'A').init).toBe(50);
    expect(byId(setInit(c, 'A', undefined), 'A').init).toBeUndefined();
  });
  test('M4: Start keeps a manual order made in setup, until the next Sort or add', () => {
    const base = fight([cb('A', 15, { tie: 0.9 }), cb('B', 15, { tie: 0.1 })]);
    const dragged = moveCombatant(base, 'B', 0);
    expect(names(start(dragged).combat)).toEqual(['B', 'A']);
    expect(names(start(sortCombat(dragged)).combat)).toEqual(['A', 'B']);
    expect(names(start(addCombatants(dragged, [cb('C', 3)])).combat)).toEqual(['A', 'B', 'C']);
  });
  test('M5: a missing encounter monster is named', () => {
    const e: Encounter = { id: 'e', campaignId: 'c1', name: 'Ambush', monsters: [{ monsterId: 'monster:homebrew-1a2b@HOMEBREW', name: 'Grue', count: 1 }], updatedAt: 0 };
    expect(encounterPicks(e, () => undefined).missing).toEqual(['Grue']);
    expect(encounterProblem(e)).toBeUndefined();
    expect(encounterProblem({ ...e, monsters: [{ monsterId: 'x', name: 5, count: 1 }] })).toBeDefined();
  });
});
