import type { Ability } from '../../lib/types.ts';

export const ABILITY_NAMES: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/** 'animal-handling' → 'Animal Handling', "smith's tools" → "Smith's Tools". */
export const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/(^|\s)\p{Ll}/gu, (m) => m.toUpperCase());

export const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** A FilterSelect option for an entity, sorted lists use byName first. */
export const entityOption = (e: { id: string; name: string; source: string }) => ({ value: e.id, label: e.source === 'SRD' ? e.name : `${e.name} (${e.source})` });

export const byName =<T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

// PHB p.123 standard and exotic languages: offered when a choice doesn't list its own.
export const LANGUAGES = ['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon'];

export const ALIGNMENTS = ['Lawful good', 'Neutral good', 'Chaotic good', 'Lawful neutral', 'Neutral', 'Chaotic neutral', 'Lawful evil', 'Neutral evil', 'Chaotic evil'];

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
