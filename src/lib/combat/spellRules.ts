// One-off rules for spells whose mechanics neither the book tags nor the wording capture, keyed by lower-case spell name. Mechanics
// only, no book text; a rule applies only when a spell of that name is present (the user's ruling, 11-02). Merged last by readSpell.
import type { SpellRead } from './spellText.ts';

export const SPELL_RULES: Record<string, Partial<SpellRead>> = {
  // one of the two d8s sets the damage type (by its face)
  'chaos bolt': { typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] } },
};
