# Stage 4 (Initiative tracker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **Execution model (as in stages 2 and 3):** tasks are grouped. Each **Group** is ONE implementer dispatch (a commit per
> task) followed by ONE review of the group's diff. The next group may build while the previous one is reviewed; fixes
> wait until the active implementer finishes (one writer at a time). The last group's review may be folded into the final
> whole-branch review.

**Goal:** The DM runs combat from an initiative tracker: party characters and monsters (one at a time or from a prepared
encounter) in a sorted, reorderable order, with turns and rounds and the seven modules of spec 3.7. The tracker survives a
reload. Players see a read-only tracker with no hidden data and can send their own initiative roll.

**Architecture:**
- **Engine (pure):** `src/lib/combat/combat.ts` holds the combat record's operations: ordering (initiative, then Dex, then a
  stored random tiebreak), placing and moving combatants, turns and rounds with start- and end-of-turn effects, monster
  HP, condition durations, and encounter expansion. It takes an injected `rng`, so tests are exact.
- **Storage:** a live `Combat` per campaign (meta key `combat:<campaignId>`, read-modify-write in one transaction), and
  prepared `Encounter`s in a new `encounters` store (IndexedDB version 3). A thin `src/lib/combat/store.ts` runs the
  operations that touch player characters. They write through `db.characters.put`, so stage 3 stamping and sync deliver
  them. Monster HP lives only in the combat record.
- **Players:** the host builds a `TrackerView` with the pure `trackerForPlayers` (in `sync/project.ts`, next to the other
  projections) and sends it in a new `tracker` message whenever the combat, a combatant character, or the settings change.
  A guest may send `initiative` for its own character. The host validates it, and the DM's store applies it.
- **UI:** the `#/combat` route is its own lazy chunk. It shows the DM tracker (DM view), or the read-only player tracker
  (Player view, or a joined campaign).

**Tech Stack:** the stage 1–3 stack. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-30-dnd-app-design.md`:
- 3.7 (all of it; the authority)
- 3.6 ("What players receive": the initiative order of visible combatants only, plus the round and whose turn it is;
  validation of every incoming message)
- 3.8 (turn-gated movement is stage 5)
- 3.9 (`Monster HP`, `Initiative modules`, `Show monster health status to players`)
- 5 (anti-goals: slow first load, data loss, leaks)
- 6 (150 KB, lazy loading, keyboard use for the initiative tracker)
- 8 ("Ties in initiative are broken by Dex, then at random"; "Prepared encounters")
- 9, stage 4

Rulings carried from earlier stages:
- R2: monsters are DM information.
- R6: stat-block rolls are private.
- R12: Player view shows only what a player would see.
- R13: a DM-only character (no `ownerId`) is not sent as party data.
- R52–R54/R60: 2024 content never enters.

**Deferred to stage 5 (explicit):** "add combatants from tokens", "starting an encounter places tokens on the current
scene", and gating token movement on the turn. Stage 4 emits the turn: the combat's `turn` on the DM side, and
`TrackerView.current` plus `currentActor()` on players' devices. Stage 5 gates on these.

## Global Constraints

- Everything in the stage 1–3 Global Constraints still holds:
  - SRD-only repo; no fetching content sites
  - `.ts` imports; no Vite-only syntax in `src/lib` except `content/srd.ts`
  - 375 px; labelled controls
  - no heredocs for agents; never copy test data into the repo
  - the controller pushes by hash
- **2014 rules only.** No 2024 content enters the tracker: monsters come from the campaign's content index and its own
  monsters, both of which already drop 2024 (R60).
- **Lazy loading.** The tracker page, `combat.ts` and `combat/store.ts` must not enter the first-load bundle. `db.ts` and
  `session.svelte.ts` (both first-load) import only types from them, and the session reaches `store.ts` by dynamic
  `import()`. `npm run size` ≤ 150 KB (it is 53.1 KB now).
- **Players never receive DM-only data** (spec 3.6). That means:
  - monster stats, AC, exact monster HP, monster ids, the DM's notes, condition durations and module state
  - hidden combatants
  - monsters during setup (round 0)
  - the HP of a DM-only character (R13)
  - a PC's DM-view max HP (hidden item bonuses: the player-view sheet is used, as in `rosterEntry`)

  This is enforced in `trackerForPlayers`, with tests that serialize the result and search it.
- **Every incoming `initiative` message is validated:**
  - shape: `characterId` a string ≤ 100; `total` an integer from **-10 to 50** (`INIT_MIN`, `INIT_MAX`)
  - ownership: the character's `ownerId` is the link's player ID, and it is in the campaign
  - fit: it is applied only when that character is a combatant whose initiative is still unset
- **PC changes made in the tracker go through `db.characters.put`.** That covers HP, temp HP, death saves and conditions.
  Each call reads the character fresh from the db, never from a copy the page holds.
- **Copy (exact):**
  - nav label `Combat`
  - health words `Unhurt`, `Hurt`, `Bloodied`, `Down`
  - lair entry name `Lair actions`
  - modules dropdown summary `Modules`
  - module labels `HP`, `Conditions`, `Concentration`, `Death saves`, `Legendary actions`, `Lair actions`, `Reactions`
- **Limits:**
  - at most **200** combatants (`MAX_COMBATANTS`)
  - an encounter line's count is an integer **1–99**
  - an encounter holds at most **50** lines

## Review Focus

1. **A hidden fact reaching a player through the tracker.** For example a hidden monster, a monster's exact HP or AC, the
   DM's notes, monsters before the fight starts, a DM-only character's HP, a PC's max HP with a hidden item bonus, or the
   turn passing to a hidden combatant. None of these may appear in any serialized `tracker` message (Task 3).
2. **The order shifting by itself.** Equal initiative and Dex must keep the same order after a reload, a re-sort, a
   combatant added mid-fight, and removing the current combatant. Removing the combatant a condition's duration counts on
   must not crash or tick forever (Task 1).
3. **The DM damages a PC while the player edits the same character on their phone.** The tracker writes through
   `db.characters.put` (stamped), from a fresh read. Two quick hits from the same page both land, and the player's
   concurrent notes edit survives (Task 2).
4. **A crafted `initiative` message.** Examples: someone else's character, `17.5`, `51`, `"17"`, a character not in the
   fight, or a second roll after the first was taken. Each is refused or ignored, and the combat is unchanged (Tasks 2 and 3).
5. **A prepared encounter whose monster has since been deleted, or whose pack was disabled.** Starting it adds the rest,
   names the missing ones, and never throws (Task 1).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/types.ts` (modify) | `Combatant`, `Combat`, `Duration`, `Encounter` types. |
| `src/lib/combat/combat.ts` (create) | Pure engine: order, placing, turns, durations, monster HP, encounter expansion, names. |
| `src/lib/combat/store.ts` (create) | db-backed operations that touch PCs: turns with PC expirations, HP, conditions, death saves, a player's initiative. |
| `src/lib/db.ts` (modify) | Version 3 (`encounters` store); `db.encounters`; `db.combat` (meta `combat:<cid>`); campaign delete cleanup; `onLocalChange` kind `'combat'`. |
| `src/lib/recordShape.ts` (modify) | `encounterProblem` for backups. |
| `src/lib/backup.ts` (modify) | Encounters travel in backups (the live combat does not). |
| `src/lib/sync/project.ts` (modify) | `healthStatus`, `TrackerView`, `trackerForPlayers`, `currentActor`. |
| `src/lib/sync/protocol.ts`, `host.ts`, `guest.ts`, `session.svelte.ts` (modify) | `tracker` (host→guest) and `initiative` (guest→host) messages, wiring. |
| `src/ui/HpControls.svelte` (create) | Amount, Damage, Heal, Set temp HP and the crit box, extracted from the sheet's Combat block for reuse. |
| `src/ui/sheet/Combat.svelte` (modify) | Uses `HpControls`. |
| `src/ui/pages/Initiative.svelte` (create) | The `#/combat` page: DM tracker plus Encounters, or the player tracker. |
| `src/ui/initiative/Tracker.svelte`, `CombatantRow.svelte`, `Encounters.svelte`, `PlayerTracker.svelte` (create) | DM list and controls; one row with its module controls; prepared encounters; read-only player view. |
| `src/App.svelte` (modify) | Route `combat`, nav `Combat`. |
| Tests | `tests/combat/combat.test.ts`, `tests/combat/storage.test.ts`, `tests/sync/tracker.test.ts`, additions to `tests/sync/session.test.ts` and `tests/sync/fakes.ts`. |

---

## Group A — Engine and storage (Tasks 1–2)

### Task 1: The combat engine

**Files:** modify `src/lib/types.ts`; create `src/lib/combat/combat.ts`; test `tests/combat/combat.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts
export interface Duration { rounds: number /* ≥ 1 */; at: 'start' | 'end'; of: string /* combatant id */ }
export interface Combatant {
  id: string; kind: 'pc' | 'monster' | 'lair'; name: string;
  characterId?: string;                  // pc
  monsterId?: string; ac?: number;       // monster (ac shown to the DM only)
  group?: string;                        // grouped identical monsters share it (= monsterId) and act as one turn
  init?: number;                         // undefined = not rolled (sorts last)
  initMod: number; dex: number;          // dex: the Dex SCORE, tiebreak 1
  tie: number;                           // tiebreak 2: rng() in [0,1), stored when added, so the order is stable
  conSave: number;                       // for the concentration prompt
  hidden?: boolean;
  hp?: number; maxHp?: number; tempHp?: number;  // monsters only (a PC's live on the character)
  conditions?: string[];                 // monsters only (a PC's are character.state.conditions)
  durations?: Record<string, Duration>;  // condition name → when it ends (PCs too)
  concentrating?: boolean; legendary?: { max: number; used: number }; reactionUsed?: boolean; notes?: string;
}
export interface Combat { campaignId: string; combatants: Combatant[] /* the order */; round: number /* 0 = setup */; turn?: string /* combatant id */; groupMonsters: boolean; updatedAt: number }
export interface Encounter { id: string; campaignId: string; name: string; monsters: { monsterId: string; count: number }[]; updatedAt: number }

// combat/combat.ts (pure)
export const MAX_COMBATANTS = 200;
export type HpOp = { damage: number; crit?: boolean } | { heal: number } | { temp: number };
export interface Expired { combatantId: string; condition: string }
export interface Step { combat: Combat; expired: Expired[] }
export function newCombat(campaignId: string): Combat;                     // round 0, no turn, groupMonsters false
export function outranks(a: Combatant, b: Combatant): boolean;              // a acts before b
export function sortCombatants(cs: Combatant[]): Combatant[];
export function place(cs: Combatant[], c: Combatant): Combatant[];          // (re)inserts c before the first one it outranks
export function moveTo(cs: Combatant[], id: string, index: number): Combatant[]; // drag; up/down = index ± 1; clamps
export function rollInit(mod: number, rng?: () => number): number;          // rollDice('1d20±mod')
export function pcCombatant(c: Character, sheet: Sheet, rng?: () => number): Combatant;           // init unset
export function monsterCombatant(m: MonsterDef, name: string, hpMode: 'average' | 'roll', rng?: () => number): Combatant;
export function lairCombatant(): Combatant;                                 // 'Lair actions', init 20
export function numberedNames(base: string, count: number, existing: string[]): string[];
export function addCombatants(c: Combat, list: Combatant[]): Combat;        // place each; a PC already in is skipped; stops at MAX_COMBATANTS
export function addMonsters(c: Combat, picks: { monster: MonsterDef; count: number }[], hpMode: 'average' | 'roll', rng?: () => number): Combat;
export function encounterPicks(e: Encounter, lookup: (id: string) => MonsterDef | undefined): { picks: { monster: MonsterDef; count: number }[]; missing: string[] };
export function setInit(c: Combat, id: string, init: number | undefined): Combat;   // and re-places it
export function patchCombatant(c: Combat, id: string, patch: Partial<Combatant>): Combat;
export function removeCombatant(c: Combat, id: string): Combat;
export function start(c: Combat): Step;    // sorts, round 1, turn = first, start-of-turn effects for it
export function next(c: Combat): Step;
export function prev(c: Combat): Combat;   // pointer only
export function monsterHp(x: Combatant, op: HpOp): Combatant;
export const concentrationDc = (damage: number): number => Math.max(10, Math.floor(damage / 2));
```
- **Order (`outranks`):**
  - higher `init` first, and an unset `init` last
  - at equal `init`, a `lair` loses to anything else
  - then higher `dex`
  - then higher `tie`
- **Placing:**
  - The array is the order. `place` inserts by key, so a manual reorder is kept until the DM presses Sort (`sortCombatants`).
  - A combatant added mid-fight waits for its place: it never takes the turn.
- **Builders:**
  - `pcCombatant`:
    - name `c.name`, `dex` = `sheet.scores.dex`, `initMod` = `sheet.initiative`
    - `conSave` = `sheet.saves.con.bonus`, `ac` = `sheet.ac`
    - `init` unset (the player rolls, or the DM types or rolls)
  - `monsterCombatant`:
    - `init` = `rollInit(abilityMod(dex))`, `dex` = `scores.dex`, `ac` = `ac[0].value`
    - `conSave` = `saves.con ?? abilityMod(con)`
    - `legendary` = `{ max: legendaryCount ?? 3, used: 0 }` when `legendary.length`
    - HP: `average` mode → `hp.average`. `roll` mode → `max(1, rollDice(formula))`, falling back to the average when there
      is no formula. `{special}` → `hp`/`maxHp` unset; the DM types them.
- **`numberedNames`:**
  - A monster is numbered when the batch has more than one, or when the combat already holds that name.
  - Numbers continue from the highest existing `Base` / `Base N`. Renamed copies are ignored.
- **`addMonsters` with `groupMonsters` on:**
  - Copies of one monster share one roll, one `tie` and `group = monsterId`.
  - A later copy joins an existing group's `init` and `tie`.
- **Turns:** a "turn" is the current combatant, or the run of adjacent combatants with the same `group`.
  - `next` ends the current turn: durations with `at: 'end'` whose `of` is in the current run tick down.
  - It then moves on, wrapping to `round + 1`.
  - Then it starts the new turn. For each member of the new run: `reactionUsed = false`, `legendary.used = 0`, and
    durations with `at: 'start'` whose `of` is in the run tick down.
- **Durations:**
  - A duration of N ends at the N-th matching trigger after it is applied. The end of the turn in progress counts.
  - When it ends, the duration goes, and for a monster the condition goes too. `Expired` lists every one, for PCs as well;
    Task 2 writes the PC side.
- **`removeCombatant`:**
  - Removing the current combatant passes the turn as `next` would, but without end-of-turn effects for the removed one.
  - Durations whose `of` was the removed combatant become untimed: the duration is dropped and the condition stays.
- **`prev`** moves the pointer back only (round − 1 when it wraps, never below 1). It undoes no resets or expirations.
- **`monsterHp`:**
  - Damage takes temp HP first, and HP floors at 0.
  - Healing caps at `maxHp`.
  - `temp` sets `tempHp` (it doesn't stack).

- [ ] **Step 1: Failing tests.** Use the SRD goblin and adult red dragon (read `src/data/srd.json` as
  `tests/monsters/storage.test.ts` does) and `const half = () => 0.5` (d20 → 11, 2d6 → 8).
  - `order: init, then lair loses ties, then Dex, then the stored tiebreak; unrolled last`:
    - A {init 15, dex 12}, B {15, 14}, C monster {20}, `lairCombatant()`, D {init unset} → names in order C, Lair actions, B, A, D
    - E {12, dex 12, tie 0.3} and F {12, 12, 0.7} → F before E
    - `sortCombatants` of the reversed array gives the same order (**Review Focus 2**)
  - `monster builders`:
    - goblin, average → `{ hp: 7, maxHp: 7, init: 13, dex: 14, ac: 15, conSave: 0 }`
    - goblin, roll, `half` → `hp 8`
    - dragon → `legendary { max: 3, used: 0 }`, `conSave 13`, average `hp 256`
    - a `{special}` monster → `hp` undefined
  - `numberedNames`:
    - `('Goblin', 2, [])` → `['Goblin 1', 'Goblin 2']`
    - `('Goblin', 1, [])` → `['Goblin']`
    - `('Goblin', 2, ['Goblin 1', 'Goblin 2'])` → `['Goblin 3', 'Goblin 4']`
    - `('Goblin', 1, ['Goblin'])` → `['Goblin 2']`
    - `('Goblin', 1, ['Snaggle'])` → `['Goblin']`
  - `grouping`:
    - on: 3 goblins share `init`, `tie`, and `group 'monster:goblin@SRD'`; a 4th added later gets the same `init`
    - off, with a sequence rng: `group` undefined and 3 distinct `tie`s
  - `turns and rounds`:
    - [A, B, C]: `start` → turn A, round 1; `next` ×3 → turn A, round 2
    - `prev` there → turn C, round 1; `prev` at round 1 on the first → unchanged
  - `a grouped run is one turn`: [goblins ×3 grouped, PC]
    - `next` from the run → turn PC
    - from PC → turn goblin 1, round 2, and all three have `reactionUsed false`
  - `start-of-turn resets`: the dragon with `legendary.used 2` and `reactionUsed true` → after `next` reaches it: `used 0`,
    `reactionUsed false`
  - `durations`:
    - During A's turn, goblin B gets Poisoned `{rounds 1, at 'end', of A}` → `next` → `expired [{B, 'Poisoned'}]`, and B's
      conditions lack it
    - `{rounds 2, at 'start', of B}` → still present after B's first turn starts, gone when B's next turn starts
    - a PC's duration expiring → listed in `expired`, and the combatant has no `durations.Poisoned`
  - `mid-fight changes` (**Review Focus 2**):
    - turn B (init 15) in [A 18, B 15, C 10]; adding X at 20 → order X, A, B, C, turn still B
    - removing B → turn C; removing C when it is current and last → turn X, round + 1
    - removing A while B holds a duration `of A` → B keeps the condition with no duration, and `next` ×4 never expires it
  - `moveTo`:
    - moving C to index 0 keeps the turn on its combatant
    - an index past either end clamps
  - `monsterHp`:
    - `{hp 7, tempHp 3}` damage 5 → `{hp 5, tempHp 0}`
    - damage 20 → `hp 0`
    - heal 50 from 0 → `7`
    - temp 4 then temp 2 → `tempHp 2`
  - `concentrationDc`: 1 → 10, 21 → 10, 22 → 11, 25 → 12, 100 → 50
  - `encounterPicks` (**Review Focus 5**): an encounter of goblin ×2 and `monster:gone@X` ×1 → one pick (count 2), and
    `missing ['monster:gone@X']`
  - `MAX_COMBATANTS`: adding 250 goblins leaves 200
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: initiative tracker engine (order, turns, modules, encounters)`.

### Task 2: Storage and the PC-side operations

**Files:**
- Modify: `src/lib/db.ts`, `src/lib/recordShape.ts`, `src/lib/backup.ts`
- Create: `src/lib/combat/store.ts`
- Test: `tests/combat/storage.test.ts`

**Interfaces — Consumes:** Task 1's types and functions. **Produces:**
```ts
// db.ts
// open(): version 3; `if (oldVersion < 3) d.createObjectStore('encounters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId')`
export const combatKey = (campaignId: string) => `combat:${campaignId}`;
db.encounters: { list(cid: string): Promise<Encounter[]>; get(id: string): Promise<Encounter | undefined>; put(e: Encounter): Promise<void>; delete(id: string): Promise<void> }
db.combat: {
  get(cid: string): Promise<Combat | undefined>;
  /** One transaction on meta. `fn` returns the new combat, or undefined to end it. Reports ('combat', cid) to onLocalChange. */
  update(cid: string, fn: (c: Combat | undefined) => Combat | undefined): Promise<Combat | undefined>;
}
onLocalChange(fn: (kind: 'character' | 'campaign' | 'combat', id: string) => void)
// Snapshot gains `encounters?: Encounter[]` (absent in old backups); recordShape: export function encounterProblem(r: unknown): string | undefined
// combat/store.ts (db + rules; lazy)
export function updateCombat(cid: string, fn: (c: Combat) => Combat): Promise<Combat>;         // default newCombat(cid); stamps updatedAt
export function turn(cid: string, dir: 'start' | 'next'): Promise<Step>;                       // PC expirations removed from their characters
export function changeHp(cid: string, combatantId: string, op: HpOp, settings: CampaignSettings): Promise<{ combat: Combat; concentrationDc?: number }>;
export function setCondition(cid: string, combatantId: string, name: string, on: boolean, duration?: Duration): Promise<Combat>;
export function deathSave(cid: string, combatantId: string, d20: number): Promise<void>;
export function applyInitiative(cid: string, characterId: string, total: number): Promise<boolean>; // false = ignored
```
- **Combat storage:**
  - `db.combat` lives in the `meta` store, as the trash does. It is not in backups: a fight in progress is not worth the
    format change. Prepared encounters are in backups.
  - `db.campaigns.delete` also removes the campaign's encounters (by index) and `combatKey(id)`.
- **Encounters in backups:**
  - A campaign export carries that campaign's encounters, and a full export all of them.
  - `readBackup` validates them with `encounterProblem`: `campaignId`, `id` and `name` are strings, and `monsters` is an
    array of at most 50 `{monsterId: string, count: integer 1–99}`.
  - `countReplaced` and `BackupCounts` include encounters.
- **PC writes (`store.ts`):** every PC write loads the character with `db.characters.get` and saves with
  `db.characters.put`.
  - `changeHp` on a PC: `applyDamage` / `applyHealing` from `character/rest.ts`, with `computeSheet(c, { settings, viewer: 'dm' })`,
    or a `tempHp` patch.
  - `changeHp` on a monster: `monsterHp`.
  - Either way, a damage op on a combatant with `concentrating` and `damage > 0` returns `concentrationDc(damage)`. That is
    the full amount entered, including any taken by temp HP.
  - `setCondition` on a PC toggles `character.state.conditions` and stores the duration on the combatant. On a monster it
    edits the combatant. Turning a condition off drops its duration.
  - `turn` removes each expired PC condition from that character (one `put` per character).
  - `deathSave` = `rollDeathSave` + `put`.
- **`applyInitiative`:** applies the total only when the combat has a `pc` combatant with that `characterId` and an unset
  `init`. It then `setInit`s and saves. Otherwise it returns false and leaves the combat untouched.

- [ ] **Step 1: Failing tests** (fake-indexeddb, `beforeEach(resetDb)`, `camp`/`char` fixtures):
  - `a version 2 database upgrades to version 3 keeping its data, with an empty encounters store`: build v2 with `openDB` as
    the v1→v2 test does, plus a monster; after `db.campaigns.list()` the campaign and `db.monsters.list('c1')` are intact, and
    `db.encounters.list('c1')` is `[]`.
  - `encounters are per campaign`: two in c1 and one in c2 → `list('c1')` has 2.
  - `the combat survives a reload and reports the change`:
    - `db.combat.update('c1', () => combat)` → `db.combat.get('c1')` deep-equals it
    - onLocalChange got `('combat', 'c1')`
    - `update(…, () => undefined)` → `get` is undefined
  - `deleting a campaign removes its encounters and its combat`.
  - `backups carry encounters`:
    - a campaign export → restore into an empty db → the encounter is back
    - an old backup without `encounters` restores
    - an encounter with `count: 0` → the import fails as damaged
  - `PC damage from the tracker goes through characters.put` (**Review Focus 3**). In a synced DM campaign, a PC at 20 HP:
    - `changeHp(…, { damage: 5 })` → stored `state.hp` 15, with a clock on `state.hp`
    - onLocalChange got `('character', id)`
    - a second `changeHp(…, { damage: 5 })` → 10
    - a `notes` edit saved between the two survives
  - `concentration`: a concentrating goblin, damage 25 → `concentrationDc 12`; not concentrating → undefined.
  - `death saves and expiry write the character`:
    - `deathSave(…, 15)` on a PC at 0 HP → `deathSaves.success` 1
    - a PC Poisoned with `{rounds 1, at 'end', of: <its own id>}` on its turn → `turn('c1', 'next')` → the stored character's
      conditions lack Poisoned
  - `applyInitiative` (**Review Focus 4**):
    - a PC with unset init → true, `init 17`, placed by key
    - a second call → false, init stays 17
    - an unknown character → false, and the combat deep-equals before
- [ ] **Steps 2–4:** FAIL → implement → PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat: store encounters and the live combat per campaign`.

---

## Group B — Players (Task 3)

### Task 3: The tracker projection, its messages and the session

**Files:**
- Modify: `src/lib/sync/project.ts`, `protocol.ts`, `host.ts`, `guest.ts`, `session.svelte.ts`; `tests/sync/fakes.ts`
  (a `combat` field and `loadCombat` on `Device`)
- Test: `tests/sync/tracker.test.ts`, plus one test in `tests/sync/session.test.ts`

**Interfaces — Consumes:** `Combat`, `db.combat`, `applyInitiative` (Task 2). **Produces:**
```ts
// project.ts
export type HealthStatus = 'Unhurt' | 'Hurt' | 'Bloodied' | 'Down';
export function healthStatus(hp: number | undefined, maxHp: number | undefined): HealthStatus | undefined;
export interface TrackerRow { id: string; name: string; characterId?: string; init?: number; hp?: number; maxHp?: number; health?: HealthStatus }
export interface TrackerView { round: number; current?: string; rows: TrackerRow[] }
export function trackerForPlayers(c: Combat | undefined, characters: Character[], settings: CampaignSettings): TrackerView | undefined;
/** Stage 5's movement gate: the characterId whose turn it is, if any. */
export function currentActor(v: TrackerView | undefined): string | undefined;
// protocol.ts
GuestMsg |= { t: 'initiative'; characterId: string; total: number };
HostMsg  |= { t: 'tracker'; tracker: TrackerView | null };
export const INIT_MIN = -10, INIT_MAX = 50;
// host.ts
HostDeps.loadCombat?(): Promise<Combat | undefined>;
HostDeps.onInitiative?(characterId: string, total: number, from: string): void;
Host.trackerChanged(): void;
// guest.ts
GuestDeps.onTracker?(t: TrackerView | undefined): void;
Guest.sendInitiative(characterId: string, total: number): void;
export function cleanTracker(v: unknown): TrackerView | undefined;
// session.svelte.ts
session.tracker: TrackerView | undefined;          // player: as the DM last sent it; cleared by stopSession
export function sendInitiative(characterId: string, total: number): void;
```
- **`healthStatus`:**
  - unset or non-positive `maxHp` → undefined
  - `hp ≤ 0` → Down
  - `hp ≥ maxHp` → Unhurt
  - `hp × 2 ≤ maxHp` → Bloodied
  - otherwise Hurt

  Spec 3.6 names unhurt, bloodied and down; `Hurt` fills the gap between full and half. Stage 5's tokens reuse this.
- **`trackerForPlayers`** is an allowlist:
  - It returns undefined with no combat.
  - It skips `hidden` rows and a PC row whose character is missing.
  - In round 0 (setup) it sends only rows for characters with an `ownerId`, so players can roll before the monsters are
    revealed.
  - Player-character rows (`characterId` set and the character has an `ownerId`): `{id, name: character.name, characterId,
    init?, hp: state.hp, maxHp}`. `maxHp` is `computeSheet(c, { settings, viewer: 'player' }).maxHp`.
  - Every other row (monsters, the lair, a DM-only character, R13): `{id, name}`, plus `health` only when
    `settings.showMonsterHealth` and `settings.initiativeModules.hp` are both on. No `init`.
  - `current` is set only when the turn's combatant is in `rows`.
- **Host:**
  - `trackerChanged` (queued like the other tasks) loads the combat and the campaign and broadcasts `{t: 'tracker',
    tracker: view ?? null}`.
  - The current tracker is sent after each welcome, when a combat exists.
  - `characterChanged(id)` re-sends it when the combat holds that character; `campaignChanged` re-sends it too.
  - On `initiative`: `loadCharacter`. If it is not the link's player's or not in the campaign → `#violation('not their
    character')`. Otherwise `deps.onInitiative(characterId, total, playerId)`.
- **Guest:**
  - `tracker` → `onTracker(m.tracker === null ? undefined : cleanTracker(m.tracker))`.
  - `cleanTracker` rebuilds rows from known fields (at most 200):
    - a row without a string `id` ≤ 100 or `name` ≤ 200 is dropped
    - a bad optional field is omitted: a non-finite number, or a `health` outside the four words
  - `sendInitiative` sends only while online, for a local character this player owns in this campaign, with an integer
    total in range.
- **Session:**
  - `hostDeps.loadCombat = () => db.combat.get(cid)`.
  - `hostDeps.onInitiative = (id, n) => void import('../combat/store.ts').then((m) => m.applyInitiative(cid, id, n)).then(() => changed(r))`.
    This is dynamic, so the store stays out of first load.
  - In `onLocalChange`, kind `'combat'` for the hosted campaign → `r.host?.trackerChanged()`. The existing `else` branch
    becomes `kind === 'campaign'`.
  - `guestDeps.onTracker` sets `session.tracker`.

- [ ] **Step 1: Failing tests** (`tests/sync/tracker.test.ts`; the hidden-item character fixture from
  `tests/sync/project.test.ts`):
  - `healthStatus`: (10,10) Unhurt, (9,10) Hurt, (6,10) Hurt, (5,10) Bloodied, (4,7) Hurt, (3,7) Bloodied, (0,10) Down,
    (5, undefined) undefined
  - `trackerForPlayers sends only the allowlist` (**Review Focus 1**). A started combat holds:
    - PC "Thorin" (A1) with init 17, whose max HP is neither 7 nor 9
    - goblin 1 at 3/7 with notes "Secret note", a condition with a duration, and `concentrating`
    - a hidden "Assassin"
    - the lair
    - a DM-only character "Spy" at 4/9

    Checks:
    - key sets: Thorin `['characterId','hp','id','init','maxHp','name']`; goblin `['health','id','name']` with
      `health 'Bloodied'`; lair `['id','name']`; Spy `['health','id','name']`
    - `JSON.stringify(view)` contains none of: `Assassin`, `Secret note`, `monster:goblin@SRD`, `"ac"`, `conSave`,
      `durations`, `"maxHp":7`, `"maxHp":9`
  - `health words follow the settings`: `showMonsterHealth` false → goblin keys `['id','name']`; `initiativeModules.hp`
    false → the same
  - `setup sends player characters only`: round 0 → rows = [Thorin], and no `current`
  - `a hidden current turn is not revealed`: turn on the Assassin → `current` undefined
  - `a PC's max HP is the player view's`: a character with a hidden `hpPerLevel +1` item → `maxHp` equals the player-view
    sheet's, which is less than the DM view's
  - `currentActor`: turn on Thorin → his characterId; on the goblin → undefined
  - Engine, with `Device` fakes and `memoryPair`:
    - the DM changes the combat → `host.trackerChanged()` → A1's `onTracker` gets a view with `round 1`
    - a second player joining mid-fight gets the tracker right after its welcome
    - the DM damages Thorin → `characterChanged` → the next view has the new `hp`
  - `initiative messages are validated` (**Review Focus 4**):
    - A1 sends `{t:'initiative', characterId: <Thorin>, total: 17}` → `onInitiative(<Thorin>, 17, 'A1')`
    - for A2's character → not called, and counted as a violation
    - totals `17.5`, `51`, `-11`, `'17'` → parse errors, not called
  - `cleanTracker`:
    - a row `{id: 5}` is dropped
    - `{id:'x', name:'Goblin 1', health:'Wounded'}` → `{id:'x', name:'Goblin 1'}`
    - 300 rows → 200
  - `session.test.ts`, `the DM's combat reaches the player, and the player's roll lands in it`: with the fake transport,
    the DM hosts with a combat holding A1's character (init unset) and round 1.
    - The player's `session.tracker.round` is 1.
    - `sendInitiative(id, 14)` → `db.combat.get` on the DM side shows `init 14` for that row.
- [ ] **Steps 2–4:** FAIL → implement → PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat: send players a projection of the tracker and take their initiative rolls`.

---

## Group C — UI (Tasks 4–5)

### Task 4: The DM tracker page, modules and encounters

**Files:**
- Create: `src/ui/pages/Initiative.svelte`, `src/ui/initiative/Tracker.svelte`, `src/ui/initiative/CombatantRow.svelte`,
  `src/ui/initiative/Encounters.svelte`, `src/ui/HpControls.svelte`
- Modify: `src/App.svelte`, `src/ui/sheet/Combat.svelte`

**Interfaces — Consumes:** Tasks 1–2 (`combat.ts`, `store.ts`, `db.encounters`, `db.combat`), `saveCampaign` and
`getIndex` (`store.svelte.ts`), `filterMonsters` (`monsters/library.ts`), `StatBlock.svelte`, `rollTo` (`ui/sheet/roll.ts`).
**Produces:**
```ts
// HpControls.svelte props
{ label: string /* prefixes aria-labels, e.g. "Goblin 1" */; dead?: boolean; atZero?: boolean /* shows the crit box */;
  ondamage: (n: number, crit: boolean) => void; onheal: (n: number) => void; ontemp: (n: number) => void }
```
- **Routing and nav:**
  - App gets the route `['combat', 'Initiative', () => import('./ui/pages/Initiative.svelte')]` and the nav item
    `['Combat', 'combat']` after Characters, for both viewers.
  - The bottom bar must still fit at 375 px with no horizontal scroll. If nine labels don't fit, `About` leaves the bottom
    bar below 768 px (it stays in the side nav), and the Campaigns page links to it.
- **The page:**
  - No campaign → "Open a campaign to run combat."
  - A joined campaign, or Player view → `PlayerTracker` (Task 5).
  - Otherwise → `Tracker` and `Encounters`.
  - The page re-reads the combat and the characters when `session.rev` changes, so a player's roll or sheet edit shows.
- **`HpControls`:** extract the Amount / Damage / Heal / crit box and Temp HP / Set temp HP block from `sheet/Combat.svelte`
  unchanged in behavior. The sheet then uses it (`ondamage` → `applyDamage` and so on, as today).
- **Tracker header:**
  - Round (`Round 2`, or `Setup` at 0), plus Start / Previous / Next turn and End combat (confirm).
  - A polite live region: "Round 2 · Goblin 1's turn".
  - The **Modules** dropdown: a `<details><summary>Modules</summary>` with seven labelled checkboxes. They write
    `settings.initiativeModules` through `saveCampaign` (the same field the Settings page edits).
  - A **Group identical monsters** checkbox (`groupMonsters`).
  - **Sort** (`sortCombatants`) and **Roll unrolled** (`rollInit` for every non-PC row with an unset `init`).
- **Adding combatants:**
  - **Add party** adds every campaign character not already in, with `pcCombatant` from its DM-view sheet.
  - **Add character** is a select.
  - **Add monster**: a search over the campaign's own monsters plus `index.all('monster')` through `filterMonsters`, with
    the first 20 results, a count (1–99) and Add (`addMonsters` with `settings.monsterHp`).
  - **Add lair actions** shows when the lair module is on and there is no lair row.
- **Rows (`CombatantRow`):**
  - `aria-current="true"` on the current turn's rows.
  - Name (editable), initiative (a number input; Roll for a PC uses `rollInit(initMod)`), AC.
  - **Move up** / **Move down** buttons labelled "Move Goblin 1 up", as the keyboard and touch alternative.
  - Native `draggable` rows with drop → `moveTo`, for mouse.
  - Hidden from players (checkbox), Remove, notes (DM only), and a Stat block disclosure for monsters (the existing
    `StatBlock`; its rolls stay private, R6).
  - Module controls, each shown only when its module is on:
    - **HP**: `HpControls` → `changeHp`. A returned DC shows "Concentration: Con save DC 12" with Roll (`rollTo('Concentration
      save', 1d20±conSave, { public: false })`) and Lost concentration.
    - **Conditions**: chips of `CONDITIONS` → `setCondition`, each with an optional duration (rounds, start/end, whose
      turn: a select of combatants). The remaining rounds show on the chip.
    - **Concentration**: a checkbox.
    - **Death saves**: for a PC at 0 HP, the marks and Roll death save → `rollTo` then `deathSave`.
    - **Legendary actions**: `used/max` with − and +.
    - **Reactions**: a Reaction used checkbox.
- **`Encounters` (DM only):**
  - A list with New, Edit, Delete (confirm) and **Start**.
  - The editor holds a name and lines of a monster and a count. Adding uses the same search as Add monster.
  - Start = `encounterPicks`, then `addMonsters`. Missing monsters → a toast naming them (**Review Focus 5**).
- [ ] **Steps:**
  - implement
  - `npx vitest run` (the sheet still passes)
  - `npm run check`, `npm run build`, `npm run size` (≤ 150 KB; the tracker is a separate chunk)
  - commit `feat: initiative tracker page for the DM with modules and encounters`

### Task 5: The player tracker, and the browser check

**Files:** create `src/ui/initiative/PlayerTracker.svelte`; modify `src/ui/pages/Initiative.svelte`.

**Interfaces — Consumes:** `TrackerView`, `trackerForPlayers` (Task 3), `session.tracker`, `sendInitiative` (Task 3),
`computeSheet`, `rollD20` (`ui/sheet/roll.ts`).
- **Source of the view:**
  - In a joined campaign it is `session.tracker`.
  - On the DM's device in Player view it is `trackerForPlayers(combat, characters, settings)` built locally, so the DM sees
    exactly what players see (R12).
- **Layout:**
  - "Round N", plus a list in order, with `aria-current` on `current` and a polite live region announcing the turn.
  - PC rows show HP `hp/maxHp` and the initiative.
  - Other rows show the health word when present.
  - No combat → "No fight in progress."
- **Own character with an unset `init`** (joined campaign only): an Initiative number input, **Roll** (`rollD20('Initiative',
  sheet.initiative)` with the player's own sheet; a public roll by default as today) that fills the input, and **Send** →
  `sendInitiative`.
- **No edit controls of any kind.**
- [ ] **Steps:** implement → `npm run check`, `npm run build`, `npm run size` → browser check → commit.
- [ ] **Browser check (required):**
  - Run the dev server. Open the DM tab at `http://localhost:5173/dnd-app/` and the player tab at
    `http://127.0.0.1:5173/dnd-app/`: different origins, so separate IndexedDB.
  - The DM hosts a campaign; the player joins as A1 and makes or brings a character.
  - DM, on Combat:
    - Add party.
    - Make an encounter "Ambush" (Goblin ×3), and Start it: rows Goblin 1–3.
    - Add the Adult Red Dragon and tick Hidden from players.
  - Player, on Combat: only their character is listed (setup). They roll and Send.
  - The DM sees the total, placed in order.
  - DM presses Start. The player sees "Round 1", the turn marker, Goblin 1–3 with `Unhurt`, and no dragon.
  - DM damages Goblin 1 by 4 → the player sees `Bloodied`. DM damages the PC by 3 → the player's sheet HP drops.
  - DM turns off "Show monster health status to players" → the words disappear. DM turns it back on.
  - DM moves a goblin with Move up using only the keyboard (Tab, Enter). Next turn wraps to round 2.
  - DM reloads → the combat, round and turn are restored.
  - Player tab at 375 px wide: no horizontal scroll, and the nav fits.
  - If the public signaling server is unreachable, say so, and rely on the fake-transport tests for the sync half.
- [ ] **Commit** `feat: read-only tracker for players with initiative entry`.

---

## Task 6: Release (controller)

- [ ] Whole-branch review (most capable model) covering all of stage 4. If Group C has had no review of its own, this
  one reads it in full. Then one fix pass and a scoped re-review.
- [ ] Run `npx vitest run`, `npm run check`, `npm run build` and `npm run size`.
- [ ] Push by hash, then a live walkthrough with two browser contexts on the deployed site:
  - host and join
  - add party and an encounter
  - player initiative
  - start, damage, health words, and a hidden monster
  - reload
- [ ] `git tag stage-4 && git push origin stage-4`.
