import { fold } from '../content/ids.ts';
import { crValue } from '../rules/monsters.ts';
import type { MonsterDef, Size } from '../types.ts';

// Pure (no Svelte/Vite/DOM): the monster library's filters and the stat block's text helpers.

export interface MonsterFilter { q: string; cr?: [min: number, max: number]; type?: string; size?: Size; source?: string }

/** First word of `type`, lower case: 'humanoid (goblinoid)' → 'humanoid', 'swarm of Tiny beasts' → 'swarm'. */
export const monsterType = (m: Pick<MonsterDef, 'type'>): string => (/^[\p{L}-]+/u.exec(m.type.trim())?.[0] ?? '').toLowerCase();

const folded = new WeakMap<MonsterDef, string>(); // folding thousands of names per keystroke is slow; once per monster

const nameKey = (m: MonsterDef) => {
  let n = folded.get(m);
  if (n === undefined) folded.set(m, n = fold(m.name));
  return n;
};

/** The monsters that pass every filter, sorted by name (then source). `q` matches the case- and accent-folded name. */
export function filterMonsters(all: MonsterDef[], f: MonsterFilter): MonsterDef[] {
  const q = fold(f.q.trim());
  const out = all.filter((m) => {
    if (q && !nameKey(m).includes(q)) return false;
    if (f.source && m.source !== f.source) return false;
    if (f.size && !m.size.includes(f.size)) return false;
    if (f.type && monsterType(m) !== f.type) return false;
    if (f.cr) {
      const v = crValue(m.cr);
      if (v === undefined || v < f.cr[0] || v > f.cr[1]) return false;
    }
    return true;
  });
  return out.sort((a, b) => { const x = nameKey(a), y = nameKey(b); return x < y ? -1 : x > y ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0; });
}

export const SIZE_NAMES: Record<Size, string> = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' };

/** The book's default legendary-actions paragraph, used when the monster has no intro of its own. */
export function legendaryIntro(m: Pick<MonsterDef, 'name' | 'legendaryCount'>): string {
  const n = m.legendaryCount ?? 3;
  const who = `The ${m.name.toLowerCase()}`; // ponytail: always "the <name>", even for named NPCs; their imported intro covers those
  return `${who} can take ${n} legendary action${n === 1 ? '' : 's'}, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. ${who} regains spent legendary actions at the start of its turn.`;
}

/** A rollable piece of stat-block text: `expr` is what goes to the dice tray. */
export type Part = { t: string } | { t: string; expr: string; hit: boolean };

const ROLL = /([+\-−–]\d+)(?= to hit)|\b(\d*d\d+(?:\s*[+\-−–]\s*\d+)?)\b/g;
const minus = (s: string) => s.replace(/[−–]/g, '-');

/** Splits text so attack bonuses ('+4 to hit') and dice ('1d6 + 2') can be buttons; the rest stays as text. */
export function rollParts(s: string): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const m of s.matchAll(ROLL)) {
    if (m.index > at) out.push({ t: s.slice(at, m.index) });
    out.push(m[1] ? { t: m[1], expr: `1d20${minus(m[1])}`, hit: true } : { t: m[2], expr: minus(m[2]).replace(/\s+/g, ''), hit: false });
    at = m.index + m[0].length;
  }
  if (at < s.length) out.push({ t: s.slice(at) });
  return out;
}

// 'At will', 'Cantrips (at will)', '3/day each', '1st level (4 slots)', '1st–3rd level (…)', 'Constant', 'Rituals'.
const SPELL_LINE = /^((?:cantrips|at will|constant|rituals|\d+\/\w+|\d+(?:st|nd|rd|th)\b)[^:]{0,60}):\s*(\S.*)$/i;

/** A spellcasting group line → its label and the spell names, for the book's layout (label, then the spells in italics). */
export function spellLine(s: string): { label: string; spells: string } | undefined {
  const m = SPELL_LINE.exec(s.trim());
  return m ? { label: m[1], spells: m[2] } : undefined;
}
