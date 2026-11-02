// One-off rules for spells whose mechanics neither the book tags nor the wording capture, keyed by lower-case spell name. Mechanics
// only, no book text; a rule applies only when a spell of that name is present (the user's ruling, 11-02). Merged last by readSpell.
import type { SpellRead } from './spellText.ts';

export const SPELL_RULES: Record<string, Partial<SpellRead>> = {
  // one of the two d8s sets the damage type (by its face); when they match, it leaps to another creature within 30 feet
  // its cold lands, no save, as a turn starts in it; its acid, on a failed Dex save, as a turn ends there (atEnd)
  'hunger of hadar': { damage: [{ dice: '2d6', type: 'cold' }], save: undefined, conditions: undefined, ends: true, atEnd: { damage: [{ dice: '2d6', type: 'acid' }], save: 'Dex', onSave: 'none' },
    manual: 'Its darkness, blinding those inside it, is by hand.' },
  // the undead they raise: one skeleton or zombie, two more per slot above 3rd; three ghouls, one more per slot above 6th
  'animate dead': { summon: { forms: ['Skeleton', 'Zombie'], count: 1, perSlot: { count: 2, above: 3 } } },
  // the ghasts, wights and mummies of its 8th- and 9th-level slots come instead of ghouls: by hand
  'create undead': { summon: { forms: ['Ghoul'], count: 3, perSlot: { count: 1, above: 6 } }, manual: 'At 8th level or higher, ghasts, wights or mummies instead of ghouls are by hand.' },
  // the steeds' forms, named apart from the summoning sentence
  'find steed': { summon: { forms: ['Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff'] } },
  'find greater steed': { summon: { forms: ['Griffon', 'Pegasus', 'Peryton', 'Dire Wolf', 'Rhinoceros', 'Saber-Toothed Tiger'] } },
  'chaos bolt': { typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] }, leap: 30 },
  // the SRD words its aura "to a distance of 15 feet"; the SRD's upcast die is misprinted "1dl0"
  'spirit guardians': { area: { shape: 'sphere', feet: 15, self: true }, enters: true, manual: 'The creatures you leave unaffected, and its halved speed, are by hand.' },
  moonbeam: { perSlot: { dice: '1d10', above: 2, step: 1 }, move: { feet: 60, cost: 'action' }, manual: 'A shapechanger saves with disadvantage: by hand.' },
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
  // the caster's own advantage, never an enemy's
  'true strike': { range: 'self' },
  // current hit points rise with the maximum (SPELL_EFFECTS); ponytail: the 2nd-level 5, as there
  aid: { heal: { dice: '5', mod: false }, manual: 'Higher slots add 5 more each to both: by hand.' },
  // lasting areas, against their wording (aiming.ts areaRolls): what the reader can't see, and what stays by hand
  cloudkill: { drift: { feet: 10 } },
  'incendiary cloud': { drift: { feet: 10 } },
  dawn: { move: { feet: 60, cost: 'bonus' } },
  'flaming sphere': { area: { shape: 'sphere', feet: 5, self: false }, lingering: true, ends: true, noStart: true, move: { feet: 30, cost: 'bonus' },
    manual: 'Ramming a creature with it is by hand.' }, // "ends its turn within 5 feet of the sphere"
  'dust devil': { area: { shape: 'sphere', feet: 5, self: false }, lingering: true, ends: true, noStart: true, move: { feet: 30, cost: 'bonus' },
    manual: 'The push on a failed save is by hand.' },
  whirlwind: { conditions: undefined, move: { feet: 30, cost: 'action' },
    manual: 'A Large or smaller creature that fails also makes a Strength save or is restrained; the whirlwind moving onto a creature: by hand.' },
  'storm sphere': { damage: [{ dice: '2d6', type: 'bludgeoning' }], manual: 'Its lightning bolts (a bonus action, a ranged spell attack) are by hand.' },
  ...Object.fromEntries(["evard's black tentacles", 'black tentacles'].map((n) => [n, { manual: 'A creature already restrained takes the damage with no save: by hand.' }])), // the SRD's name too
  'sickening radiance': { conditions: undefined, manual: 'A failed save also adds a level of exhaustion: by hand.' },
  maelstrom: { manual: 'The pull toward the center is by hand.' },
  web: { damage: [], manual: 'Burning webs, and entering only on that creature’s own turn, are by hand.' },
  'sleet storm': { manual: 'The concentration save for a creature starting its turn there is by hand.' },
  'stinking cloud': { manual: 'A creature that fails spends its action that turn retching.' },
  'gust of wind': { manual: 'Pushing a creature that fails 15 feet is by hand.' },
  'healing spirit': { manual: 'Its healing as a creature moves into or starts its turn in its space is by hand.' },
  'watery sphere': { conditions: ['Restrained'], manual: 'Moving the sphere, and those in it, is by hand.' },
  'bones of the earth': { damage: [], conditions: undefined, targets: { count: 6 }, manual: 'A lifted creature’s damage and restraint at a ceiling, and more pillars at higher slots, are by hand.' },
  'cordon of arrows': { damage: [], save: undefined, manual: 'Its arrows strike creatures that come within 30 feet: by hand.' },
  'transmute rock': { damage: [], save: undefined, conditions: undefined, lingering: undefined, manual: 'Run the mud or the rock by hand.' },
  'magic circle': { save: undefined, conditions: undefined, manual: 'Creatures of the types you chose can’t willingly enter it and attack those inside with disadvantage: by hand.' },
  snare: { save: undefined, conditions: undefined, manual: 'A trap: a creature moving into its circle makes the Dexterity save or is restrained, by hand.' },
  // walls: the map places areas, not walls
  ...Object.fromEntries(['blade barrier', 'wall of fire', 'wall of ice', 'wall of thorns', 'wall of light', 'wall of water'].map((n) => [n,
    { damage: [], save: undefined, conditions: undefined, lingering: undefined, manual: 'A wall: place it with the Template tool; creatures in or near it save and take damage by hand.' }])),
  // buffs on the caster (rules/constants.ts SPELL_EFFECTS); their actions are by hand
  'investiture of flame': { damage: [], save: undefined, area: undefined, manual: 'Its 1d10 fire aura and fire line (an action) are by hand.' },
  'investiture of ice': { damage: [], save: undefined, area: undefined, manual: 'Its freezing cone (an action) is by hand.' },
  'investiture of wind': { damage: [], save: undefined, area: undefined, manual: 'Its wind cube (an action), and ranged attacks against you with disadvantage, are by hand.' },
  // healing: what the wording sets apart from its first cast
  'vampiric touch': { again: { cost: 'action' } }, // the touch again each turn, as an action, while it lasts
  // a failed save: 4d8 (and 4d8 each turn after, an action, no save); a success: 2d8 and the spell ends, here half of the 4d8
  enervation: { damage: [{ dice: '4d8', type: 'necrotic' }], onSave: 'half', again: { cost: 'action', read: { save: undefined, auto: { count: 1 } } },
    manual: 'A successful save ends the spell: end concentration by hand.' },
  // the cast makes the aura; its bonus action heals one creature in it (the caster too), on any of the caster's turns
  'aura of vitality': { heal: undefined, again: { cost: 'bonus', read: { heal: { dice: '2d6', mod: false }, range: { feet: 30 } } } },
  'power word heal': { heal: { dice: 'all', mod: false }, conditions: undefined, manual: 'It also ends charmed, frightened, paralyzed and stunned, and a prone target can stand as a reaction: by hand.' },
  regenerate: { manual: 'The 1 hit point it restores at the start of each of the target’s turns, and regrowing limbs, are by hand.' },
  goodberry: { manual: 'Each berry eaten restores 1 hit point: by hand.' },
  'soul cage': { heal: undefined, manual: 'Steal Life (a bonus action: you regain 2d8) and its other uses, six in all, are by hand.' },
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
    'antimagic field': 'Spells and magic in the sphere are suppressed: by hand.',
    maze: 'Banish the target to the maze by hand.',
    'giant insect': 'Use the giant insect’s stat block for the creature it grows, by hand.',
    'danse macabre': 'Raise the corpses as zombies or skeletons by hand.',
    'summon lesser demons': 'Roll the demons and add them by hand.',
    'protection from energy':'Put the type you chose on the creature: Protection from Energy (fire), and so on.',
  }).map(([k, manual]) => [k, { manual }])),
};
