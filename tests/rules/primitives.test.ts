import { expect, test } from 'vitest';
import { abilityMod, averageHp, FULL_CASTER_SLOTS, PACT_TABLE, profBonus } from '../../src/lib/rules/constants.ts';
import { isStandardArray, pointBuyCost, roll4d6DropLowest } from '../../src/lib/rules/abilities.ts';
import { evalFormula } from '../../src/lib/rules/formula.ts';
import type { FormulaContext } from '../../src/lib/rules/formula.ts';
import { maxSpellLevel, multiclassSlots, pactSlots, singleClassSlots } from '../../src/lib/rules/spellcasting.ts';
import { meetsMulticlassPrereq } from '../../src/lib/rules/multiclass.ts';
import type { Scores } from '../../src/lib/types.ts';

const seq = (...dice: number[]) => { let i = 0; return () => (dice[i++] - 1) / 6 + 0.01; }; // d6 helper

test('basics', () => {
  expect([1, 4, 5, 9, 13, 17, 20].map(profBonus)).toEqual([2, 2, 3, 4, 5, 6, 6]);
  expect([1, 8, 10, 15, 20, 30].map(abilityMod)).toEqual([-5, -1, 0, 2, 5, 10]);
  expect([6, 8, 10, 12].map(averageHp)).toEqual([4, 5, 6, 7]);
  expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
  expect(pointBuyCost({ str: 14, dex: 14, con: 14, int: 12, wis: 10, cha: 8 })).toBe(27);
  expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBeNull();
  expect(isStandardArray({ str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 })).toBe(true);
  expect(isStandardArray({ str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 })).toBe(false);
  expect(roll4d6DropLowest(seq(6, 1, 4, 5))).toBe(15);
});

test('formula', () => {
  const ctx = (o: Partial<FormulaContext> = {}) => ({ level: 5, totalLevel: 5, prof: 3, mods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 2 }, ...o });
  expect(evalFormula('level+mod:int', ctx())).toBe(8);
  expect(evalFormula('level/2+mod:cha', ctx())).toBe(4);
  expect(evalFormula('max(1,mod:cha)', ctx({ mods: { ...ctx().mods, cha: -1 } }))).toBe(1);
  expect(evalFormula('5*level', ctx({ level: 3 }))).toBe(15);
  expect(evalFormula('prof*2', ctx())).toBe(6);
  expect(evalFormula('col[Ki Points]', ctx({ col: () => 4 }))).toBe(4);
  expect(evalFormula('col[Unarmored Movement]', ctx({ col: () => '+10 ft.' }))).toBe(10);
  expect(evalFormula('col[Rages]', ctx({ col: () => 'Unlimited' }))).toBe(Infinity);
  expect(() => evalFormula('level+', ctx())).toThrow('Bad formula: level+');
});

test('formula edge cases', () => {
  const ctx = (o: Partial<FormulaContext> = {}): FormulaContext => ({ level: 5, totalLevel: 7, prof: 3, mods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: -2 }, ...o });
  expect(evalFormula('-mod:cha', ctx())).toBe(2);
  expect(evalFormula('--3', ctx())).toBe(3);
  expect(evalFormula('(level+1)*2', ctx())).toBe(12);
  expect(evalFormula('1+2*3-4', ctx())).toBe(3);
  expect(evalFormula('10-3-2', ctx())).toBe(5);
  expect(evalFormula('totalLevel/2', ctx())).toBe(3);
  expect(evalFormula('-7/2', ctx())).toBe(-4); // floor division
  expect(evalFormula('mod:cha/2', ctx())).toBe(-1);
  expect(evalFormula('min(level, max(2, mod:int))', ctx())).toBe(3);
  expect(evalFormula(' level + 1 ', ctx())).toBe(6);
  expect(evalFormula('col[Rages]+1', ctx({ col: () => 'Unlimited' }))).toBe(Infinity);
  expect(evalFormula('col[Sneak Attack]', ctx({ col: () => '3d6' }))).toBe(3);
  expect(evalFormula('col[Cantrips Known]*2', ctx({ col: (l) => (l === 'Cantrips Known' ? 4 : undefined) }))).toBe(8);
  expect(() => evalFormula('col[X]', ctx())).toThrow('Bad formula: col[X]'); // no col provider
  expect(() => evalFormula('col[X]', ctx({ col: () => undefined }))).toThrow('Bad formula: col[X]');
  expect(() => evalFormula('col[X]', ctx({ col: () => 'none' }))).toThrow('Bad formula: col[X]'); // no integer in string
  for (const bad of ['', '1/0', 'foo', 'mod:xyz', '(1+2', '1+2)', 'max(1)', 'max(1,2,3)', '1 2', 'level +* 2', 'col[Open', '3 $ 4'])
    expect(() => evalFormula(bad, ctx()), bad).toThrow('Bad formula: ' + bad);
});

test('slots', () => {
  expect(singleClassSlots('full', 1)).toEqual([2]);
  expect(singleClassSlots('full', 5)).toEqual([4, 3, 2]);
  expect(singleClassSlots('full', 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  expect([singleClassSlots('half', 1), singleClassSlots('half', 2), singleClassSlots('half', 5)]).toEqual([[], [2], [4, 2]]);
  expect([singleClassSlots('third', 2), singleClassSlots('third', 3), singleClassSlots('third', 7), singleClassSlots('third', 19)]).toEqual([[], [2], [4, 2], [4, 3, 3, 1]]);
  expect([singleClassSlots('artificer', 1), singleClassSlots('artificer', 3)]).toEqual([[2], [3]]);
  expect(multiclassSlots([{ progression: 'full', level: 3 }, { progression: 'full', level: 2 }])).toEqual([4, 3, 2]);
  expect(multiclassSlots([{ progression: 'half', level: 5 }, { progression: 'full', level: 3 }])).toEqual([4, 3, 2]);
  expect(multiclassSlots([{ progression: 'third', level: 4 }, { progression: 'half', level: 3 }])).toEqual([3]);
  expect(multiclassSlots([{ progression: 'artificer', level: 3 }, { progression: 'full', level: 1 }])).toEqual([4, 2]);
  expect(multiclassSlots([{ progression: 'pact', level: 5 }, { progression: 'full', level: 3 }])).toEqual([4, 2]);
  expect(multiclassSlots([{ progression: 'half', level: 1 }, { progression: 'full', level: 3 }])).toEqual([4, 2]);
  expect([1, 2, 3, 5, 9, 11, 17].map(pactSlots)).toEqual([{ slots: 1, level: 1 }, { slots: 2, level: 1 }, { slots: 2, level: 2 }, { slots: 2, level: 3 }, { slots: 2, level: 5 }, { slots: 3, level: 5 }, { slots: 4, level: 5 }]);
  expect(pactSlots(0)).toBeUndefined();
  expect([maxSpellLevel('full', 1), maxSpellLevel('full', 3), maxSpellLevel('full', 17), maxSpellLevel('half', 1), maxSpellLevel('half', 5), maxSpellLevel('third', 7), maxSpellLevel('pact', 5), maxSpellLevel('pact', 11)])
    .toEqual([1, 2, 9, 0, 2, 2, 3, 5]);
});

test('slot tables are the PHB tables', () => {
  expect(FULL_CASTER_SLOTS).toHaveLength(20);
  // PHB p.165 Multiclass Spellcaster table: slots per spell level 1-9, by caster level.
  const phb: Record<number, string> = {
    1: '2', 2: '3', 3: '4 2', 4: '4 3', 5: '4 3 2', 6: '4 3 3', 7: '4 3 3 1', 8: '4 3 3 2', 9: '4 3 3 3 1', 10: '4 3 3 3 2',
    11: '4 3 3 3 2 1', 12: '4 3 3 3 2 1', 13: '4 3 3 3 2 1 1', 14: '4 3 3 3 2 1 1', 15: '4 3 3 3 2 1 1 1', 16: '4 3 3 3 2 1 1 1',
    17: '4 3 3 3 2 1 1 1 1', 18: '4 3 3 3 3 1 1 1 1', 19: '4 3 3 3 3 2 1 1 1', 20: '4 3 3 3 3 2 2 1 1',
  };
  for (let l = 1; l <= 20; l++) expect(FULL_CASTER_SLOTS[l - 1].join(' '), `caster level ${l}`).toBe(phb[l]);
  // PHB Warlock Pact Magic: [slots, slot level] by warlock level.
  const pact = [[1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];
  expect(PACT_TABLE.map((r) => [r.slots, r.level])).toEqual(pact);
});

test('multiclass prereq', () => {
  const s = (o: Partial<Scores>) => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...o });
  expect(meetsMulticlassPrereq({ any: { str: 13, dex: 13 } }, s({ str: 12, dex: 13 }))).toBe(true);
  expect(meetsMulticlassPrereq({ all: { str: 13, cha: 13 } }, s({ str: 13, cha: 12 }))).toBe(false);
  expect(meetsMulticlassPrereq(undefined, s({}))).toBe(true);
});
