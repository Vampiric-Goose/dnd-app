import type { Size } from '../types.ts';
import { abilityMod } from './constants.ts';

export const CR_LADDER: readonly string[] = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];

const XP = [10, 25, 50, 100, 200, 450, 700, 1100, 1800, 2300, 2900, 3900, 5000, 5900, 7200, 8400, 10000, 11500, 13000, 15000, 18000, 20000, 22000, 25000, 33000, 41000, 50000, 62000, 75000, 90000, 105000, 120000, 135000, 155000];

const pick = (n: number, steps: [number, number][]) => steps.find(([upTo]) => n <= upTo)![1]; // first step whose upper CR bound holds n

/** DMG chapter 9 "Monster Statistics by Challenge Rating"; HP and DPR are the upper bounds of each band. */
const TABLE = CR_LADDER.map((cr, i) => {
  const n = i < 4 ? [0, 0.125, 0.25, 0.5][i] : i - 3;
  const hpMax = i < 4 ? [6, 35, 49, 70][i] : n <= 19 ? 85 + 15 * (n - 1) : 400 + 45 * (n - 20);
  const dprMax = i < 4 ? [1, 3, 5, 8][i] : n === 1 ? 14 : n <= 19 ? 20 + 6 * (n - 2) : 140 + 18 * (n - 20);
  return {
    cr, hpMax, dprMax, xp: XP[i], prof: n < 1 ? 2 : 2 + Math.floor((n - 1) / 4),
    ac: pick(n, [[3, 13], [4, 14], [7, 15], [9, 16], [12, 17], [16, 18], [30, 19]]),
    attack: pick(n, [[2, 3], [3, 4], [4, 5], [7, 6], [10, 7], [15, 8], [16, 9], [20, 10], [23, 11], [26, 12], [29, 13], [30, 14]]),
    dc: pick(n, [[3, 13], [4, 14], [7, 15], [10, 16], [12, 17], [16, 18], [20, 19], [23, 20], [26, 21], [29, 22], [30, 23]]),
  };
});

const row = (cr: string) => TABLE[CR_LADDER.indexOf(cr)];

export function crValue(cr: string): number | undefined {
  if (!CR_LADDER.includes(cr)) return undefined;
  const [a, b] = cr.split('/');
  return b ? +a / +b : +a;
}
export const crXp = (cr: string): number | undefined => row(cr)?.xp;
export const crProf = (cr: string): number | undefined => row(cr)?.prof;

/** '2d6+2' → 9 (averages round down, as in the Monster Manual); accepts U+2212 and U+2013 minus signs. */
export function hpAverage(formula: string): number | undefined {
  const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+\-−–])\s*(\d+))?\s*$/.exec(formula);
  if (!m) return undefined;
  const mod = m[3] ? (m[3] === '+' ? +m[4] : -m[4]) : 0;
  return Math.floor((+m[1] * (+m[2] + 1)) / 2) + mod;
}

const HIT_DIE: Record<Size, number> = { T: 4, S: 6, M: 8, L: 10, H: 12, G: 20 };
export const hitDieFor = (size: Size): number => HIT_DIE[size];

export function hpFormula(count: number, size: Size, con: number): string {
  const bonus = count * abilityMod(con);
  return `${count}d${HIT_DIE[size]}${bonus > 0 ? ` + ${bonus}` : bonus < 0 ? ` - ${-bonus}` : ''}`;
}

/** DMG "Creating a monster": CR from defensive and offensive halves, each adjusted one step per 2 points off the row. */
export function suggestCr(input: { hp: number; ac: number; dpr: number; attack?: number; dc?: number }): { cr: string; defensive: string; offensive: string } {
  const fin = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0); // a blank field counts as 0, so it never suggests CR 30
  const x = { hp: fin(input.hp), ac: fin(input.ac), dpr: fin(input.dpr), attack: input.attack === undefined ? undefined : fin(input.attack), dc: input.dc === undefined ? undefined : fin(input.dc) };
  const last = CR_LADDER.length - 1;
  const clamp = (n: number) => Math.min(last, Math.max(0, n));
  const band = (k: 'hpMax' | 'dprMax', v: number) => { const i = TABLE.findIndex((r) => v <= r[k]); return i < 0 ? last : i; };
  const steps = (diff: number) => Math.trunc(diff / 2);
  const d = band('hpMax', x.hp);
  const o = band('dprMax', x.dpr);
  const def = clamp(d + steps(x.ac - TABLE[d].ac));
  const off = clamp(o + steps(x.attack !== undefined ? x.attack - TABLE[o].attack : x.dc !== undefined ? x.dc - TABLE[o].dc : 0));
  return { cr: CR_LADDER[Math.floor((def + off) / 2 + 0.5)], defensive: CR_LADDER[def], offensive: CR_LADDER[off] };
}
