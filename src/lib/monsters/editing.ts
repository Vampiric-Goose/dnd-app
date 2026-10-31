import { richToPlain } from '../content/richtext.ts';
import { hpAverage } from '../rules/monsters.ts';
import type { MonsterDef, RichText, StoredMonster } from '../types.ts';
import { duplicateMonster } from './homebrew.ts';

// Pure (no Svelte/Vite/DOM): the monster creator's helpers.

// Raw 5etools text keeps its tags ('{@damage 2d6 + 3}', '{@hit 5}', '{@dc 13}'); imported and SRD text reads '10 (2d6 + 3)', '+5 to hit', 'DC 13'.
const plain = (r: RichText) => richToPlain(r);
const DAMAGE = /\{@damage ([^}|]+)[^}]*\}|(\d+) \(\s*\d*d\d+[^)]*\)/g;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const count = (w: string): number => WORDS[w.toLowerCase()] ?? (Number(w) || 0);
const attackRoll = (s: string) => /to hit|\{@hit/i.test(s);

/**
 * The average damage of one use: the first amount, plus each one joined to it by "plus", or by "taking" (save damage riding on a
 * hit: the DMG assumes the save fails). An "or …" alternative (versatile two-handed damage) ends the count. Printed averages are
 * used as printed; `{@damage XdY}` tags by their dice average.
 */
function actionDamage(s: string): number {
  let total = 0, last = -1;
  for (const m of s.matchAll(DAMAGE)) {
    const between = last < 0 ? '' : s.slice(last, m.index);
    if (/\bor\b/i.test(between)) break;
    if (last < 0 || /\b(plus|taking)\b/i.test(between)) total += m[1] !== undefined ? hpAverage(m[1]) ?? 0 : +m[2];
    last = m.index + m[0].length;
  }
  return total;
}

const key = (name: string) => name.replace(/\s*\(.*$/, '').trim().toLowerCase().replace(/s$/, ''); // 'Claws (Recharge 5–6)' → 'claw'

/**
 * A Multiattack entry's damage: "makes three attacks: one with its bite and two with its claws" sums the named actions with their
 * counts; "makes two melee weapon attacks" (or a list naming an action it can't find) is N × the best attack-roll action.
 */
function multiattack(m: MonsterDef, damage: Map<string, number>, bestAttack: number): number {
  for (const t of [...m.actions, ...m.traits]) {
    if (!/multiattack/i.test(t.name)) continue;
    const s = plain(t.text);
    const head = /makes (\w+) (?:[\w-]+ ){0,2}attacks(:[^.]*)?/i.exec(s);
    if (!head) continue;
    const named = [...(head[2] ?? '').matchAll(/\b(\w+) with its ([\w' -]+?)(?=,| and |$)/gi)];
    if (named.length && named.every((x) => count(x[1]) && damage.has(key(x[2])))) return named.reduce((sum, x) => sum + count(x[1]) * damage.get(key(x[2]))!, 0);
    return count(head[1]) * bestAttack;
  }
  return 0;
}

/**
 * Best-effort damage per round (for the CR suggestion): the better of the Multiattack total and the strongest single action
 * (a breath weapon). ponytail: no recharge averaging over three rounds as the DMG suggests.
 */
export function estimateDpr(m: MonsterDef): number {
  const damage = new Map<string, number>();
  let best = 0, bestAttack = 0, bestNoSave = 0;
  for (const t of m.actions) {
    const s = plain(t.text), d = actionDamage(s);
    damage.set(key(t.name), Math.max(d, damage.get(key(t.name)) ?? 0));
    best = Math.max(best, d);
    if (attackRoll(s)) bestAttack = Math.max(bestAttack, d);
    if (!/saving throw/i.test(s)) bestNoSave = Math.max(bestNoSave, d); // hand-typed attacks may lack "to hit"
  }
  return Math.max(best, multiattack(m, damage, bestAttack || bestNoSave));
}

/** HP as the editor saves it. `fixed`: an average with no formula (as some books print it) is kept exactly as typed. */
export type HpMode = 'dice' | 'fixed' | 'special';
export const hpModeFor = (hp: MonsterDef['hp']): HpMode => ('special' in hp ? 'special' : hp.formula ? 'dice' : 'fixed');
export function assembleHp(mode: HpMode, v: { formula: string; fixed: string; special: string }): MonsterDef['hp'] {
  if (mode === 'special') return { special: v.special.trim() };
  if (mode === 'fixed') return { average: Number(v.fixed) };
  return { average: hpAverage(v.formula) ?? 0, formula: v.formula };
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
