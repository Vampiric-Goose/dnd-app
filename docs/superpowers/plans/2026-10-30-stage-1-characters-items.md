# Stage 1 (Foundation, Characters, Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship stage 1 of dnd-app to GitHub Pages:
- campaigns, local storage and backups
- the built-in SRD plus 5etools import, and a compendium
- the 2014 character creator, level-up and play-mode sheet, and a dice roller
- magic items with DM-controlled player views, inventory and party loot
- JSON and PDF import/export for characters and items

**Architecture:**
- A static Svelte 5 single-page app with hash routing, storing everything in IndexedDB.
- All rules content (the SRD, generated at build time from 5e-database, and user-imported
  5etools files) is converted into one internal entity format. A `ContentIndex` serves it.
- A character stores build choices plus an embedded copy of the entities it uses. A pure
  `computeSheet()` derives every number from those.
- Heavy code (the importer, pdf-lib) loads lazily.

**Tech Stack:** TypeScript ~6.0.3, Svelte ^5.57.3, Vite ^8.3.5, @sveltejs/vite-plugin-svelte
^7.3.1, Vitest ^5.0.5, svelte-check ^4.7.7, idb ^8.0.4, pdf-lib ^1.17.1, fake-indexeddb ^6.2.7
(tests), Node 24 (scripts run as `.ts` with native type stripping).

**Spec:** `docs/superpowers/specs/2026-10-30-dnd-app-design.md`. Executors read both documents.
This plan covers stage 1 only. Stages 2 to 6 get their own plans, written once stage 1's real
code exists.

## Global Constraints

- Only SRD 5.1 content ships in the repo or the build.
- No hardcoded links to, or fetching from, 5etools or any other content site. The user picks
  files from disk.
- Test fixtures are written by us in 5etools format, not copied from books. The official
  character sheet PDF isn't committed. Tests build a synthetic PDF with the same field names.
- No WotC logos or trade dress, and no "Dungeons & Dragons" in the display name. The display
  name lives in one constant, `APP_NAME = 'dnd-app'`, in `src/lib/app.ts`.
- The SRD attribution must appear verbatim on the About page: *"This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode."*
- At most about 150 KB of gzipped JS on first load. PDF and import code load lazily. The SRD
  data loads lazily and is cached in IndexedDB.
- 2014 rules only. Import skips 2024 entries (the XPHB, XDMG and XMM sources, and anything
  marked `edition: "one"`).
- Routing uses URL hashes. Vite `base` is `/dnd-app/`. The site is served at
  `https://vampiric-goose.github.io/dnd-app/` from the public repo `Vampiric-Goose/dnd-app`.
- No service worker. Include a web app manifest, so iOS users can add the app to the Home
  Screen.
- Browsers: the last two versions of Chrome, Edge, Firefox and Safari (iOS 16+). Layout works
  at 375 px wide.
- Accessibility basics: labelled controls, keyboard use for the sheet, and readable contrast in
  light and dark themes (which follow the system).
- Storage is IndexedDB, with images stored as blobs keyed by SHA-256 hash. Call
  `navigator.storage.persist()`.
- Real test data lives in `C:\Users\bestj\dnd-app-testdata\` and is never committed or copied
  into the repo.
- Every import path is `.ts`-suffixed (`import { x } from './x.ts'`). This lets Node scripts
  share `src/lib` code. Code under `src/lib` must not use Vite-only syntax, except in
  `src/lib/content/srd.ts`.

## Review Focus

These are the inputs most likely to break the app for a real user. Each is pinned by a test
in the owning task.

1. **Wrong, broken or partly unsupported import files**, such as a random JSON file, a race
   missing its name, or an unknown `_mod` mode. Expected: per-file errors are listed, everything
   valid still imports, existing packs are untouched, and nothing throws. *(Task 11)*
2. **Storage write failure** (quota full, Safari private mode). Expected: the write rejects with
   `StorageError('Could not save: …')`, the UI shows it, and in-memory edits are kept.
   *(Task 3, Task 17)*
3. **A character whose embedded content is incomplete**, for example a hand-edited JSON import.
   Expected: the sheet renders with a warning (`Missing class: …`) and doesn't crash. *(Task 8)*
4. **Non-Latin text in PDF export**, such as emoji or CJK in a name. Expected: export succeeds,
   the visible fields show `?` for characters they can't print, and re-import restores the
   exact text. *(Task 20)*
5. **5etools schema drift**, such as pipe-suffixed codes (`"M|XPHB"`), spell class lists stored
   inside the spell versus in `sources.json`, and progression arrays versus `{level: count}`
   objects. Expected: every form parses. *(Tasks 11, 12)*

---

### Task 1: Scaffold, app shell, deploy pipeline

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `svelte.config.js`, `index.html`,
  `.gitignore`, `src/main.ts`, `src/App.svelte`, `src/app.css`, `src/lib/app.ts`,
  `src/lib/router.svelte.ts`, `src/ui/pages/About.svelte`, `public/manifest.webmanifest`,
  `scripts/make-icons.ts`, `public/icon-192.png`, `public/icon-512.png`,
  `public/apple-touch-icon.png`, `scripts/check-size.ts`, `.github/workflows/deploy.yml`
- Test: `tests/router.test.ts`

**Interfaces:**
- Produces:
  - `parseHash(hash: string): { path: string[]; query: URLSearchParams }`
  - `router` (a reactive `$state` object `{ path: string[]; query: URLSearchParams }` that
    updates on `hashchange`)
  - `navigate(path: string): void` (sets `location.hash = '#/' + path`)
  - `APP_NAME` and `SRD_ATTRIBUTION` in `src/lib/app.ts`
- **Route table.** `App.svelte` lazy-imports one page component per route and shows a "Not
  built yet" placeholder until a later task fills it in:

  | Path | Page |
  | --- | --- |
  | `''` | Campaigns |
  | `characters` | Characters |
  | `characters/new` | Creator |
  | `characters/:id` | Sheet |
  | `characters/:id/level-up` | LevelUp |
  | `compendium` | Compendium |
  | `items` | Items |
  | `items/:id` | ItemEditor |
  | `loot` | Loot |
  | `packs` | Packs |
  | `settings` | CampaignSettings |
  | `about` | About |

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'vitest';
import { parseHash } from '../src/lib/router.svelte.ts';
test('parseHash splits path and query', () => {
  const r = parseHash('#/characters/x1?tab=spells');
  expect(r.path).toEqual(['characters', 'x1']);
  expect(r.query.get('tab')).toBe('spells');
  expect(parseHash('').path).toEqual([]);
  expect(parseHash('#/').path).toEqual([]);
});
```

- [ ] **Step 2: Scaffold the project**
  - `package.json`: `"type": "module"`. Dependencies at the Tech Stack versions.
  - Scripts:

    | Script | Command |
    | --- | --- |
    | `dev` | `vite` |
    | `build` | `vite build` |
    | `preview` | `vite preview` |
    | `test` | `vitest run` |
    | `check` | `svelte-check --tsconfig ./tsconfig.json` |
    | `size` | `node scripts/check-size.ts` |
    | `build:srd` | `node scripts/build-srd.ts` |
    | `import-check` | `node scripts/import-check.ts` |

  - `tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`,
    `erasableSyntaxOnly`, `moduleResolution: "bundler"`, `target: "es2022"`,
    `types: ["svelte", "vite/client"]`.
  - `vite.config.ts`: `base: '/dnd-app/'`, the svelte plugin, and `test.environment: 'node'`.
  - `.gitignore`: `node_modules`, `dist`, `*.local`.
- [ ] **Step 3: Run `npx vitest run tests/router.test.ts`.** Expected: FAIL (module not found).
- [ ] **Step 4: Implement the router and the shell**
  - **Navigation:** a bottom tab bar below 768 px and a left sidebar from 768 px. Entries:
    Campaigns, Characters, Compendium, Items, Loot, Packs, About.
  - A header slot for the current-campaign picker (filled in by Task 13).
  - **CSS:** colors as custom properties on `:root`, redefined under
    `@media (prefers-color-scheme: dark)`. `body` gets an explicit background.
  - **About** renders `SRD_ATTRIBUTION` verbatim.
- [ ] **Step 5: Icons and manifest**
  - `scripts/make-icons.ts` writes PNGs at 180, 192 and 512 px using only `node:zlib`, with a
    hand-written PNG encoder: a d20 silhouette (a hexagon with an inner triangle) in the accent
    color on the dark background color. Commit the outputs.
  - The manifest has `name: APP_NAME`, `display: "standalone"`, `start_url: "./"` and the icons.
  - `index.html` links the manifest and the apple-touch-icon, and sets
    `<meta name="apple-mobile-web-app-capable" content="yes">`.
- [ ] **Step 6: `scripts/check-size.ts`**
  - Parse `dist/index.html` for `<script type="module" src>` and `<link rel="modulepreload" href>`.
  - Gzip each file (`zlib.gzipSync`, level 9) and print the total.
  - Exit with code 1 if the total is over `150 * 1024` bytes.
- [ ] **Step 7: `.github/workflows/deploy.yml`**
  - Triggers: `push` to `main`, and `workflow_dispatch`.
  - Permissions: `pages: write`, `id-token: write`, `contents: read`.
  - **Build job:** checkout, setup-node 24 with an npm cache, then `npm ci`, `npm run check`,
    `npm test`, `npm run build`, `npm run size`, and upload-pages-artifact from `dist`.
  - **Deploy job:** deploy-pages.
- [ ] **Step 8: Run the checks.** Run `npx vitest run`, `npm run check`, `npm run build` and
  `npm run size`. Expected: all pass, and size prints under the budget.
- [ ] **Step 9: Commit and publish**

```bash
git add -A
git commit -m "feat: scaffold app shell, router, manifest, size budget, Pages deploy"
gh repo create Vampiric-Goose/dnd-app --public --source . --push
gh api -X POST repos/Vampiric-Goose/dnd-app/pages -f build_type=workflow
gh run watch --exit-status
curl -sI https://vampiric-goose.github.io/dnd-app/ | head -1
```
Expected: the run succeeds, and the last line is `HTTP/2 200`.

---

### Task 2: Shared types, IDs, ContentIndex

**Files:**
- Create: `src/lib/types.ts`, `src/lib/content/ids.ts`, `src/lib/content/index.ts`
- Test: `tests/content/index.test.ts`

**Interfaces:**
- Produces all shared types. Every later task imports types from `src/lib/types.ts` only.

```ts
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
export interface ItemDef extends Base { kind: 'item'; type: ItemType; magic: boolean; weight?: number; costCp?: number; rarity?: Rarity; attunement?: boolean | string; baseItemId?: string; consumable?: boolean; curse?: RichText;
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
```

- Also produces, in `ids.ts`:
  - `slug(s: string): string`: NFKD with diacritics stripped, lowercase, apostrophes removed,
    every run of other non-alphanumeric characters turned into `-`, and dashes trimmed.
  - `entityId(kind: EntityKind, name: string, source: string): string` returns
    `` `${kind}:${slug(name)}@${source.toUpperCase()}` ``.
  - `featureId(className: string, subclassShortName: string | undefined, name: string, level: number, source: string): string`
  - `baseKey(id: string): string` (the id with its `@SOURCE` part removed)
  - `sourceOf(id: string): string`
- Also produces `class ContentIndex`, in `index.ts`:
  - `constructor(packs: Pack[])`
  - `get(id)`
  - `all<K>(kind: K): EntityOfKind<K>[]`
  - `find<K>(kind: K, name: string, source?: string): EntityOfKind<K> | undefined`
  - `resolve(id: string): Entity | undefined`
  - `search(q: string, kinds?: EntityKind[], limit = 200): Entity[]`
  - `subclassesOf(classId)`
  - `optionalFeatures(featureTypes: string[])`

- [ ] **Step 1: Write the failing tests**

```ts
test('ids', () => {
  expect(slug("Tasha's Hideous Laughter")).toBe('tashas-hideous-laughter');
  expect(slug('Zoë')).toBe('zoe');
  expect(entityId('spell', 'Fireball', 'phb')).toBe('spell:fireball@PHB');
  expect(featureId('Fighter', undefined, 'Fighting Style', 1, 'SRD')).toBe('feature:fighter:fighting-style:1@SRD');
  expect(featureId('Fighter', 'Champion', 'Improved Critical', 3, 'SRD')).toBe('feature:fighter:champion:improved-critical:3@SRD');
  expect(baseKey('spell:fireball@PHB')).toBe('spell:fireball');
});
test('patches alias and extend SRD entities', () => {
  const idx = new ContentIndex([srdPack /* class:fighter@SRD with features [{1,'feature:fighter:second-wind:1@SRD'}] */,
    { ...pack('TCE'), patches: [{ targetId: 'class:fighter@SRD', alias: 'PHB', addFeatures: [{ level: 4, id: 'feature:fighter:martial-versatility:4@TCE' }] }] }]);
  expect(idx.find('class', 'Fighter', 'PHB')?.id).toBe('class:fighter@SRD');
  expect(idx.resolve('class:fighter@PHB')?.id).toBe('class:fighter@SRD');
  expect((idx.get('class:fighter@SRD') as ClassDef).features.map(f => f.id)).toContain('feature:fighter:martial-versatility:4@TCE');
});
test('same-name entities from different sources coexist; search ranks prefix first', () => {
  // packs contain spell:shield@SRD, spell:shield@TST, spell:fireball@SRD, spell:fire-bolt@SRD, spell:delayed-blast-fireball@SRD
  expect(idx.find('spell', 'Shield', 'TST')?.id).toBe('spell:shield@TST');
  expect(idx.find('spell', 'Shield')?.id).toBe('spell:shield@SRD'); // SRD preferred without source
  const names = idx.search('fire', ['spell']).map(e => e.name);
  expect(names.indexOf('Delayed Blast Fireball')).toBeGreaterThan(names.indexOf('Fireball'));
});
```

- [ ] **Step 2: Run `npx vitest run tests/content`.** Expected: FAIL.
- [ ] **Step 3: Implement the ids and the index**
  - Patches are applied at construction, onto copies of their targets: push the alias (no
    duplicates), replace `text` when it's given, and append `addFeatures` (no duplicate ids).
  - `find` matches `source` against both `entity.source` and its aliases, ignoring case.
  - `resolve` is `get(id)`. Failing that, it looks up `baseKey(id)` among entities whose aliases
    include `sourceOf(id)`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: shared types, ids, ContentIndex with SRD patches`.

---

### Task 3: Storage, settings defaults, backups, record files

**Files:**
- Create: `src/lib/db.ts`, `src/lib/settings.ts`, `src/lib/backup.ts`
- Test: `tests/db.test.ts`, `tests/backup.test.ts` (both import `fake-indexeddb/auto`)

**Interfaces:**
- Produces `DEFAULT_SETTINGS: CampaignSettings`. These values come from the spec's 3.9 table:

  | Setting | Default |
  | --- | --- |
  | `allowOverrides`, `customOrigin`, `optionalClassFeatures` | `false` |
  | `multiclassing`, `feats` | `true` |
  | `hpMethod` | `'average'` |
  | `encumbrance` | `'off'` |
  | `crSuggestion`, `fog`, `freeMovement` | `false` |
  | `diagonal` | `'5-5-5'` |
  | `monsterHp` | `'average'` |
  | `initiativeModules` | `hp`, `conditions` and `deathSaves` `true`; the others `false` |
  | `showMonsterHealth` | `true` |

- Produces `class StorageError extends Error`.
- Produces `db`. IndexedDB `'dnd-app'` version 1 has these stores: `campaigns`, `characters`
  (indexed on `campaignId`), `items` (indexed on `campaignId`), `packMeta`, `packs`, `raw5e`,
  `blobs` and `meta`.
  - `db.campaigns`: `list()`, `get(id)`, `put(c)`, `delete(id)`. Delete removes the campaign's
    `items`, and **unassigns** its characters (sets `campaignId` to `undefined`).
  - `db.characters`: `list(campaignId?)`, `get`, `put`, `delete`.
  - `db.items`: `list(campaignId)`, `get`, `put`, `delete`.
  - `db.packs`:
    - `listMeta(): Promise<PackMeta[]>`
    - `get(id): Promise<Pack | undefined>`
    - `put(p: Pack)` (writes both `packs` and `packMeta`, with counts computed per kind)
    - `delete(id)`
  - `db.raw5e`: `getMany(keys: string[]): Promise<(unknown | undefined)[]>`,
    `putMany(entries: [string, unknown][])`.
  - `db.blobs`: `put(blob: Blob): Promise<string>` returns the SHA-256 hex of the blob, via
    `crypto.subtle`. Also `get(hash): Promise<Blob | undefined>`.
  - `db.meta`: `get<T>(key)`, `set(key, value)`.
  - Every `put` sets `updatedAt = Date.now()` where the record has that field.
  - Every write failure is rethrown as `new StorageError('Could not save: ' + reason)`.
- Produces `requestPersistence(): Promise<boolean>`.
- Produces, in `backup.ts`:
  - `exportBackup(opts: { campaignId?: string; includePacks: boolean }): Promise<Blob>` returns
    JSON `{ format: 'dnd-app-backup', version: 1, exportedAt, campaigns, characters, items, packs, blobs: { hash, type, base64 }[] }`
    and sets meta `lastBackupAt`.
  - `importBackup(file: Blob): Promise<{ campaigns: number; characters: number; items: number; packs: number }>`
    upserts by id.
  - `exportRecord(kind: 'character' | 'item', data: Character | StoredItem): Blob` returns
    `{ format: 'dnd-app-character' | 'dnd-app-item', version: 1, data }`.
  - `importRecord(file: Blob): Promise<{ kind: 'character'; data: Character } | { kind: 'item'; data: StoredItem }>`.
    If the id already exists, the record gets a fresh `crypto.randomUUID()`.

- [ ] **Step 1: Write the failing tests**

```ts
test('campaign delete removes items, unassigns characters', async () => {
  await db.campaigns.put(camp('c1')); await db.characters.put(char('a', 'c1')); await db.items.put(item('i', 'c1'));
  await db.campaigns.delete('c1');
  expect((await db.characters.get('a'))?.campaignId).toBeUndefined();
  expect(await db.items.get('i')).toBeUndefined();
});
test('write failure becomes StorageError', async () => {
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  await expect(db.characters.put(char('a'))).rejects.toThrow(/Could not save/);
});
test('backup round-trip incl. blobs', async () => {
  const hash = await db.blobs.put(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
  await db.campaigns.put(camp('c1')); await db.characters.put(char('a', 'c1'));
  const file = await exportBackup({ includePacks: true });
  await resetDb();
  expect(await importBackup(file)).toEqual({ campaigns: 1, characters: 1, items: 0, packs: 0 });
  expect(new Uint8Array(await (await db.blobs.get(hash))!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});
test('rejects foreign files', async () => {
  await expect(importBackup(new Blob(['{"x":1}']))).rejects.toThrow('Not a dnd-app backup file');
  await expect(importRecord(new Blob(['{"x":1}']))).rejects.toThrow('Not a dnd-app character or item file');
});
test('importRecord never overwrites', async () => {
  await db.characters.put(char('a'));
  const r = await importRecord(exportRecord('character', char('a')));
  expect(r.data.id).not.toBe('a');
});
```

- [ ] **Step 2: Run `npx vitest run tests/db.test.ts tests/backup.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement with `idb`'s `openDB`.** Export `resetDb()` for tests only; it closes
  and deletes the database.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: IndexedDB storage, settings defaults, backups, record files`.

---

### Task 4: Rich text, 5etools entries and tags, redaction

**Files:**
- Create: `src/lib/content/richtext.ts`, `src/ui/RichText.svelte`
- Test: `tests/content/richtext.test.ts`

**Interfaces:**
- Produces:
  - `textToRich(paragraphs: string[]): RichText`. This is for SRD `desc` arrays:
    - Consecutive strings starting with `|` become one table. The first row is the head, and
      `|---|` rows are dropped.
    - Strings starting with `- ` or `* ` become one list.
  - `entriesToRich(entries: unknown[]): RichText`
  - `renderTags(s: string): string`
  - `richToPlain(r: RichText): string`
  - `redact(r: RichText, revealed: ReadonlySet<string>): RichText`
  - `redactionIds(r: RichText): string[]`
- `RichText.svelte` (prop `text: RichText`) renders blocks, with `**…**` as `<strong>` and
  `*…*` as `<em>`. It splits strings rather than using `{@html}`.

- [ ] **Step 1: Write the failing tests**

```ts
test('tags', () => {
  expect(renderTags('{@spell fireball}')).toBe('fireball');
  expect(renderTags('{@spell fireball|phb|Fireball!}')).toBe('Fireball!');
  expect(renderTags('{@damage 2d6} {@dice 1d4+1}')).toBe('2d6 1d4+1');
  expect(renderTags('{@hit 5} {@hit -1} {@dc 15}')).toBe('+5 -1 DC 15');
  expect(renderTags('{@atk mw} {@atk rs} {@h}x')).toBe('*Melee Weapon Attack:* *Ranged Spell Attack:* *Hit:* x');
  expect(renderTags('{@recharge 5} {@recharge}')).toBe('(Recharge 5–6) (Recharge 6)');
  expect(renderTags('{@b bold {@i nested}}')).toBe('**bold *nested***');
  expect(renderTags('{@chance 25} {@filter cantrips|spells|level=0} {@foo bar|x}')).toBe('25 percent cantrips bar');
});
test('entries', () => {
  expect(entriesToRich(['a', { type: 'entries', name: 'Sub', entries: ['b'] },
    { type: 'list', items: ['x', { type: 'item', name: 'N', entry: 'y' }] },
    { type: 'table', caption: 'T', colLabels: ['d6', 'Effect'], rows: [[{ roll: { min: 1, max: 3 } }, '{@b x}'], [{ roll: { exact: 4 } }, 'z']] },
    { type: 'inset', name: 'Box', entries: ['c'] }, { type: 'refClassFeature', classFeature: 'X|Y||1' }, { type: 'image', href: {} }]))
    .toEqual([{ p: 'a' }, { h: 'Sub', blocks: [{ p: 'b' }] }, { list: ['x', '**N.** y'] },
      { table: { caption: 'T', head: ['d6', 'Effect'], rows: [['1–3', '**x**'], ['4', 'z']] } }, { h: 'Box', blocks: [{ p: 'c' }] }]);
});
test('SRD text with a table', () => {
  expect(textToRich(['Para', '| a | b |', '|---|---|', '| 1 | 2 |'])).toEqual([{ p: 'Para' }, { table: { head: ['a', 'b'], rows: [['1', '2']] } }]);
});
test('redaction', () => {
  const t = [{ p: 'Cures {{redact:r1}}nothing{{/redact}} and {{redact:r2}}poisons{{/redact}}.' }, { list: ['{{redact:r3}}x{{/redact}}'] }];
  expect(redact(t, new Set(['r1']))).toEqual([{ p: 'Cures nothing and ██████.' }, { list: ['██████'] }]);
  expect(redactionIds(t)).toEqual(['r1', 'r2', 'r3']);
});
```

- [ ] **Step 2: Run `npx vitest run tests/content/richtext.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - `renderTags` resolves the innermost `{@…}` first, in a loop.
  - For unknown tags with 3 or more pipe parts, the third part is the display text when it's
    non-empty. Otherwise the first part is.
  - Atk codes: `m` Melee, `r` Ranged, `mw` Melee Weapon, `rw` Ranged Weapon, `ms` Melee Spell,
    `rs` Ranged Spell, and `mw,rw` "Melee or Ranged Weapon".
  - `entriesToRich` applies `renderTags` to every string it emits. Unknown entry types with
    `entries` are flattened, and others are dropped.
  - `redact` always replaces hidden text with a fixed `██████`, so the bar doesn't leak the
    hidden text's length.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: rich text, 5etools entry/tag rendering, redaction`.

---

### Task 5: SRD converter and loader

**Files:**
- Create: `scripts/build-srd.ts`, `scripts/srd/classes.ts`, `scripts/srd/races.ts`,
  `scripts/srd/spells.ts`, `scripts/srd/items.ts`, `scripts/srd/misc.ts`,
  `scripts/srd/effects.ts` (a stub `export const SRD_EFFECTS: Record<string, { effects?: Effect[]; choices?: Choice[] }> = {}`,
  which is applied by id after conversion), `src/data/srd.json` (generated and committed), and
  `src/lib/content/srd.ts`
- Test: `tests/srd/srd.test.ts` (reads `src/data/srd.json` with `fs`)

**Interfaces:**
- Consumes: Task 2 types and ids, and Task 4 `textToRich`.
- Produces: `src/data/srd.json`, a `Pack` with `id: 'srd'`,
  `name: 'System Reference Document 5.1'`, `source: 'SRD'` and `patches: []`. Every entity has
  `srd: true`.
- Produces `loadSrd(): Promise<Pack>` (in `srd.ts`):
  - It uses `import srdUrl from '../../data/srd.json?url'`.
  - It returns `db.packs.get('srd')` when that pack's `hash === srdUrl`. Otherwise it fetches,
    stores the pack with `hash: srdUrl`, and returns it.
- **Input:** a local checkout of `https://github.com/5e-bits/5e-database` at commit
  `a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f`. That repo is archived, and its content is SRD 5.1.
  Clone it into a scratch directory outside the repo, then run
  `node scripts/build-srd.ts <checkout>/src/2014/en`. Monsters are converted in stage 2, not
  here.

**Mapping decisions.** Anything not listed here is a straightforward field copy.

- **Classes.**
  - Proficiencies come from `proficiencies`, typed through `5e-SRD-Proficiencies.json`.
    Saving-throw entries are skipped.
  - `skillChoice` comes from the `proficiency_choices` entry that offers skills.
  - `multiclassPrereq`: `multi_classing.prerequisites` maps to `all`, and
    `prerequisite_options` maps to `any`.
  - `asiLevels` are the levels where `ability_score_bonuses` increases.
  - `subclassLevel` is the lowest level among the class's subclass features, and
    `subclassTitle` is `subclass_flavor`.
  - `table` comes from `class_specific`, one column per key. Known labels:

    | Key | Label |
    | --- | --- |
    | `rage_count` | Rages |
    | `rage_damage_bonus` | Rage Damage |
    | `martial_arts` | Martial Arts (written as `NdM`) |
    | `ki_points` | Ki Points |
    | `unarmored_movement` | Unarmored Movement (written as `+N ft.`) |
    | `sneak_attack` | Sneak Attack (written as `NdM`) |
    | `sorcery_points` | Sorcery Points |
    | `invocations_known` | Invocations Known |
    | `channel_divinity_charges` | Channel Divinity |
    | `action_surges` | Action Surges |
    | `indomitable_uses` | Indomitable |
    | `extra_attacks` | Extra Attacks |
    | `bardic_inspiration_die` | Bardic Inspiration (written as `dN`) |

    Any other key is title-cased.
  - `spellcasting`, per class:
    - The ability comes from `Classes.spellcasting`. `cantrips` and `known` come from each
      level's `spellcasting` (`cantrips_known`, `spells_known`).
    - Progression: bard, cleric, druid, sorcerer and wizard are `full`. Paladin and ranger are
      `half`. Warlock is `pact`.
    - `prepared` preparation: cleric, druid, paladin and wizard (the wizard also gets
      `spellbook: true`). Everyone else is `known`.
    - `preparedFormula`: cleric and druid `'level+mod:wis'`, wizard `'level+mod:int'`, paladin
      `'level/2+mod:cha'`.
- **Feature choices.**
  - `feature_specific.expertise_options` becomes `{type:'expertise', count: choose}`.
  - Fighting-style `subfeature_options` (fighter, paladin, ranger, and the champion's
    additional style) become `{type:'optionalFeature', featureTypes:['FS:F'|'FS:P'|'FS:R'], count:1}`.
    Their options become `OptionalFeatureDef`, **deduplicated by name with the featureTypes
    combined**. Defense ends up as one entity with `['FS:F','FS:P','FS:R']`.
  - Option names lose their SRD prefix, meaning everything up to and including `': '`. For
    example, "Fighting Style: Defense" becomes "Defense" and "Eldritch Invocation: Agonizing
    Blast" becomes "Agonizing Blast". This gives the same ids that 5etools names produce.
  - Warlock invocations become `optionalFeatureProgression {name:'Eldritch Invocations', featureTypes:['EI'], counts: the Invocations Known column}`.
    Each invocation feature becomes an `OptionalFeatureDef` with `['EI']`.
  - Sorcerer metamagic becomes `optionalFeatureProgression {name:'Metamagic', featureTypes:['MM'], counts:[0,0,2,2,2,2,2,2,2,3,3,3,3,3,3,3,4,4,4,4]}`,
    with its options as `['MM']`.
  - Every other `subfeature_options` becomes `{type:'option', count, options}`, built from the
    referenced features. This covers terrain, dragon ancestor, pact boon and similar.
  - Features named "Ability Score Improvement" get `[{type:'asi'}]`.
  - The class feature at `subclassLevel` whose name equals `subclassTitle` gets
    `{type:'subclass'}`. If no such feature exists, synthesize one named `subclassTitle` at that
    level.
- **Races and subraces.**
  - `ability_bonus_options` (half-elf) becomes `{type:'ability', count:2, amount:1, from: every ability except cha}`.
  - `language_options` becomes `{type:'language'}`.
  - `starting_proficiency_options` becomes a skill or tool choice.
  - Each trait becomes a `Trait`. A trait's `trait_specific.subtrait_options` becomes an
    `option` choice on that trait. This covers dragonborn ancestry.
  - The Darkvision trait sets `darkvision: 60`.
  - Size maps to a letter.
- **Background (Acolyte).** Skills come from starting proficiencies, `language_options` becomes
  a language choice, the feature becomes a `Trait`, and the equipment becomes text.
- **Spells.** Classes come from `classes[].index`. `range`, `duration` and `casting_time` are
  copied as strings. `components` comes from the letters plus `material`.
- **Equipment.**
  - Type: Weapon → `weapon`. Armor with `armor_category === 'Shield'` → `shield`, with
    `armor: {category:'shield', ac: 2}`. Other armor → `armor`. Gear in the ammunition category
    → `ammunition`, in the equipment-pack category → `pack`, otherwise → `gear`. Tools →
    `tool`. Anything else → `other`.
  - `costCp`: cp ×1, sp ×10, ep ×50, gp ×100, pp ×1000.
  - Armor `dexCap`: no cap if `dex_bonus` is true and there's no `max_bonus`; `max_bonus` if
    it's set; `0` if `dex_bonus` is false.
- **Magic items.**
  - Parse `desc[0]` with
    `/^(.+?), (common|uncommon|rare|very rare|legendary|artifact|rarity varies)(?: \((requires attunement(?: by [^)]+)?)\))?/i`
    to get the type word, the rarity and the attunement (`true`, or `'by a wizard'`).
  - `text` is `desc.slice(1)`, and `magic` is `true`.
  - Skip parent entries that have a non-empty `variants`.
  - Names matching `/^(Weapon|Ammunition), \+(\d)$/` get `bonuses {attack:n, damage:n}`.
    Names matching `/^(Armor|Shield), \+(\d)$/` get `bonuses {ac:n}`.
- **Conditions.** All 15 entries, exhaustion included.

- [ ] **Step 1: Write the failing tests**

```ts
const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const by = (id: string) => srd.entities.find(e => e.id === id)!;
const count = (k: string) => srd.entities.filter(e => e.kind === k).length;
test('counts', () => {
  expect([count('class'), count('subclass'), count('race'), count('subrace'), count('background'), count('feat'), count('spell'), count('condition')])
    .toEqual([12, 12, 9, 4, 1, 1, 319, 15]);
});
test('classes', () => {
  const f = by('class:fighter@SRD') as ClassDef;
  expect([f.hitDie, f.saves, f.subclassLevel, f.asiLevels]).toEqual([10, ['str', 'con'], 3, [4, 6, 8, 12, 14, 16, 19]]);
  expect(f.multiclassPrereq).toEqual({ any: { str: 13, dex: 13 } });
  expect(f.table.find(t => t.label === 'Action Surges')!.values[16]).toBe(2);
  expect((by('class:paladin@SRD') as ClassDef).multiclassPrereq).toEqual({ all: { str: 13, cha: 13 } });
  const w = (by('class:wizard@SRD') as ClassDef).spellcasting!;
  expect([w.ability, w.progression, w.preparation, w.spellbook, w.cantrips![4], w.preparedFormula]).toEqual(['int', 'full', 'prepared', true, 4, 'level+mod:int']);
  const wl = by('class:warlock@SRD') as ClassDef;
  expect(wl.spellcasting!.progression).toBe('pact');
  expect(wl.optionalFeatureProgression.find(p => p.featureTypes[0] === 'EI')!.counts[1]).toBe(2);
  expect((by('optionalFeature:defense@SRD') as OptionalFeatureDef).featureTypes.sort()).toEqual(['FS:F', 'FS:P', 'FS:R']);
});
test('races', () => {
  expect((by('subrace:hill-dwarf@SRD') as SubraceDef)).toMatchObject({ raceId: 'race:dwarf@SRD', abilityBonuses: { wis: 1 } });
  expect((by('race:half-elf@SRD') as RaceDef).choices).toContainEqual(expect.objectContaining({ type: 'ability', count: 2, amount: 1 }));
});
test('items', () => {
  expect(by('item:longsword@SRD')).toMatchObject({ type: 'weapon', costCp: 1500, weight: 3, weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', versatile: '1d10' } });
  expect(by('item:half-plate-armor@SRD')).toMatchObject({ type: 'armor', armor: { category: 'medium', ac: 15, dexCap: 2, stealthDisadvantage: true } });
  expect(by('item:ring-of-protection@SRD')).toMatchObject({ type: 'ring', rarity: 'rare', attunement: true, magic: true });
  expect(by('item:weapon-2@SRD')).toMatchObject({ bonuses: { attack: 2, damage: 2 }, rarity: 'rare' });
  expect(by('spell:fireball@SRD')).toMatchObject({ level: 3, school: 'evocation', concentration: false });
  expect((by('spell:fireball@SRD') as SpellDef).classes).toEqual(expect.arrayContaining(['sorcerer', 'wizard']));
});
```

- [ ] **Step 2: Run `npx vitest run tests/srd`.** Expected: FAIL (no file).
- [ ] **Step 3: Implement the converter, run it, and commit `src/data/srd.json`.** It prints
  counts per kind.
- [ ] **Step 4: Run the tests.** Expected: PASS. Also check that `npm run build` shows
  `srd-*.json` as a separate asset, not inlined into the JS.
- [ ] **Step 5: Commit** with
  `feat: SRD 5.1 converter (5e-database@a6212be) and lazy SRD loader`.

---

### Task 6: Rules primitives and dice

**Files:**
- Create: `src/lib/rules/constants.ts`, `src/lib/rules/formula.ts`,
  `src/lib/rules/abilities.ts`, `src/lib/rules/spellcasting.ts`,
  `src/lib/rules/multiclass.ts`, `src/lib/dice.ts`
- Test: `tests/rules/primitives.test.ts`, `tests/dice.test.ts`

**Interfaces:**
- Produces, in `constants.ts`:
  - `ABILITIES`
  - `SKILL_ABILITY: Record<Skill, Ability>`
  - `POINT_BUY_COST = {8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9}` and `POINT_BUY_BUDGET = 27`
  - `STANDARD_ARRAY = [15,14,13,12,10,8]`
  - `FULL_CASTER_SLOTS: number[][]`, the PHB multiclass table indexed by caster level − 1, with
    `[4,3,3,3,3,2,2,1,1]` at level 20
  - `PACT_TABLE: { slots: number; level: number }[]`
  - `CONDITIONS`, the 14 condition names
  - `ATTUNEMENT_LIMIT = 3`
  - `profBonus(totalLevel)` is `2 + floor((totalLevel - 1) / 4)`
  - `abilityMod(score)`
  - `averageHp(die)` is `die / 2 + 1`
- Produces, in `abilities.ts`:
  - `pointBuyCost(s: Scores): number | null` (`null` if any score is outside 8 to 15)
  - `isStandardArray(s: Scores): boolean`
  - `roll4d6DropLowest(rng: () => number): number`
- Produces, in `formula.ts`:
  - `interface FormulaContext { level: number; totalLevel: number; prof: number; mods: Scores; col?: (label: string) => number | string | undefined }`
  - `evalFormula(expr: string, ctx: FormulaContext): number`. The grammar:
    - Numbers; `+ - * /`, where `/` is floor division; parentheses; unary minus; and
      `max(a,b)` and `min(a,b)`.
    - Identifiers: `level`, `totalLevel`, `prof`, `mod:<ability>` and `col[<Label>]`.
    - A string column value yields its first integer (`'+10 ft.'` → 10), and `'Unlimited'`
      yields `Infinity`.
    - A bad formula throws `Error('Bad formula: ' + expr)`.
- Produces, in `spellcasting.ts`:
  - `singleClassSlots(p: Progression, level: number): number[]`:
    - `full`: the full table at `level`
    - `half`: `[]` at level 1, otherwise the full table at `ceil(level/2)`
    - `artificer`: the full table at `ceil(level/2)`
    - `third`: `[]` below level 3, otherwise the full table at `ceil(level/3)`
    - `pact`: `[]`
  - `multiclassSlots(entries: { progression: Progression; level: number }[]): number[]`:
    - Keep only the entries whose `singleClassSlots` is non-empty.
    - Zero entries left gives `[]`. One gives its single table.
    - Two or more give the full table at `Σfull + Σfloor(half/2) + Σfloor(third/3) + Σceil(artificer/2)`.
  - `pactSlots(warlockLevel): { slots: number; level: number } | undefined`
  - `maxSpellLevel(p, level)` is the length of `singleClassSlots`, or `pactSlots().level` for
    `pact`.
- Produces, in `multiclass.ts`:
  `meetsMulticlassPrereq(p: MulticlassPrereq | undefined, s: Scores): boolean`.
- Produces, in `dice.ts`:
  - `type DiceTerm = { count: number; sides: number; sign: 1 | -1; keep?: { highest: boolean; n: number } } | { const: number; sign: 1 | -1 }`
  - `parseDice(expr: string): DiceTerm[]`. This accepts `NdM`, `dM`, `NdMkhX`, `NdMklX`,
    `NdMdlX` (which equals `kh(N−X)`) and constants, joined with `+` or `-`. Spaces are
    ignored. Anything else throws `Error('Bad dice: ' + expr)`.
  - `rollDice(expr: string, opts?: { rng?: () => number; advantage?: 'adv' | 'dis'; crit?: boolean }): { total: number; detail: string }`.
    - A die value is `1 + floor(rng() * sides)`.
    - `advantage` turns the first `1d20` term into `2d20kh1` (or `kl1` for `dis`).
    - `crit` doubles dice counts but not constants.
    - The detail format is `2d6 (4, 5) + 3`.

- [ ] **Step 1: Write the failing tests**

```ts
const seq = (...dice: number[]) => { let i = 0; return () => (dice[i++] - 1) / 6 + 0.01; }; // d6 helper
const seq20 = (...d: number[]) => { let i = 0; return () => (d[i++] - 1) / 20 + 0.001; };
test('basics', () => {
  expect([1, 4, 5, 9, 13, 17, 20].map(profBonus)).toEqual([2, 2, 3, 4, 5, 6, 6]);
  expect([1, 8, 10, 15, 20, 30].map(abilityMod)).toEqual([-5, -1, 0, 2, 5, 10]);
  expect([6, 8, 10, 12].map(averageHp)).toEqual([4, 5, 6, 7]);
  expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
  expect(pointBuyCost({ str: 14, dex: 14, con: 14, int: 12, wis: 10, cha: 8 })).toBe(27);
  expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBeNull();
  expect(isStandardArray({ str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 })).toBe(true);
  expect(isStandardArray({ str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 })).toBe(false);
  expect(roll4d6DropLowest(seq(6, 1, 4, 5))).toBe(15);
});
test('formula', () => {
  const ctx = (o: Partial<FormulaContext> = {}) => ({ level: 5, totalLevel: 5, prof: 3, mods: { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 2 }, ...o });
  expect(evalFormula('level+mod:int', ctx())).toBe(8);
  expect(evalFormula('level/2+mod:cha', ctx())).toBe(4);
  expect(evalFormula('max(1,mod:cha)', ctx({ mods: { ...ctx().mods, cha: -1 } }))).toBe(1);
  expect(evalFormula('5*level', ctx({ level: 3 }))).toBe(15);
  expect(evalFormula('prof*2', ctx())).toBe(6);
  expect(evalFormula('col[Ki Points]', ctx({ col: () => 4 }))).toBe(4);
  expect(evalFormula('col[Unarmored Movement]', ctx({ col: () => '+10 ft.' }))).toBe(10);
  expect(evalFormula('col[Rages]', ctx({ col: () => 'Unlimited' }))).toBe(Infinity);
  expect(() => evalFormula('level+', ctx())).toThrow('Bad formula: level+');
});
test('slots', () => {
  expect(singleClassSlots('full', 1)).toEqual([2]);
  expect(singleClassSlots('full', 5)).toEqual([4, 3, 2]);
  expect(singleClassSlots('full', 20)).toEqual([4, 3, 3, 3, 3, 2, 2, 1, 1]);
  expect([singleClassSlots('half', 1), singleClassSlots('half', 2), singleClassSlots('half', 5)]).toEqual([[], [2], [4, 2]]);
  expect([singleClassSlots('third', 2), singleClassSlots('third', 3), singleClassSlots('third', 7), singleClassSlots('third', 19)]).toEqual([[], [2], [4, 2], [4, 3, 3, 1]]);
  expect([singleClassSlots('artificer', 1), singleClassSlots('artificer', 3)]).toEqual([[2], [3]]);
  expect(multiclassSlots([{ progression: 'full', level: 3 }, { progression: 'full', level: 2 }])).toEqual([4, 3, 2]);
  expect(multiclassSlots([{ progression: 'half', level: 5 }, { progression: 'full', level: 3 }])).toEqual([4, 3, 2]);
  expect(multiclassSlots([{ progression: 'third', level: 4 }, { progression: 'half', level: 3 }])).toEqual([3]);
  expect(multiclassSlots([{ progression: 'artificer', level: 3 }, { progression: 'full', level: 1 }])).toEqual([4, 2]);
  expect(multiclassSlots([{ progression: 'pact', level: 5 }, { progression: 'full', level: 3 }])).toEqual([4, 2]);
  expect(multiclassSlots([{ progression: 'half', level: 1 }, { progression: 'full', level: 3 }])).toEqual([4, 2]);
  expect([1, 2, 3, 5, 9, 11, 17].map(pactSlots)).toEqual([{ slots: 1, level: 1 }, { slots: 2, level: 1 }, { slots: 2, level: 2 }, { slots: 2, level: 3 }, { slots: 2, level: 5 }, { slots: 3, level: 5 }, { slots: 4, level: 5 }]);
  expect(pactSlots(0)).toBeUndefined();
  expect([maxSpellLevel('full', 1), maxSpellLevel('full', 3), maxSpellLevel('full', 17), maxSpellLevel('half', 1), maxSpellLevel('half', 5), maxSpellLevel('third', 7), maxSpellLevel('pact', 5), maxSpellLevel('pact', 11)])
    .toEqual([1, 2, 9, 0, 2, 2, 3, 5]);
});
test('multiclass prereq', () => {
  const s = (o: Partial<Scores>) => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...o });
  expect(meetsMulticlassPrereq({ any: { str: 13, dex: 13 } }, s({ str: 12, dex: 13 }))).toBe(true);
  expect(meetsMulticlassPrereq({ all: { str: 13, cha: 13 } }, s({ str: 13, cha: 12 }))).toBe(false);
  expect(meetsMulticlassPrereq(undefined, s({}))).toBe(true);
});
// tests/dice.test.ts
test('dice', () => {
  expect(parseDice('2d6+3')).toEqual([{ count: 2, sides: 6, sign: 1 }, { const: 3, sign: 1 }]);
  expect(parseDice('d20 - 1')).toEqual([{ count: 1, sides: 20, sign: 1 }, { const: 1, sign: -1 }]);
  expect(parseDice('4d6dl1')).toEqual(parseDice('4d6kh3'));
  expect(() => parseDice('abc')).toThrow('Bad dice: abc');
  expect(rollDice('2d6+3', { rng: seq(4, 5) })).toEqual({ total: 12, detail: '2d6 (4, 5) + 3' });
  expect(rollDice('1d20+5', { rng: seq20(7, 15), advantage: 'adv' }).total).toBe(20);
  expect(rollDice('1d20+5', { rng: seq20(7, 15), advantage: 'dis' }).total).toBe(12);
  expect(rollDice('1d8+3', { rng: () => 0.2, crit: true }).total).toBe(2 + 2 + 3);
});
```

- [ ] **Step 2: Run `npx vitest run tests/rules/primitives.test.ts tests/dice.test.ts`.** Expected:
  FAIL.
- [ ] **Step 3: Implement.** `evalFormula` is a small recursive-descent parser. There is no
  `eval` and no `Function`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: rules primitives (slots, pact, point buy, formulas) and dice`.

---

### Task 7: Item player views and inventory operations

**Files:**
- Create: `src/lib/items/playerView.ts`, `src/lib/items/inventory.ts`
- Test: `tests/items/items.test.ts`

**Interfaces:**
- Consumes: `redact` (Task 4), `rollDice` (Task 6), `ATTUNEMENT_LIMIT`.
- Produces, in `playerView.ts`:
  - `playerItem(item: ItemDef, view?: PlayerView): ItemDef`. With no view, `redact(item.text, ∅)`
    is still applied. With a view:
    - `name` is `view.name ?? item.name`.
    - `text` is `redact(view.text ?? item.text, new Set(view.revealed))`.
    - Each hidden field is removed. Hidden `effects` become `[]`.
    - `curse` is removed unless it's revealed (it isn't in `hidden`).
  - `revealField(view, f: HideableField): PlayerView`
  - `revealRedaction(view, id: string): PlayerView`
  - `identify(entry: InventoryEntry): InventoryEntry` (removes `view`)
- Produces, in `inventory.ts`:
  - `makeEntry(item: ItemDef, opts?: { sourceId?: string; view?: PlayerView; quantity?: number }): InventoryEntry`
  - `useItem(e): InventoryEntry | null`
  - `useCharge(e, n = 1): InventoryEntry`
  - `rechargeEntry(e, event: Recharge, rng?: () => number): InventoryEntry`
  - `attunedCount(entries): number`
  - `carriedWeight(entries, currency): number` (counts quantity × weight, plus 1 lb per 50
    coins)
  - `refreshEntry(e, latest: ItemDef): InventoryEntry`
  - `transfer(from: InventoryEntry[], to: InventoryEntry[], entryId: string, qty: number): { from: InventoryEntry[]; to: InventoryEntry[] }`

- [ ] **Step 1: Write the failing tests**

```ts
const potion = { ...item('Potion of Poison'), rarity: 'uncommon', consumable: true, text: [{ p: 'Looks like healing. {{redact:r1}}It is poison.{{/redact}}' }] } as ItemDef;
test('player view hides, redacts, reveals, identifies', () => {
  const view: PlayerView = { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] };
  const p = playerItem(potion, view);
  expect([p.name, p.rarity, p.text]).toEqual(['Cloudy red potion', undefined, [{ p: 'Looks like healing. ██████' }]]);
  expect(richToPlain(playerItem(potion, revealRedaction(view, 'r1')).text)).toContain('It is poison.');
  expect(playerItem(potion, revealField(view, 'rarity')).rarity).toBe('uncommon');
  expect(identify(makeEntry(potion, { view })).view).toBeUndefined();
  expect(playerItem(potion).text).toEqual([{ p: 'Looks like healing. ██████' }]); // no view: markers never leak
});
test('hidden bonuses/effects/curse', () => {
  const sword = { ...item('Sword of Woe'), bonuses: { attack: -1 }, effects: [{ type: 'note', text: 'x' }], curse: [{ p: 'Cursed.' }] } as ItemDef;
  const p = playerItem(sword, { hidden: ['bonuses', 'effects', 'curse'], revealed: [], text: [{ p: 'A plain sword.' }] });
  expect([p.bonuses, p.effects, p.curse, p.text]).toEqual([undefined, [], undefined, [{ p: 'A plain sword.' }]]);
});
test('use, charges, recharge', () => {
  expect(useItem(makeEntry(potion, { quantity: 2 }))!.quantity).toBe(1);
  expect(useItem(makeEntry(potion))).toBeNull();
  const wand = { ...item('Wand'), charges: { max: 7, recharge: 'dawn', rechargeAmount: '1d6+1' } } as ItemDef;
  const spent = useCharge(makeEntry(wand), 7);
  expect(rechargeEntry(spent, 'dawn', () => 0.4).chargesUsed).toBe(3); // d6=3, +1 → 4 restored
  expect(rechargeEntry(spent, 'long').chargesUsed).toBe(7);
  expect(rechargeEntry(useCharge(makeEntry({ ...wand, charges: { max: 3, recharge: 'long' } }), 2), 'long').chargesUsed).toBe(0);
  expect(refreshEntry({ ...spent, chargesUsed: 5 }, { ...wand, charges: { max: 3, recharge: 'dawn' } }).chargesUsed).toBe(3);
});
test('weight, attunement, transfer', () => {
  const sword = makeEntry({ ...item('Longsword'), weight: 3 }), arrows = makeEntry({ ...item('Arrow'), weight: 0.05 }, { quantity: 20 });
  expect(carriedWeight([sword, arrows], { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 })).toBeCloseTo(6);
  expect(attunedCount([{ ...sword, attuned: true }, arrows])).toBe(1);
  const r = transfer([arrows], [], arrows.id, 5);
  expect([r.from[0].quantity, r.to[0].quantity, r.to[0].id === arrows.id]).toEqual([15, 5, false]);
  expect(transfer([arrows], [], arrows.id, 20).from).toEqual([]);
});
```

- [ ] **Step 2: Run `npx vitest run tests/items`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Write `rechargeEntry` so it is pure, with no side effects:
  - A matching `recharge` event restores `rollDice(rechargeAmount).total` charges, or all
    charges when there's no `rechargeAmount`.
  - `'long'` also matches items marked `'short'`.
  - `'dawn'` and `'dusk'` match only themselves.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: item player views with redaction, inventory operations`.

---

### Task 8: `computeSheet`

**Files:**
- Create: `src/lib/rules/sheet.ts`, `src/lib/rules/effects.ts`, `src/lib/character/choices.ts`
- Test: `tests/rules/sheet.test.ts`, `tests/fixtures/content.ts`
  - **The fixture.** Small hand-written entities with SRD numbers, all with source `FIX`:
    - races: human, dwarf, hill dwarf
    - classes: fighter (with the champion subclass), monk, barbarian, bard, rogue, wizard,
      cleric, warlock
    - items: chain mail, shield, longsword, half plate, ring of protection, gauntlets of ogre
      power, potion of poison (exported as `potionFixture`), and a 60 lb `sack-of-60lb`
    - a Defense optional feature
  - **`mkChar`.** The fixture also exports
    `mkChar(o: { race: string; subrace?: string; base: Partial<Scores>; levels: string[]; answers?: Partial<Record<Choice['type'], string[]>>; inventory?: [slug: string, equipped: boolean, attuned?: boolean, view?: PlayerView][] }): Character`.
    - Missing base scores default to 10.
    - Slugs map to `<kind>:<slug>@FIX`.
    - Each answers entry goes to the first unanswered choice of that type, found with
      `enumerateChoices`.
    - It embeds every fixture entity the character uses.

**Interfaces:**
- Consumes: the Task 2 types, the Task 6 primitives, and `playerItem`.
- Produces, in `choices.ts`. These are shared with Task 9.
  - `choiceKey(level: number, sourceId: string, index: number): string` returns
    `` `${level}|${sourceId}|${index}` ``.
    - `level` is the character level the choice arises at, or 0 for race, subrace and
      background.
    - `sourceId` is an entity id, optionally followed by one sub-path: `/trait:<slug>`,
      `/skills`, `/ofp:<slug>`, `/option:<slug>` or `/feature`.
  - `interface PendingChoice { key: string; level: number; sourceId: string; sourceName: string; choice: Choice; answer?: ChoiceAnswer }`
  - `enumerateChoices(c: Character, lookup: (id: string) => Entity | undefined, settings: CampaignSettings): PendingChoice[]`.
    The collection rules are listed under Task 9's `listChoices`. `computeSheet` uses this to
    work out what each answer in `build.choices` means.
- Produces, in `sheet.ts` and `effects.ts`:
  - `computeSheet(c: Character, opts: { settings: CampaignSettings; viewer: 'dm' | 'player' }): Sheet`
  - `activeEffects(c, opts): { effect: Effect; source: string }[]`

  Both read entities only from `c.embedded`, through `lookup = id => c.embedded[id]`.

**Rules pinned here (not restated in the tests):**
- **Scores** are built up in this order:
  1. Start from base scores.
  2. Add `customOrigin` when it's set. Otherwise add the race and subrace `abilityBonuses`.
  3. Add `ability` choice answers, then ASI answers and feat `abilityBonus`. These ASI and feat
     increases cap at 20.
  4. Apply `setScore` effects, which set the score to `max(score, value)`.
  5. An `score.X` override wins over all of this.
- **Features gained.** For each class, the features at or below that class's level, plus the
  matching subclass features from `build.subclasses[classId]`. `optional` features are
  included only when `settings.optionalClassFeatures` is on.
- **Saves.** Proficiency comes from the first class (`levels[0]`) plus `proficiency` effects
  with category `save`.
- **Proficiencies** combine:
  - the first class's `proficiencies`, and each later class's `multiclassProficiencies`
  - the race, subrace and background
  - choice answers (skill, tool and language)
  - `proficiency` effects
- **Skills.** A skill is the ability modifier plus the best of:
  - `2×prof` with expertise
  - `prof` if proficient
  - for halfProficiency, `floor(prof/2)`, or `ceil(prof/2)` when `roundUp` is set (when that
    effect lists abilities, it applies only to those abilities)
  - otherwise 0

  Then add `skill.X` and `check.<ability>` bonuses.
- **Initiative** is the Dex modifier, plus `floor(prof/2)` if a halfProficiency effect without
  abilities is active, plus `initiative` bonuses.
- **Passive Perception** is 10 plus the Perception bonus plus `passive.perception` bonuses.
- **AC**, starting with the base:
  - Body armor: light is `ac + dex`, medium is `ac + min(dex, dexCap)`, heavy is `ac`.
  - With no armor, take the best of `10 + dex` and every `acBase` effect (`base` + the listed
    ability modifiers). A base whose `shieldAllowed` is false applies only when no shield is
    worn. If a shield is worn, compare `10 + dex + shield` against the allowed bases plus the
    shield, and take the higher.

  Then add the shield (`armor.ac` plus its `bonuses.ac`), the `bonuses.ac` of other active
  items, and `bonus ac` effects. Honor `when` for `armored`, `unarmored`, `noShield` and
  `notHeavy`.
- **Active items.** An item counts as active when it is `equipped` and either needs no
  attunement or is `attuned`. Only active items contribute bonuses or effects.
- **Max HP** is the first class's hit die maximum at level 1, plus `hpRoll ?? averageHp(die)`
  for each later level, plus Con × total level, plus `hpPerLevel` × total level. Each level
  adds at least 1.
- **Speed** is the subrace speed, or else the race speed, plus `speed` effects.
  - Worn heavy armor with an unmet `strReq` costs 10 ft unless the
    `ignoreHeavyArmorSpeed` flag is set.
  - Variant encumbrance: over 5×Str is `encumbered` (−10 ft), and over 10×Str is `heavy`
    (−20 ft).
  - Standard encumbrance: over 15×Str gives a warning and `over`.
  - Capacity doubles for size L and larger, and halves for T.
- **Attacks.** One per equipped weapon, plus an unarmed strike.
  - The ability: finesse uses the better of Str and Dex, ranged uses Dex, and anything else
    uses Str.
  - Proficiency applies when the weapon's category (`simple` or `martial`) or its name is among
    the weapon proficiencies.
  - Add the item's `bonuses.attack` and `bonuses.damage`, and the `attack.melee`,
    `attack.ranged`, `damage.melee` and `damage.ranged` effects.
  - The damage string is `` `${die}+${mod}` `` (omit `+0`, and write negatives as `-1`).
- **Spellcasting.** One entry per class or subclass that has `spellcasting`:
  - `dc = 8 + prof + mod + spellDc bonuses + item bonuses.spellDc`
  - `attack = prof + mod + attack.spell bonuses + item bonuses.spellAttack`
  - `prepared = max(1, evalFormula(preparedFormula))`
  - `slots` come from `multiclassSlots`, and `pact` from `pactSlots`.
- **Resources.** For each `resource` effect, `max` is `evalFormula` with `level` set to the
  owning class's level and `col` reading the class table at that level. `resourceRecharge`
  effects replace `recharge`.
- **Player viewer.** With `viewer: 'player'`, every inventory item passes through
  `playerItem(entry.item, entry.view)` first. With `'dm'`, effect sources from hidden fields get
  ` (hidden)` appended.
- **Overrides** replace the final value, and the key goes into `overridden`. `speed` overrides
  `walk`, and `spellDc` and `spellAttack` override every spellcasting entry.
- **Missing entities.** A missing embedded entity adds the warning
  `` `Missing ${kind}: ${id}` ``, and computation continues. Attuning more than 3 items adds the
  warning `'Attuned to more than 3 items'`.

- [ ] **Step 1: Write the failing tests**

```ts
const S = DEFAULT_SETTINGS, dm = { settings: S, viewer: 'dm' as const };
test('hill dwarf fighter 1', () => {
  const c = mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, levels: ['fighter'],
    answers: { optionalFeature: ['optionalFeature:defense@FIX'], skill: ['athletics', 'perception'] }, inventory: [['chain-mail', true], ['shield', true], ['longsword', true]] });
  const s = computeSheet(c, dm);
  expect([s.scores.con, s.scores.wis, s.ac, s.maxHp, s.prof, s.initiative, s.speed.walk, s.passivePerception]).toEqual([16, 13, 19, 14, 2, 1, 25, 13]);
  expect([s.saves.str.bonus, s.saves.con.bonus, s.saves.dex.bonus, s.skills.athletics.bonus, s.skills.perception.bonus]).toEqual([4, 5, 1, 4, 3]);
  expect(s.attacks.find(a => a.name === 'Longsword')).toMatchObject({ toHit: 4, damage: '1d8+2', versatile: '1d10+2', damageType: 'slashing' });
});
test('heavy armor strength', () => {
  const weak = (race: string) => computeSheet(mkChar({ race, base: { str: 11 }, levels: ['fighter'], inventory: [['chain-mail', true]] }), dm).speed.walk; // human 12, dwarf 11: both under 13
  expect([weak('human'), weak('dwarf')]).toEqual([20, 25]);
});
test('AC variants', () => {
  const ac = (o: Parameters<typeof mkChar>[0]) => computeSheet(mkChar(o), dm).ac;
  expect(ac({ race: 'human', base: { dex: 15, wis: 15 }, levels: ['monk'] })).toBe(16); // human +1: dex16 wis16 → 10+3+3
  expect(ac({ race: 'human', base: { dex: 15, wis: 15 }, levels: ['monk'], inventory: [['shield', true]] })).toBe(15);
  expect(ac({ race: 'human', base: { dex: 13, con: 15 }, levels: ['barbarian'], inventory: [['shield', true]] })).toBe(17);
  expect(ac({ race: 'human', base: { dex: 17 }, levels: ['fighter'], inventory: [['half-plate', true]] })).toBe(17);
});
test('proficiency variants', () => {
  const bard = computeSheet(mkChar({ race: 'human', base: { dex: 13, int: 9 }, levels: ['bard', 'bard'] }), dm);
  expect([bard.initiative, bard.skills.arcana.bonus]).toEqual([3, 1]);
  const rogue = computeSheet(mkChar({ race: 'human', base: { dex: 15 }, levels: ['rogue'], answers: { skill: ['stealth', 'acrobatics', 'perception', 'insight'], expertise: ['stealth', 'acrobatics'] } }), dm);
  expect(rogue.skills.stealth.bonus).toBe(7);
});
test('spellcasting and slots', () => {
  const wiz = computeSheet(mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard'] }), dm);
  expect(wiz.spellcasting[0]).toMatchObject({ dc: 13, attack: 5, cantrips: 3, prepared: 4 });
  expect(wiz.slots).toEqual([2]);
  const mc = computeSheet(mkChar({ race: 'human', base: { int: 15, wis: 13 }, levels: ['wizard', 'wizard', 'wizard', 'cleric', 'cleric'] }), dm);
  expect([mc.slots, mc.saves.int.proficient, mc.saves.wis.proficient]).toEqual([[4, 3, 2], true, true]);
  expect(computeSheet(mkChar({ race: 'human', base: {}, levels: ['warlock', 'warlock', 'warlock'] }), dm)).toMatchObject({ slots: [], pact: { slots: 2, level: 2 } });
});
test('items: attunement, player view, setScore, override', () => {
  const ring = (attuned: boolean, view?: PlayerView) => mkChar({ race: 'human', base: {}, levels: ['fighter'], inventory: [['ring-of-protection', true, attuned, view]] });
  expect([computeSheet(ring(true), dm).ac, computeSheet(ring(false), dm).ac]).toEqual([11, 10]);
  const hidden = ring(true, { hidden: ['bonuses'], revealed: [] });
  expect([computeSheet(hidden, { settings: S, viewer: 'player' }).ac, computeSheet(hidden, dm).ac]).toEqual([10, 11]);
  const g = (str: number) => computeSheet(mkChar({ race: 'human', base: { str: str - 1 }, levels: ['fighter'], inventory: [['gauntlets-of-ogre-power', true, true]] }), dm).scores.str;
  expect([g(15), g(20)]).toEqual([19, 20]);
  const o = computeSheet({ ...ring(true), overrides: { ac: 25 } }, dm);
  expect([o.ac, o.overridden]).toEqual([25, ['ac']]);
});
test('robust to missing content; encumbrance; resources', () => {
  const broken = mkChar({ race: 'human', base: {}, levels: ['fighter'] }); broken.build.levels.push({ classId: 'class:nope@X' });
  expect(() => computeSheet(broken, dm)).not.toThrow();
  expect(computeSheet(broken, dm).warnings).toContain('Missing class: class:nope@X');
  const heavy = mkChar({ race: 'human', base: { str: 9 }, levels: ['fighter'], inventory: [['sack-of-60lb', false]] });
  expect(computeSheet(heavy, { settings: { ...S, encumbrance: 'variant' }, viewer: 'dm' })).toMatchObject({ carrying: { encumbrance: 'encumbered' }, speed: { walk: 20 } });
  const monk5 = computeSheet(mkChar({ race: 'human', base: {}, levels: Array(5).fill('monk') }), dm);
  expect(monk5.resources.find(r => r.name === 'Ki')).toEqual({ name: 'Ki', max: 5, recharge: 'short' });
  const bard5 = computeSheet(mkChar({ race: 'human', base: { cha: 15 }, levels: Array(5).fill('bard') }), dm);
  expect(bard5.resources.find(r => r.name === 'Bardic Inspiration')).toEqual({ name: 'Bardic Inspiration', max: 3, recharge: 'short' });
});
```

- [ ] **Step 2: Run `npx vitest run tests/rules/sheet.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `computeSheet` and `activeEffects`** in `sheet.ts`, with the effect
  helpers in `effects.ts`. The fixture's effects mirror the SRD effects table in Task 10.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: computeSheet derives all character numbers from build + embedded content`.

---

### Task 9: Choices, validation, embedding, level-up, spells, rests, HP

**Files:**
- Create: `src/lib/character/build.ts`, `src/lib/character/rest.ts`
- Test: `tests/character/build.test.ts`, `tests/character/rest.test.ts`. These reuse
  `tests/fixtures/content.ts` and add `fixtureIndex(): ContentIndex`.

**Interfaces:**
- Consumes: `ContentIndex`, `computeSheet`, `choiceKey`, `PendingChoice` and
  `enumerateChoices` (all from Task 8), and the primitives.
- Produces, in `build.ts`:
  - `listChoices(c: Character, index: ContentIndex, settings: CampaignSettings): PendingChoice[]`
    is `enumerateChoices(c, id => index.resolve(id) ?? c.embedded[id], settings)`.
    `enumerateChoices` collects choices from:
    - the race, subrace and their traits; the background and its feature
    - the first class's `skillChoice` at level 1, and `multiclassSkillChoice` when a class is
      added later
    - each gained feature's choices
    - each `optionalFeatureProgression` row, with count
      `counts[classLevel-1] - counts[classLevel-2]`
    - the choices of every chosen option `Trait` and of every chosen feat
  - `answerChoice(c, key, answer): Character`. A subclass answer also sets
    `build.subclasses[classId]`.
  - `interface Problem { key?: string; step: 'race' | 'class' | 'abilities' | 'background' | 'choices' | 'equipment' | 'spells' | 'details'; message: string; blocking: boolean }`
  - `validateCharacter(c, index, settings): Problem[]`. When `settings.allowOverrides` is on,
    every problem has `blocking: false`.
  - `addLevel(c, classId, index, settings, hpRoll?: number): { character: Character; problems: Problem[] }`
  - `embedContent(c, index): Character`
  - `spellLimits(c: Character, settings): { classId: string; cantrips: number; known?: number; prepared?: number; maxLevel: number }[]`
  - `newCharacter(name: string, campaignId?: string): Character`. This creates empty build
    arrays, standard-array base scores of 10, and a zeroed state.
- Produces, in `rest.ts`:
  - `shortRest(c, spent: { die: number; rolls: number[] }[], sheet: Sheet): Character`. Each
    die heals `max(0, roll + con mod)`, and spent dice are added to `hitDiceUsed`. Pact slots
    reset, and `short` resources and items recharge.
  - `longRest(c, sheet): Character`:
    - HP goes to max and temp HP to 0.
    - Hit dice come back: `max(1, floor(totalLevel/2))` regained, counted from the largest die
      first.
    - Slots and pact slots reset. Short and long resources reset, and items with `long` or
      `short` recharge.
    - Exhaustion drops by 1 (not below 0). Death saves reset, and `stable` and `dead` clear.
  - `applyDamage(c, amount: number, sheet: Sheet, crit = false): Character`:
    - Temp HP absorbs damage first.
    - Damage taken at 0 HP adds `crit ? 2 : 1` failures.
    - If the damage left after dropping to 0 is at least max HP, `dead` is set.
  - `applyHealing(c, amount, sheet): Character`. HP caps at max, and healing from 0 resets death
    saves.
  - `rollDeathSave(c, d20: number): Character`:
    - A 20 sets HP to 1 and resets the saves.
    - A 1 adds 2 failures.
    - 10 or higher adds a success, and anything else adds a failure.
    - 3 successes set `stable`, and 3 failures set `dead`.

- [ ] **Step 1: Write the failing tests**

```ts
const idx = fixtureIndex(), S = DEFAULT_SETTINGS;
test('choices appear per level and after subclass', () => {
  let c = mkChar({ race: 'human', base: { str: 15 }, levels: ['fighter'] });
  const l1 = listChoices(c, idx, S);
  expect(l1.map(p => p.choice.type)).toEqual(expect.arrayContaining(['skill', 'optionalFeature']));
  expect(l1.find(p => p.choice.type === 'skill')!.key).toBe('1|class:fighter@FIX/skills|0');
  c = addLevel(addLevel(c, 'class:fighter@FIX', idx, S).character, 'class:fighter@FIX', idx, S).character;
  const sub = listChoices(c, idx, S).find(p => p.choice.type === 'subclass')!;
  c = answerChoice(c, sub.key, { type: 'ids', ids: ['subclass:champion@FIX'] });
  expect(c.build.subclasses['class:fighter@FIX']).toBe('subclass:champion@FIX');
  expect(Object.keys(embedContent(c, idx).embedded)).toContain('feature:fighter:champion:improved-critical:3@FIX');
  c = addLevel(c, 'class:fighter@FIX', idx, S).character;
  expect(listChoices(c, idx, S).some(p => p.level === 4 && p.choice.type === 'asi')).toBe(true);
});
test('ASI caps at 20', () => {
  let c = mkChar({ race: 'human', base: { str: 18 }, levels: ['fighter', 'fighter', 'fighter', 'fighter'] });
  const asi = listChoices(c, idx, S).find(p => p.choice.type === 'asi')!;
  c = embedContent(answerChoice(c, asi.key, { type: 'asi', abilities: { str: 2 } }), idx);
  expect(computeSheet(c, { settings: S, viewer: 'dm' }).scores.str).toBe(20);
});
test('multiclass prerequisites, overrides setting', () => {
  const c = mkChar({ race: 'human', base: { str: 15, int: 11 }, levels: ['fighter'] }); // int 12 after human +1
  expect(addLevel(c, 'class:wizard@FIX', idx, S).problems[0]).toMatchObject({ message: 'Multiclassing into Wizard needs Int 13', blocking: true });
  expect(addLevel(c, 'class:wizard@FIX', idx, { ...S, allowOverrides: true }).problems[0].blocking).toBe(false);
  expect(addLevel(c, 'class:wizard@FIX', idx, { ...S, multiclassing: false }).problems[0].message).toBe('Multiclassing is off in this campaign');
});
test('validation', () => {
  const c = mkChar({ race: 'human', base: { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 }, levels: ['fighter'] });
  c.build.abilityMethod = 'pointBuy';
  expect(validateCharacter(c, idx, S)).toContainEqual(expect.objectContaining({ step: 'abilities', message: 'Point buy total is 28 of 27', blocking: true }));
  const sk = listChoices(c, idx, S).find(p => p.choice.type === 'skill')!;
  const tooMany = answerChoice(c, sk.key, { type: 'ids', ids: ['athletics', 'perception', 'survival'] });
  expect(validateCharacter(tooMany, idx, S).some(p => p.key === sk.key && p.blocking)).toBe(true);
});
test('embedding makes the sheet independent of the index', () => {
  const c = embedContent(mkChar({ race: 'human', base: { int: 15 }, levels: ['wizard', 'wizard', 'wizard'] }), idx);
  const before = computeSheet(c, { settings: S, viewer: 'dm' });
  expect(computeSheet(JSON.parse(JSON.stringify(c)), { settings: S, viewer: 'dm' })).toEqual(before);
  expect(spellLimits(c, S)[0]).toMatchObject({ cantrips: 3, prepared: 6, maxLevel: 2 });
});
// rest.test.ts
test('long rest', () => {
  const f5 = mkChar({ race: 'human', base: {}, levels: Array(5).fill('fighter') });
  f5.state = { ...f5.state, hp: 3, hitDiceUsed: { 10: 4 }, exhaustion: 2 };
  const r = longRest(f5, computeSheet(f5, dm));
  expect([r.state.hp, r.state.hitDiceUsed[10], r.state.exhaustion]).toEqual([computeSheet(f5, dm).maxHp, 2, 1]);
  const f1 = mkChar({ race: 'human', base: {}, levels: ['fighter'] }); f1.state.hitDiceUsed = { 10: 1 };
  expect(longRest(f1, computeSheet(f1, dm)).state.hitDiceUsed[10]).toBe(0);
});
test('short rest', () => {
  const w = mkChar({ race: 'human', base: { con: 13 }, levels: ['warlock', 'warlock', 'warlock'] });
  w.state = { ...w.state, hp: 1, pactSlotsUsed: 2 };
  const r = shortRest(w, [{ die: 8, rolls: [3, 5] }], computeSheet(w, dm));
  expect([r.state.hp, r.state.pactSlotsUsed, r.state.hitDiceUsed[8]]).toEqual([1 + 5 + 7, 0, 2]);
});
test('damage, death saves', () => {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] }), s = computeSheet(c, dm); // maxHp 10
  c.state = { ...c.state, hp: 10, tempHp: 5 };
  expect(applyDamage(c, 8, s).state).toMatchObject({ tempHp: 0, hp: 7 });
  const down = applyDamage({ ...c, state: { ...c.state, tempHp: 0, hp: 3 } }, 3, s);
  expect(down.state.deathSaves.fail).toBe(0);
  expect(applyDamage(down, 1, s, true).state.deathSaves.fail).toBe(2);
  expect(applyDamage({ ...c, state: { ...c.state, tempHp: 0, hp: 5 } }, 15, s).state.dead).toBe(true);
  expect(rollDeathSave(down, 20).state).toMatchObject({ hp: 1, deathSaves: { success: 0, fail: 0 } });
  expect(rollDeathSave(rollDeathSave(down, 1), 5).state.dead).toBe(true);
});
```

- [ ] **Step 2: Run `npx vitest run tests/character`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Multiclassing checks both the new class's prerequisite and every current class's, and the
    message names the first one unmet, in the format
    `` `Multiclassing into ${name} needs ${Abbr} 13` ``. When `any` isn't met, list its
    alternatives joined with " or ".
  - Spell rules:
    - `known` count = `known[level-1]`
    - wizard `known` (the spellbook) = `6 + 2*(level-1)`
    - `prepared` uses `preparedFormula`
    - `maxLevel` uses `maxSpellLevel` with that class's own level
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with
  `feat: choices, validation, level-up, embedding, spell limits, rests, HP and death saves`.

---

### Task 10: SRD effects and end-to-end characters

**Files:**
- Modify: `scripts/srd/effects.ts`, and regenerate `src/data/srd.json`
- Test: `tests/srd/characters.test.ts`. It builds characters from the real `srd.json` through
  `ContentIndex`, `addLevel`, `answerChoice`, `embedContent` and `computeSheet`.

**Effects to author** (keyed by the converted entity ids; trait effects are keyed
`<raceId>/trait:<slug>`):

| Source | Effects |
| --- | --- |
| Dwarf | Dwarven Resilience: `damage resistance poison` and a note. Dwarven Toughness (hill dwarf): `bonus hpPerLevel 1`. Speed: `flag ignoreHeavyArmorSpeed`. Combat training: weapon proficiencies. Stonecunning: a note. |
| Elf | Keen Senses: `proficiency skill perception`. Fey Ancestry and Trance: notes. High Elf: weapon training proficiencies, and the Extra Language choice. |
| Halfling | Lucky, Brave and Nimbleness: notes. |
| Human | `abilityBonuses` all +1 (from data). |
| Dragonborn | The Draconic Ancestry option choice. Each option carries `damage resistance <type>` and a note for its breath weapon. |
| Gnome | Gnome Cunning: a note. Rock gnome: `proficiency tool tinker's tools`. |
| Half-elf | The two ability choices (from data), and Skill Versatility `{type:'skill', count:2, from:'any'}`. |
| Half-orc | Menacing: `proficiency skill intimidation`. Relentless Endurance and Savage Attacks: notes. |
| Tiefling | Hellish Resistance: `damage resistance fire`. Infernal Legacy: a note. |
| Barbarian | Unarmored Defense: `acBase 10 [dex,con] shieldAllowed true`. Rage: `resource Rage max 'col[Rages]' long`. Fast Movement: `speed walk 10 when notHeavy`. Danger Sense, Reckless Attack and Feral Instinct: notes. |
| Bard | Bardic Inspiration: `resource 'Bardic Inspiration' 'max(1,mod:cha)' long`. Font of Inspiration: `resourceRecharge short`. Jack of All Trades: `halfProficiency`. Lore Bonus Proficiencies: `skill count 3 any`. |
| Cleric | Channel Divinity: `resource 'Channel Divinity' 'col[Channel Divinity]' short`. Life Domain Bonus Proficiency: `proficiency armor heavy`. Domain spells: `alwaysPrepared`. |
| Druid | Wild Shape: `resource 'Wild Shape' '2' short`. Land: circle spells as an option choice of terrain, with `alwaysPrepared` notes. |
| Fighter | Second Wind: `resource '1' short`. Action Surge: `resource 'col[Action Surges]' short`. Indomitable: `resource 'col[Indomitable]' long`. |
| Fighting styles | Archery: `bonus attack.ranged 2`. Defense: `bonus ac 1 when armored`. Dueling, Great Weapon Fighting, Protection and Two-Weapon Fighting: notes. |
| Champion | Remarkable Athlete: `halfProficiency [str,dex,con] roundUp`. Improved and Superior Critical: notes. |
| Monk | Unarmored Defense: `acBase 10 [dex,wis] shieldAllowed false`. Ki: `resource Ki 'col[Ki Points]' short`. Unarmored Movement: `speed walk 'col[Unarmored Movement]' when unarmored`. Diamond Soul: `proficiency save` for each ability. |
| Paladin | Divine Sense: `resource '1+mod:cha' long`. Lay on Hands: `resource '5*level' long`. Aura of Protection: `bonus save.all 'max(1,mod:cha)'`. Channel Divinity: `resource '1' short`. Oath spells: `alwaysPrepared`. |
| Ranger | Natural Explorer and Favored Enemy: notes, plus a language choice. |
| Rogue | Expertise: from data. Thieves' Cant: `proficiency language Thieves' Cant`. Slippery Mind: `proficiency save wis`. Reliable Talent and Evasion: notes. |
| Sorcerer | Sorcery Points: `resource 'col[Sorcery Points]' long`. Draconic Resilience: `bonus hpPerLevel 1` and `acBase 13 [dex] shieldAllowed true`. Dragon Ancestor: the option choice and `proficiency language Draconic`. |
| Warlock | Fiend expanded spells: a note. Pact Boon: the option choice. Invocations: notes per optional feature. |
| Wizard | Arcane Recovery: `resource '1' long`. |
| Acolyte | Skills (from data) and the language choice. |
| Grappler | A note. |

- [ ] **Step 1: Write the failing tests**

```ts
const idx = new ContentIndex([srd]);
const build = (race: string, sub: string | undefined, base: Partial<Scores>, classes: string[], answers: Partial<Record<Choice['type'], string[]>> = {}) => /* helper in test: newCharacter → race/sub → addLevel per class → each answers entry fills the first unanswered choice of that type ('option' values match option names case-insensitively by substring) → embedContent */;
test('SRD hill dwarf fighter 1 matches the hand-computed sheet', () => {
  const s = sheetOf(build('dwarf', 'hill-dwarf', { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, ['fighter'], { optionalFeature: ['optionalFeature:defense@SRD'], skill: ['athletics', 'perception'] }), [['chain-mail', true], ['shield', true], ['longsword', true]]);
  expect([s.ac, s.maxHp, s.saves.con.bonus, s.skills.perception.bonus, s.speed.walk]).toEqual([19, 14, 5, 3, 25]);
});
test('SRD class features drive numbers', () => {
  const monk = sheetOf(build('human', undefined, { dex: 15, wis: 15 }, Array(5).fill('monk')));
  expect([monk.ac, monk.speed.walk, monk.resources.find(r => r.name === 'Ki')!.max]).toEqual([16, 40, 5]);
  const barb = sheetOf(build('human', undefined, { dex: 13, con: 15 }, ['barbarian']));
  expect([barb.ac, barb.resources.find(r => r.name === 'Rage')!.max]).toEqual([15, 2]);
  const pal = sheetOf(build('human', undefined, { cha: 15 }, Array(6).fill('paladin')));
  expect([pal.saves.str.bonus, pal.resources.find(r => r.name === 'Lay on Hands')!.max, pal.resources.find(r => r.name === 'Divine Sense')!.max]).toEqual([3, 30, 4]); // str 11 (+0, not proficient) + aura 3
  const sorc = sheetOf(build('human', undefined, { dex: 13, con: 13 }, ['sorcerer'], { subclass: ['subclass:draconic@SRD'] }));
  expect([sorc.ac, sorc.maxHp]).toEqual([15, 6 + 2 + 1]);
  expect(sheetOf(build('half-orc', undefined, {}, ['fighter'])).skills.intimidation.proficient).toBe(true);
  expect(sheetOf(build('elf', 'high-elf', {}, ['wizard'])).skills.perception.proficient).toBe(true);
  expect(sheetOf(build('tiefling', undefined, {}, ['warlock'])).resistances).toContain('fire');
  expect(sheetOf(build('dragonborn', undefined, {}, ['fighter'], { option: ['red'] })).resistances).toContain('fire');
  expect(sheetOf(build('human', undefined, { int: 15, wis: 13 }, ['wizard', 'wizard', 'wizard', 'cleric', 'cleric'])).slots).toEqual([4, 3, 2]);
});
test('every authored SRD id exists', () => {
  for (const id of Object.keys(SRD_EFFECTS)) expect(idx.get(id.split('/')[0]), id).toBeDefined();
});
```

- [ ] **Step 2: Run `npx vitest run tests/srd/characters.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Author the effects, re-run `npm run build:srd`, and commit the regenerated JSON.**
- [ ] **Step 4: Run all tests with `npx vitest run`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: hand-authored SRD effects; end-to-end SRD character tests`.

---

### Task 11: 5etools import for non-class categories

**Files:**
- Create: `src/lib/import/fivetools/index.ts`, `common.ts`, `copy.ts`, `races.ts`,
  `backgrounds.ts`, `feats.ts`, `optionalFeatures.ts`, `conditions.ts`, `spells.ts` and
  `items.ts`, plus `scripts/import-check.ts`
- Test: `tests/import/fivetools.test.ts`, with fixtures in `tests/fixtures/5etools/`. These
  are hand-written files using the source code `TST` and invented content.

**Interfaces:**
- Consumes: `ContentIndex`, `entityId`/`featureId`/`baseKey`, `entriesToRich` and `renderTags`.
- Produces:
  - `interface ImportResult { packs: Pack[]; raw: [string, unknown][]; errors: { file: string; message: string }[]; skipped2024: number; warnings: string[] }`
  - `import5etools(files: { name: string; json: unknown }[], ctx: { index: ContentIndex; rawLookup: (key: string) => Promise<unknown | undefined> }): Promise<ImportResult>`
  - `mergePack(existing: Pack | undefined, incoming: Pack): Pack`. Entities with the same id
    are replaced, patches are deduplicated by `targetId + alias`, and `hash` and `importedAt`
    are refreshed.
  - `DROP_SOURCES = new Set(['XPHB', 'XDMG', 'XMM'])`
  - The raw key format is `` `${kind}|${name.toLowerCase()}|${source.toUpperCase()}` ``.
- **Packs are grouped by source:** one `Pack` per source, with `id: 'pack:' + SOURCE`.
  - The name comes from `book[]` or `adventure[]` entries (`{id, name}`) when a
    `books.json`/`adventures.json` is in the batch. Otherwise it's the source code.
  - An entity with `srd` set (`true` or a string with the SRD name) whose SRD counterpart
    exists becomes a patch on that counterpart: `{ targetId, alias: source, text }`. No entity
    is created for it.
- **Codes:** `code.split('|')[0]` everywhere (item `type`, `property`, `dmgType`).
- **Errors:**
  - A file with none of the recognised top-level keys (`race`, `subrace`, `background`,
    `feat`, `optionalfeature`, `condition`, `spell`, `baseitem`, `item`, `magicvariant`,
    `class`, `subclass`, `classFeature`, `subclassFeature`, `book`, `adventure`) gives the
    error `'No recognised 5etools content'`.
  - If a single entity fails to convert, the error is
    `` `${kind} "${name ?? '?'}": ${message}` `` and the rest of the file continues.
- **`_copy`:** resolve from the batch first, then from `rawLookup`. The supported `_mod` modes
  are `replaceArr`, `appendArr`, `prependArr`, `insertArr`, `removeArr`, `replaceTxt` and
  `setProp`. Any other mode adds a warning and is skipped.
- **Mappings:**
  - **Races:** `size[0]`; `speed` (a number or an object); `ability` (`{choose:{from,count,amount=1}}`
    becomes an ability choice); skill, language, tool, weapon and armor proficiencies, where
    `true` keys are fixed and `choose` or `any`/`anyStandard` become choices; `darkvision`;
    `resist` (strings); and named `entries` become `Trait`s. Subraces resolve `raceId` through
    `raceName`/`raceSource`, from the batch or the index. Skip subraces with no name.
  - **Spells:**
    - `level`. `school` codes: A abjuration, C conjuration, D divination, E enchantment,
      V evocation, I illusion, N necromancy, T transmutation.
    - `time[0]` becomes `"1 action"`, `"1 bonus action"`, or `"1 reaction, <condition>"`.
    - `range`: point/feet becomes `"150 feet"`; self → `"Self"`; touch → `"Touch"`; area types
      become `"Self (60-foot cone)"`; sight → `"Sight"`; unlimited → `"Unlimited"`.
    - `duration`: instant → `"Instantaneous"`; timed becomes `"1 minute"`, or
      `"Concentration, up to 1 minute"` with `concentration: true`; permanent → `"Until dispelled"`;
      special → `"Special"`.
    - `meta.ritual`; `entriesHigherLevel`.
    - `classes` come from `classes.fromClassList[].name`, slugified, **and** from a
      `sources.json`-shaped file (`{ "<SRC>": { "<Spell Name>": { "class": [{ "name", "source" }] } } }`)
      in the same batch.
  - **Items:**
    - Type codes: M/R → weapon; A → ammunition; LA/MA/HA → armor (light, medium or heavy); S →
      shield (`ac` from the item, default 2); G and SCF → gear; AT, T, INS and GS → tool; P →
      potion; RG → ring; RD → rod; SC → scroll; ST → staff; WD → wand. `wondrous: true` →
      wondrous. Anything else → other.
    - Damage type codes: B bludgeoning, P piercing, S slashing, A acid, C cold, F fire, O force,
      L lightning, N necrotic, I poison, Y psychic, R radiant, T thunder.
    - Property codes: A ammunition, F finesse, H heavy, L light, LD loading, R reach, S special,
      T thrown, 2H two-handed, V versatile.
    - `range` `"20/60"` becomes `[20,60]`. `strength` becomes `strReq`. `stealth` becomes
      `stealthDisadvantage`. `dexCap`: LA has none, MA has 2 (or `dexterityMax`), HA has 0.
    - `value` becomes `costCp`.
    - `bonusWeapon`, `bonusAc`, `bonusSavingThrow`, `bonusSpellAttack` and
      `bonusSpellSaveDc` are parsed from strings like `"+1"`.
    - `charges`. `recharge`: dawn, dusk, `restShort` → short, `restLong` → long, anything else →
      none. `rechargeAmount` has its tags rendered.
    - `reqAttune` becomes `attunement`. `baseItem` (`"longsword|phb"`) becomes `baseItemId`
      through `index.find`.
    - `rarity` of `"none"` means not magic.
  - **Magic variants:**
    - Each `magicvariant` with `requires` (an array of property objects such as `{weapon:true}`,
      `{type:'M'}` or `{armor:true}`) is expanded against every base item in the batch or index
      that matches **all keys of any one** `requires` object and **no** `excludes` entry.
    - The name is `(inherits.namePrefix ?? '') + base.name + (inherits.nameSuffix ?? '')`.
    - The source is `inherits.source`. Rarity and bonuses come from `inherits`, and its entries
      have `{=baseName}` replaced.
  - **Feats:** `prerequisite[]` maps `ability` to `abilities`, `race[].name` to `races`, and
    `spellcasting` to `spellcasting`. `ability` gives fixed bonuses, or a choice.
  - **Backgrounds:** proficiencies; `startingEquipment` as text; and the feature is the entry
    with `data.isFeature` or a name starting with "Feature:".
  - **Optional features:** `featureType`, plus `prerequisite` rendered as text.
- **Dropping 2024 content:** skip any entity whose source is in `DROP_SOURCES` or which has
  `edition === 'one'`. Count it in `skipped2024`.

- [ ] **Step 1: Write the fixtures and failing tests**

```ts
const srdIdx = new ContentIndex([srdPackFixture /* tests/fixtures/srdPack.ts: race:dwarf@SRD, item:longsword@SRD, class:fighter@SRD, feature:fighter:second-wind:1@SRD */]);
const run = (files: Record<string, unknown>) => import5etools(Object.entries(files).map(([name, json]) => ({ name, json })), { index: srdIdx, rawLookup: async () => undefined });
test('races, subraces, choices', async () => {
  const r = await run({ 'races.json': readFixture('races.json') });
  const tst = r.packs.find(p => p.source === 'TST')!;
  expect(tst.entities.find(e => e.id === 'race:testfolk@TST')).toMatchObject({ abilityBonuses: { str: 2 }, choices: [{ type: 'ability', count: 1, amount: 1, from: ['dex', 'con'] }] });
  expect(tst.entities.find(e => e.id === 'subrace:hill-testfolk@TST')).toMatchObject({ raceId: 'race:testfolk@TST' });
});
test('SRD overlap becomes a patch; 2024 is dropped', async () => {
  const r = await run({ 'x.json': { race: [{ name: 'Dwarf', source: 'PHB', srd: true, size: ['M'], speed: 25, entries: ['Full text.'] }], spell: [{ name: 'Fireball', source: 'XPHB', level: 3 }] } });
  const phb = r.packs.find(p => p.source === 'PHB')!;
  expect(phb.patches).toEqual([{ targetId: 'race:dwarf@SRD', alias: 'PHB', text: [{ p: 'Full text.' }] }]);
  expect(phb.entities.some(e => e.id === 'race:dwarf@PHB')).toBe(false);
  expect(r.skipped2024).toBe(1);
});
test('schema drift: piped codes, both spell-class styles', async () => {
  const r = await run({ 'items-base.json': { baseitem: [{ name: 'Testblade', source: 'TST', type: 'M|XPHB', weaponCategory: 'martial', property: ['F|XPHB', 'L'], dmg1: '1d6', dmgType: 'S|XPHB', weight: 2, value: 1000 }] },
    'spells-tst.json': { spell: [{ name: 'Testball', source: 'TST', level: 3, school: 'V', time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 150 } }, components: { v: true, s: true, m: 'a pinch of sulfur' }, duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }], entries: ['Boom.'], classes: { fromClassList: [{ name: 'Wizard', source: 'PHB' }] } },
      { name: 'Testlight', source: 'TST', level: 0, school: 'E', time: [{ number: 1, unit: 'bonus' }], range: { type: 'point', distance: { type: 'touch' } }, components: { v: true }, duration: [{ type: 'instant' }], entries: ['Glow.'] }] },
    'sources.json': { TST: { Testlight: { class: [{ name: 'Cleric', source: 'PHB' }] } } } });
  const all = r.packs.flatMap(p => p.entities);
  expect(all.find(e => e.name === 'Testblade')).toMatchObject({ type: 'weapon', weapon: { properties: ['finesse', 'light'], damageType: 'slashing' }, costCp: 1000 });
  expect(all.find(e => e.name === 'Testball')).toMatchObject({ range: '150 feet', duration: 'Concentration, up to 1 minute', concentration: true, castingTime: '1 action', classes: ['wizard'], school: 'evocation' });
  expect(all.find(e => e.name === 'Testlight')).toMatchObject({ classes: ['cleric'], castingTime: '1 bonus action', range: 'Touch', duration: 'Instantaneous' });
});
test('magic variants expand; excludes respected', async () => {
  const base = { name: 'Testsword', source: 'TST', type: 'M', weapon: true, weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S' };
  const variant = (excludes?: object) => ({ magicvariant: [{ name: '+1 Weapon', requires: [{ weapon: true }], excludes, inherits: { namePrefix: '+1 ', source: 'TST', rarity: 'uncommon', bonusWeapon: '+1', entries: ['A +1 {=baseName}.'] } }] });
  const ok = (await run({ 'b.json': { baseitem: [base] }, 'v.json': variant() })).packs.flatMap(p => p.entities);
  expect(ok.find(e => e.name === '+1 Testsword')).toMatchObject({ bonuses: { attack: 1, damage: 1 }, rarity: 'uncommon', magic: true });
  const no = (await run({ 'b.json': { baseitem: [base] }, 'v.json': variant({ name: ['Testsword'] }) })).packs.flatMap(p => p.entities);
  expect(no.some(e => e.name === '+1 Testsword')).toBe(false);
});
test('_copy with appendArr', async () => {
  const r = await run({ 'races.json': readFixture('races.json'), 'more.json': { race: [{ name: 'Copyfolk', source: 'TST', _copy: { name: 'Testfolk', source: 'TST', _mod: { entries: { mode: 'appendArr', items: 'Extra.' } } } }] } });
  const cf = r.packs.flatMap(p => p.entities).find(e => e.name === 'Copyfolk')!;
  expect((cf as RaceDef).abilityBonuses).toEqual({ str: 2 });
  expect(richToPlain(cf.text)).toContain('Extra.');
});
test('bad input never throws and keeps the good parts', async () => {
  const r = await run({ 'junk.json': { foo: 1 }, 'half.json': { race: [{ source: 'TST', size: ['M'], speed: 30 }, { name: 'Goodfolk', source: 'TST', size: ['M'], speed: 30, entries: [] }] },
    'mods.json': { race: [{ name: 'Oddfolk', source: 'TST', _copy: { name: 'Goodfolk', source: 'TST', _mod: { entries: { mode: 'calculateProp' } } } }] } });
  expect(r.errors).toContainEqual({ file: 'junk.json', message: 'No recognised 5etools content' });
  expect(r.errors.some(e => e.file === 'half.json' && e.message.startsWith('race "?"'))).toBe(true);
  expect(r.packs.flatMap(p => p.entities).map(e => e.name)).toEqual(expect.arrayContaining(['Goodfolk', 'Oddfolk']));
  expect(r.warnings.some(w => w.includes('calculateProp'))).toBe(true);
});
```

- [ ] **Step 2: Run `npx vitest run tests/import/fivetools.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the converters and `scripts/import-check.ts`.** The script:
  - takes a folder argument, reads every `*.json` under it recursively, and builds an index
    from `src/data/srd.json`
  - runs `import5etools` with an in-memory `rawLookup` over the batch
  - prints counts per source and kind, errors and warnings, and exits 0 unless an exception
    escaped
- [ ] **Step 4: Run the tests.** Expected: PASS. Then, **if** `C:\Users\bestj\dnd-app-testdata\5etools`
  exists, run `npm run import-check -- C:\Users\bestj\dnd-app-testdata\5etools`. Fix crashes
  and any systematic mapping errors it reveals, such as a different spell-class-list file
  shape. Note the counts in the commit body.
- [ ] **Step 5: Commit** with `feat: 5etools import for races, backgrounds, feats, options, conditions, spells, items`.

---

### Task 12: 5etools import for classes, subclasses and features

**Files:**
- Create: `src/lib/import/fivetools/classes.ts` (registered in `index.ts`)
- Test: `tests/import/classes.test.ts`, with fixture `tests/fixtures/5etools/class-testclass.json`
  (described below)

**Fixture `class-testclass.json`:**
- `class` Testclass (TST):
  - `hd {faces:10}`, `proficiency ['str','con']`
  - `startingProficiencies.skills [{choose:{from:['athletics','perception','survival'],count:2}}]`
  - `multiclassing {requirements:{or:[{str:13,dex:13}]}, proficienciesGained:{armor:['light']}}`
  - `classFeatures`: `'Battle Training|Testclass|TST|1'`,
    `'Variant Trick|Testclass|TST|2|TCE'`,
    `{classFeature:'Test Path|Testclass|TST|3', gainSubclassFeature:true}`,
    `'Ability Score Improvement|Testclass|TST|4'`, `'Expertise|Testclass|TST|6'` and
    `'Ability Score Improvement|Testclass|TST|8'`
  - `subclassTitle 'Test Path'`, `casterProgression '1/2'`, `spellcastingAbility 'wis'`,
    `preparedSpells '<$level$> / 2 + <$wis_mod$>'`
  - `classTableGroups [{colLabels:['{@filter Tricks|classes}'], rows: 20 rows [[1],[1],[2],…]}]`
  - `optionalfeatureProgression [{name:'Fighting Style', featureType:['FS:F'], progression:{'2':1}}]`
- `classFeature` records for each referenced feature. Variant Trick has
  `isClassFeatureVariant: true` and `source: 'TCE'`.
- `subclass` Champion of Tests: `shortName 'Champ'`, `className 'Testclass'`, `classSource 'TST'`,
  `subclassFeatures ['Champ|Testclass|TST|Champ|TST|3','Big Hit|Testclass|TST|Champ|TST|7']`.
- `subclassFeature` records for both.
- **The SRD-overlap block:**
  - `class` Fighter (source PHB, `srd: true`), whose `classFeatures` include
    `'Second Wind|Fighter||1'` and `'Martial Versatility|Fighter||4|TCE'`
  - `classFeature` Second Wind (Fighter/PHB, level 1, `srd: true`)
  - `classFeature` Martial Versatility (Fighter/PHB, level 4, source TCE, `isClassFeatureVariant: true`)
  - `subclass` Battle Master (PHB, `className 'Fighter'`, `classSource 'PHB'`)

**Mapping notes:**
- **Feature references.** The class format is `Name|Class|ClassSource|Level|FeatureSource?`.
  The subclass format is `Name|Class|ClassSource|SubShort|SubSource|Level|FeatureSource?`.
  Empty sources default to the class's source, then PHB.
- **Process class records and their aliases before subclasses,** so that `Fighter|PHB`
  resolves to `class:fighter@SRD` inside the same batch.
- **Choices:**
  - The feature flagged `gainSubclassFeature` at the lowest level gets `{type:'subclass'}`, and
    that level becomes `subclassLevel`.
  - "Ability Score Improvement" gets `{type:'asi'}`, and its levels become `asiLevels`.
  - "Expertise" gets `{type:'expertise', count:2}`.
- **`optionalfeatureProgression`.** `progression` can be a 20-length array or a
  `{level: count}` object. Either way it becomes a cumulative `counts` array of length 20.
- **`classTableGroups`.** Ignore groups that have `rowsSpellProgression`. Column labels have
  their tags rendered. Cell objects: `{type:'bonus',value}` becomes `'+2'`,
  `{type:'dice',toRoll:[{number,faces}]}` becomes `'1d6'`, and `{type:'bonusSpeed',value}`
  becomes `'+10 ft.'`.
- **Spellcasting.** `casterProgression` maps `full`→full, `1/2`→half, `1/3`→third,
  `pact`→pact and `artificer`→artificer.
  - `preparedSpells` becomes `preparedFormula`: `<$level$>` → `level`, `<$X_mod$>` → `mod:X`,
    spaces stripped.
  - `cantripProgression` becomes `cantrips` and `spellsKnownProgression` becomes `known`.
  - `spellsKnownProgressionFixed` present → `spellbook: true`.
  - `additionalSpells[].prepared` (`{"1":[...]}`) becomes `alwaysPrepared`.
- **Optional class features.** `isClassFeatureVariant` → `optional: true`.
- **Overlap patch.** An SRD-overlap class emits
  `{ targetId: 'class:fighter@SRD', alias: 'PHB', text, addFeatures }`. `addFeatures` lists the
  referenced features that have no SRD counterpart.

- [ ] **Step 1: Write the failing tests**

```ts
test('Testclass converts', async () => {
  const r = await run({ 'class-testclass.json': readFixture('class-testclass.json') });
  const ents = r.packs.flatMap(p => p.entities);
  const c = ents.find(e => e.id === 'class:testclass@TST') as ClassDef;
  expect([c.hitDie, c.saves, c.subclassLevel, c.asiLevels, c.subclassTitle]).toEqual([10, ['str', 'con'], 3, [4, 8], 'Test Path']);
  expect(c.skillChoice).toEqual({ count: 2, from: ['athletics', 'perception', 'survival'] });
  expect(c.multiclassPrereq).toEqual({ any: { str: 13, dex: 13 } });
  expect(c.spellcasting).toMatchObject({ progression: 'half', ability: 'wis', preparation: 'prepared', preparedFormula: 'level/2+mod:wis' });
  expect(c.table[0]).toMatchObject({ label: 'Tricks' });
  expect(c.optionalFeatureProgression[0].counts.slice(0, 3)).toEqual([0, 1, 1]);
  const f = (n: string, l: number, src = 'TST') => ents.find(e => e.id === featureId('Testclass', undefined, n, l, src)) as FeatureDef;
  expect(f('Ability Score Improvement', 4).choices).toEqual([{ type: 'asi' }]);
  expect(f('Test Path', 3).choices).toEqual([{ type: 'subclass' }]);
  expect(f('Expertise', 6).choices).toEqual([{ type: 'expertise', count: 2 }]);
  expect(f('Variant Trick', 2, 'TCE')).toMatchObject({ optional: true, source: 'TCE' });
  expect(r.packs.find(p => p.source === 'TCE')!.entities.length).toBeGreaterThan(0);
  const sub = ents.find(e => e.kind === 'subclass' && e.name === 'Champion of Tests') as SubclassDef;
  expect([sub.classId, sub.shortName, sub.features.map(x => x.level)]).toEqual(['class:testclass@TST', 'Champ', [3, 7]]);
});
test('PHB Fighter merges into SRD; PHB subclasses attach', async () => {
  const r = await run({ 'class-testclass.json': readFixture('class-testclass.json') }); // fixture index has class:fighter@SRD, feature:fighter:second-wind:1@SRD
  const phb = r.packs.find(p => p.source === 'PHB')!;
  expect(phb.patches).toContainEqual(expect.objectContaining({ targetId: 'class:fighter@SRD', alias: 'PHB', addFeatures: [{ level: 4, id: 'feature:fighter:martial-versatility:4@TCE' }] }));
  expect(phb.patches.some(p => p.targetId === 'feature:fighter:second-wind:1@SRD')).toBe(true);
  expect((phb.entities.find(e => e.name === 'Battle Master') as SubclassDef).classId).toBe('class:fighter@SRD');
});
```

- [ ] **Step 2: Run `npx vitest run tests/import/classes.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests.** Expected: PASS. **If** the test data exists, re-run
  `npm run import-check` and confirm that every 2014 class and subclass converts with no
  errors.
- [ ] **Step 5: Commit** with `feat: 5etools class/subclass/feature import with SRD merge`.

---

### Task 13: Campaigns, settings, packs and backup UI

**Files:**
- Create:
  - `src/lib/store.svelte.ts`: the reactive `app` state with `campaign: Campaign | undefined`,
    `viewer: 'dm' | 'player'`, and `getIndex(campaignId?: string): Promise<ContentIndex>`.
    - The index is built from the SRD plus that campaign's `enabledPacks`. With no
      `campaignId`, it uses the current campaign.
    - When neither is set, it uses every pack.
    - It is cached by the sorted pack ids plus their hashes.
  - `src/lib/platform.ts`: `isIOS()`, `isStandalone()`, and
    `needsBackupReminder(o: { lastBackupAt?: number; snoozedUntil?: number; hasData: boolean; now: number }): boolean`
  - `src/ui/pages/Campaigns.svelte`, `src/ui/pages/CampaignSettings.svelte`,
    `src/ui/pages/Packs.svelte`, `src/ui/BackupBanner.svelte`, `src/ui/CampaignPicker.svelte`
- Test: `tests/platform.test.ts`

**Behavior:**
- **Campaigns page:** list; create (name); open (sets `app.campaign`, persisted in meta
  `currentCampaign`); rename; delete with a confirm that names what is removed; and export a
  backup of this campaign.
- **Settings page:** one labelled control for every `CampaignSettings` field, and a checklist of
  enabled packs. Saving happens on change. The initiative modules and map options are shown
  under the heading "Used in later stages".
- **Packs page:**
  - A multi-file `<input type=file accept=".json" multiple>`. It lazy-imports
    `src/lib/import/fivetools/index.ts` and calls `import5etools` with `rawLookup` set to
    `db.raw5e`.
  - Results are written as `mergePack(await db.packs.get(id), incoming)` and `db.raw5e.putMany`.
  - It shows a summary with counts per source, errors per file, warnings, and
    `skipped2024`.
  - The pack list shows the name, source, counts and import date, with delete (confirm).
  - Copy on the page tells the user to select all the files at once.
- **Backup banner:** shown when `needsBackupReminder` is true. It has Export (which includes
  the imported books when a checkbox is checked) and "Remind me in 3 days", which sets meta
  `backupSnoozedUntil`. Import-backup lives on the Campaigns page.
- **iOS tip:** when `isIOS() && !isStandalone()`, show a one-time dismissible tip: "Add this app
  to your Home Screen so Safari doesn't clear your data." It's stored in meta `iosTipDismissed`.
- **Startup:** call `requestPersistence()` and restore `currentCampaign`.

- [ ] **Step 1: Write the failing test**

```ts
const day = 86_400_000, now = 100 * day;
test('backup reminder', () => {
  expect(needsBackupReminder({ hasData: true, now })).toBe(true);
  expect(needsBackupReminder({ hasData: true, lastBackupAt: now - 13 * day, now })).toBe(false);
  expect(needsBackupReminder({ hasData: true, lastBackupAt: now - 15 * day, now })).toBe(true);
  expect(needsBackupReminder({ hasData: true, lastBackupAt: now - 15 * day, snoozedUntil: now + day, now })).toBe(false);
  expect(needsBackupReminder({ hasData: false, now })).toBe(false);
});
```

- [ ] **Step 2: Run `npx vitest run tests/platform.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement the helpers and the pages.**
- [ ] **Step 4: Run the tests and `npm run check`.** Expected: PASS. Then verify in the browser
  pane (`npm run dev`):
  1. Create a campaign, toggle encumbrance to variant, and reload. It persists.
  2. Import `tests/fixtures/5etools/*.json`. The summary shows a TST pack and the
     `junk.json` error.
  3. Enable the TST pack in settings.
  4. At 375 px width, nothing overflows horizontally.
- [ ] **Step 5: Commit** with `feat: campaigns, settings, pack import, backup reminder UI`.

---

### Task 14: Compendium

**Files:**
- Create: `src/ui/pages/Compendium.svelte`, `src/ui/VirtualList.svelte`,
  `src/ui/EntityDetail.svelte`, `src/lib/virtual.ts`
- Test: `tests/virtual.test.ts`

**Behavior:**
- **Kind tabs:** Spells, Items, Races, Classes, Backgrounds, Feats, Options and Conditions.
- **Search** uses `ContentIndex.search`. There's a source filter. Spells filter by level and
  class, and items by type, rarity and magic.
- **Items** also lists the current campaign's homebrew items (`db.items`).
- **Rows** are 44 px each, in `VirtualList`.
- **The detail view** renders the kind's fields (spell header line, item type/rarity/attunement
  line, class hit die and saves table) and `RichText`. It's a side pane from 768 px and full
  screen below that.

- [ ] **Step 1: Write the failing test**

```ts
test('visibleRange', () => {
  expect(visibleRange(0, 440, 44, 1000, 5)).toEqual([0, 15]);
  expect(visibleRange(4400, 440, 44, 1000, 5)).toEqual([95, 115]);
  expect(visibleRange(43_800, 440, 44, 1000, 5)).toEqual([990, 1000]);
});
```

- [ ] **Step 2: Run `npx vitest run tests/virtual.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `visibleRange(scrollTop, viewport, rowHeight, count, overscan): [number, number]`
  and the components.**
- [ ] **Step 4: Run the tests.** Expected: PASS. Then verify in the browser:
  1. With the SRD, searching "fire" lists Fireball, and its detail shows the text and
     "3rd-level evocation".
  2. The magic items list scrolls smoothly under 4× CPU throttling in devtools.
- [ ] **Step 5: Commit** with `feat: compendium browser with virtualized lists`.

---

### Task 15: Dice tray and roll log

**Files:**
- Create: `src/lib/rolls.svelte.ts` and `src/ui/DiceTray.svelte`

**Interfaces:**
- Consumes: `rollDice` (Task 6).
- Produces:
  - `rollLog: RollEntry[]` (reactive, most recent first, capped at 200)
  - `interface RollEntry { id: string; label: string; expr: string; total: number; detail: string; at: number; public: boolean }`
  - `roll(label: string, expr: string, opts?: { crit?: boolean }): RollEntry`, which uses the
    tray's current advantage state and then resets it to normal
  - `rollMode: { value: 'normal' | 'adv' | 'dis' }`

**Behavior:**
- A floating tray button opens a panel containing:
  - an expression box, which rejects input with the parser's message
  - buttons for d4, d6, d8, d10, d12, d20 and d100
  - a normal/advantage/disadvantage toggle
  - a public/private toggle, defaulting to public, and stored with each entry for stage 3
  - the log
- A natural 20 or a natural 1 on a d20 is highlighted.

- [ ] **Step 1: Implement** (the logic is already tested in Task 6).
- [ ] **Step 2: Verify in the browser.** `2d6+3` logs a total and detail. Advantage on
  `1d20+5` shows two dice. Keyboard users can reach every control, and Enter rolls.
- [ ] **Step 3: Commit** with `feat: dice tray and roll log`.

---

### Task 16: Character creator and level-up

**Files:**
- Create:
  - `src/ui/pages/Characters.svelte`: list, filter by campaign, New, and Import (`.json` goes to
    `importRecord`; `.pdf` is wired up in Task 20)
  - `src/ui/creator/Creator.svelte`
  - The steps: `src/ui/creator/RaceStep.svelte`, `ClassStep.svelte`, `AbilitiesStep.svelte`,
    `BackgroundStep.svelte`, `ChoicesStep.svelte`, `ChoiceInput.svelte`,
    `EquipmentStep.svelte`, `SpellsStep.svelte`, `DetailsStep.svelte`, `ReviewStep.svelte`
  - `src/ui/creator/LevelUp.svelte` and `src/lib/images.ts`
- Test: `tests/images.test.ts` (for the pure size helper)

**Interfaces:**
- Consumes: `listChoices`, `answerChoice`, `validateCharacter`, `addLevel`, `embedContent`,
  `spellLimits`, `newCharacter`, `computeSheet`, `makeEntry`, `app.getIndex()`, `roll()`, and
  `db`.
- Produces:
  - `fitWithin(w: number, h: number, maxSide: number): { w: number; h: number }`, which keeps the
    aspect ratio and never upscales
  - `resizeImage(file: Blob, maxSide: number, type = 'image/webp', quality = 0.85): Promise<Blob>`
    (canvas based; also used by stage 5 maps at 4096)

**Behavior:**
- **Content index.** The creator and level-up use `app.getIndex(character.campaignId)`, which
  holds the SRD plus that campaign's enabled packs (spec 3.2, "Where characters live"). A
  character outside any campaign sees every pack.
- **Step list.** A clickable list of steps, in the spec's 3.2 order. Each step shows its
  `validateCharacter` problems for that `step`. Save is disabled while any blocking problem
  remains.
- **Class step.** Pick a class and "Start at level N" (1 to 20), which calls `addLevel`
  repeatedly. HP per `settings.hpMethod`: average, or a roll per level through `roll()`.
- **Abilities step:**
  - Point buy has +/− buttons and shows the remaining points against 27.
  - Standard array assigns values through selects, and each value can be used once.
  - Rolled does six `roll4d6DropLowest` rolls, logged to the roll log, which are then assigned.
  - Manual appears only when `allowOverrides` is on.
  - When `customOrigin` is on, the racial bonuses can be reassigned: +2/+1 or +1/+1/+1, to
    any abilities.
- **Choices step.** Every `PendingChoice` is grouped by level. `ChoiceInput` renders each
  choice type:
  - subclass picker: from `index.subclassesOf`
  - optional features: from `index.optionalFeatures(featureTypes)`, with prerequisite text
  - feats: when `settings.feats` is on, ASI offers "+2 / +1+1 or a feat"
  - checklists for skills, expertise (only proficient skills), languages and tools
  - ability picks
  - option radio and checkboxes
- **Equipment step.** One radio group per `startingEquipment.choices` group, for the class and
  the background. Category items open a filtered `ItemPicker` (built in Task 19; until then a
  plain select of matching items). Or "Take starting gold", which rolls `gold`. Chosen items
  go through `makeEntry` into the inventory.
- **Spells step.** One section per `spellLimits` entry. Spells are filtered by class slug and
  `maxLevel`, with counters against the limits. Wizards pick spellbook spells and then
  prepared spells.
- **Details step.**
  - Name, an alignment select (the 9 alignments), and text areas.
  - A **Campaign** select (none, or one campaign) that sets `campaignId`. The same select on
    the sheet moves an existing character into or out of a campaign. Its embedded content stays
    as it is.
  - A portrait upload that goes through `resizeImage(file, 256)` and then `db.blobs.put`.
- **Review step.** A compact `computeSheet` preview, then Save: `embedContent`, then
  `db.characters.put`, then navigate to `characters/:id`.
- **Level-up page.**
  - Choose an existing class, or a new one. A new class goes through `addLevel` problems,
    shown with an override when `allowOverrides` is on.
  - HP: average, or a roll.
  - Then the new choices, then spells, then Save (which re-embeds).

- [ ] **Step 1: Write the failing test**

```ts
test('fitWithin', () => {
  expect(fitWithin(1024, 512, 256)).toEqual({ w: 256, h: 128 });
  expect(fitWithin(100, 300, 256)).toEqual({ w: 85, h: 256 });
  expect(fitWithin(100, 50, 256)).toEqual({ w: 100, h: 50 });
});
```

- [ ] **Step 2: Run `npx vitest run tests/images.test.ts`.** Expected: FAIL. Then implement and
  run it again. Expected: PASS.
- [ ] **Step 3: Implement the pages.**
- [ ] **Step 4: Verify in the browser** at both 375 px and desktop:
  1. Build a Hill Dwarf Fighter 1 (standard array str 15, dex 13, con 14, int 8, wis 12,
     cha 10; Defense; athletics and perception; chain mail, shield and longsword). The review
     shows AC 19 and HP 14.
  2. Level up to 3 and pick Champion.
  3. With Int 8, multiclassing into Wizard is blocked with "Multiclassing into Wizard needs Int
     13". With rule overrides on, it's allowed as a warning.
  4. A wizard 1 must pick 3 cantrips and 6 spellbook spells.
- [ ] **Step 5: Commit** with `feat: character creator and level-up flow`.

---

### Task 17: Character sheet and play mode

**Files:**
- Create: `src/ui/sheet/Sheet.svelte`, `Abilities.svelte`, `Combat.svelte`, `Attacks.svelte`,
  `Spells.svelte`, `Features.svelte`, `OverrideNumber.svelte`, `CustomEffects.svelte`,
  `RestDialogs.svelte` and `src/ui/Toast.svelte`

**Behavior:**
- `computeSheet(c, { settings: app.campaign?.settings ?? DEFAULT_SETTINGS, viewer: app.viewer })`
  is a `$derived`.
- **Numbers.** Every check, save, skill, initiative, attack and damage figure is a button that
  calls `roll()` (attack rolls `1d20+toHit`; damage rolls the damage string, with a Crit
  option).
- **Overrides.** `OverrideNumber` shows the value. An edit button opens an input that writes
  `c.overrides[key]`. An overridden value shows a ✎ badge and a Reset button.
- **HP widget:**
  - Damage, Heal and Temp inputs call `applyDamage`, `applyHealing` and set `tempHp`.
  - At 0 HP it shows death saves, with a Roll button that rolls d20 and calls `rollDeathSave`.
  - It shows "Stable" or "Dead" states.
- **Rests.** The short rest dialog picks hit dice to spend, rolls them, and calls `shortRest`.
  The long rest dialog confirms and calls `longRest`.
- **Trackers:**
  - condition chips (the 14 conditions), and an exhaustion stepper from 0 to 6
  - slot pips per level, pact slot pips, resource pips with their recharge label, and an
    inspiration toggle
- **Features** lists every gained feature, trait and chosen option with its `RichText`, plus
  `sheet.notes`.
- **Custom effects** lets the user add an effect from the `Effect` union through a form (type
  select, then the fields for that type).
- **Banners and warnings.** An "Imported, unverified" banner shows when `c.imported`. The
  sheet's `warnings` are shown in a warning list.
- **Autosave.** Changes save after a 500 ms debounce via `db.characters.put`. A
  `StorageError` shows in a Toast, and the in-memory state is kept.
- **Buttons:** Level up (to the route) and Export (wired up in Task 20).
- **Keyboard.** All controls are native buttons and inputs with labels, and the tab order
  follows the visual order.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify in the browser:**
  1. On the Hill Dwarf Fighter, set 5 temp HP, then take 8 damage. HP shows 11/14 and temp 0.
  2. Damage to 0 shows death saves. Roll until stable or dead, then heal 5. The death saves
     clear.
  3. A short rest spending 1 hit die raises HP. A long rest restores it.
  4. Override AC to 21 and reload: the ✎ badge persists, and Reset returns AC to 19.
  5. In devtools, block IndexedDB writes (or simulate quota). Editing shows the toast "Could not
     save: …".
- [ ] **Step 3: Commit** with `feat: character sheet with play-mode tracking, rests, overrides`.

---

### Task 18: Item creator and player-view editor

**Files:**
- Create:
  - `src/ui/pages/Items.svelte`: the homebrew list for the current campaign, with New
  - `src/ui/items/ItemEditor.svelte`, `src/ui/items/EffectsEditor.svelte` and
    `src/ui/items/PlayerViewEditor.svelte`
  - `src/lib/items/textEdit.ts`
- Test: `tests/items/textEdit.test.ts`

**Interfaces:**
- Produces:
  - `richToEditable(r: RichText): string`. Blocks are separated by blank lines; lists use
    `- item` lines; tables use `| a | b |` rows with the first row as the head; headers use
    `## H`, with their blocks following until the next `## `.
  - `editableToRich(s: string): RichText`
  - `wrapRedaction(s: string, start: number, end: number, id: string): string`. This returns
    `s` unchanged if the range is empty or overlaps an existing marker.
  - `nextRedactionId(r: RichText): string`, which returns `r1`, `r2` and so on.
  - `PlayerViewEditor` props: `{ item: ItemDef; view: PlayerView | undefined; onchange(view: PlayerView | undefined): void }`
- **ItemEditor:**
  - It edits every `ItemDef` field: name, type, rarity, attunement (none, required, or
    "required by …"), weight, cost, magic, consumable, weapon block, armor block, bonuses,
    charges and recharge, curse text, and description.
  - The base-item picker copies the `weapon`/`armor` blocks, weight and cost from the chosen
    base, and sets `baseItemId`.
  - `EffectsEditor` handles the effects.
  - Items are stored as `StoredItem` through `db.items.put`, with Duplicate and Delete.
  - A "Default player view" section (`PlayerViewEditor`) writes `defaultView`.
- **PlayerViewEditor:**
  - a player name field
  - a player text area (starting from `richToEditable(item.text)`), with a "Redact selection"
    button that calls `wrapRedaction` with the textarea's selection
  - "hidden" checkboxes for the 6 `HideableField`s
  - a list of redactions, each with its hidden text and a Reveal button
  - Reveal buttons for hidden fields
  - Identify, which sets the view to `undefined`
  - a live "Players see" preview showing `playerItem(item, view)` through `RichText`

- [ ] **Step 1: Write the failing tests**

```ts
test('editable text round-trips', () => {
  const r: RichText = [{ p: 'Para one' }, { list: ['a', 'b'] }, { table: { head: ['d6', 'x'], rows: [['1', 'y']] } }, { h: 'Head', blocks: [{ p: 'inner' }] }];
  expect(editableToRich(richToEditable(r))).toEqual(r);
  expect(editableToRich('Para one\n\n- a\n- b')).toEqual([{ p: 'Para one' }, { list: ['a', 'b'] }]);
});
test('wrapRedaction', () => {
  expect(wrapRedaction('abc def', 4, 7, 'r1')).toBe('abc {{redact:r1}}def{{/redact}}');
  const once = wrapRedaction('abc def', 4, 7, 'r1');
  expect(wrapRedaction(once, 2, 10, 'r2')).toBe(once);
  expect(wrapRedaction('abc', 1, 1, 'r1')).toBe('abc');
  expect(nextRedactionId([{ p: '{{redact:r1}}x{{/redact}} {{redact:r3}}y{{/redact}}' }])).toBe('r4');
});
```

- [ ] **Step 2: Run `npx vitest run tests/items/textEdit.test.ts`.** Expected: FAIL. Then
  implement and run it again. Expected: PASS.
- [ ] **Step 3: Implement the components.**
- [ ] **Step 4: Verify in the browser:**
  1. Create the homebrew "Potion of Poison" (potion, uncommon, consumable). Give it the
     default view: name "Cloudy red potion", with "It is poison" redacted and rarity hidden.
  2. The preview shows the cover name and a bar, and Reveal shows the hidden text.
  3. Make "+1 Longsword" from the base longsword with attack and damage +1.
- [ ] **Step 5: Commit** with `feat: magic item creator and DM player-view editor with redaction`.

---

### Task 19: Inventory, currency and party loot

**Files:**
- Create: `src/ui/sheet/Inventory.svelte`, `src/ui/ItemPicker.svelte`,
  `src/ui/pages/Loot.svelte` and `src/ui/ViewerToggle.svelte`
- Modify: `src/ui/sheet/Sheet.svelte` (adds the Inventory tab), and `src/ui/sheet/RestDialogs.svelte`
  (rests call `rechargeEntry` on every entry)

**Behavior:**
- **ItemPicker:** a search over index items plus campaign homebrew, with type and rarity
  filters. Picking an item calls `makeEntry(item, { sourceId: item.id, view: stored.defaultView })`.
- **Inventory rows:**
  - The name is `playerItem` when the viewer is player, otherwise the true name, with a
    "Secret" badge when a view exists.
  - Quantity ±.
  - An equipped toggle for weapons, armor, shields and any magic item.
  - An attuned toggle, only when the item needs attunement. At 3 attuned items it warns: "Over
    the limit of 3; allowed only with an override, for example artificer."
  - Charges pips and a Use charge button. Use for consumables.
  - Notes.
  - A menu with: Edit player view (`PlayerViewEditor` on this entry), Update from source
    (enabled when the index has `sourceId`, via `refreshEntry`), Transfer (pick another
    character in the campaign, or Party loot, plus a quantity, via `transfer`), and Remove
    (confirm).
- **Currency:** five number inputs.
- **Encumbrance:** when the setting isn't off, show the carried weight against capacity and the
  status.
- **Dawn button:** calls `rechargeEntry(e, 'dawn')` for all entries. Rests recharge with `short`
  or `long`.
- **Loot page:** `campaign.loot` holds entries. Add uses `ItemPicker`. "Edit player view" and
  "Give to…" (a character picker, via `transfer`) write the campaign through
  `db.campaigns.put`.
- **ViewerToggle:** "View as: DM / Player" in the header. It sets `app.viewer`, which drives
  `computeSheet` and every item display. It's shown only when a campaign is selected.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Verify in the browser:**
  1. Add a longsword and equip it: an attack row appears.
  2. Add a Ring of Protection, equip it and attune it: AC +1.
  3. Add the secret potion to party loot and give it to the fighter. As Player, it shows
     "Cloudy red potion", with no rarity and a bar. As DM, it shows the true name and the
     Secret badge.
  4. Use the potion: it's removed at quantity 0.
  5. Give a wand with 7 charges, spend 3, and press Dawn: the charges are restored by the roll.
  6. Turn variant encumbrance on, add 200 lb of gear, and check the speed drop.
- [ ] **Step 3: Commit** with `feat: inventory, attunement, charges, currency, party loot, viewer toggle`.

---

### Task 20: PDF export and import (our own format)

**Files:**
- Create:
  - `src/lib/pdf/fieldmap.ts`: `interface FieldMap { id: string; detect(names: Set<string>): boolean; toCharacter(fields: Record<string, string | boolean>, index?: ContentIndex): Character }`,
    plus a `FIELD_MAPS` registry array
  - `src/lib/pdf/winansi.ts`: `toWinAnsi(s: string): string`
  - `src/lib/pdf/appLayout.ts`: `appFieldValues(c: Character, sheet: Sheet): Record<string, string>`,
    plus the page drawing
  - `src/lib/pdf/exportPdf.ts`
  - `src/lib/pdf/importPdf.ts`
- Modify: Characters page (PDF import), the Sheet (Export JSON/PDF), and ItemEditor plus the
  inventory menu (Export JSON/PDF).
- Test: `tests/pdf/roundtrip.test.ts`

**Interfaces:**
- Produces:
  - `exportCharacterPdf(c: Character, sheet: Sheet): Promise<Uint8Array>`
  - `exportItemPdf(item: ItemDef): Promise<Uint8Array>`. Callers pass `playerItem(...)` when
    exporting for a player.
  - `importPdf(bytes: Uint8Array, index?: ContentIndex): Promise<{ kind: 'character'; data: Character; edits: string[] } | { kind: 'item'; data: ItemDef }>`
  - `pdf-lib` is reached only through `await import('pdf-lib')` inside these functions.
- **Our layout:**
  - US Letter, 3 pages for characters (main sheet; spells and slots; inventory, currency and
    notes) and 1 page for items. The design is our own: no WotC trade dress.
  - The text fields are named:
    - `app.name`, `app.classLevels`, `app.race`, `app.background`, `app.alignment`
    - `app.score.<ability>`, `app.mod.<ability>`, `app.save.<ability>`, `app.skill.<skill>`
    - `app.ac`, `app.init`, `app.speed`, `app.hpMax`, `app.hp`, `app.hitDice`, `app.prof`,
      `app.passive`
    - `app.attacks`, `app.profs`, `app.features`, `app.spells`, `app.slots`, `app.inventory`
      (multiline)
    - `app.currency.<cp|sp|ep|gp|pp>`, `app.notes`
  - The hidden field `app.data` holds the base64 of the UTF-8 JSON
    `{ format: 'dnd-app-character' | 'dnd-app-item', version: 1, data }`.
  - Every visible value passes through `toWinAnsi`. Characters outside WinAnsi become `?`.
- **Re-import:** decode `app.data`, then compute
  `expected = appFieldValues(data, computeSheet(data, …))`. For each editable field whose
  value differs from `expected`, apply it:

  | Field | Applied to | Edit label |
  | --- | --- | --- |
  | `app.name` | `name` | "Name" |
  | `app.hp` | `state.hp` | "HP" |
  | `app.ac`, `app.init`, `app.speed`, `app.hpMax`, `app.prof`, `app.passive` | `overrides` (`ac`, `initiative`, `speed`, `maxHp`, `prof`, `passivePerception`) | "AC", "Initiative", "Speed", "Max HP", "Proficiency", "Passive Perception" |
  | `app.save.*`, `app.skill.*` | `overrides` (`save.*`, `skill.*`) | "Saving throw (Str)", "Skill (Stealth)" and so on |
  | `app.score.*` | `overrides['score.*']` | "Strength" and so on |
  | `app.currency.*` | `currency` | "Currency" |
  | `app.notes` | `details.notes` | "Notes" |

  Parse numbers with `parseInt` and skip non-numbers.
- **Unknown PDFs:** a PDF without `app.data` falls through to `FIELD_MAPS` detection (Task 21).
  If nothing matches, it throws `Error('Unrecognised PDF: no supported form fields')`.

- [ ] **Step 1: Write the failing tests** (node environment; pdf-lib runs in Node)

```ts
const c = embedContent(mkChar({ race: 'dwarf', subrace: 'hill-dwarf', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, levels: ['fighter'], inventory: [['chain-mail', true], ['shield', true]] }), fixtureIndex());
const sheet = () => computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'dm' });
test('character round-trip is lossless', async () => {
  const r = await importPdf(await exportCharacterPdf(c, sheet()));
  expect(r.kind).toBe('character');
  expect({ ...r.data, updatedAt: 0 }).toEqual({ ...c, updatedAt: 0 });
  expect((r as { edits: string[] }).edits).toEqual([]);
});
test('edits made in a PDF reader come back as overrides', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await exportCharacterPdf(c, sheet()));
  doc.getForm().getTextField('app.ac').setText('21'); doc.getForm().getTextField('app.name').setText('Bruni');
  const r = await importPdf(await doc.save()) as { data: Character; edits: string[] };
  expect([r.data.overrides.ac, r.data.name]).toEqual([21, 'Bruni']);
  expect(r.edits).toEqual(expect.arrayContaining(['AC', 'Name']));
});
test('non-Latin names survive', async () => {
  const z = { ...c, name: 'Zoë 🐉 李' };
  const bytes = await exportCharacterPdf(z, sheet());
  const { PDFDocument } = await import('pdf-lib');
  expect((await PDFDocument.load(bytes)).getForm().getTextField('app.name').getText()).toBe('Zoë ? ?');
  expect((await importPdf(bytes)).data.name).toBe('Zoë 🐉 李');
});
test('item card carries only what it was given', async () => {
  const p = playerItem(potionFixture, { name: 'Cloudy red potion', hidden: ['rarity'], revealed: [] });
  const r = await importPdf(await exportItemPdf(p));
  expect(r).toMatchObject({ kind: 'item', data: { name: 'Cloudy red potion', rarity: undefined } });
  expect(JSON.stringify(r.data)).not.toContain('It is poison');
});
test('unknown PDFs are rejected', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create(); doc.addPage();
  await expect(importPdf(await doc.save())).rejects.toThrow('Unrecognised PDF: no supported form fields');
});
```

- [ ] **Step 2: Run `npx vitest run tests/pdf/roundtrip.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Compare visible fields against the `toWinAnsi`-sanitized expected values, so that sanitizing
    never reads as an edit.
  - Field appearances use `StandardFonts.Helvetica`.
  - Downloads use `URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))` with
    the file name `<name>.pdf`.
- [ ] **Step 4: Run all tests.** Expected: PASS. Then run `npm run build && npm run size`: still
  under budget, because pdf-lib is in its own chunk. In the browser, export the fighter to PDF,
  open it in the browser's PDF viewer, edit AC, save, re-import, and see the AC override and
  the edit list.
- [ ] **Step 5: Commit** with `feat: PDF export/import with embedded data and edit detection`.

---

### Task 21: The official 2014 sheet field map

**BLOCKED** until the blank official sheet exists in `C:\Users\bestj\dnd-app-testdata\pdf\`.
If it's missing when this task comes up, skip it and report it as waiting on the user.

**Files:**
- Create: `scripts/dump-pdf-fields.ts` (prints each field's name and type) and
  `src/lib/pdf/maps/official2014.ts` (registered in `FIELD_MAPS`)
- Test: `tests/pdf/official2014.test.ts`

**Mapping:**
- `detect` requires `CharacterName`, `ClassLevel` and `STR`.
- **Map** these to `name`, the race, the background, `details.alignment`, `details` text, and
  `currency`, using the **exact names printed by the dump**, including trailing spaces such as
  `'Race '` or `'DEXmod '`:
  - `CharacterName`, `ClassLevel`, `Race`, `Background`, `Alignment`
  - ability scores, `HPMax`, `HPCurrent`, `HPTemp`, `AC`, `Speed`
  - `PersonalityTraits`, `Ideals`, `Bonds`, `Flaws`
  - `Equipment`, `Features and Traits`, `ProficienciesLang`
  - CP, SP, EP, GP, PP
  - the skill and save proficiency checkboxes
- **`ClassLevel`** is parsed with `/([A-Za-z' ]+?)\s*(\d+)/g`. Each match goes through
  `index.find('class', name)`, which builds the `levels`.
- **Fallbacks:**
  - Race, background and class are resolved by name. Anything unresolved is left out and added
    to `details.notes` as "Not found: …".
  - Scores become `baseScores` with `abilityMethod: 'manual'`.
  - Checked skills become `customEffects` proficiency entries.
  - Any sheet number that disagrees with `computeSheet` becomes an override.
  - `Equipment` text goes to `details.notes`.
  - `imported` is set to `'unverified'`.

- [ ] **Step 1: Dump the fields.** Run
  `node scripts/dump-pdf-fields.ts "C:\Users\bestj\dnd-app-testdata\pdf\<blank>.pdf"` and keep
  the output in the scratchpad.
- [ ] **Step 2: Write the failing test.** It builds a **synthetic** PDF in the test with
  `pdf-lib`, using only the field names this map lists: `CharacterName: 'Tordek'`,
  `ClassLevel: 'Fighter 3'`, `Race: 'Dwarf'`, `STR: '16'`, `AC: '20'`, and the Athletics
  checkbox checked. Expected:
  - `data.name` is `'Tordek'`
  - `data.build.levels.length` is `3`
  - `data.build.baseScores.str` is `16`
  - `data.overrides.ac` is `20` (it disagrees with the computed value)
  - `data.imported` is `'unverified'`
  - `computeSheet(...).skills.athletics.proficient` is `true`
- [ ] **Step 3: Run the test.** Expected: FAIL. Then implement, and run it again. Expected:
  PASS.
- [ ] **Step 4: Check against the real file.** If a filled-in official sheet exists in the test
  data, import it in the browser and check the fields by eye.
- [ ] **Step 5: Commit** with `feat: official 2014 character sheet PDF import`.

---

### Task 22: Stage 1 release check

- [ ] **Step 1: Run the full suite.** Run `npx vitest run`, `npm run check`, `npm run build` and
  `npm run size`. Expected: all pass, and the size is under 150 KB gzipped.
- [ ] **Step 2: Run the importer check, if the test data exists.** Run `npm run import-check -- C:\Users\bestj\dnd-app-testdata\5etools`.
  Expected: no exceptions and no errors on the official files.
- [ ] **Step 3: Walk through the app in the browser** at 375×812 and at desktop size:
  1. Create a campaign.
  2. Import the fixture and real packs.
  3. Create the SRD Hill Dwarf Fighter and confirm AC 19 and HP 14.
  4. Level up to 3 and pick Champion.
  5. Add a longsword, chain mail, a shield and a Ring of Protection.
  6. Make a secret potion, put it in loot, and give it to the fighter.
  7. Check the Player view.
  8. Take a long rest.
  9. Export to PDF and re-import it.
  10. Export a backup, clear the site data, import the backup, and confirm everything is back.
  11. Check the About page attribution.
- [ ] **Step 4: Publish.** Push to `main`, then confirm the Actions run succeeds and that
  `https://vampiric-goose.github.io/dnd-app/` serves the new build, with the walkthrough
  passing on the live URL.
- [ ] **Step 5: Tag the release** with `git tag stage-1 && git push --tags`.
