import { slug } from '../../src/lib/content/ids.ts';
import type { Choice, Effect, Entity, Trait } from '../../src/lib/types.ts';

type Target = { effects?: Effect[]; choices?: Choice[]; traits?: Trait[] };

/**
 * What an SRD_EFFECTS key addresses (R8): `<entityId>`, `<entityId>/trait:<slug>` (a race/subrace trait),
 * `<entityId>/trait:<slug>/option:<slug>` or `<featureId>/option:<slug>` (an option Trait of an `option` choice).
 */
export function effectTarget(get: (id: string) => Entity | undefined, key: string): Target | undefined {
  const [id, ...path] = key.split('/');
  let t: Target | undefined = get(id);
  for (const step of path) {
    const [, kind, name] = /^(trait|option):(.+)$/.exec(step) ?? [];
    t = kind === 'trait' ? t?.traits?.find(x => slug(x.name) === name)
      : kind === 'option' ? t?.choices?.flatMap(c => (c.type === 'option' ? c.options : [])).find(o => slug(o.name) === name)
      : undefined;
  }
  return t;
}

const note = (text: string): Effect => ({ type: 'note', text });
const notes = (...text: string[]) => ({ effects: text.map(note) });
const resource = (name: string, max: string, recharge: 'short' | 'long'): Effect => ({ type: 'resource', name, max, recharge });
const SAVE_DC = 'DC 8 + Con mod + proficiency bonus';

// Dragonborn: [colour, damage type, breath weapon area, save].
const ANCESTRY: [string, string, string, string][] = [
  ['Black', 'acid', '5 by 30 ft. line', 'Dex'], ['Blue', 'lightning', '5 by 30 ft. line', 'Dex'], ['Brass', 'fire', '5 by 30 ft. line', 'Dex'],
  ['Bronze', 'lightning', '5 by 30 ft. line', 'Dex'], ['Copper', 'acid', '5 by 30 ft. line', 'Dex'], ['Gold', 'fire', '15 ft. cone', 'Dex'],
  ['Green', 'poison', '15 ft. cone', 'Con'], ['Red', 'fire', '15 ft. cone', 'Dex'], ['Silver', 'cold', '15 ft. cone', 'Con'], ['White', 'cold', '15 ft. cone', 'Con'],
];

// Circle of the Land: circle spells per terrain (druid levels 3, 5, 7, 9), always prepared.
const CIRCLE_SPELLS: Record<string, string[]> = {
  Arctic: ['Hold Person, Spike Growth', 'Sleet Storm, Slow', 'Freedom of Movement, Ice Storm', 'Commune With Nature, Cone of Cold'],
  Coast: ['Mirror Image, Misty Step', 'Water Breathing, Water Walk', 'Control Water, Freedom of Movement', 'Conjure Elemental, Scrying'],
  Desert: ['Blur, Silence', 'Create Food and Water, Protection From Energy', 'Blight, Hallucinatory Terrain', 'Insect Plague, Wall of Stone'],
  Forest: ['Barkskin, Spider Climb', 'Call Lightning, Plant Growth', 'Divination, Freedom of Movement', 'Commune With Nature, Tree Stride'],
  Grassland: ['Invisibility, Pass Without Trace', 'Daylight, Haste', 'Divination, Freedom of Movement', 'Dream, Insect Plague'],
  Mountain: ['Spider Climb, Spike Growth', 'Lightning Bolt, Meld Into Stone', 'Stone Shape, Stoneskin', 'Passwall, Wall of Stone'],
  Swamp: ['Acid Arrow, Darkness', 'Water Walk, Stinking Cloud', 'Freedom of Movement, Locate Creature', 'Insect Plague, Scrying'],
};

const atWill = (spell: string, extra = '') => `Cast ${spell} at will, without expending a spell slot${extra}.`;
const oncePerLong = (spell: string) => `Cast ${spell} once using a warlock spell slot; again after a long rest.`;
const INVOCATIONS: Record<string, string> = {
  'agonizing-blast': 'Add your Charisma modifier to the damage of eldritch blast on a hit.',
  'armor-of-shadows': atWill('mage armor on yourself', ' or material components'),
  'beast-speech': atWill('speak with animals'),
  'beguiling-influence': 'Proficiency in Deception and Persuasion.',
  'book-of-ancient-secrets': 'Your Book of Shadows holds two 1st-level rituals from any class list; add more rituals you find (level up to half your warlock level).',
  'devils-sight': 'See normally in darkness, both magical and nonmagical, out to 120 feet.',
  'eldritch-sight': atWill('detect magic'),
  'eldritch-spear': 'Eldritch blast has a range of 300 feet.',
  'eyes-of-the-rune-keeper': 'You can read all writing.',
  'fiendish-vigor': atWill('false life on yourself as a 1st-level spell', ' or material components'),
  'gaze-of-two-minds': 'Action: touch a willing humanoid and perceive through its senses until the end of your next turn (extendable each turn).',
  'mask-of-many-faces': atWill('disguise self'),
  'misty-visions': atWill('silent image', ' or material components'),
  'repelling-blast': 'Eldritch blast pushes a creature it hits up to 10 feet away from you.',
  'thief-of-five-fates': oncePerLong('bane'),
  'voice-of-the-chain-master': 'Communicate telepathically with your familiar and perceive through its senses at any distance on the same plane; speak through it in your own voice.',
  'mire-the-mind': oncePerLong('slow'),
  'one-with-shadows': 'In dim light or darkness, use an action to become invisible until you move or take an action or reaction.',
  'sign-of-ill-omen': oncePerLong('bestow curse'),
  'thirsting-blade': 'Attack twice, instead of once, with your pact weapon when you take the Attack action.',
  'bewitching-whispers': oncePerLong('compulsion'),
  'dreadful-word': oncePerLong('confusion'),
  'sculptor-of-flesh': oncePerLong('polymorph'),
  'ascendant-step': atWill('levitate on yourself', ' or material components'),
  'minions-of-chaos': oncePerLong('conjure elemental'),
  'otherworldly-leap': atWill('jump on yourself', ' or material components'),
  'whispers-of-the-grave': atWill('speak with dead'),
  'lifedrinker': 'Pact weapon hits deal extra necrotic damage equal to your Charisma modifier (minimum 1).',
  'chains-of-carceri': atWill('hold monster on a celestial, fiend or elemental', ' or material components; once per creature per long rest'),
  'master-of-myriad-forms': atWill('alter self'),
  'visions-of-distant-realms': atWill('arcane eye'),
  'witch-sight': 'See the true form of any shapechanger or creature concealed by illusion or transmutation magic within 30 feet.',
};

/**
 * Hand-authored effects and choices, keyed as `effectTarget` reads them. build-srd appends them to what the data already gives,
 * so nothing the converted data already carries (race proficiencies, Skill Versatility, tool/language choices, domain/oath
 * spells, the Pact Boon, Dragon Ancestor and terrain option choices, rogue Expertise) is repeated here (N4).
 */
export const SRD_EFFECTS: Record<string, { effects?: Effect[]; choices?: Choice[] }> = {
  // Races
  'race:dwarf@SRD': { effects: [{ type: 'flag', flag: 'ignoreHeavyArmorSpeed' }] },
  'race:dwarf@SRD/trait:dwarven-resilience': { effects: [{ type: 'damage', kind: 'resistance', damageType: 'poison' }, note('Advantage on saving throws against poison.')] },
  'race:dwarf@SRD/trait:stonecunning': notes('Int (History) checks about the origin of stonework: proficient, with double your proficiency bonus.'),
  'subrace:hill-dwarf@SRD/trait:dwarven-toughness': { effects: [{ type: 'bonus', target: 'hpPerLevel', value: 1 }] },
  'race:elf@SRD/trait:fey-ancestry': notes('Advantage on saving throws against being charmed; magic can\'t put you to sleep.'),
  'race:elf@SRD/trait:trance': notes('Meditate 4 hours instead of sleeping 8 to gain the benefit of a long rest.'),
  'race:halfling@SRD/trait:lucky': notes('When you roll a 1 on an attack roll, ability check or saving throw, reroll and use the new roll.'),
  'race:halfling@SRD/trait:brave': notes('Advantage on saving throws against being frightened.'),
  'race:halfling@SRD/trait:halfling-nimbleness': notes('You can move through the space of any creature larger than you.'),
  ...Object.fromEntries(ANCESTRY.map(([colour, type, area, save]) => [`race:dragonborn@SRD/trait:draconic-ancestry/option:draconic-ancestry-${slug(colour)}`, { effects: [
    { type: 'damage', kind: 'resistance', damageType: type },
    note(`Breath Weapon (action): ${area}, ${save} save (${SAVE_DC}), 2d6 ${type} damage, half on a success; 3d6 at 6th level, 4d6 at 11th, 5d6 at 16th. Once per short or long rest.`),
  ] }])),
  'race:gnome@SRD/trait:gnome-cunning': notes('Advantage on Intelligence, Wisdom and Charisma saving throws against magic.'),
  'race:half-orc@SRD/trait:relentless-endurance': notes('When reduced to 0 hit points but not killed outright, drop to 1 hit point instead. Once per long rest.'),
  'race:half-orc@SRD/trait:savage-attacks': notes('On a critical hit with a melee weapon, roll one of its damage dice one more time and add it to the extra damage.'),
  'race:tiefling@SRD/trait:hellish-resistance': { effects: [{ type: 'damage', kind: 'resistance', damageType: 'fire' }] },
  'race:tiefling@SRD/trait:infernal-legacy': notes('Thaumaturgy cantrip; from 3rd level, hellish rebuke as a 2nd-level spell once per long rest; from 5th level, darkness once per long rest. Charisma is your spellcasting ability for these.'),

  // Barbarian
  'feature:barbarian:unarmored-defense:1@SRD': { effects: [{ type: 'acBase', base: 10, abilities: ['dex', 'con'], shieldAllowed: true }] },
  'feature:barbarian:rage:1@SRD': { effects: [resource('Rage', 'col[Rages]', 'long')] },
  'feature:barbarian:fast-movement:5@SRD': { effects: [{ type: 'speed', mode: 'walk', value: 10, when: 'notHeavy' }] },
  'feature:barbarian:danger-sense:2@SRD': notes('Advantage on Dexterity saving throws against effects you can see, unless blinded, deafened or incapacitated.'),
  'feature:barbarian:reckless-attack:2@SRD': notes('On your first attack of a turn, take advantage on Strength melee weapon attacks this turn; attacks against you have advantage until your next turn.'),
  'feature:barbarian:feral-instinct:7@SRD': notes('Advantage on initiative rolls. If surprised, you can act normally on your first turn if you enter a rage first.'),

  // Bard
  'feature:bard:bardic-inspiration-d6:1@SRD': { effects: [resource('Bardic Inspiration', 'max(1,mod:cha)', 'long')] },
  'feature:bard:font-of-inspiration:5@SRD': { effects: [{ type: 'resourceRecharge', name: 'Bardic Inspiration', recharge: 'short' }] },
  'feature:bard:jack-of-all-trades:2@SRD': { effects: [{ type: 'halfProficiency' }] },
  'feature:bard:lore:bonus-proficiencies:3@SRD': { choices: [{ type: 'skill', count: 3, from: 'any' }] },

  // Cleric
  'feature:cleric:channel-divinity-1-rest:2@SRD': { effects: [resource('Channel Divinity', 'col[Channel Divinity]', 'short')] },
  'feature:cleric:life:bonus-proficiency:1@SRD': { effects: [{ type: 'proficiency', category: 'armor', value: 'heavy' }] },

  // Druid
  'feature:druid:wild-shape-cr-1-4-or-below-no-flying-or-swim-speed:2@SRD': { effects: [resource('Wild Shape', '2', 'short')] },
  ...Object.fromEntries(Object.entries(CIRCLE_SPELLS).map(([terrain, spells]) => [`feature:druid:land:circle-of-the-land:2@SRD/option:${slug(terrain)}`,
    notes(`Circle spells (always prepared, don't count against spells prepared): ${spells.map((s, i) => `druid ${3 + 2 * i}: ${s}`).join('; ')}.`)])),

  // Fighter
  'feature:fighter:second-wind:1@SRD': { effects: [resource('Second Wind', '1', 'short')] },
  'feature:fighter:action-surge-1-use:2@SRD': { effects: [resource('Action Surge', 'col[Action Surges]', 'short')] },
  'feature:fighter:indomitable-1-use:9@SRD': { effects: [resource('Indomitable', 'col[Indomitable]', 'long')] },
  'feature:fighter:champion:improved-critical:3@SRD': notes('Weapon attacks score a critical hit on a roll of 19 or 20.'),
  'feature:fighter:champion:remarkable-athlete:7@SRD': { effects: [{ type: 'halfProficiency', abilities: ['str', 'dex', 'con'], roundUp: true }] },
  'feature:fighter:champion:superior-critical:15@SRD': notes('Weapon attacks score a critical hit on a roll of 18 to 20.'),

  // Fighting styles
  'optionalFeature:archery@SRD': { effects: [{ type: 'bonus', target: 'attack.ranged', value: 2 }] },
  'optionalFeature:defense@SRD': { effects: [{ type: 'bonus', target: 'ac', value: 1, when: 'armored' }] },
  'optionalFeature:dueling@SRD': notes('+2 damage with a melee weapon held in one hand when you wield no other weapons.'),
  'optionalFeature:great-weapon-fighting@SRD': notes('Reroll 1s and 2s on damage dice for two-handed or versatile melee weapons wielded in two hands; use the new roll.'),
  'optionalFeature:protection@SRD': notes('While wielding a shield, use your reaction to impose disadvantage on an attack against a creature within 5 feet of you.'),
  'optionalFeature:two-weapon-fighting@SRD': notes('Add your ability modifier to the damage of the second attack when you fight with two weapons.'),

  // Monk
  'feature:monk:unarmored-defense:1@SRD': { effects: [{ type: 'acBase', base: 10, abilities: ['dex', 'wis'], shieldAllowed: false }] },
  'feature:monk:martial-arts:1@SRD': { effects: [{ type: 'flag', flag: 'martialArts' }] }, // R23
  'feature:monk:ki:2@SRD': { effects: [resource('Ki', 'col[Ki Points]', 'short')] },
  'feature:monk:unarmored-movement:2@SRD': { effects: [{ type: 'speed', mode: 'walk', value: 'col[Unarmored Movement]', when: 'unarmored' }] },
  'feature:monk:diamond-soul:14@SRD': { effects: (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a): Effect => ({ type: 'proficiency', category: 'save', value: a })) },

  // Paladin
  'feature:paladin:divine-sense:1@SRD': { effects: [resource('Divine Sense', '1+mod:cha', 'long')] },
  'feature:paladin:lay-on-hands:1@SRD': { effects: [resource('Lay on Hands', '5*level', 'long')] },
  'feature:paladin:aura-of-protection:6@SRD': { effects: [{ type: 'bonus', target: 'save.all', value: 'max(1,mod:cha)' }] },
  'feature:paladin:channel-divinity:3@SRD': { effects: [resource('Channel Divinity', '1', 'short')] },

  // Ranger: SRD 5.1 gives a favored enemy's language with each favored enemy choice (1st, 6th, 14th level).
  'feature:ranger:favored-enemy-1-type:1@SRD': { effects: [note('Advantage on Wisdom (Survival) checks to track your favored enemies and on Intelligence checks to recall information about them.')], choices: [{ type: 'language', count: 1 }] },
  'feature:ranger:favored-enemy-2-types:6@SRD': { choices: [{ type: 'language', count: 1 }] },
  'feature:ranger:favored-enemy-3-enemies:14@SRD': { choices: [{ type: 'language', count: 1 }] },
  'feature:ranger:natural-explorer-1-terrain-type:1@SRD': notes('Favored terrain: double proficiency on Int and Wis checks about it; while traveling there for an hour or more, difficult terrain doesn\'t slow your group, you can\'t become lost except by magic, you stay alert while foraging or navigating, you move stealthily alone at a normal pace, you find twice as much food, and you learn exact numbers, sizes and age of tracks.'),

  // Rogue
  'feature:rogue:thieves-cant:1@SRD': { effects: [{ type: 'proficiency', category: 'language', value: 'Thieves\' Cant' }] },
  'feature:rogue:slippery-mind:15@SRD': { effects: [{ type: 'proficiency', category: 'save', value: 'wis' }] },
  'feature:rogue:reliable-talent:11@SRD': notes('On an ability check that uses your proficiency bonus, treat a d20 roll of 9 or lower as a 10.'),
  'feature:rogue:evasion:7@SRD': notes('On a Dexterity save for half damage, take no damage on a success and half on a failure.'),

  // Sorcerer
  'feature:sorcerer:font-of-magic:2@SRD': { effects: [resource('Sorcery Points', 'col[Sorcery Points]', 'long')] },
  'feature:sorcerer:draconic:draconic-resilience:1@SRD': { effects: [{ type: 'bonus', target: 'hpPerLevel', value: 1 }, { type: 'acBase', base: 13, abilities: ['dex'], shieldAllowed: true }] }, // R22: per sorcerer level
  'feature:sorcerer:draconic:dragon-ancestor:1@SRD': { effects: [{ type: 'proficiency', category: 'language', value: 'Draconic' }] },

  // Warlock
  'subclass:fiend@SRD': notes('Expanded spells (added to the warlock spell list): 1st burning hands, command; 2nd blindness/deafness, scorching ray; 3rd fireball, stinking cloud; 4th fire shield, wall of fire; 5th flame strike, hallow.'),
  ...Object.fromEntries(Object.entries(INVOCATIONS).map(([s, text]) => [`optionalFeature:${s}@SRD`, notes(text)])),
  'optionalFeature:beguiling-influence@SRD': { effects: [note(INVOCATIONS['beguiling-influence']), { type: 'proficiency', category: 'skill', value: 'deception' }, { type: 'proficiency', category: 'skill', value: 'persuasion' }] },

  // Wizard
  'feature:wizard:arcane-recovery:1@SRD': { effects: [resource('Arcane Recovery', '1', 'long')] },

  // Feats
  'feat:grappler@SRD': notes('Advantage on attack rolls against a creature you are grappling. Action: make another grapple check to pin it; on a success you and it are both restrained until the grapple ends.'),
};
