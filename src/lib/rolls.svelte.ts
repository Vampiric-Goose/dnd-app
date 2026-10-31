import { rollDice } from './dice.ts';
import { uid } from './uid.ts';

export interface RollEntry { id: string; label: string; expr: string; total: number; detail: string; at: number; public: boolean }

const CAP = 200;

/** Most recent first, capped at 200. */
export const rollLog: RollEntry[] = $state([]);
/** The next roll's advantage state; roll() resets it to 'normal'. */
export const rollMode: { value: 'normal' | 'adv' | 'dis' } = $state({ value: 'normal' });
/** Stored on each entry for stage 3 (shared logs); the tray's toggle writes it. */
export const rollVisibility: { public: boolean } = $state({ public: true });

/** Rolls with the tray's current mode, logs it, and resets the mode. Throws the parser's message on bad input. */
export function roll(label: string, expr: string, opts: { crit?: boolean } = {}): RollEntry {
  const advantage = rollMode.value === 'normal' ? undefined : rollMode.value;
  const { total, detail } = rollDice(expr, { advantage, crit: opts.crit });
  const entry: RollEntry = { id: uid(), label, expr, total, detail, at: Date.now(), public: rollVisibility.public };
  rollLog.unshift(entry);
  if (rollLog.length > CAP) rollLog.length = CAP;
  rollMode.value = 'normal';
  return entry;
}

/** 'nat20' / 'nat1' when the roll's kept d20 shows that face. Reads the first d20 term of `detail` (as rollDice formats it). */
export function natD20(detail: string): 'nat20' | 'nat1' | undefined {
  const m = /(\d+)d20(?:(kh|kl)(\d+))? \(([\d, ]+)\)/.exec(detail);
  if (!m) return undefined;
  const rolls = m[4].split(',').map(Number);
  const kept = m[2] ? [...rolls].sort((a, b) => (m[2] === 'kh' ? b - a : a - b)).slice(0, Number(m[3])) : rolls;
  if (kept.length !== 1) return undefined; // ponytail: a bare 2d20 sum is not an attack roll; no highlight
  return kept[0] === 20 ? 'nat20' : kept[0] === 1 ? 'nat1' : undefined;
}
