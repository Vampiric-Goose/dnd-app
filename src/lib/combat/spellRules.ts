// One-off rules for spells whose mechanics neither the book tags nor the wording capture, keyed by lower-case spell name. Mechanics
// only, no book text; a rule applies only when a spell of that name is present (the user's ruling, 11-02). Merged last by readSpell.
import type { SpellRead } from './spellText.ts';

export const SPELL_RULES: Record<string, Partial<SpellRead>> = {
  // one of the two d8s sets the damage type (by its face); when they match, it leaps to another creature within 30 feet
  // its cold lands as a turn starts in it; its acid at the end of one, which isn't automated
  'hunger of hadar': { damage: [{ dice: '2d6', type: 'cold' }], manual: 'Entering the area and the acid at the end of a turn in it aren’t automated: apply them by hand.' },
  // the undead they raise: one skeleton or zombie, two more per slot above 3rd; three ghouls, one more per slot above 6th
  'animate dead': { summon: { forms: ['Skeleton', 'Zombie'], count: 1, perSlot: { count: 2, above: 3 } } },
  'create undead': { summon: { forms: ['Ghoul', 'Ghast', 'Wight', 'Mummy'], count: 3, perSlot: { count: 1, above: 6 } } },
  // the steeds' forms, named apart from the summoning sentence
  'find steed': { summon: { forms: ['Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff'] } },
  'find greater steed': { summon: { forms: ['Griffon', 'Pegasus', 'Peryton', 'Dire Wolf', 'Rhinoceros', 'Saber-Toothed Tiger'] } },
  'chaos bolt': { typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] }, leap: 30 },
};
