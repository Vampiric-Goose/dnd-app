import { expect, test } from 'vitest';
import { CR_LADDER, crProf, crValue, crXp, hitDieFor, hpAverage, hpFormula, suggestCr } from '../../src/lib/rules/monsters.ts';

test('CR ladder and crValue', () => {
  expect(CR_LADDER).toHaveLength(34);
  expect(CR_LADDER.slice(0, 6)).toEqual(['0', '1/8', '1/4', '1/2', '1', '2']);
  expect(crValue('1/4')).toBe(0.25);
  expect(crValue('17')).toBe(17);
  expect(crValue('—')).toBeUndefined();
  expect(crValue('junk')).toBeUndefined();
});

test('crXp', () => {
  const want: Record<string, number> = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '5': 1800, '10': 5900, '20': 25000, '30': 155000 };
  for (const [cr, xp] of Object.entries(want)) expect(crXp(cr), cr).toBe(xp);
  expect(crXp('—')).toBeUndefined();
});

test('crProf', () => {
  const want: Record<string, number> = { '1/4': 2, '4': 2, '5': 3, '9': 4, '13': 5, '17': 6, '21': 7, '25': 8, '29': 9 };
  for (const [cr, p] of Object.entries(want)) expect(crProf(cr), cr).toBe(p);
});

test('hpAverage', () => {
  expect(hpAverage('2d6')).toBe(7);
  expect(hpAverage('2d6+2')).toBe(9);
  expect(hpAverage('10d10 - 10')).toBe(45);
  expect(hpAverage('1d4−1')).toBe(1);
  expect(hpAverage('abc')).toBeUndefined();
});

test('hpFormula and hitDieFor', () => {
  expect(hpFormula(5, 'M', 14)).toBe('5d8 + 10');
  expect(hpFormula(3, 'S', 8)).toBe('3d6 - 3');
  expect(hpFormula(2, 'T', 10)).toBe('2d4');
  expect(['T', 'S', 'M', 'L', 'H', 'G'].map((s) => hitDieFor(s as 'T'))).toEqual([4, 6, 8, 10, 12, 20]);
});

test('suggestCr', () => {
  expect(suggestCr({ hp: 85, ac: 13, dpr: 14, attack: 3 })).toEqual({ cr: '1', defensive: '1', offensive: '1' });
  const hi = suggestCr({ hp: 85, ac: 17, dpr: 14, attack: 3 });
  expect([hi.defensive, hi.cr]).toEqual(['3', '2']);
  expect(suggestCr({ hp: 150, ac: 15, dpr: 40, dc: 15 })).toEqual({ cr: '6', defensive: '6', offensive: '6' });
  expect(suggestCr({ hp: 3, ac: 10, dpr: 0, attack: 0 }).cr).toBe('0');
});

test('suggestCr table endpoints: CR 19 and CR 30 bands, and beyond the ladder', () => {
  expect(suggestCr({ hp: 355, ac: 18, dpr: 122, attack: 10 }).defensive).toBe('19');
  expect(suggestCr({ hp: 400, ac: 19, dpr: 140, attack: 10 }).defensive).toBe('20');
  expect(suggestCr({ hp: 850, ac: 19, dpr: 320, attack: 14 }).cr).toBe('30');
  expect(suggestCr({ hp: 5000, ac: 30, dpr: 900, attack: 20 }).cr).toBe('30');
});
