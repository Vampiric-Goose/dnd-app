// One-off rules for spells whose mechanics neither the book tags nor the wording capture, keyed by lower-case spell name. Mechanics
// only, no book text; a rule applies only when a spell of that name is present (the user's ruling, 11-02). Merged last by readSpell.
import type { SpellRead } from './spellText.ts';

export const SPELL_RULES: Record<string, Partial<SpellRead>> = {
  // one of the two d8s sets the damage type (by its face); when they match, it leaps to another creature within 30 feet
  // its cold lands as a turn starts in it; its acid at the end of one, which isn't automated
  'hunger of hadar': { damage: [{ dice: '2d6', type: 'cold' }], manual: 'Entering the area and the acid at the end of a turn in it aren’t automated: apply them by hand.' },
  // the undead they raise: one skeleton or zombie, two more per slot above 3rd; three ghouls, one more per slot above 6th
  'animate dead': { summon: { forms: ['Skeleton', 'Zombie'], count: 1, perSlot: { count: 2, above: 3 } } },
  // the ghasts, wights and mummies of its 8th- and 9th-level slots come instead of ghouls: by hand
  'create undead': { summon: { forms: ['Ghoul'], count: 3, perSlot: { count: 1, above: 6 } }, manual: 'At 8th level or higher, ghasts, wights or mummies instead of ghouls are by hand.' },
  // the steeds' forms, named apart from the summoning sentence
  'find steed': { summon: { forms: ['Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff'] } },
  'find greater steed': { summon: { forms: ['Griffon', 'Pegasus', 'Peryton', 'Dire Wolf', 'Rhinoceros', 'Saber-Toothed Tiger'] } },
  'chaos bolt': { typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] }, leap: 30 },
  // the SRD words its aura "to a distance of 15 feet"; the SRD's upcast die is misprinted "1dl0"
  'spirit guardians': { area: { shape: 'sphere', feet: 15, self: true }, manual: 'Entering the area isn’t automated, only starting a turn in it.' },
  moonbeam: { perSlot: { dice: '1d10', above: 2, step: 1 } },
  // the save rolls; what a failure does is the caster's pick, by option or by the target's hit points
  command: { conditions: undefined, manual: 'On a failed save, carry out the command by hand.' },
  eyebite: { conditions: undefined, manual: 'On a failed save, apply the effect you chose by hand.' },
  'divine word': { conditions: undefined, manual: 'On a failed save, apply its effect for the target’s hit points by hand.' },
  imprisonment: { conditions: undefined, manual: 'On a failed save, apply the prison you chose by hand.' },
  'flesh to stone': { conditions: ['Restrained'], manual: 'Its later saves aren’t automated: three failures petrify the target.' },
  'prismatic spray': { damage: [], conditions: undefined, manual: 'Roll each target’s ray and apply it by hand.' },
  'prismatic wall': { damage: [], conditions: undefined, manual: 'Its layers aren’t automated: apply them by hand.' },
  // a touch attack that poisons; the disease saves follow
  contagion: { attack: 'melee', reach: 5, save: undefined, conditions: ['Poisoned'], manual: 'Its disease saves at the end of the target’s turns aren’t automated.' },
  // nothing to aim: by hand
  earthquake: { damage: [], save: undefined, conditions: undefined, manual: 'Run its saves, fissures and collapses by hand.' },
  symbol: { damage: [], save: undefined, conditions: undefined, manual: 'Apply the glyph you chose by hand when it triggers.' },
  'fire shield': { damage: [], manual: 'Its resistance and the flames against melee attackers aren’t automated: apply them by hand.' },
  'control winds': { save: undefined, conditions: undefined, manual: 'Apply the winds you chose by hand.' },
  hallow: { save: undefined, conditions: undefined, manual: 'Apply the effect you bound to the area by hand.' },
  dream: { damage: [], save: undefined, manual: 'Run the dream by hand.' },
  tsunami: { damage: [], save: undefined, manual: 'Move the wall and roll its saves by hand.' },
  'storm of vengeance': { damage: [], save: undefined, conditions: undefined, manual: 'Run each round of the storm by hand.' },
  scrying: { save: undefined, manual: 'The target’s save is by hand.' },
  'contact other plane': { damage: [], save: undefined, onSave: undefined, manual: 'Your Intelligence save and its damage are by hand.' },
  // a save on the next weapon hit: by hand
  'ensnaring strike': { damage: [], save: undefined, conditions: undefined, perSlot: undefined, manual: 'On your next weapon hit, roll the target’s Strength save by hand.' },
  'hail of thorns': { damage: [], save: undefined, perSlot: undefined, manual: 'On your next ranged weapon hit, roll the saves around the target by hand.' },
  'lightning arrow': { damage: [], save: undefined, perSlot: undefined, manual: 'On your next ranged weapon attack, apply its damage by hand.' },
  // buffs on the caster (rules/constants.ts SPELL_EFFECTS); their own saves and attacks are by hand
  'investiture of stone': { save: undefined, conditions: undefined, manual: 'Its earthquake action is by hand.' },
  "tenser's transformation": { save: undefined, manual: 'The extra force damage on weapon hits and the Constitution save at the end are by hand.' },
  // a buff whose save is the attacker's (a fiend or undead that hits): aimed at allies, the save by hand
  'holy aura': { save: undefined, conditions: undefined, manual: 'A fiend or undead that hits a creature in it makes the Constitution save by hand.' },
  'wrath of nature': { manual: 'Only the trees’ slashing is automated: the roots, vines and hurled rocks are by hand.' },
  // fight-changing, but nothing a roll or a number here can carry: the cast says so
  ...Object.fromEntries(Object.entries({
    heroism: 'Its temporary hit points each turn and its immunity to fear are by hand.',
    'death ward': 'Dropping to 1 hit point instead of 0 is by hand.',
    'power word kill': 'A target with 100 hit points or fewer dies: apply it by hand.',
    'mirror image': 'Roll for the duplicates when it’s attacked, by hand.',
    blink: 'Roll at the end of each of your turns, by hand.',
    'magic weapon': 'Add the weapon’s bonus to its attack and damage by hand.',
    shillelagh: 'Use your spellcasting ability and a d8 for the staff’s attacks by hand.',
    counterspell: 'Decide the spell it stops by hand.',
    'dispel magic': 'End the spells it stops by hand.',
    'mass heal': 'Divide its healing by hand.',
    'time stop': 'Run your extra turns by hand.',
    'antilife shell': 'Keep creatures out of its barrier by hand.',
    'globe of invulnerability': 'Spells of the level it stops are by hand.',
    'wall of force': 'Place the wall by hand: nothing passes through it.',
    'swift quiver': 'Make the bonus-action attacks it allows.',
    'mind blank': 'Its immunity to psychic damage and charm is by hand.',
    invulnerability: 'Its immunity to all damage is by hand.',
    'circle of power': 'Advantage on saves against spells, and no damage on a success, by hand.',
    'aura of purity': 'Its resistance to poison and advantage on saves are by hand.',
    'aura of life': 'Its resistance to necrotic damage and regaining 1 hit point are by hand.',
    'aura of vitality': 'Roll its bonus-action healing by hand.',
    'antimagic field': 'Spells and magic in the sphere are suppressed: by hand.',
    maze: 'Banish the target to the maze by hand.',
    'giant insect': 'Use the giant insect’s stat block for the creature it grows, by hand.',
    'danse macabre': 'Raise the corpses as zombies or skeletons by hand.',
    'summon lesser demons': 'Roll the demons and add them by hand.',
    'protection from energy':'Put the type you chose on the creature: Protection from Energy (fire), and so on.',
  }).map(([k, manual]) => [k, { manual }])),
};
