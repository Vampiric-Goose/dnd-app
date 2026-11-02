// Pure: what the spells a creature holds (conditions named after them, SPELL_EFFECTS) do to the numbers a fight reads, for a PC or a
// monster alike. A PC's sheet reads the same table for its own AC, HP, speed and resistances (rules/effects.ts); a fight adds the rest.
import { rollDice } from '../dice.ts';
import { SPELL_EFFECTS } from '../rules/constants.ts';
import type { Effect } from '../types.ts';

type Edge = Extract<Effect, { type: 'edge' }>;
type Dice = Extract<Effect, { type: 'rollDice' }>;
export interface SpellMods { /** a fly speed it gives (Fly) */ fly?: number; ac: number; acMin?: number; /** Mage Armor: base AC plus these abilities' modifiers, unarmored */ acBase?: { base: number; abilities: string[] }; resist: string[]; immune: string[]; speed: number;
  edges: (Omit<Edge, 'type'> & { from: string })[]; dice: (Omit<Dice, 'type'> & { from: string })[] }

export function spellMods(conditions: readonly string[]): SpellMods {
  const out: SpellMods = { ac: 0, resist: [], immune: [], speed: 0, edges: [], dice: [] };
  for (const from of conditions) for (const e of SPELL_EFFECTS[from] ?? []) {
    if (e.type === 'bonus' && e.target === 'ac' && typeof e.value === 'number') out.ac += e.value;
    else if (e.type === 'acMin') out.acMin = Math.max(out.acMin ?? 0, e.value);
    else if (e.type === 'acBase') out.acBase = { base: e.base, abilities: e.abilities };
    else if (e.type === 'damage') (e.kind === 'immunity' ? out.immune : out.resist).push(e.damageType);
    else if (e.type === 'speed' && e.mode === 'walk' && typeof e.value === 'number') out.speed += e.value;
    else if (e.type === 'speed' && e.mode === 'fly' && typeof e.value === 'number') out.fly = Math.max(out.fly ?? 0, e.value);
    else if (e.type === 'edge') out.edges.push({ on: e.on, mode: e.mode, from });
    else if (e.type === 'rollDice') out.dice.push({ on: e.on, dice: e.dice, from });
  }
  return out;
}

/** The dice a roll of kind `on` gets from these spells, rolled with `rng`: their total and a note ("Bless +3, Bane −2"). */
export function rollSpellDice(m: SpellMods, on: Dice['on'], rng: () => number): { total: number; note?: string } {
  const parts = m.dice.filter((d) => d.on === on).map((d) => {
    const n = rollDice(d.dice.replace(/^-/, ''), { rng }).total * (d.dice.startsWith('-') ? -1 : 1);
    return { n, note: `${d.from} ${n >= 0 ? '+' : '−'}${Math.abs(n)}` };
  });
  return { total: parts.reduce((t, p) => t + p.n, 0), ...(parts.length && { note: parts.map((p) => p.note).join(', ') }) };
}

/** Advantage or disadvantage the spells give on that kind of roll, with why ("target has Faerie Fire"). */
export const spellEdges = (m: SpellMods, on: Edge['on'], who: 'you have' | 'target has') =>
  m.edges.filter((e) => e.on === on).map((e) => ({ mode: e.mode, why: `${who} ${e.from}` }));
