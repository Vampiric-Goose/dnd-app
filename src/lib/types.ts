import type { SpellRead } from './combat/spellText.ts';
import type { Hlc } from './sync/hlc.ts';
import type { SyncMeta } from './sync/merge.ts';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type Skill = 'acrobatics' | 'animal-handling' | 'arcana' | 'athletics' | 'deception' | 'history' | 'insight' | 'intimidation' | 'investigation' | 'medicine' | 'nature' | 'perception' | 'performance' | 'persuasion' | 'religion' | 'sleight-of-hand' | 'stealth' | 'survival';
export type Size = 'T' | 'S' | 'M' | 'L' | 'H' | 'G';
export type Scores = Record<Ability, number>;
export type Block = { p: string } | { list: string[] } | { table: { caption?: string; head: string[]; rows: string[][] } } | { h: string; blocks: Block[] };
export type RichText = Block[]; // inline marks: **bold**, *italic*, {{redact:ID}}…{{/redact}}
export type Speeds = { walk: number; fly?: number; swim?: number; climb?: number; burrow?: number };
export type Recharge = 'short' | 'long' | 'dawn' | 'dusk' | 'none';
export type BonusTarget = 'ac' | 'initiative' | 'hpPerLevel' | 'hpMax' | 'save.all' | `save.${Ability}` | `check.${Ability}` | `skill.${Skill}` | 'attack.melee' | 'attack.ranged' | 'attack.spell' | 'damage.melee' | 'damage.ranged' | 'spellDc' | 'passive.perception';
export type When = 'armored' | 'unarmored' | 'notHeavy' | 'noShield';
export type Effect =
  | { type: 'bonus'; target: BonusTarget; value: number | string /* formula, Task 6 */; when?: When }
  | { type: 'acBase'; base: number; abilities: Ability[]; shieldAllowed: boolean }
  | { type: 'acMin'; value: number } // AC can't be less (Barkskin)
  | { type: 'rollDice'; on: 'attack' | 'save' | 'check'; dice: string /* '1d4', '-1d4' */ } // Bless, Bane, Guidance
  | { type: 'edge'; on: 'attacksBy' | 'attacksAgainst' | `save.${Ability}`; mode: 'adv' | 'dis' } // Faerie Fire, Blur, Haste's Dex saves
  | { type: 'setScore'; ability: Ability; value: number }
  | { type: 'proficiency'; category: 'skill' | 'save' | 'tool' | 'weapon' | 'armor' | 'language'; value: string }
  | { type: 'expertise'; skill: Skill }
  | { type: 'halfProficiency'; abilities?: Ability[]; roundUp?: boolean } // no abilities = all checks + initiative
  | { type: 'damage'; kind: 'resistance' | 'immunity' | 'vulnerability'; damageType: string }
  | { type: 'speed'; mode: keyof Speeds; value: number | string; when?: When }
  | { type: 'resource'; name: string; max: string; recharge: Recharge }
  | { type: 'resourceRecharge'; name: string; recharge: Recharge }
  | { type: 'flag'; flag: 'ignoreHeavyArmorSpeed' | 'martialArts' }
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
export interface SubraceDef extends Base { kind: 'subrace'; raceId: string; speed?: Speeds; abilityBonuses: Partial<Scores>; proficiencies: Proficiencies; darkvision?: number; resist?: string[]; traits: Trait[];
  /** Race fields this subrace replaces instead of adding to (5etools `overwrite`): ability bonuses and choices, or a proficiency list and its choices. */
  overwrite?: ('ability' | keyof Proficiencies)[];
  /** Race traits this subrace's traits replace, by name (5etools entry `data.overwrite`). */
  overwriteTraits?: string[] }
export interface ClassDef extends Base { kind: 'class'; hitDie: number; sidekick?: boolean /* R11: a 5etools sidekick class (DM only) */; saves: Ability[]; proficiencies: Proficiencies; skillChoice: { count: number; from: Skill[] | 'any' }; multiclassPrereq?: MulticlassPrereq; multiclassProficiencies: Proficiencies; multiclassSkillChoice?: { count: number; from: Skill[] | 'any' }; startingEquipment: StartingEquipment; subclassLevel: number; subclassTitle: string; asiLevels: number[]; features: FeatureRef[]; spellcasting?: Spellcasting; table: { label: string; values: (number | string)[] }[]; optionalFeatureProgression: { name: string; featureTypes: string[]; counts: number[] }[] }
export interface SubclassDef extends Base { kind: 'subclass'; classId: string; shortName: string; features: FeatureRef[]; spellcasting?: Spellcasting; alwaysPrepared?: { level: number; spells: string[] }[]; optionalFeatureProgression?: { name: string; featureTypes: string[]; counts: number[] }[] }
export interface FeatureDef extends Base { kind: 'feature'; level: number; classId: string; subclassId?: string; optional?: boolean }
export interface OptionalFeatureDef extends Base { kind: 'optionalFeature'; featureTypes: string[]; prerequisite?: string }
export interface BackgroundDef extends Base { kind: 'background'; proficiencies: Proficiencies; equipment: StartingEquipment; feature: Trait }
export interface FeatDef extends Base { kind: 'feat'; prerequisite?: { abilities?: Partial<Scores>[]; spellcasting?: boolean; races?: string[]; text?: string }; abilityBonus?: Partial<Scores> }
/** A spell's mechanics as its book tags them (5etools import): saves, attack, damage types, conditions, cantrip dice by level, an area around the caster. */
export interface SpellMech { save?: Ability[]; attack?: 'melee' | 'ranged'; types?: string[]; conditions?: string[]; scaling?: Record<number, string>;
  area?: { shape: 'cone' | 'sphere' | 'cube' | 'line' | 'cylinder'; feet: number } }
export interface SpellDef extends Base { kind: 'spell'; level: number; school: string; castingTime: string; range: string; components: { v?: boolean; s?: boolean; m?: string }; duration: string; concentration: boolean; ritual: boolean; higherLevels?: RichText; classes: string[] /* class slugs, e.g. 'wizard' */; mech?: SpellMech }
export type ItemType = 'weapon' | 'armor' | 'shield' | 'ammunition' | 'gear' | 'pack' | 'tool' | 'wondrous' | 'potion' | 'ring' | 'rod' | 'scroll' | 'staff' | 'wand' | 'other';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'very rare' | 'legendary' | 'artifact' | 'varies';
export interface ItemDef extends Base { kind: 'item'; type: ItemType; magic: boolean; weight?: number; costCp?: number; rarity?: Rarity; attunement?: boolean | string; baseItemId?: string; consumable?: boolean; category?: string /* gear/tool category, e.g. 'holy-symbols'; weapons and armor use weapon/armor.category */; curse?: RichText;
  weapon?: { category: 'simple' | 'martial'; ranged: boolean; damage: string; damageType: string; versatile?: string; properties: string[]; range?: [number, number] };
  armor?: { category: 'light' | 'medium' | 'heavy' | 'shield'; ac: number; dexCap?: number /* undefined = no cap */; strReq?: number; stealthDisadvantage?: boolean };
  bonuses?: { attack?: number; damage?: number; ac?: number; save?: number; spellAttack?: number; spellDc?: number };
  charges?: { max: number; recharge: Recharge; rechargeAmount?: string };
  redactionSeq?: number /* I3: highest redaction id ever issued for this item; never shown to players */ }
export interface ConditionDef extends Base { kind: 'condition' }
export interface MonsterDef extends Base {
  kind: 'monster';
  size: Size[]; // usually one; some 5etools monsters list several ("Medium or Small")
  type: string; // display form, e.g. 'humanoid (goblinoid)', 'swarm of Tiny beasts'
  alignment: string; // display form, e.g. 'neutral evil', 'unaligned', 'any alignment'
  ac: { value: number; from?: string }[]; // first entry is the main AC
  hp: { average: number; formula?: string } | { special: string };
  speed: Speeds & { hover?: boolean; note?: string };
  scores: Scores;
  saves: Partial<Record<Ability, number>>; // printed bonuses
  skills: Partial<Record<Skill, number>>; // printed bonuses
  vulnerable: string[]; resist: string[]; immune: string[]; conditionImmune: string[]; // display strings
  senses: string[]; passive: number; languages: string[];
  cr: string; // '0', '1/8', '1/4', '1/2', '1'…'30', or '—'
  xp?: number; // only when the book prints XP other than its CR's (read it with monsterXp); drop it when the CR is edited
  traits: Trait[]; actions: Trait[]; bonusActions: Trait[]; reactions: Trait[];
  legendary: Trait[]; legendaryCount?: number; legendaryIntro?: RichText;
  mythic?: Trait[]; mythicIntro?: RichText; lair?: RichText; regional?: RichText;
  environment?: string[];
} // spellcasting and innate spellcasting are traits (or actions) whose text lists the spells
export type Entity = RaceDef | SubraceDef | ClassDef | SubclassDef | FeatureDef | OptionalFeatureDef | BackgroundDef | FeatDef | SpellDef | ItemDef | ConditionDef | MonsterDef;
export type EntityKind = Entity['kind'];
export type EntityOfKind<K extends EntityKind> = Extract<Entity, { kind: K }>;
export interface EntityPatch { targetId: string; alias: string; text?: RichText; /** a spell's book mechanics */ mech?: SpellMech; addFeatures?: FeatureRef[]; /** monsters: the book's lair actions and regional effects */ lair?: RichText; regional?: RichText }
export interface Pack { id: string; name: string; source: string; homebrew?: boolean; importedAt: number; hash: string; entities: Entity[]; patches: EntityPatch[]; sharedBy?: string /* stage 3: received from this campaign's DM */ }
export interface PackMeta { id: string; name: string; source: string; homebrew?: boolean; importedAt: number; hash: string; counts: Partial<Record<EntityKind, number>>; sharedBy?: string }
export type HideableField = 'rarity' | 'attunement' | 'bonuses' | 'effects' | 'charges' | 'curse';
export interface PlayerView { name?: string; text?: RichText; hidden: HideableField[]; revealed: string[] }
export interface InventoryEntry { id: string; item: ItemDef; sourceId?: string; quantity: number; equipped: boolean; attuned: boolean; chargesUsed: number; notes: string; view?: PlayerView }
export interface StoredItem extends ItemDef { campaignId: string; defaultView?: PlayerView; updatedAt: number }
export interface StoredMonster extends MonsterDef { campaignId: string; updatedAt: number }
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
  sync?: SyncMeta; // stage 3: per-path clocks, set by saves in a synced campaign
}
export interface CampaignSettings { allowOverrides: boolean; customOrigin: boolean; optionalClassFeatures: boolean; multiclassing: boolean; feats: boolean; hpMethod: 'average' | 'roll'; encumbrance: 'off' | 'standard' | 'variant'; crSuggestion: boolean; fog: boolean; diagonal: '5-5-5' | '5-10-5'; freeMovement: boolean; monsterHp: 'average' | 'roll';
  initiativeModules: { hp: boolean; conditions: boolean; deathSaves: boolean; concentration: boolean; legendary: boolean; lair: boolean; reactions: boolean }; showMonsterHealth: boolean;
  /** Targeted actions (map targeting, automatic hits, saves and damage): on unless false. */ targeting?: boolean;
  /** Ask about reactions (Opportunity Attacks, Counterspell, Shield, Hellish Rebuke) as they happen: on unless false. */ reactions?: boolean;
  /** House rule: a critical hit doubles its whole damage total (rolled once), not just its dice: on unless false. */ critAll?: boolean }
export interface Campaign { id: string; name: string; createdAt: number; updatedAt: number; settings: CampaignSettings; enabledPacks: string[]; loot: InventoryEntry[]; sync?: CampaignSync }
/** Stage 3: a hosted (dm) or joined (player) campaign. `node`: this device's random 8-character HLC node id; `last`: its latest HLC. */
export interface CampaignSync { role: 'dm' | 'player'; code: string; node: string; last?: Hlc;
  players?: Record<string, { name?: string; removed?: boolean }>; playerId?: string /* role player */; deleted?: Record<string, Hlc> /* character id tombstones */ }
/** Stage 4: when a condition ends: after `rounds` (≥ 1) matching triggers, at the start or end of combatant `of`'s turn. */
export interface Duration { rounds: number; at: 'start' | 'end'; of: string }
export interface Combatant {
  id: string; kind: 'pc' | 'monster' | 'lair'; name: string;
  characterId?: string;                  // pc
  monsterId?: string; ac?: number;       // monster (ac shown to the DM only)
  portrait?: string;                     // monster: the library's portrait (blob hash), for the token it gets
  group?: string;                        // grouped identical monsters share it (= monsterId) and act as one turn
  init?: number;                         // undefined = not rolled (sorts last)
  initMod: number; dex: number;          // dex: the Dex SCORE, tiebreak 1
  tie: number;                           // tiebreak 2: rng() in [0,1), stored when added, so the order is stable
  conSave: number;                       // for the concentration prompt
  hidden?: boolean;
  hp?: number; maxHp?: number; tempHp?: number;  // monsters only (a PC's live on the character)
  conditions?: string[];                 // monsters only (a PC's are character.state.conditions)
  durations?: Record<string, Duration>;  // condition name → when it ends (PCs too)
  concentrating?: boolean; /** the spell it concentrates on (its name), and how many concentration spells it has cast (which casting it is) */ concentratingOn?: string; concentrationCount?: number;
  /** the slot its concentration spell was cast with (its repeats' dice: turnActions.ts againOf) */ concentrationSlot?: number;
  /** extra damage on its weapon hits from a spell it cast (`type` '' = the weapon's): the next hit only (`once`), or hits on `target` */
  rider?: { spell: string; dice: string; type: string; once?: true; target?: string; /** spell attacks too (Hex) */ anyAttack?: true }; legendary?: { max: number; used: number }; reactionUsed?: boolean; notes?: string;
  economy?: { used: number; extra: number; bonus: boolean; attacks: number; light?: boolean; surged?: boolean; haste?: boolean; object?: boolean; readied?: boolean; bonusSpell?: boolean; leveledSpell?: boolean; dodging?: boolean; disengaging?: boolean }; // this turn (dodging: took the Dodge action; it lasts until this resets at its next turn): Actions used, extra Actions, Bonus action, attacks in the Attack action, attacked with a light melee weapon (two-weapon fighting), Action Surge used, one extra Action is Haste's, the free object interaction used, an action readied, a bonus-action spell cast, a spell other than an action cantrip cast (absent: fresh)
  hasted?: { by: string; round: number; ended?: true };
  /** summoned by `by`'s casting of `spell` (`cast`: its concentration count, when it needs concentration); it leaves with it (summons.ts) */
  summon?: { by: string; spell: string; cast?: number };
  spellsUsed?: Record<string, number>; // a monster's spell slots ('slot:3') and per-day spells ('day:<spell id>') used this fight // the Hasted condition: the caster's combatant id and the round cast; ended: the caster cast another concentration spell
}
/** The live fight of a campaign. `combatants` is the order; round 0 = setup; `turn` = the current combatant's id. */
export interface Combat { campaignId: string; combatants: Combatant[]; round: number; turn?: string; groupMonsters: boolean; updatedAt: number;
  /** S4-R2: the DM reordered by hand since the last Sort or add, so Start keeps the order. */ reordered?: boolean;
  /** M1: turn boundaries already applied (`round:e|s:turnId`), so Previous then Next never ticks one twice. */ done?: string[];
  /** Combatant id → its movement this turn (dropped where its own turn starts). */ movement?: Record<string, Movement>;
  /** creatures that entered a lasting area (Cloudkill) on a turn: `turn` is whose turn it was, in `round` (aiming.ts noteEntries) */ entered?: { rid: string; id: string; round: number; turn: string }[];
  /** The saved encounter this fight was resumed from (Group C). */ encounterId?: string;
  /** This fight's identity: new when a fight is made or resumed, kept by saves (the map's arrows end with it). */ fightId?: string;
  /** The map's Start combat: round 1 starts by itself once every initiative is in (the players' rolls). */ autoStart?: true;
  /** The DM asked the party to roll initiative: players get a pop-up during setup. */ askInit?: true;
  /** Targeting: the last 20 targeted uses worked out on the DM's device, newest last (the DM's Results list, Undo, PC saves). */ resolutions?: Resolution[] }
/** One target's part of a targeted use: an attack's hit, or a save. `pending`: a PC's save its player still rolls (`owed`: the damage before it). */
export interface Outcome {
  id: string /* combatant */; part?: 'hit' | 'save';
  hit?: boolean; nat?: 20 | 1; /** the natural d20 kept */ die?: number; /** it rolled two d20s (advantage or disadvantage); `first`: the first, a straight roll's */ two?: { mode: 'adv' | 'dis'; first: number }; roll?: number; ac?: number /* the DM's Results list (a Combat never reaches players) */; edge?: string /* why it had advantage or disadvantage */;
  save?: { roll: number; total: number; ok: boolean };
  damage: number; note?: string;
  pending?: true; owed?: { amount: number; type: string }[];
  /** conditions a failed save left (`inflicts`: what a PC's pending save would leave on a failure; `ends`: what a repeat save ends on a success) */ inflict?: string[]; inflicts?: string[]; ends?: string[];
  /** its dice matched: the spell may leap to another creature (Chaos Bolt) */ leap?: true;
  /** a hit waiting for its caster's player to pick the die that sets the type (Chaos Bolt): each pick's damage, worked out already */
  choose?: { face: number; type: string; damage: number; note?: string }[];
  /** damage still to come at the end of the target's next turn (Acid Arrow), applied then by turn() */ later?: number;
  /** a helpful spell's healing and temporary hit points */ heal?: number; temp?: number;
}
/** What a result took off a combatant (HP and temp HP), and a PC's dying state before it, so Undo puts back exactly that. */
export interface Applied { id: string; hp: number; temp: number; dying?: { deathSaves: { success: number; fail: number }; stable: boolean; dead: boolean };
  /** the Con save DC to keep concentrating (the hit left it standing) */ conc?: number }
export interface Resolution { id: string; actor: string /* combatant */; action: string /* its name */; dc?: number; ability?: Ability; onSave?: 'half' | 'none'; /** its `later` damage has landed */ laterDone?: true;
  outcomes: Outcome[]; applied: Applied[]; at: number; /** an area's catch (combatant ids), for the DM's list */ caught?: string[];
  /** Undo: the creatures it touched (combatants, and PCs' character state) before it was paid for, and after it landed. */ undo?: { before: Snap; after: Snap };
  /** A spell's area as cast, on scene `sceneId` in `round`; `lasting`: a concentration spell's, shown while its caster concentrates. */
  area?: Area; sceneId?: string; round?: number; lasting?: true; /** its area goes with its caster (Spirit Guardians) */ follows?: true; /** whose turn an area roll was on */ turn?: string; /** the round its area last drifted (Cloudkill) */ drifted?: number;
  /** the conditions it left, which end with the spell; `rounds`: a non-concentration spell's length */ inflicted?: { id: string; condition: string; /** a monster's save bonus, for its repeat saves */ bonus?: number }[]; rounds?: number;
  /** its targets save again at the end of each of their turns */ repeat?: true;
  /** a marked rider spell (Hex): the creature marked and the rider its caster now has; `spent`: a hit used a once-only rider */ mark?: string; rider?: Combatant['rider']; spent?: true;
  /** a leaping spell (Chaos Bolt): the creatures it has hit so far this casting, and whether this hit's leap was taken; `slot`: the slot it was cast with */ chain?: string[]; leapt?: true; slot?: number;
  /** a concentration spell's casting: its caster's concentrationCount once it is paid for */ cast?: number;
  /** damage over time (Moonbeam): its dice, reading and DC, rolled when a creature starts its turn in the area */ linger?: { dice: { expr: string; type: string }[]; read: SpellRead; dc?: number } }
/** An area on the map (as a map template: a cone's or line's length, a sphere's or cylinder's radius, a cube's side, in ft). */
export interface Area { shape: 'cone' | 'sphere' | 'cube' | 'line' | 'cylinder'; origin: { x: number; y: number }; aim: { x: number; y: number }; feet: number; width?: number }
export interface Snap { combatants: Record<string, Combatant>; states: Record<string, Character['state']> }
/** Map ↔ combat: where the token stood when its turn's movement began (set by its first move) and Dashes taken this turn. */
export interface Movement { from?: { x: number; y: number }; dashes: number; /** speed multiplier this turn: 2 Hasted, 0 after Haste ends */ mult?: number;
  /** stood up from prone this turn: half the speed spent */ stood?: true;
  /** feet walked this turn (the running total; an old saved fight has none: origin distance) */ used?: number; /** diagonals walked this turn (5-10-5 parity) */ diags?: number }
/** A fight saved into an encounter: the whole combat, plus the shown scene's tokens and fog at save time (none when no scene was shown). */
export interface SavedFight { combat: Combat; map?: { sceneId: string; tokens: Token[]; fog?: string }; savedAt: number }
/** A prepared encounter (at most 50 lines, each count 1–99), or a saved fight (`fight`, with `monsters` empty). */
export interface Encounter { id: string; campaignId: string; name: string; monsters: { monsterId: string; name?: string /* when prepared, to name it once it is gone */; count: number;
  /** the library's own touches: a name its creatures take (numbered), a portrait (blob hash), max HP and AC */ label?: string; portrait?: string; hp?: number; ac?: number }[]; fight?: SavedFight; updatedAt: number }
export interface Attack { entryId: string; name: string; toHit: number; damage: string; damageType: string; versatile?: string; properties: string[]; ranged?: true; range?: [number, number] /* normal, long (ft) */ }
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

// Stage 5: the battle map.
export interface Grid { type: 'square' | 'hex-flat' | 'hex-pointy'; size: number /* px between neighbouring cell centres */; offsetX: number; offsetY: number; color: string /* #rrggbb */; opacity: number; feet: number }
export interface Token { id: string; name: string; x: number; y: number /* centre, scene px */; size: Size; color: string; portrait?: string /* blob hash */; hidden?: boolean;
  characterId?: string; monsterId?: string; hp?: number; maxHp?: number /* monster instance state */; combatantId?: string /* C3: linked monster combatant */;
  /** a monster's own AC (the library's), DM only: players' scenes never carry it */ ac?: number;
  /** Transient: the squares (token centres, ≤200) walked in the write that set it, ending where it stands; any other write drops it (db.scenes.update). */ trail?: { x: number; y: number }[] }
export interface Scene { id: string; campaignId: string; name: string; image?: string /* blob hash */; width: number; height: number; grid: Grid; tokens: Token[]; fog?: string /* C */; shown?: boolean; updatedAt: number;
  /** Walls, low walls, arrow slits and doors the DM drew (map/walls.ts) */ walls?: import('./map/walls.ts').Wall[] }
