// Hand-written content entities (source FIX, SRD 5.1 numbers) and a character builder for rules tests.
import type { Character, Choice, ClassDef, Entity, FeatureDef, ItemDef, OptionalFeatureDef, PlayerView, Proficiencies, RaceDef, Scores, Skill, SubclassDef, SubraceDef } from '../../src/lib/types.ts';
import { featureId, slug } from '../../src/lib/content/ids.ts';
import { enumerateChoices, walkLevels } from '../../src/lib/character/choices.ts';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';

const P = (o: Partial<Proficiencies> = {}): Proficiencies => ({ armor: [], weapons: [], tools: [], skills: [], languages: [], ...o });
const note = (text: string) => ({ type: 'note' as const, text });

const feature = (cls: string, name: string, level: number, extra: Partial<FeatureDef> = {}, sub?: string): FeatureDef => ({
  kind: 'feature', id: featureId(cls, sub, name, level, 'FIX'), name, source: 'FIX', text: [], level, classId: `class:${cls}@FIX`,
  ...(sub && { subclassId: `subclass:${slug(sub)}@FIX` }), ...extra,
});
const asi = (cls: string, level: number) => feature(cls, 'Ability Score Improvement', level, { choices: [{ type: 'asi' }] });
const subclassPick = (cls: string, name: string, level: number) => feature(cls, name, level, { choices: [{ type: 'subclass' }] });

type ClassIn = Omit<ClassDef, 'kind' | 'id' | 'source' | 'text' | 'features' | 'startingEquipment' | 'multiclassProficiencies' | 'table' | 'optionalFeatureProgression'>
  & Partial<Pick<ClassDef, 'multiclassProficiencies' | 'table' | 'optionalFeatureProgression'>>;
const features: FeatureDef[] = [];
const cls = (o: ClassIn, feats: FeatureDef[]): ClassDef => {
  features.push(...feats);
  return {
    kind: 'class', id: `class:${slug(o.name)}@FIX`, source: 'FIX', text: [], startingEquipment: { text: [], choices: [] },
    multiclassProficiencies: P(), table: [], optionalFeatureProgression: [], ...o, features: feats.map(f => ({ level: f.level, id: f.id })),
  };
};

const INSTRUMENTS = ['bagpipes', 'drum', 'dulcimer', 'flute', 'lute', 'lyre', 'horn', 'pan flute', 'shawm', 'viol'];
const ARTISAN_TOOLS = ["alchemist's supplies", "brewer's supplies", "calligrapher's supplies", "carpenter's tools", "cartographer's tools", "cobbler's tools",
  "cook's utensils", "glassblower's tools", "jeweler's tools", "leatherworker's tools", "mason's tools", "painter's supplies", "potter's tools",
  "smith's tools", "tinker's tools", "weaver's tools", "woodcarver's tools"];
const ROGUE_SKILLS: Skill[] = ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'];
const FULL_CANTRIPS_3 = [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
const CANTRIPS_2 = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];

export const fighter = cls({
  name: 'Fighter', hitDie: 10, saves: ['str', 'con'], proficiencies: P({ armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['simple', 'martial'] }),
  skillChoice: { count: 2, from: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
  multiclassPrereq: { any: { str: 13, dex: 13 } }, multiclassProficiencies: P({ armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] }),
  subclassLevel: 3, subclassTitle: 'Martial Archetype', asiLevels: [4, 6, 8, 12, 14, 16, 19],
  table: [
    { label: 'Action Surges', values: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2] },
    { label: 'Indomitable', values: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3] },
  ],
}, [
  feature('fighter', 'Fighting Style', 1, { choices: [{ type: 'optionalFeature', count: 1, featureTypes: ['FS:F'] }] }),
  feature('fighter', 'Second Wind', 1, { effects: [{ type: 'resource', name: 'Second Wind', max: '1', recharge: 'short' }] }),
  feature('fighter', 'Action Surge', 2, { effects: [{ type: 'resource', name: 'Action Surge', max: 'col[Action Surges]', recharge: 'short' }] }),
  subclassPick('fighter', 'Martial Archetype', 3),
  asi('fighter', 4),
  feature('fighter', 'Extra Attack', 5),
  asi('fighter', 6),
]);

const championFeatures = [
  feature('fighter', 'Improved Critical', 3, { effects: [note('Your weapon attacks score a critical hit on a roll of 19 or 20.')] }, 'Champion'),
  feature('fighter', 'Remarkable Athlete', 7, { effects: [{ type: 'halfProficiency', abilities: ['str', 'dex', 'con'], roundUp: true }] }, 'Champion'),
];
features.push(...championFeatures);
export const champion: SubclassDef = {
  kind: 'subclass', id: 'subclass:champion@FIX', name: 'Champion', source: 'FIX', text: [], classId: fighter.id, shortName: 'Champion',
  features: championFeatures.map(f => ({ level: f.level, id: f.id })),
};

export const monk = cls({
  name: 'Monk', hitDie: 8, saves: ['str', 'dex'], proficiencies: P({ weapons: ['simple', 'shortsword'] }),
  skillChoice: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] },
  multiclassPrereq: { all: { dex: 13, wis: 13 } }, multiclassProficiencies: P({ weapons: ['simple', 'shortsword'] }),
  subclassLevel: 3, subclassTitle: 'Monastic Tradition', asiLevels: [4, 8, 12, 16, 19],
  choices: [{ type: 'tool', count: 1, from: [...ARTISAN_TOOLS, ...INSTRUMENTS] }],
  table: [
    { label: 'Martial Arts', values: ['1d4', '1d4', '1d4', '1d4', '1d6', '1d6', '1d6', '1d6', '1d6', '1d6', '1d8', '1d8', '1d8', '1d8', '1d8', '1d8', '1d10', '1d10', '1d10', '1d10'] },
    { label: 'Ki Points', values: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] },
    { label: 'Unarmored Movement', values: ['+0 ft.', '+10 ft.', '+10 ft.', '+10 ft.', '+10 ft.', '+15 ft.', '+15 ft.', '+15 ft.', '+15 ft.', '+20 ft.', '+20 ft.', '+20 ft.', '+20 ft.', '+25 ft.', '+25 ft.', '+25 ft.', '+25 ft.', '+30 ft.', '+30 ft.', '+30 ft.'] },
  ],
}, [
  feature('monk', 'Unarmored Defense', 1, { effects: [{ type: 'acBase', base: 10, abilities: ['dex', 'wis'], shieldAllowed: false }] }),
  feature('monk', 'Martial Arts', 1),
  feature('monk', 'Ki', 2, { effects: [{ type: 'resource', name: 'Ki', max: 'col[Ki Points]', recharge: 'short' }] }),
  feature('monk', 'Unarmored Movement', 2, { effects: [{ type: 'speed', mode: 'walk', value: 'col[Unarmored Movement]', when: 'unarmored' }] }),
  subclassPick('monk', 'Monastic Tradition', 3),
  asi('monk', 4),
  feature('monk', 'Extra Attack', 5),
]);

export const barbarian = cls({
  name: 'Barbarian', hitDie: 12, saves: ['str', 'con'], proficiencies: P({ armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] }),
  skillChoice: { count: 2, from: ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
  multiclassPrereq: { all: { str: 13 } }, multiclassProficiencies: P({ armor: ['shield'], weapons: ['simple', 'martial'] }),
  subclassLevel: 3, subclassTitle: 'Primal Path', asiLevels: [4, 8, 12, 16, 19],
  table: [
    { label: 'Rages', values: [2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 'Unlimited'] },
    { label: 'Rage Damage', values: [2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4] },
  ],
}, [
  feature('barbarian', 'Rage', 1, { effects: [{ type: 'resource', name: 'Rage', max: 'col[Rages]', recharge: 'long' }] }),
  feature('barbarian', 'Unarmored Defense', 1, { effects: [{ type: 'acBase', base: 10, abilities: ['dex', 'con'], shieldAllowed: true }] }),
  feature('barbarian', 'Reckless Attack', 2),
  feature('barbarian', 'Danger Sense', 2),
  subclassPick('barbarian', 'Primal Path', 3),
  asi('barbarian', 4),
  feature('barbarian', 'Extra Attack', 5),
  feature('barbarian', 'Fast Movement', 5, { effects: [{ type: 'speed', mode: 'walk', value: 10, when: 'notHeavy' }] }),
]);

export const bard = cls({
  name: 'Bard', hitDie: 8, saves: ['dex', 'cha'], proficiencies: P({ armor: ['light'], weapons: ['simple', 'crossbow, hand', 'longsword', 'rapier', 'shortsword'] }),
  skillChoice: { count: 3, from: 'any' }, multiclassSkillChoice: { count: 1, from: 'any' },
  multiclassPrereq: { all: { cha: 13 } }, multiclassProficiencies: P({ armor: ['light'] }),
  subclassLevel: 3, subclassTitle: 'Bard College', asiLevels: [4, 8, 12, 16, 19],
  choices: [{ type: 'tool', count: 3, from: INSTRUMENTS }],
  spellcasting: { ability: 'cha', progression: 'full', preparation: 'known', cantrips: CANTRIPS_2, known: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22] },
  table: [{ label: 'Bardic Inspiration', values: ['d6', 'd6', 'd6', 'd6', 'd8', 'd8', 'd8', 'd8', 'd8', 'd10', 'd10', 'd10', 'd10', 'd10', 'd12', 'd12', 'd12', 'd12', 'd12', 'd12'] }],
}, [
  feature('bard', 'Spellcasting', 1),
  feature('bard', 'Bardic Inspiration', 1, { effects: [{ type: 'resource', name: 'Bardic Inspiration', max: 'max(1,mod:cha)', recharge: 'long' }] }),
  feature('bard', 'Jack of All Trades', 2, { effects: [{ type: 'halfProficiency' }] }),
  feature('bard', 'Song of Rest', 2),
  subclassPick('bard', 'Bard College', 3),
  feature('bard', 'Expertise', 3, { choices: [{ type: 'expertise', count: 2 }] }),
  asi('bard', 4),
  feature('bard', 'Font of Inspiration', 5, { effects: [{ type: 'resourceRecharge', name: 'Bardic Inspiration', recharge: 'short' }] }),
]);

export const rogue = cls({
  name: 'Rogue', hitDie: 8, saves: ['dex', 'int'], proficiencies: P({ armor: ['light'], weapons: ['simple', 'crossbow, hand', 'longsword', 'rapier', 'shortsword'], tools: ["thieves' tools"] }),
  skillChoice: { count: 4, from: ROGUE_SKILLS }, multiclassSkillChoice: { count: 1, from: ROGUE_SKILLS },
  multiclassPrereq: { all: { dex: 13 } }, multiclassProficiencies: P({ armor: ['light'], tools: ["thieves' tools"] }),
  subclassLevel: 3, subclassTitle: 'Roguish Archetype', asiLevels: [4, 8, 10, 12, 16, 19],
  table: [{ label: 'Sneak Attack', values: ['1d6', '1d6', '2d6', '2d6', '3d6', '3d6', '4d6', '4d6', '5d6', '5d6', '6d6', '6d6', '7d6', '7d6', '8d6', '8d6', '9d6', '9d6', '10d6', '10d6'] }],
}, [
  feature('rogue', 'Expertise', 1, { choices: [{ type: 'expertise', count: 2 }] }),
  feature('rogue', 'Sneak Attack', 1),
  feature('rogue', "Thieves' Cant", 1, { effects: [{ type: 'proficiency', category: 'language', value: "Thieves' Cant" }] }),
  feature('rogue', 'Cunning Action', 2),
  subclassPick('rogue', 'Roguish Archetype', 3),
  asi('rogue', 4),
  feature('rogue', 'Uncanny Dodge', 5),
]);

export const wizard = cls({
  name: 'Wizard', hitDie: 6, saves: ['int', 'wis'], proficiencies: P({ weapons: ['dagger', 'dart', 'sling', 'quarterstaff', 'crossbow, light'] }),
  skillChoice: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
  multiclassPrereq: { all: { int: 13 } }, subclassLevel: 2, subclassTitle: 'Arcane Tradition', asiLevels: [4, 8, 12, 16, 19],
  spellcasting: { ability: 'int', progression: 'full', preparation: 'prepared', spellbook: true, cantrips: FULL_CANTRIPS_3, preparedFormula: 'level+mod:int' },
}, [
  feature('wizard', 'Spellcasting', 1),
  feature('wizard', 'Arcane Recovery', 1, { effects: [{ type: 'resource', name: 'Arcane Recovery', max: '1', recharge: 'long' }] }),
  subclassPick('wizard', 'Arcane Tradition', 2),
  asi('wizard', 4),
]);

export const cleric = cls({
  name: 'Cleric', hitDie: 8, saves: ['wis', 'cha'], proficiencies: P({ armor: ['light', 'medium', 'shield'], weapons: ['simple'] }),
  skillChoice: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
  multiclassPrereq: { all: { wis: 13 } }, multiclassProficiencies: P({ armor: ['light', 'medium', 'shield'] }),
  subclassLevel: 1, subclassTitle: 'Divine Domain', asiLevels: [4, 8, 12, 16, 19],
  spellcasting: { ability: 'wis', progression: 'full', preparation: 'prepared', cantrips: FULL_CANTRIPS_3, preparedFormula: 'level+mod:wis' },
  table: [{ label: 'Channel Divinity', values: [0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3] }],
}, [
  feature('cleric', 'Spellcasting', 1),
  subclassPick('cleric', 'Divine Domain', 1),
  feature('cleric', 'Channel Divinity', 2, { effects: [{ type: 'resource', name: 'Channel Divinity', max: 'col[Channel Divinity]', recharge: 'short' }] }),
  asi('cleric', 4),
  feature('cleric', 'Destroy Undead', 5),
]);

const INVOCATIONS = [0, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8];
export const warlock = cls({
  name: 'Warlock', hitDie: 8, saves: ['wis', 'cha'], proficiencies: P({ armor: ['light'], weapons: ['simple'] }),
  skillChoice: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] },
  multiclassPrereq: { all: { cha: 13 } }, multiclassProficiencies: P({ armor: ['light'], weapons: ['simple'] }),
  subclassLevel: 1, subclassTitle: 'Otherworldly Patron', asiLevels: [4, 8, 12, 16, 19],
  spellcasting: { ability: 'cha', progression: 'pact', preparation: 'known', cantrips: CANTRIPS_2, known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15] },
  table: [{ label: 'Invocations Known', values: INVOCATIONS }],
  optionalFeatureProgression: [{ name: 'Eldritch Invocations', featureTypes: ['EI'], counts: INVOCATIONS }],
}, [
  subclassPick('warlock', 'Otherworldly Patron', 1),
  feature('warlock', 'Pact Magic', 1),
  feature('warlock', 'Eldritch Invocations', 2),
  feature('warlock', 'Pact Boon', 3, { choices: [{ type: 'option', count: 1, options: ['Pact of the Chain', 'Pact of the Blade', 'Pact of the Tome'].map(name => ({ name, text: [], effects: [note(name)] })) }] }),
  asi('warlock', 4),
]);

export const human: RaceDef = {
  kind: 'race', id: 'race:human@FIX', name: 'Human', source: 'FIX', text: [], size: 'M', speed: { walk: 30 },
  abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, proficiencies: P({ languages: ['Common'] }),
  choices: [{ type: 'language', count: 1 }], traits: [],
};
export const dwarf: RaceDef = {
  kind: 'race', id: 'race:dwarf@FIX', name: 'Dwarf', source: 'FIX', text: [], size: 'M', speed: { walk: 25 }, darkvision: 60,
  abilityBonuses: { con: 2 }, proficiencies: P({ weapons: ['battleaxe', 'handaxe', 'light hammer', 'warhammer'], languages: ['Common', 'Dwarvish'] }),
  effects: [{ type: 'flag', flag: 'ignoreHeavyArmorSpeed' }],
  traits: [
    { name: 'Dwarven Resilience', text: [], effects: [{ type: 'damage', kind: 'resistance', damageType: 'poison' }, note('Advantage on saving throws against poison.')] },
    { name: 'Dwarven Combat Training', text: [] },
    { name: 'Tool Proficiency', text: [], choices: [{ type: 'tool', count: 1, from: ["smith's tools", "brewer's supplies", "mason's tools"] }] },
    { name: 'Stonecunning', text: [], effects: [note('Double proficiency on History checks related to the origin of stonework.')] },
  ],
};
export const hillDwarf: SubraceDef = {
  kind: 'subrace', id: 'subrace:hill-dwarf@FIX', name: 'Hill Dwarf', source: 'FIX', text: [], raceId: dwarf.id, abilityBonuses: { wis: 1 }, proficiencies: P(),
  traits: [{ name: 'Dwarven Toughness', text: [], effects: [{ type: 'bonus', target: 'hpPerLevel', value: 1 }] }],
};

export const defense: OptionalFeatureDef = {
  kind: 'optionalFeature', id: 'optionalFeature:defense@FIX', name: 'Defense', source: 'FIX', text: [], featureTypes: ['FS:F', 'FS:P', 'FS:R'],
  effects: [{ type: 'bonus', target: 'ac', value: 1, when: 'armored' }],
};

const item = (name: string, o: Omit<ItemDef, 'kind' | 'id' | 'name' | 'source' | 'text'> & { text?: ItemDef['text'] }): ItemDef =>
  ({ kind: 'item', id: `item:${slug(name)}@FIX`, name, source: 'FIX', text: [], ...o });
export const chainMail = item('Chain Mail', { type: 'armor', magic: false, weight: 55, costCp: 7500, armor: { category: 'heavy', ac: 16, strReq: 13, stealthDisadvantage: true } });
export const shield = item('Shield', { type: 'shield', magic: false, weight: 6, costCp: 1000, armor: { category: 'shield', ac: 2 } });
export const longsword = item('Longsword', { type: 'weapon', magic: false, weight: 3, costCp: 1500,
  weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', versatile: '1d10', properties: ['versatile'] } });
export const halfPlate = item('Half Plate', { type: 'armor', magic: false, weight: 40, costCp: 75000, armor: { category: 'medium', ac: 15, dexCap: 2, stealthDisadvantage: true } });
export const ringOfProtection = item('Ring of Protection', { type: 'ring', magic: true, rarity: 'rare', attunement: true, bonuses: { ac: 1, save: 1 } });
export const gauntletsOfOgrePower = item('Gauntlets of Ogre Power', { type: 'wondrous', magic: true, rarity: 'uncommon', attunement: true, effects: [{ type: 'setScore', ability: 'str', value: 19 }] });
export const potionFixture = item('Potion of Poison', { type: 'potion', magic: true, rarity: 'uncommon', consumable: true, weight: 0.5, costCp: 10000,
  text: [{ p: 'Looks like healing. {{redact:r1}}It is poison.{{/redact}}' }] });
export const sack60 = item('Sack of 60lb', { type: 'gear', magic: false, weight: 60 });

export const fixtureEntities: Entity[] = [
  human, dwarf, hillDwarf, fighter, champion, monk, barbarian, bard, rogue, wizard, cleric, warlock, ...features, defense,
  chainMail, shield, longsword, halfPlate, ringOfProtection, gauntletsOfOgrePower, potionFixture, sack60,
];
const byId = new Map(fixtureEntities.map(e => [e.id, e]));
const need = (id: string): Entity => byId.get(id) ?? (() => { throw new Error(`No fixture entity ${id}`); })();

type InvSpec = [slug: string, equipped: boolean, attuned?: boolean, view?: PlayerView];
export function mkChar(o: { race: string; subrace?: string; base: Partial<Scores>; levels: string[]; answers?: Partial<Record<Choice['type'], string[]>>; inventory?: InvSpec[] }): Character {
  const c: Character = {
    id: 'char-fix', name: 'Fixture', updatedAt: 0,
    build: {
      raceId: `race:${o.race}@FIX`, ...(o.subrace && { subraceId: `subrace:${o.subrace}@FIX` }), backgroundId: '', abilityMethod: 'manual',
      baseScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...o.base },
      levels: o.levels.map(l => ({ classId: `class:${l}@FIX` })), subclasses: {}, choices: {}, spells: {},
    },
    embedded: {},
    state: { hp: 1, tempHp: 0, hitDiceUsed: {}, slotsUsed: [], pactSlotsUsed: 0, resourcesUsed: {}, conditions: [], exhaustion: 0, deathSaves: { success: 0, fail: 0 }, inspiration: false },
    inventory: (o.inventory ?? []).map(([s, equipped, attuned, view], i) =>
      ({ ...makeEntry(need(`item:${s}@FIX`) as ItemDef, { view }), id: `entry-${i}`, equipped, attuned: attuned ?? false })),
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, overrides: {}, customEffects: [],
    details: { alignment: '', personality: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '', notes: '' },
  };
  const lookup = (id: string) => byId.get(id);
  for (const [type, vals] of Object.entries(o.answers ?? {})) {
    const p = enumerateChoices(c, lookup, DEFAULT_SETTINGS).find(p => p.choice.type === type && !p.answer);
    if (!p) throw new Error(`mkChar: no unanswered ${type} choice`);
    if (p.choice.type === 'asi') throw new Error('mkChar: answer asi choices with an explicit ChoiceAnswer');
    const amount = p.choice.type === 'ability' ? p.choice.amount : 0;
    c.build.choices[p.key] = p.choice.type === 'ability' ? { type: 'abilities', abilities: Object.fromEntries(vals.map(a => [a, amount])) } : { type: 'ids', ids: vals };
    if (type === 'subclass') { const s = need(vals[0]) as SubclassDef; c.build.subclasses[s.classId] = s.id; }
  }
  const used = new Set([c.build.raceId, c.build.subraceId ?? '', ...c.build.levels.map(l => l.classId), ...Object.values(c.build.subclasses)]);
  for (const step of walkLevels(c, lookup, DEFAULT_SETTINGS)) for (const f of step.features) used.add(f.id);
  for (const a of Object.values(c.build.choices)) if (a.type === 'ids') for (const id of a.ids) if (byId.has(id)) used.add(id);
  used.delete('');
  c.embedded = Object.fromEntries([...used].map(id => [id, need(id)]));
  return c;
}
