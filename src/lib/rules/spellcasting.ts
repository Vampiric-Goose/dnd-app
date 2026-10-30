import type { Progression } from '../types.ts';
import { FULL_CASTER_SLOTS, PACT_TABLE } from './constants.ts';

// Slots at a caster level; copies so callers can't mutate the shared table.
const fullAt = (casterLevel: number): number[] => (!(casterLevel >= 1) ? [] : [...FULL_CASTER_SLOTS[Math.min(casterLevel, 20) - 1]]);

export function singleClassSlots(p: Progression, level: number): number[] {
  switch (p) {
    case 'full': return fullAt(level);
    case 'half': return level < 2 ? [] : fullAt(Math.ceil(level / 2));
    case 'artificer': return fullAt(Math.ceil(level / 2));
    case 'third': return level < 3 ? [] : fullAt(Math.ceil(level / 3));
    case 'pact': return [];
  }
}

/** Multiclass slots (PHB p.164). Pact Magic is separate and never contributes. */
export function multiclassSlots(entries: { progression: Progression; level: number }[]): number[] {
  const casters = entries.filter((e) => singleClassSlots(e.progression, e.level).length > 0);
  if (casters.length === 0) return [];
  if (casters.length === 1) return singleClassSlots(casters[0].progression, casters[0].level);
  let casterLevel = 0;
  for (const { progression: p, level: l } of casters)
    casterLevel += p === 'full' ? l : p === 'half' ? Math.floor(l / 2) : p === 'third' ? Math.floor(l / 3) : Math.ceil(l / 2);
  return fullAt(casterLevel);
}

export function pactSlots(warlockLevel: number): { slots: number; level: number } | undefined {
  const row = warlockLevel < 1 ? undefined : PACT_TABLE[Math.min(warlockLevel, 20) - 1];
  return row && { ...row };
}

export const maxSpellLevel = (p: Progression, level: number): number =>
  p === 'pact' ? (pactSlots(level)?.level ?? 0) : singleClassSlots(p, level).length;
