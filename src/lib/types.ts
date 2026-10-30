export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type Skill = 'acrobatics' | 'animal-handling' | 'arcana' | 'athletics' | 'deception' | 'history' | 'insight' | 'intimidation' | 'investigation' | 'medicine' | 'nature' | 'perception' | 'performance' | 'persuasion' | 'religion' | 'sleight-of-hand' | 'stealth' | 'survival';
export type Size = 'T' | 'S' | 'M' | 'L' | 'H' | 'G';
export type Scores = Record<Ability, number>;
export type Block = { p: string } | { list: string[] } | { table: { caption?: string; head: string[]; rows: string[][] } } | { h: string; blocks: Block[] };
export type RichText = Block[]; // inline marks: **bold**, *italic*, {{redact:ID}}…{{/redact}}
export type Speeds = { walk: number; fly?: number; swim?: number; climb?: number; burrow?: number };
export type Recharge = 'short' | 'long' | 'dawn' | 'dusk' | 'none';
export type BonusTarget = 'ac' | 'initiative' | 'hpPerLevel' | 'save.all' | `save.${Ability}` | `check.${Ability}` | `skill.${Skill}` | 'attack.melee' | 'attack.ranged' | 'attack.spell' | 'damage.melee' | 'damage.ranged' | 'spellDc' | 'passive.perception';
export type When = 'armored' | 'unarmored' | 'notHeavy' | 'noShield';
export type Effect =
  | { type: 'bonus'; target: BonusTarget; value: number | string /* formula, Task 6 */; when?: When }
  | { type: 'acBase'; base: number; abilities: Ability[]; shieldAllowed: boolean }
  | { type: 'setScore'; ability: Ability; value: number }
  | { type: 'proficiency'; category: 'skill' | 'save' | 'tool' | 'weapon' | 'armor' | 'language'; value: string }
  | { type: 'expertise'; skill: Skill }
  | { type: 'halfProficiency'; abilities?: Ability[]; roundUp?: boolean } // no abilities = all checks + initiative
  | { type: 'damage'; kind: 'resistance' | 'immunity' | 'vulnerability'; damageType: string }
  | { type: 'speed'; mode: keyof Speeds; value: number | string; when?: When }
  | { type: 'resource'; name: string; max: string; recharge: Recharge }
  | { type: 'resourceRecharge'; name: string; recharge: Recharge }
  | { type: 'flag'; flag: 'ignoreHeavyArmorSpeed' }
  | { type: 'note'; text: string };
export interface Trait { name: string; text: RichText; effects?: Effect[]; choices?: Choice[] }
export type Choice =
  | { type: 'asi' } | { type: 'subclass' } | { type: 'feat' }
  | { type: 'skill'; count: number; from: Skill[] | 'any' }
  | { type: 'expertise'; count: number }
  | { type: 'language'; count: number; from?: string[] }
  | { type: 'tool'; count: number; from?: string[] }
  | { type: 'ability'; count: number; amount: number; from: Ability[] }
  | { type: 'optionalFeature'; count: number; featureTypes: string[] }
  | { type: 'option'; count: number; options: Trait[] };
export type ChoiceAnswer =
  | { type: 'asi'; abilities?: Partial<Scores>; featId?: string }
  | { type: 'ids'; ids: string[] } // subclass/feat/optional-feature ids, skill/tool/language names, option names
  | { type: 'abilities'; abilities: Partial<Scores> };
export interface Proficiencies { armor: string[]; weapons: string[]; tools: string[]; skills: Skill[]; languages: string[] }
export interface MulticlassPrereq { all?: Partial<Scores>; any?: Partial<Scores> }
export type Progression = 'full' | 'half' | 'third' | 'pact' | 'artificer';
export interface Spellcasting { ability: Ability; progression: Progression; preparation: 'known' | 'prepared'; spellbook?: boolean; cantrips?: number[]; known?: number[]; preparedFormula?: string; alwaysPrepared?: { level: number; spells: string[] }[] }
export interface FeatureRef { level: number; id: string }
export interface EquipmentOption { label: string; items: { itemId?: string; category?: string; quantity: number }[] }
export interface StartingEquipment { text: RichText; choices: EquipmentOption[][]; gold?: string }
interface Base { id: string; name: string; source: string; aliases?: string[]; text: RichText; effects?: Effect[]; choices?: Choice[]; srd?: boolean }
export interface RaceDef extends Base { kind: 'race'; size: Size; speed: Speeds; abilityBonuses: Partial<Scores>; proficiencies: Proficiencies; darkvision?: number; resist?: string[]; traits: Trait[] }
export interface SubraceDef extends Base { kind: 'subrace'; raceId: string; speed?: Speeds; abilityBonuses: Partial<Scores>; proficiencies: Proficiencies; darkvision?: number; resist?: string[]; traits: Trait[] }
export interface ClassDef extends Base { kind: 'class'; hitDie: number; saves: Ability[]; proficiencies: Proficiencies; skillChoice: { count: number; from: Skill[] | 'any' }; multiclassPrereq?: MulticlassPrereq; multiclassProficiencies: Proficiencies; multiclassSkillChoice?: { count: number; from: Skill[] | 'any' }; startingEquipment: StartingEquipment; subclassLevel: number; subclassTitle: string; asiLevels: number[]; features: FeatureRef[]; spellcasting?: Spellcasting; table: { label: string; values: (number | string)[] }[]; optionalFeatureProgression: { name: string; featureTypes: string[]; counts: number[] }[] }
export interface SubclassDef extends Base { kind: 'subclass'; classId: string; shortName: string; features: FeatureRef[]; spellcasting?: Spellcasting; alwaysPrepared?: { level: number; spells: string[] }[] }
export interface FeatureDef extends Base { kind: 'feature'; level: number; classId: string; subclassId?: string; optional?: boolean }
export interface OptionalFeatureDef extends Base { kind: 'optionalFeature'; featureTypes: string[]; prerequisite?: string }
export interface BackgroundDef extends Base { kind: 'background'; proficiencies: Proficiencies; equipment: StartingEquipment; feature: Trait }
export interface FeatDef extends Base { kind: 'feat'; prerequisite?: { abilities?: Partial<Scores>[]; spellcasting?: boolean; races?: string[]; text?: string }; abilityBonus?: Partial<Scores> }
export interface SpellDef extends Base { kind: 'spell'; level: number; school: string; castingTime: string; range: string; components: { v?: boolean; s?: boolean; m?: string }; duration: string; concentration: boolean; ritual: boolean; higherLevels?: RichText; classes: string[] /* class slugs, e.g. 'wizard' */ }
export type ItemType = 'weapon' | 'armor' | 'shield' | 'ammunition' | 'gear' | 'pack' | 'tool' | 'wondrous' | 'potion' | 'ring' | 'rod' | 'scroll' | 'staff' | 'wand' | 'other';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'very rare' | 'legendary' | 'artifact' | 'varies';
export interface ItemDef extends Base { kind: 'item'; type: ItemType; magic: boolean; weight?: number; costCp?: number; rarity?: Rarity; attunement?: boolean | string; baseItemId?: string; consumable?: boolean; category?: string /* gear/tool category, e.g. 'holy-symbols'; weapons and armor use weapon/armor.category */; curse?: RichText;
  weapon?: { category: 'simple' | 'martial'; ranged: boolean; damage: string; damageType: string; versatile?: string; properties: string[]; range?: [number, number] };
  armor?: { category: 'light' | 'medium' | 'heavy' | 'shield'; ac: number; dexCap?: number /* undefined = no cap */; strReq?: number; stealthDisadvantage?: boolean };
  bonuses?: { attack?: number; damage?: number; ac?: number; save?: number; spellAttack?: number; spellDc?: number };
  charges?: { max: number; recharge: Recharge; rechargeAmount?: string } }
export interface ConditionDef extends Base { kind: 'condition' }
export type Entity = RaceDef | SubraceDef | ClassDef | SubclassDef | FeatureDef | OptionalFeatureDef | BackgroundDef | FeatDef | SpellDef | ItemDef | ConditionDef;
export type EntityKind = Entity['kind'];
export type EntityOfKind<K extends EntityKind> = Extract<Entity, { kind: K }>;
export interface EntityPatch { targetId: string; alias: string; text?: RichText; addFeatures?: FeatureRef[] }
export interface Pack { id: string; name: string; source: string; importedAt: number; hash: string; entities: Entity[]; patches: EntityPatch[] }
export interface PackMeta { id: string; name: string; source: string; importedAt: number; hash: string; counts: Partial<Record<EntityKind, number>> }
export type HideableField = 'rarity' | 'attunement' | 'bonuses' | 'effects' | 'charges' | 'curse';
export interface PlayerView { name?: string; text?: RichText; hidden: HideableField[]; revealed: string[] }
export interface InventoryEntry { id: string; item: ItemDef; sourceId?: string; quantity: number; equipped: boolean; attuned: boolean; chargesUsed: number; notes: string; view?: PlayerView }
export interface StoredItem extends ItemDef { campaignId: string; defaultView?: PlayerView; updatedAt: number }
export type OverrideKey = 'ac' | 'initiative' | 'speed' | 'maxHp' | 'prof' | 'passivePerception' | 'spellDc' | 'spellAttack' | `score.${Ability}` | `save.${Ability}` | `skill.${Skill}`;
export interface Character {
  id: string; name: string; campaignId?: string; ownerId?: string; updatedAt: number; imported?: 'unverified';
  build: { raceId: string; subraceId?: string; backgroundId: string; abilityMethod: 'pointBuy' | 'standard' | 'rolled' | 'manual'; baseScores: Scores; customOrigin?: Partial<Scores>;
    levels: { classId: string; hpRoll?: number }[]; subclasses: Record<string, string>; choices: Record<string, ChoiceAnswer>;
    spells: Record<string, { known: string[]; prepared: string[] }> };
  embedded: Record<string, Entity>;
  state: { hp: number; tempHp: number; hitDiceUsed: Record<number, number>; slotsUsed: number[]; pactSlotsUsed: number; resourcesUsed: Record<string, number>; conditions: string[]; exhaustion: number; deathSaves: { success: number; fail: number }; stable?: boolean; dead?: boolean; inspiration: boolean };
  inventory: InventoryEntry[]; currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  overrides: Partial<Record<OverrideKey, number>>; customEffects: Effect[];
  details: { alignment: string; personality: string; ideals: string; bonds: string; flaws: string; appearance: string; backstory: string; notes: string; portrait?: string };
}
export interface CampaignSettings { allowOverrides: boolean; customOrigin: boolean; optionalClassFeatures: boolean; multiclassing: boolean; feats: boolean; hpMethod: 'average' | 'roll'; encumbrance: 'off' | 'standard' | 'variant'; crSuggestion: boolean; fog: boolean; diagonal: '5-5-5' | '5-10-5'; freeMovement: boolean; monsterHp: 'average' | 'roll';
  initiativeModules: { hp: boolean; conditions: boolean; deathSaves: boolean; concentration: boolean; legendary: boolean; lair: boolean; reactions: boolean }; showMonsterHealth: boolean }
export interface Campaign { id: string; name: string; createdAt: number; updatedAt: number; settings: CampaignSettings; enabledPacks: string[]; loot: InventoryEntry[] }
export interface Attack { entryId: string; name: string; toHit: number; damage: string; damageType: string; versatile?: string; properties: string[] }
export interface Sheet {
  totalLevel: number; prof: number; scores: Scores; mods: Scores;
  saves: Record<Ability, { bonus: number; proficient: boolean }>;
  skills: Record<Skill, { bonus: number; proficient: boolean; expertise: boolean }>;
  passivePerception: number; initiative: number; ac: number; speed: Speeds; maxHp: number;
  hitDice: { die: number; total: number }[]; attacks: Attack[];
  spellcasting: { classId: string; ability: Ability; dc: number; attack: number; cantrips: number; known?: number; prepared?: number; maxLevel: number }[];
  slots: number[] /* slots[0] = 1st-level count */; pact?: { slots: number; level: number };
  resources: { name: string; max: number; recharge: Recharge }[];
  proficiencies: Proficiencies; resistances: string[]; immunities: string[]; vulnerabilities: string[];
  notes: { source: string; text: string }[];
  carrying: { weight: number; capacity: number; encumbrance: 'none' | 'encumbered' | 'heavy' | 'over' };
  attunedCount: number; overridden: OverrideKey[]; warnings: string[];
}
