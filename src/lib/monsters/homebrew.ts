import { is2024 } from '../character/strip2024.ts';
import { isRichText } from '../content/richtext.ts';
import { traitOk } from '../items/homebrew.ts';
import { isRec } from '../recordShape.ts';
import { ABILITIES, SKILL_ABILITY } from '../rules/constants.ts';
import type { MonsterDef, StoredMonster } from '../types.ts';
import { uid } from '../uid.ts';

// Pure (no Svelte/Vite/DOM): how the DM's own monsters are made. Mirrors items/homebrew.ts.

const NO_2024 = 'This monster is from the 2024 rules, which this app does not use.';

/** A fresh homebrew id. Not the name: a rename must not leave a stale slug. */
export const newMonsterId = (): string => `monster:homebrew-${uid().slice(0, 8)}@HOMEBREW`;

export function blankMonster(campaignId: string): StoredMonster {
  return {
    kind: 'monster', id: newMonsterId(), name: 'New monster', source: 'HOMEBREW', text: [], campaignId, updatedAt: Date.now(),
    size: ['M'], type: 'humanoid', alignment: 'unaligned', ac: [{ value: 10 }], hp: { average: 4, formula: '1d8' }, speed: { walk: 30 },
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: {},
    vulnerable: [], resist: [], immune: [], conditionImmune: [], senses: [], passive: 10, languages: [], cr: '0',
    traits: [], actions: [], bonusActions: [], reactions: [], legendary: [],
  };
}

/** Duplicate: every stat of an SRD or pack monster as a new homebrew record in this campaign. The name stays; `srd` and aliases are not copied. */
export function duplicateMonster(m: MonsterDef, campaignId: string): StoredMonster {
  if (is2024(m)) throw new Error(NO_2024); // defence in depth: the index already leaves these out
  const { srd: _s, aliases: _a, campaignId: _c, updatedAt: _u, ...copy } = structuredClone(m) as MonsterDef & { campaignId?: string; updatedAt?: number };
  return { ...copy, id: newMonsterId(), source: 'HOMEBREW', campaignId, updatedAt: Date.now() };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const traits = (v: unknown): boolean => Array.isArray(v) && v.every((t) => traitOk(t, 0));
const numbersFor = (v: unknown, keys: readonly string[]): boolean => isRec(v) && Object.entries(v).every(([k, n]) => keys.includes(k) && num(n));
const speedOk = (v: unknown): boolean => isRec(v) && num(v.walk) && Object.entries(v).every(([k, x]) => k === 'hover' ? typeof x === 'boolean' : k === 'note' ? str(x) : num(x));

/**
 * The one guard for a stored or imported monster: everything the stat block and the lists read is present and the right type.
 * Every place that reads stored monsters filters through this (like soundItem).
 */
export function soundMonster(m: unknown): boolean {
  if (!isRec(m) || m.kind !== 'monster' || !str(m.id) || !str(m.name) || !m.name.trim() || !isRichText(m.text)) return false;
  if (!Array.isArray(m.size) || !m.size.length || !m.size.every((s) => ['T', 'S', 'M', 'L', 'H', 'G'].includes(s as string))) return false;
  if (!str(m.type) || !str(m.alignment) || !str(m.cr) || !num(m.passive)) return false;
  if (!Array.isArray(m.ac) || !m.ac.length || !m.ac.every((a) => isRec(a) && num(a.value) && (a.from === undefined || str(a.from)))) return false;
  if (!isRec(m.hp) || !(num(m.hp.average) || str(m.hp.special)) || (m.hp.formula !== undefined && !str(m.hp.formula))) return false;
  if (!speedOk(m.speed)) return false;
  if (!isRec(m.scores) || !ABILITIES.every((a) => num((m.scores as Record<string, unknown>)[a]))) return false;
  if (!numbersFor(m.saves, ABILITIES) || !numbersFor(m.skills, Object.keys(SKILL_ABILITY))) return false;
  if (![m.vulnerable, m.resist, m.immune, m.conditionImmune, m.senses, m.languages].every(strs)) return false;
  if (![m.traits, m.actions, m.bonusActions, m.reactions, m.legendary].every(traits)) return false;
  if (m.legendaryCount !== undefined && !num(m.legendaryCount)) return false;
  if (m.mythic !== undefined && !traits(m.mythic)) return false;
  for (const k of ['legendaryIntro', 'lair', 'regional']) if (m[k] !== undefined && !isRichText(m[k])) return false;
  return m.environment === undefined || strs(m.environment);
}
