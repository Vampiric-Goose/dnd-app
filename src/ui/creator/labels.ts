import { fold } from '../../lib/content/ids.ts';
import { OFFICIAL_2014 } from '../../lib/content/sources.ts';
import type { Ability } from '../../lib/types.ts';

export const ABILITY_NAMES: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/** 'animal-handling' → 'Animal Handling', "smith's tools" → "Smith's Tools". */
export const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/(^|\s)\p{Ll}/gu, (m) => m.toUpperCase());

export const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** A FilterSelect option for an entity, sorted lists use byName first. */
export const entityOption = (e: { id: string; name: string; source: string }) => ({ value: e.id, label: e.source === 'SRD' ? e.name : `${e.name} (${e.source})` });

export const byName =<T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

// SRD first, then official books newest first (a reprint like MPMM replaces VGM's version), then homebrew.
const rank = (source: string) => (source === 'SRD' ? '9' : OFFICIAL_2014[source.toUpperCase()]?.published ?? '');
/** Same-named entries from different books, one group per name (sorted by name), each with its preferred version first. */
export function versions<T extends { name: string; source: string }>(list: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const e of list) { const k = fold(e.name); groups.set(k, [...(groups.get(k) ?? []), e]); }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => rank(b.source).localeCompare(rank(a.source)) || a.source.localeCompare(b.source)))
    .sort((a, b) => byName(a[0], b[0]));
}

// PHB p.123 standard and exotic languages: offered when a choice doesn't list its own.
export const LANGUAGES = ['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon'];

export const ALIGNMENTS = ['Lawful good', 'Neutral good', 'Chaotic good', 'Lawful neutral', 'Neutral', 'Chaotic neutral', 'Lawful evil', 'Neutral evil', 'Chaotic evil'];

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
