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
const ALL_SAVES = (mode: 'adv' | 'dis'): Effect[] => ABILITIES.map((a) => ({ type: 'edge', on: `save.${a}`, mode }));
const resist = (...types: string[]): Effect[] => types.map((damageType) => ({ type: 'damage', kind: 'resistance', damageType }));
const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
const INVISIBLE: Effect[] = [{ type: 'edge', on: 'attacksBy', mode: 'adv' }, { type: 'edge', on: 'attacksAgainst', mode: 'dis' }];
export const SPELL_EFFECTS: Record<string, Effect[]> = {
  'Mage Armor': [{ type: 'acBase', base: 13, abilities: ['dex'], shieldAllowed: true }], // ends if the target dons armor: worn armor wins (sheet.ts)
  Shield: [{ type: 'bonus', target: 'ac', value: 5 }],
  'Shield of Faith': [{ type: 'bonus', target: 'ac', value: 2 }],
  Haste: [{ type: 'bonus', target: 'ac', value: 2 }, { type: 'edge', on: 'save.dex', mode: 'adv' }], // doubled speed and the action: combat.ts
  Barkskin: [{ type: 'acMin', value: 16 }],
  Bless: [{ type: 'rollDice', on: 'attack', dice: '1d4' }, { type: 'rollDice', on: 'save', dice: '1d4' }],
  Bane: [{ type: 'rollDice', on: 'attack', dice: '-1d4' }, { type: 'rollDice', on: 'save', dice: '-1d4' }],
  Guidance: [{ type: 'rollDice', on: 'check', dice: '1d4' }],
  Resistance: [{ type: 'rollDice', on: 'save', dice: '1d4' }],
  'Faerie Fire': [{ type: 'edge', on: 'attacksAgainst', mode: 'adv' }],
  Blur: [{ type: 'edge', on: 'attacksAgainst', mode: 'dis' }],
  Stoneskin: resist('bludgeoning, piercing, and slashing from nonmagical attacks'),
  'Investiture of Stone': resist('bludgeoning, piercing, and slashing from nonmagical attacks'),
  "Tenser's Transformation": [{ type: 'edge', on: 'attacksBy', mode: 'adv' }], // ponytail: weapon attacks in the book; it bars spellcasting, so any attack here
  'Blade Ward': resist('bludgeoning', 'piercing', 'slashing'), // ponytail: from weapon attacks in the book; any of those types here
  Longstrider: [{ type: 'speed', mode: 'walk', value: 10 }],
  Fly: [{ type: 'speed', mode: 'fly', value: 60 }],
  'Beacon of Hope': [{ type: 'edge', on: 'save.wis', mode: 'adv' }], // its death-save advantage and maximum healing: by hand
  'Greater Invisibility': INVISIBLE,
  Invisibility: INVISIBLE, // it ends when the target attacks or casts: by hand
  'True Strike': [{ type: 'edge', on: 'attacksBy', mode: 'adv' }], // ponytail: the first attack on its target in the book; any attack here
  'Warding Bond': [{ type: 'bonus', target: 'ac', value: 1 }, { type: 'bonus', target: 'save.all', value: 1 }, ...resist(...DAMAGE_TYPES)],
  'Gaseous Form': [...resist('bludgeoning, piercing, and slashing from nonmagical attacks'), ...(['str', 'dex', 'con'] as const).map((a): Effect => ({ type: 'edge', on: `save.${a}`, mode: 'adv' }))],
  'Primordial Ward': resist('acid', 'cold', 'fire', 'lightning', 'thunder'),
  'Intellect Fortress': [...resist('psychic'), ...(['int', 'wis', 'cha'] as const).map((a): Effect => ({ type: 'edge', on: `save.${a}`, mode: 'adv' }))],
  "Tasha's Otherworldly Guise": [{ type: 'bonus', target: 'ac', value: 2 }, { type: 'speed', mode: 'fly', value: 40 }],
  Aid: [{ type: 'bonus', target: 'hpMax', value: 5 }], // ponytail: the 2nd-level amount; higher slots add 5 more each (by hand)
  Foresight: [{ type: 'edge', on: 'attacksBy', mode: 'adv' }, { type: 'edge', on: 'attacksAgainst', mode: 'dis' }, ...ALL_SAVES('adv')],
  'Holy Aura': [{ type: 'edge', on: 'attacksAgainst', mode: 'dis' }, ...ALL_SAVES('adv')],
  ...Object.fromEntries(['acid', 'cold', 'fire', 'lightning', 'thunder'].map((t) => [`Protection from Energy (${t})`, resist(t)])),
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
