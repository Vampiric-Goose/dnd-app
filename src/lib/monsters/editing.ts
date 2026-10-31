import { richToPlain } from '../content/richtext.ts';
import { hpAverage } from '../rules/monsters.ts';
import type { MonsterDef, RichText, StoredMonster } from '../types.ts';
import { duplicateMonster } from './homebrew.ts';

// Pure (no Svelte/Vite/DOM): the monster creator's helpers.

// Raw 5etools text keeps its tags ('{@damage 2d6 + 3}', '{@hit 5}', '{@dc 13}'); imported and SRD text reads '10 (2d6 + 3)', '+5 to hit', 'DC 13'.
const plain = (r: RichText) => richToPlain(r);
const DAMAGE = /\{@damage ([^}|]+)[^}]*\}|(\d+) \(\s*\d*d\d+[^)]*\)/g;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** The average damage of one use: the first amount, plus each one joined to it by "plus" (an "or …" alternative doesn't add). */
function actionDamage(s: string): number {
  let total = 0, last = -1;
  for (const m of s.matchAll(DAMAGE)) {
    const v = m[1] !== undefined ? hpAverage(m[1]) ?? 0 : +m[2];
    if (last < 0 || /\bplus\b/i.test(s.slice(last, m.index))) total += v;
    last = m.index + m[0].length;
  }
  return total;
}

/** "makes two attacks", "makes 3 melee attacks" in a Multiattack entry → N (1 when there is none). */
function attacksPerTurn(m: MonsterDef): number {
  for (const t of [...m.actions, ...m.traits]) {
    if (!/multiattack/i.test(t.name)) continue;
    const n = /makes (\w+) (?:\w+ )?attacks/i.exec(plain(t.text))?.[1]?.toLowerCase();
    if (n) return WORDS[n] ?? (Number(n) || 1);
  }
  return 1;
}

/**
 * Best-effort damage per round: the highest-average action, ×N when a Multiattack entry says "makes N attacks". An action that
 * calls for a saving throw (a breath weapon) is not multiplied. ponytail: no recharge averaging over three rounds as the DMG suggests.
 */
export function estimateDpr(m: MonsterDef): number {
  const n = attacksPerTurn(m);
  let best = 0;
  for (const t of m.actions) {
    const s = plain(t.text);
    best = Math.max(best, actionDamage(s) * (/saving throw/i.test(s) ? 1 : n));
  }
  return best;
}

/** The highest attack bonus ('+N to hit') and save DC ('DC N') among the actions. */
export function estimateAttack(m: MonsterDef): { attack?: number; dc?: number } {
  const out: { attack?: number; dc?: number } = {};
  for (const t of m.actions) {
    const s = plain(t.text);
    for (const x of s.matchAll(/([+\-−]\d+) to hit|\{@hit ([+-]?\d+)\}/g)) out.attack = Math.max(out.attack ?? -Infinity, Number((x[1] ?? x[2]).replace('−', '-')));
    for (const x of s.matchAll(/\bDC (\d+)|\{@dc (\d+)\}/g)) out.dc = Math.max(out.dc ?? -Infinity, Number(x[1] ?? x[2]));
  }
  return out;
}

/** A comma list as typed: entries that hold commas themselves ("… from nonmagical attacks") are separated by semicolons. */
export const joinList = (xs: readonly string[]): string => xs.join(xs.some((x) => x.includes(',')) ? '; ' : ', ');
export const splitList = (s: string): string[] => s.split(s.includes(';') ? ';' : ',').map((x) => x.trim()).filter(Boolean);

/**
 * An imported monster file as one of this campaign's own monsters. It keeps its id only when that is a homebrew id and is free
 * or already this campaign's (then `clash` asks Replace / Keep both); an SRD or pack id, or another campaign's monster, gets a
 * new id so two library rows never share one.
 */
export function rehome(m: StoredMonster, campaignId: string, existing: StoredMonster | undefined): { monster: StoredMonster; clash: boolean } {
  if (!m.id.endsWith('@HOMEBREW') || (existing && existing.campaignId !== campaignId)) return { monster: duplicateMonster(m, campaignId), clash: false };
  return { monster: { ...m, source: 'HOMEBREW', campaignId, updatedAt: Date.now() }, clash: !!existing };
}
