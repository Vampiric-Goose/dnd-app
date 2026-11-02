import type { Ability, Effect, Skill } from '../types.ts';

export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const SKILL_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex', 'animal-handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', 'sleight-of-hand': 'dex', stealth: 'dex', survival: 'wis',
};

export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// PHB multiclass spellcaster table: slots per spell level (1st..9th), indexed by caster level - 1.
export const FULL_CASTER_SLOTS: number[][] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// PHB Warlock Pact Magic, indexed by warlock level - 1.
export const PACT_TABLE: { slots: number; level: number }[] = [
  { slots: 1, level: 1 }, { slots: 2, level: 1 }, { slots: 2, level: 2 }, { slots: 2, level: 2 },
  { slots: 2, level: 3 }, { slots: 2, level: 3 }, { slots: 2, level: 4 }, { slots: 2, level: 4 },
  { slots: 2, level: 5 }, { slots: 2, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 },
  { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 },
  { slots: 4, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 },
];

// The 14 conditions; exhaustion is tracked separately as a level (Character.state.exhaustion).
export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious',
];

/**
 * Spells kept on a character as a condition of their own name, and what they do to its sheet while it holds it (mechanics only, by name;
 * the user's ruling, 11-02). Casting one puts it on the caster; the sheet's chips toggle it; a long rest ends it (each lasts 8 hours or less).
 */
export const SPELL_EFFECTS: Record<string, Effect[]> = {
  'Mage Armor': [{ type: 'acBase', base: 13, abilities: ['dex'], shieldAllowed: true }], // ends if the target dons armor: worn armor wins (sheet.ts)
};

export const ATTUNEMENT_LIMIT = 3;

export const ALIGNMENTS = ['Lawful good', 'Neutral good', 'Chaotic good', 'Lawful neutral', 'Neutral', 'Chaotic neutral', 'Lawful evil', 'Neutral evil', 'Chaotic evil'];
const ALIGNMENT_TAGS: Record<string, string> = { lg: 'Lawful good', ng: 'Neutral good', cg: 'Chaotic good', ln: 'Lawful neutral', n: 'Neutral', tn: 'Neutral', nn: 'Neutral', truen: 'Neutral', trueneutral: 'Neutral', cn: 'Chaotic neutral', le: 'Lawful evil', ne: 'Neutral evil', ce: 'Chaotic evil' };
/** 'LG', 'l/g', 'lawful GOOD', 'True Neutral' → one of ALIGNMENTS; anything else is kept as written. */
export function parseAlignment(s: string): string {
  const k = s.toLowerCase().replace(/[^a-z]/g, '');
  return ALIGNMENT_TAGS[k] ?? ALIGNMENTS.find((a) => a.toLowerCase().replace(/ /g, '') === k) ?? s;
}

export const profBonus = (totalLevel: number): number => 2 + Math.floor((totalLevel - 1) / 4);
export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);
export const averageHp = (die: number): number => die / 2 + 1;
