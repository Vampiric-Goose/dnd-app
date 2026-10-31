# Stage 2 (Monsters) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution model for this stage (user request, 2026-10-31):** tasks are grouped. Each **Group** is ONE implementer
> dispatch that does all of its tasks in order (a commit per task), followed by ONE review of the whole group's diff.
> Fix rounds work as in the skill. While a group is in review, the next group's implementer may start; fixes for the
> reviewed group are applied after that implementer finishes, so only one writer touches the checkout at a time.

**Goal:** Ship stage 2 of dnd-app: SRD monsters, a searchable monster library with stat blocks, a monster
creator (from scratch or duplicated), 5etools bestiary import with `_copy` and template resolution, paste-text
import for monsters, spells and items, monster JSON and PDF, and the CR suggestion option.

**Architecture:**
- Monsters are a new content kind, `MonsterDef` (`kind: 'monster'`), in the same entity format, packs and
  `ContentIndex` as everything else. SRD monsters ship in `src/data/srd.json`, generated from 5e-database.
- The DM's own monsters live per campaign in a new IndexedDB store, `monsters`, mirroring homebrew items
  (`StoredMonster`, `HOMEBREW` source, duplicate = copy into the store).
- Monsters are DM information: the Monsters page and its nav link exist only in DM view, and the Compendium
  never lists monsters.
- Stat-block numbers that the rules derive (XP, proficiency bonus, ability modifiers, average HP from dice) are
  computed by pure helpers in `src/lib/rules/monsters.ts`, not stored.

**Tech Stack:** unchanged from stage 1 (TypeScript ~6, Svelte 5, Vite 8, Vitest, idb, pdf-lib lazy, fake-indexeddb).

**Spec:** `docs/superpowers/specs/2026-10-30-dnd-app-design.md` — sections 3.1, 3.4, 3.5, 3.9 (CR suggestion,
Monster HP), 5 and 9 (stage 2). Executors read both documents.

## Global Constraints

- Everything in the stage 1 plan's Global Constraints still holds (SRD-only content in the repo; no fetching from
  5etools or other content sites; fixtures written by us; `.ts`-suffixed imports; no Vite-only syntax in `src/lib`
  except `content/srd.ts`; 375 px layouts; labelled controls).
- **2024 rules never enter** (rulings R52–R54, R60): the source whitelist in `src/lib/content/sources.ts` applies to
  monsters, legendary groups, templates and `_copy` bases exactly as to other kinds. XMM, XPHB, XDMG and every
  other `RULES_2024` source are refused, including through a `_copy`.
- First load stays under 150 KB gzipped JS (`npm run size`). The importer, pdf-lib and the paste parsers load lazily.
- Agents never use shell heredocs (they hang in this environment); write files with the Write tool.
- Never copy anything from `C:\Users\bestj\dnd-app-testdata\` into the repo. `node scripts/import-check.ts` reads it in place.
- Push only reviewed work, by explicit hash (R32). The controller pushes, not implementers.
- Re-cloning the pinned SRD source is allowed: `https://github.com/5e-bits/5e-database` at commit `a6212be`,
  into the scratchpad, never into the repo.

## Review Focus

1. **A `_copy` whose base is in a file that wasn't loaded** (or a chain longer than the files given): the monster is
   skipped with a readable error naming the missing base, and the rest of the pack imports. Pinned in Task 4.
2. **2024 monsters arriving indirectly**: an XMM `_copy` base, a template from a 2024 source, or a legendary group from
   XMM never produces a stored monster or text. Pinned in Task 4.
3. **The whole 5etools bestiary (≈4,500 monsters)** in the library: search and filters stay responsive (the list is
   virtualized; filtering 5,000 rows takes under 50 ms in a unit benchmark). Pinned in Task 5.
4. **Player view** never shows a monster: no nav link, the route shows a DM-only message, the Compendium has no
   monster tab, and the Items page's player view is unchanged. Pinned in Task 5.
5. **Messy pasted text** (PDF line breaks mid-sentence, `−` and `–` minus signs, ligatures such as `ﬁ`, missing
   sections, a stat block pasted twice): the parser returns a draft plus notes on what it couldn't read and never
   throws. Pinned in Task 8.

---

## Group A — Monster core (Tasks 1–3)

### Task 1: The monster type and its rules helpers

**Files:**
- Modify: `src/lib/types.ts` (add `MonsterDef`, add it to `Entity`)
- Create: `src/lib/rules/monsters.ts`
- Test: `tests/rules/monsters.test.ts`

**Interfaces — Produces:**
```ts
// types.ts
export interface MonsterDef extends Base {
  kind: 'monster';
  size: Size[];                 // usually one; some 5etools monsters list several ("Medium or Small")
  type: string;                 // display form, e.g. 'humanoid (goblinoid)', 'swarm of Tiny beasts'
  alignment: string;            // display form, e.g. 'neutral evil', 'unaligned', 'any alignment'
  ac: { value: number; from?: string }[];          // first entry is the main AC
  hp: { average: number; formula?: string } | { special: string };
  speed: Speeds & { hover?: boolean; note?: string };
  scores: Scores;
  saves: Partial<Record<Ability, number>>;         // printed bonuses
  skills: Partial<Record<Skill, number>>;          // printed bonuses
  vulnerable: string[]; resist: string[]; immune: string[]; conditionImmune: string[]; // display strings
  senses: string[]; passive: number; languages: string[];
  cr: string;                                      // '0', '1/8', '1/4', '1/2', '1'…'30', or '—'
  traits: Trait[]; actions: Trait[]; bonusActions: Trait[]; reactions: Trait[];
  legendary: Trait[]; legendaryCount?: number; legendaryIntro?: RichText;
  mythic?: Trait[]; lair?: RichText; regional?: RichText;
  environment?: string[];
}
export interface StoredMonster extends MonsterDef { campaignId: string; updatedAt: number }
// Spellcasting and innate spellcasting are traits (or actions) whose text lists the spells; no separate structure.

// rules/monsters.ts
export const CR_LADDER: readonly string[];                   // ['0','1/8','1/4','1/2','1',…,'30']
export function crValue(cr: string): number | undefined;     // '1/4' → 0.25; '—' or junk → undefined
export function crXp(cr: string): number | undefined;
export function crProf(cr: string): number | undefined;
export function hpAverage(formula: string): number | undefined;   // '2d6+2' → 9; '10d10 - 10' → 45
export function hitDieFor(size: Size): number;               // T4 S6 M8 L10 H12 G20
export function hpFormula(count: number, size: Size, con: number): string; // (5, 'M', 14) → '5d8 + 10'
export function suggestCr(x: { hp: number; ac: number; dpr: number; attack?: number; dc?: number }):
  { cr: string; defensive: string; offensive: string };
```

- [ ] **Step 1: Write the failing tests** in `tests/rules/monsters.test.ts`:
  - `crXp`: `'0'`→10, `'1/8'`→25, `'1/4'`→50, `'1/2'`→100, `'1'`→200, `'5'`→1800, `'10'`→5900, `'20'`→25000, `'30'`→155000, `'—'`→undefined.
  - `crProf`: `'1/4'`→2, `'4'`→2, `'5'`→3, `'9'`→4, `'13'`→5, `'17'`→6, `'21'`→7, `'25'`→8, `'29'`→9.
  - `hpAverage`: `'2d6'`→7, `'2d6+2'`→9, `'10d10 - 10'`→45, `'1d4−1'` (U+2212 minus)→1, `'abc'`→undefined.
  - `hpFormula(5, 'M', 14)` → `'5d8 + 10'`; `hpFormula(3, 'S', 8)` → `'3d6 - 3'` (ASCII minus); `hpFormula(2, 'T', 10)` → `'2d4'`.
  - `suggestCr({ hp: 85, ac: 13, dpr: 14, attack: 3 })` → `{ cr: '1', defensive: '1', offensive: '1' }`.
  - `suggestCr({ hp: 85, ac: 17, dpr: 14, attack: 3 })` → defensive `'3'` (AC 4 above CR 1's 13 → +2 steps), cr `'2'`.
  - `suggestCr({ hp: 150, ac: 15, dpr: 40, dc: 15 })` → defensive `'6'`, offensive `'6'`, cr `'6'`.
  - `suggestCr({ hp: 3, ac: 10, dpr: 0, attack: 0 })` → cr `'0'` (never below the ladder).
- [ ] **Step 2: Run** `npx vitest run tests/rules/monsters.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement.** The DMG chapter 9 "Monster Statistics by Challenge Rating" table, as one array of
  `{ cr, prof, ac, hpMax, attack, dprMax, dc }` rows (CR 0 to 30; HP and DPR are upper bounds of each band:
  CR 0 hp 6 dpr 1, 1/8 35/3, 1/4 49/5, 1/2 70/8, 1 85/14, 2 100/20, 3 115/26, 4 130/32, 5 145/38, then +15 HP and
  +6 DPR per CR to CR 19 (355/122), CR 20 400/140, then +45 HP and +18 DPR per CR to CR 30 (850/320). AC: 13 to CR 3,
  14 at 4, 15 at 5–7, 16 at 8–9, 17 at 10–12, 18 at 13–16, 19 at 17+. Attack: +3 to CR 2, +4 at 3, +5 at 4, +6 at 5–7,
  +7 at 8–10, +8 at 11–15, +9 at 16, +10 at 17–20, +11 at 21–23, +12 at 24–26, +13 at 27–29, +14 at 30.
  DC: 13 to CR 3, 14 at 4, 15 at 5–7, 16 at 8–10, 17 at 11–12, 18 at 13–16, 19 at 17–20, 20 at 21–23, 21 at 24–26,
  22 at 27–29, 23 at 30. Prof follows the CR/4 pattern in the tests.)
  `suggestCr`: defensive = the row whose HP band holds `hp`, moved one ladder step per 2 points `ac` differs from
  that row's AC (rounding toward zero); offensive = the row whose DPR band holds `dpr`, moved one step per 2 points
  the attack bonus (or, if no attack, the DC) differs from that row's; result = the average of the two ladder
  positions, rounded half up; clamp to the ladder.
- [ ] **Step 4: Run** the test file — PASS. `npm run check` — 0 errors (adding to `Entity` may surface exhaustive
  switches; give each a `monster` branch that does the obvious nothing, e.g. Compendium `sub()` returns `''`).
- [ ] **Step 5: Commit** `feat: monster type and CR, XP and HP helpers`.

### Task 2: SRD monsters

**Files:**
- Create: `scripts/srd/monsters.ts`
- Modify: `scripts/build-srd.ts` (call it), `src/data/srd.json` (regenerated)
- Test: `tests/srd/monsters.test.ts`

**Interfaces — Consumes:** `MonsterDef` (Task 1). **Produces:** `monster:<slug>@SRD` entities in the SRD pack.

- [ ] **Step 1: Failing test** reading `src/data/srd.json`:
  - there are at least 300 `monster` entities, every id ends `@SRD`;
  - `monster:goblin@SRD`: size `['S']`, type `'humanoid (goblinoid)'`, alignment `'neutral evil'`, ac `[{ value: 15, from: 'leather armor, shield' }]`,
    hp `{ average: 7, formula: '2d6' }`, speed.walk 30, scores dex 14, skills `{ stealth: 6 }`, senses include `'darkvision 60 ft.'`, passive 9,
    languages `['Common', 'Goblin']`, cr `'1/4'`, a trait named `'Nimble Escape'`, actions named `'Scimitar'` and `'Shortbow'`;
  - `monster:adult-red-dragon@SRD`: legendary has 3 entries, legendaryCount 3, immune includes `'fire'`, cr `'17'`, saves `{ dex: 6, con: 13, wis: 7, cha: 11 }`;
  - every monster's `cr` is in `CR_LADDER`, and `hpAverage(formula) === average` wherever a formula is present.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `convertMonsters(raw: Raw[]): MonsterDef[]` from 5e-database `src/2014/en/5e-SRD-Monsters.json` at
  `a6212be` (re-clone into the scratchpad if gone). Map: size word → letter; `subtype` → `type (subtype)`;
  `armor_class[]` → `ac` (armor names joined into `from`; natural armor → `'natural armor'`); speeds `'30 ft.'` → 30, `hover` flag;
  `proficiencies` `saving-throw-*` / `skill-*` → saves / skills; damage and condition arrays → display strings;
  `senses` → `'darkvision 60 ft.'` strings plus `passive_perception`; `languages` split on commas (empty / `'—'` → `[]`);
  `challenge_rating` → CR string; `special_abilities` / `actions` / `reactions` / `legendary_actions` → `Trait[]` with `desc`
  as paragraphs (usage such as "Recharge 5–6" or "3/Day" appended to the name in parentheses, the way the SRD prints it);
  `legendaryCount: 3` when legendary actions exist. `text: []`.
- [ ] **Step 4: Rebuild** `node scripts/build-srd.ts <checkout>/src/2014/en`; the only diff in `srd.json` outside the new
  monsters must be none (assert in the test that non-monster entity counts equal stage 1's: class 12, spell 319, item 578,
  condition 15). Run the tests — PASS. `npm run size` — first load unchanged (srd.json is lazy).
- [ ] **Step 5: Commit** `feat: SRD monsters`.

### Task 3: Storing the DM's monsters, duplicate, JSON and backup

**Files:**
- Modify: `src/lib/db.ts` (DB version 2: store `monsters`, keyPath `id`, index `campaignId`; `db.monsters.list/get/put/delete`),
  `src/lib/backup.ts`, `src/lib/recordShape.ts` (the IndexedDB `Schema` type is in `db.ts`)
- Create: `src/lib/monsters/homebrew.ts`
- Test: `tests/monsters/storage.test.ts`

**Interfaces — Produces:**
```ts
// monsters/homebrew.ts
export const newMonsterId = (): string;                         // `monster:homebrew-${uid8}@HOMEBREW`
export function blankMonster(campaignId: string): StoredMonster; // CR '0', 10s in every score, size M, hp 1d8 → 4
export function duplicateMonster(m: MonsterDef, campaignId: string): StoredMonster; // deep copy, new id, source HOMEBREW, name unchanged, srd/aliases dropped
export function soundMonster(m: unknown): boolean;              // shape check at trust boundaries, like soundItem
// backup.ts
exportRecord(kind: 'character' | 'item' | 'monster', …)         // format 'dnd-app-monster'
importRecord(file) → … | { kind: 'monster'; data: StoredMonster; taken: boolean; playerView: false }
```
- The upgrade must keep every stage-1 store and its data (`upgrade(d, oldVersion)` creates only what's missing).
- Backups gain an optional `monsters: StoredMonster[]`; old backups without it still restore. `readBackup` counts monsters,
  skips unsound or 2024 ones (reported like `skippedItems`), and restore writes them in the same transaction.
  A campaign backup includes that campaign's monsters.
- `db.monsters.list/get` hide 2024 records (R60 pattern).

- [ ] **Step 1: Failing tests:** a v1 database with a character and an item opens as v2 with both intact and an empty
  `monsters` store; put/list/get/delete by campaign; `duplicateMonster(goblin)` has a new `@HOMEBREW` id, the same stats, no
  `srd`; `soundMonster` rejects `{}`, a missing `scores`, a non-array `actions`, and accepts `blankMonster('c')`;
  export → importRecord round-trips a monster (`taken` true when the id exists); a backup with two monsters restores both, and
  one whose id ends `@XMM` is skipped and reported; a backup with no `monsters` key restores.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the full suite — PASS; `npm run check` — 0 errors.
- [ ] **Step 5: Commit** `feat: store, duplicate and back up the DM's monsters`.

---

## Group B — 5etools bestiary import (Task 4)

### Task 4: Bestiary converter, legendary groups, templates and `_copy`

**Files:**
- Create: `src/lib/import/fivetools/monsters.ts`
- Modify: `src/lib/import/fivetools/index.ts` (register `monster`; read `legendaryGroup` and `monsterTemplate` keys),
  `src/lib/import/fivetools/copy.ts` (bestiary `_mod` modes, `_templates`), `src/lib/import/dataFolder.ts`, `scripts/import-check.ts`
- Test: `tests/import/monsters.test.ts`, `tests/import/dataFolder.test.ts` (extend), fixtures under `tests/fixtures/` written by us

**Interfaces — Consumes:** `MonsterDef` (Task 1), the existing `import5etools`, `resolveCopy`, `Ctx`, `srdTwin`.
**Produces:** `monster` entities in packs; `selectDataFiles` now selects `bestiary/bestiary-*.json`,
`bestiary/legendarygroups.json` and `bestiary/template.json` (still skipping `fluff-*`, `foundry*.json`, `index.json`).

Conversion rules (5etools → `MonsterDef`):
- `size` array kept; `type` string or `{type, tags[], swarmSize}` → display form (`'humanoid (goblinoid)'`,
  `'swarm of Tiny beasts'`); `alignment` letters (`L N C G E U A`, nested `{alignment, chance}`) → display form
  (`['C','E']` → `'chaotic evil'`, `['U']` → `'unaligned'`, `['A']` → `'any alignment'`); `alignmentPrefix` prepended.
- `ac`: numbers or `{ac, from[], condition}` → entries; `from` tags stripped to plain text (`{@item leather armor|phb}` → `leather armor`).
- `hp`: `{average, formula}` or `{special}`. `speed`: numbers or `{number, condition}`, `canHover` → `hover`.
- `save`/`skill`: `'+4'` strings → numbers (skill names to our `Skill` slugs; unknown keys such as `other` dropped with a warning).
- `vulnerable`/`resist`/`immune`: strings or `{resist: [...], note, cond: true}` groups → one display string each
  (`'bludgeoning, piercing, and slashing from nonmagical attacks'`). `conditionImmune` likewise.
- `senses` strings kept (tags stripped); `passive`; `languages`; `cr`: string or `{cr, lair, coven}` → main `cr`.
- `trait`/`action`/`bonus`/`reaction`/`legendary`/`mythic` → `Trait[]` through the existing entries → `RichText` converter
  (tags such as `{@atk mw}`, `{@hit 4}`, `{@h}`, `{@damage 1d6 + 2}`, `{@dc 13}`, `{@recharge 5}` render as the book prints them:
  "Melee Weapon Attack:", "+4 to hit", "Hit:", "1d6 + 2", "DC 13", "(Recharge 5–6)").
- `spellcasting[]` → a trait (or, with `displayAs: 'action'`, an action) named by its `name`, text = `headerEntries`, then one
  line per group: `'At will: '`, `'3/day each: '`, `'Cantrips (at will): '`, `'1st level (4 slots): '` … with spell names.
- `legendaryActions` → `legendaryCount` (default 3 when `legendary` exists); `legendaryHeader` → `legendaryIntro`.
- `legendaryGroup: {name, source}` → that group's `lairActions` → `lair`, `regionalEffects` → `regional` (from a
  `legendaryGroup` array in the same import; a group from a refused source contributes nothing).
- `_copy._templates: [{name, source}]` applies each `monsterTemplate`'s `apply._root` (shallow assign) then `apply._mod`.
- Bestiary `_mod` modes to add in `copy.ts`: `addSkills`, `addSpells`, `replaceSpells`, `removeSpells` (the only ones in the
  v2.39 data besides those already supported; others warn and are skipped). `scalarAddProp`, `scalarMultProp`, `scalarAddHit`,
  `scalarAddDc`, `maxSize`, `addSenses`, `addSaves`, `addAllSaves`, `addAllSkills` too, if each is a few lines.
- Overlap with the SRD (`srd: true` on an official monster) becomes a patch on the SRD monster, as other kinds already do.

- [ ] **Step 1: Failing tests** (fixtures are invented monsters in 5etools shape, not copied from books):
  - a full monster converts to the expected `MonsterDef` (each rule above has one assertion; `{@hit 4}` renders `+4 to hit`);
  - `_copy` with `replaceTxt`, `appendArr` and `addSkills` resolves; a chain of two copies resolves;
  - **Review Focus 1:** a `_copy` naming a base that isn't in the import → that monster is an error naming the base
    ("_copy source "Orc Brute" (MM) not found"), and the pack still has its other monsters;
  - **Review Focus 2:** a monster from `XMM`; a monster copying an `XMM` base; a `_templates` entry from a 2024 source; a
    `legendaryGroup` from `XMM` → no monster stored for the first two, the template/group ignored with a warning for the last two;
  - a `_templates` monster gets the template's `_root` field and `_mod` change;
  - `addSpells` adds to the right spellcasting group; `removeSpells` removes;
  - an official monster with `srd: true` named like an SRD monster patches it (alias added) instead of duplicating;
  - `selectDataFiles` on a path list with `bestiary/bestiary-mm.json`, `bestiary/fluff-bestiary-mm.json`, `bestiary/foundry.json`,
    `bestiary/index.json`, `bestiary/legendarygroups.json`, `bestiary/template.json` uses exactly the bestiary, legendary groups
    and template files; the "monsters (stage 2)" skip reason is gone.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the suite — PASS.
- [ ] **Step 5: Real data check:** `node scripts/import-check.ts "C:\Users\bestj\dnd-app-testdata\5etools\data"` →
  Errors 0 or each remaining error explained in the report; **0 accepted 2024 entities**; monsters accepted ≥ 3,500 and
  rejected 2024 monsters counted. Record the numbers in the report. `npm run size` unchanged (importer is lazy).
- [ ] **Step 6: Commit** `feat: import 5etools bestiaries with copies, templates and legendary groups`.

### Task 4b: Import a 5etools zip as downloaded (user request, 2026-10-31)

Players who aren't technical get stuck unzipping the download and finding `data/`. Phones can't pick folders at all.

**Files:**
- Modify: `package.json` (add `fflate`, MIT, lazy-loaded only), `src/lib/import/dataFolder.ts`, `src/ui/pages/Packs.svelte`
- Create: `src/lib/import/zip.ts`
- Test: `tests/import/zip.test.ts`

**Interfaces — Produces:**
```ts
// zip.ts (pure, no DOM; takes chunks so the browser can stream a File and tests can pass a Uint8Array)
export async function readDataZip(chunks: AsyncIterable<Uint8Array>, onProgress?: (done: number, total?: number) => void):
  Promise<{ files: { path: string; text: string }[]; summary: ReturnType<typeof selectDataFiles> }>;
```
- Selection is `selectDataFiles` over the zip's entry paths, so the zip, folder and CLI paths agree. This includes a `data/`
  root nested inside a top-level folder, such as `5etools-src-v2.x/data/...`.
- Only the selected entries are decompressed. Every other entry (images, adventure text, fluff) is skipped without inflating.
  Read the file as a stream (fflate's streaming `Unzip`, fed from `file.stream()`) so a several-hundred-MB zip doesn't have
  to fit in memory at once.
- Untrusted input:
  - entries with `..` or absolute paths are ignored
  - a selected entry larger than 20 MB uncompressed is skipped and reported
  - a zip with no recognisable data falls back to homebrew `.json` files under 5 MB, as the folder path does
- Packs page:
  - The primary button becomes **"Import 5etools (zip or folder)"**: one picker accepting `.zip`, plus the folder button
    where supported.
  - The same summary → Import / Cancel → progress flow as the folder scanner, ending in the existing import path unchanged.
  - The phone hint changes to "On a phone, import the 5etools zip file."
- `fflate` must not enter the first-load bundle. Check with `npm run size`.

- [ ] **Step 1: Failing tests.** Build zips in the test with fflate's `zipSync`, from invented content:
  - A zip shaped like `5etools-src-x/data/races.json`, `.../data/bestiary/bestiary-xyz.json`, `.../data/img/a.png`,
    `.../data/adventure/x.json` and `.../data/bestiary/fluff-bestiary-xyz.json` yields exactly the races and bestiary
    files. The summary counts the skipped ones.
  - A `../evil.json` entry is ignored.
  - A homebrew zip with two `.json` files at its root yields both.
  - Chunked input split at odd byte boundaries gives the same result as one chunk.
- [ ] **Step 2–4:** FAIL → implement → PASS. Run `npm run check` and `npm run size` (first load unchanged).
- [ ] **Step 5: Real data.** Zip `C:\Users\bestj\dnd-app-testdata\5etools\data` into the scratchpad (never the repo) and run
  `readDataZip` on it from a small Node script there. The file count must match `selectDataFiles` on the folder. Report the
  time taken.
- [ ] **Step 6: Commit** `feat: import a 5etools zip without unzipping it`.

---

## Group C — Library, stat block and creator (Tasks 5–6)

### Task 5: Stat block and the monster library

**Files:**
- Create: `src/ui/monsters/StatBlock.svelte`, `src/ui/pages/Monsters.svelte`, `src/lib/monsters/library.ts`
- Modify: `src/App.svelte` (routes `monsters`, `monsters/:id`; nav "Monsters" only when `app.viewer === 'dm'`),
  `src/ui/pages/Compendium.svelte` (no monster tab — confirm)
- Test: `tests/monsters/library.test.ts`

**Interfaces — Produces:**
```ts
// monsters/library.ts (pure)
export interface MonsterFilter { q: string; cr?: [min: number, max: number]; type?: string; size?: Size; source?: string }
export function monsterType(m: MonsterDef): string;      // first word of `type`, e.g. 'humanoid', for the type filter
export function filterMonsters(all: MonsterDef[], f: MonsterFilter): MonsterDef[]; // sorted by name; q matches folded name
```
- `StatBlock.svelte` props `{ monster: MonsterDef; index?: ContentIndex }`: the classic layout — name; size/type/alignment
  line; AC (with `from`), HP (average and formula), speed; the six scores with modifiers; saves, skills, vulnerabilities,
  resistances, immunities, condition immunities, senses (with passive), languages, "Challenge X (N XP)" and
  "Proficiency Bonus +P" from Task 1 helpers; then traits, Actions, Bonus Actions, Reactions, Legendary Actions (intro
  defaults to "The <name> can take N legendary actions, choosing from the options below. Only one legendary action option can
  be used at a time and only at the end of another creature's turn. The <name> regains spent legendary actions at the start
  of its turn."), Mythic Actions, Lair Actions, Regional Effects — each section only when non-empty. Rich text through the
  existing `RichText` component. Rolls: attack bonuses and damage dice are clickable and roll through the existing dice tray
  (reuse whatever `RichText`/roll helper the sheet uses).
- `Monsters.svelte`: list (VirtualList) of SRD + enabled packs + this campaign's own monsters, with search, CR range,
  type, size and source filters; selecting shows the stat block (same split layout as the Compendium); "New monster",
  "Duplicate" and "Edit" (own monsters only) buttons lead to `#/monsters/new`, `#/monsters/<id>/edit` (Task 6).
  In Player view the page shows only "Monsters are visible to the DM only." Without a campaign, the list shows SRD and all
  packs, and creating is disabled with "Open a campaign to make monsters."

- [ ] **Step 1: Failing tests:** `filterMonsters` by q (case and accent folded), CR range `[0.25, 1]` keeps CR 1/4 and 1 but
  not 2, type, size, source; **Review Focus 3:** filtering 5,000 generated monsters by q + CR takes under 50 ms (measure with
  `performance.now()`, generous bound); `monsterType({type: 'swarm of Tiny beasts'})` → `'swarm'`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm run check` 0 errors.
- [ ] **Step 5: Browser check** (`npx vite --port 5248 --strictPort` in the background; if the port is busy, use another):
  the Goblin and the Adult Red Dragon stat blocks read correctly at desktop and 375 px; **Review Focus 4:** switch to Player
  view — the nav has no Monsters link, `#/monsters` shows the DM-only message, the Compendium has no monster tab.
- [ ] **Step 6: Commit** `feat: monster library and stat blocks`.

### Task 6: The monster creator and CR suggestion

**Files:**
- Create: `src/ui/monsters/MonsterEditor.svelte`, `src/ui/monsters/TraitListEditor.svelte`
- Modify: `src/ui/pages/Monsters.svelte` (edit/new routes, JSON export/import buttons), `src/ui/pages/CampaignSettings.svelte`
  (move "CR suggestion" out of "Used in later stages" into the active settings with help text
  "The monster creator suggests a CR from HP, AC, damage and attack bonus (DMG chapter 9).")
- Test: `tests/monsters/editor.test.ts` (pure helpers only)

**Interfaces — Consumes:** Task 1 helpers, Task 3 `db.monsters`, `blankMonster`, `duplicateMonster`, `exportRecord`/`importRecord`.
**Produces (pure, in `src/lib/monsters/editing.ts`):**
```ts
export function estimateDpr(m: MonsterDef): number;        // best-effort: the highest-average action, ×N when a Multiattack trait says "makes N attacks"; '{@damage 1d6 + 2}' and '7 (1d6 + 4)' both count
export function estimateAttack(m: MonsterDef): { attack?: number; dc?: number }; // highest '+N to hit' / 'DC N' in actions
```
- The editor covers the full 2014 stat block (spec 3.4): size, type, alignment; AC and its source (several entries);
  HP from hit dice count + size die + Con (shows the formula and average; a "Special" HP text option); speeds incl. hover;
  scores; saves and skills (each with "proficient" shortcut that fills `mod + prof`, editable); vulnerabilities,
  resistances, immunities, condition immunities (comma lists); senses, passive (defaults to 10 + Wis mod + Perception
  proficiency, editable); languages; CR (select from `CR_LADDER`) with XP and proficiency shown; trait lists for traits,
  actions, bonus actions, reactions, legendary (with count), mythic; lair and regional text. Text fields accept the same
  plain-text editing the item editor uses (`richToEditable` / `editableToRich`).
- With the campaign's `crSuggestion` on, a panel shows "Suggested CR: X (defensive A, offensive B)" from `suggestCr`, with
  DPR and attack/DC inputs prefilled from `estimateDpr` / `estimateAttack` and editable, and an "Use X" button.
- Unsaved changes are guarded exactly as the item editor does (R41). Save writes `db.monsters.put`; Delete confirms.
- JSON: "Export JSON" on a monster's page (any monster); "Import" (JSON) on the library adds to this campaign
  (Replace / Keep both when the id exists, as for characters, R49).

- [ ] **Step 1: Failing tests:** `estimateDpr` on a fixture with "Multiattack. The beast makes two attacks" and a bite
  `{@damage 2d6 + 3}` → 20; on '7 (1d6 + 4) slashing' alone → 7; with no actions → 0. `estimateAttack` returns the highest
  `+N to hit` and `DC N`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm run check` 0 errors.
- [ ] **Step 5: Browser check:** new monster from scratch saves and shows in the library; Duplicate the SRD Goblin, change
  HP dice to 4 and Con to 14 → formula `4d6 + 8`, average 22; turn CR suggestion on in Settings → the panel appears with a
  sensible suggestion; leaving with unsaved edits asks first; export JSON then import it back offers Replace / Keep both.
- [ ] **Step 6: Commit** `feat: monster creator with CR suggestion`.

---

## Group D — Monster PDF and paste-text import (Tasks 7–8)

### Task 7: Monster PDF

**Files:**
- Modify: `src/lib/pdf/appLayout.ts` (`monsterFieldValues`, `drawMonster`, envelope format `'dnd-app-monster'`),
  `src/lib/pdf/exportPdf.ts` (`exportMonsterPdf`), `src/lib/pdf/importPdf.ts` (`{ kind: 'monster'; data: MonsterDef; edits: string[] }`),
  `src/ui/pages/Monsters.svelte` ("Export PDF"; Import accepts `.pdf`)
- Test: `tests/pdf/monster.test.ts`

- The PDF is one stat-block page (overflow pages as the character PDF does), fillable, with the full record in the hidden
  `app.data` field. Editable fields read back on import: name, AC (main value), HP average, CR, and the six scores; an edit
  changes that field and is listed in `edits`. Everything else comes from the embedded record.
- Uses `toWinAnsi` for text, like the other PDFs.

- [ ] **Step 1: Failing tests:** export the SRD Adult Red Dragon → import gives a deep-equal monster and `edits: []`; edit
  `app.name` and `app.hp` in pdf-lib → import reflects both and lists `['Name', 'HP']`; a monster with 40 long traits produces
  more than one page and still round-trips.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: monster PDF export and import`.

### Task 8: Paste-text import for monsters, spells and items

**Files:**
- Create: `src/lib/import/paste/monster.ts`, `src/lib/import/paste/spell.ts`, `src/lib/import/paste/item.ts`, `src/lib/import/paste/clean.ts`,
  `src/ui/PasteDialog.svelte`, `src/ui/spells/SpellEditor.svelte`
- Modify: `src/ui/pages/Monsters.svelte`, `src/ui/pages/Items.svelte` (or `ItemsHome.svelte`), `src/ui/pages/Packs.svelte` (spells)
- Test: `tests/import/paste.test.ts`

**Interfaces — Produces:**
```ts
export function cleanPasted(s: string): string;  // NFKC (ligatures), −/–/— → '-' where numeric, joins lines broken mid-sentence, trims
export function parseMonsterText(s: string): { draft: MonsterDef; notes: string[] };
export function parseSpellText(s: string): { draft: SpellDef; notes: string[] };
export function parseItemText(s: string): { draft: ItemDef; notes: string[] };
```
- Monster text is the usual book layout: name; "Small humanoid (goblinoid), neutral evil"; Armor Class; Hit Points;
  Speed; the STR…CHA row (values with or without modifiers, on one line or six); Saving Throws; Skills; Damage
  Vulnerabilities/Resistances/Immunities; Condition Immunities; Senses; Languages; Challenge; Proficiency Bonus (ignored,
  derived); then traits ("Name. text"), and "Actions", "Bonus Actions", "Reactions", "Legendary Actions", "Lair Actions",
  "Regional Effects" headings. Anything not recognised goes into the nearest trait's text, and a note says so.
- Spell text: name; "3rd-level evocation" / "Evocation cantrip" (and "(ritual)"); Casting Time; Range; Components (with
  material in parentheses); Duration (with "Concentration, up to"); description; "At Higher Levels." paragraph.
- Item text: name; "Wondrous item, rare (requires attunement by a wizard)" (or "Weapon (longsword), uncommon"); description.
- Drafts get homebrew ids (`newMonsterId`, `newHomebrewId`, `spell:homebrew-xxxx@MYSPELLS`) and open in the matching editor for
  review before anything is saved: monsters → MonsterEditor, items → ItemEditor, spells → `SpellEditor` (name, level, school,
  casting time, range, components, duration, concentration, ritual, classes, text, higher levels).
- Saved spells go into one local homebrew pack: id `pack:MYSPELLS`, name "My spells", source `MYSPELLS`, `homebrew: true`,
  merged with `mergePack` so each save adds or replaces one spell; campaigns enable it like any pack. Packs page gets
  "Paste a spell" next to the import buttons.
- The parsers are pure and load lazily (dynamic import from the dialog).

- [ ] **Step 1: Failing tests** with stat-block text we write ourselves (an invented "Bog Lurker", never book text):
  every listed field parses; **Review Focus 5:** the same block with lines broken mid-sentence, `−1` modifiers, a `ﬁ`
  ligature, no Senses line, and pasted twice in a row → a draft with the first copy's values, notes mentioning what was
  missing, no throw; `parseMonsterText('')` → a blank draft and a note. Spell: an invented "Ember Lattice" (2nd-level
  evocation, ritual, concentration up to 1 minute, V S M (a pinch of ash)) parses every field and the higher-levels
  paragraph. Item: "Wondrous item, very rare (requires attunement by a sorcerer or wizard)" → type wondrous, rarity very
  rare, attunement `'by a sorcerer or wizard'`.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm run check` 0 errors; `npm run size` under budget.
- [ ] **Step 5: Browser check:** paste the test monster on the Monsters page → editor opens prefilled → save; paste the
  test item on the Items page → ItemEditor prefilled; paste the test spell on the Packs page → SpellEditor → save → "My spells"
  appears as a pack, and after enabling it the spell shows in the Compendium.
- [ ] **Step 6: Commit** `feat: paste-text import for monsters, spells and items`.

---

## Task 9: Release (controller)

- [ ] Whole-branch review of stage 2 (most capable model), one fix pass, scoped re-review.
- [ ] `npx vitest run`, `npm run check`, `npm run build`, `npm run size` (first load ≤ 150 KB),
  `node scripts/import-check.ts "C:\Users\bestj\dnd-app-testdata\5etools\data"` (0 accepted 2024 entities).
- [ ] Push by hash; watch the deploy; live walkthrough (library, Goblin and dragon stat blocks, duplicate + edit, CR
  suggestion, JSON and PDF export, paste a monster, Player view hides monsters, 375 px).
- [ ] `git tag stage-2 && git push origin stage-2`.
