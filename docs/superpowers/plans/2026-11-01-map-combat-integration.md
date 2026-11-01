# Map ↔ combat integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Movement budgets that stop a player's token at its speed, encounters that save and resume whole fights with their map, and
right-click "declared action" arrows everyone sees, built as the base for later attacks and rolls.

**Architecture:** Pure logic in `src/lib` (new `combat/movement.ts`, `combat/encounters.ts`, `map/actions.ts`) with Vitest tests. The host
(DM device) enforces movement and owns the declared-action board. Players get allowlisted views through the existing tracker/scene
messages plus one new `actions` message. UI changes compose the Abyssal kit in `src/ui/kit`.

**Tech Stack:** Svelte 5 runes, TypeScript, Vite, Vitest, IndexedDB via idb, relay sync (`src/lib/sync`).

**Spec:** `docs/superpowers/specs/2026-11-01-map-combat-integration-design.md` (read it in full; this plan argues from it).

**Execution:** grouped, as in stages 2–5. Each **Group** is one implementer dispatch plus one review. Groups run in order A → B → C → D,
one writer at a time (the next group may build while the previous one is reviewed). The last group's review folds into the final
whole-branch review.

## Global Constraints
- 2014 rules only; nothing from 2024 rules. Never bundle 5etools/book data; never copy `C:\Users\bestj\dnd-app-testdata`.
- Svelte 5, existing code and kit (`src/ui/kit`: Workspace, Tabs, Drawer, Menu, Pill, Stat, Bar); no new dependencies.
- First load ≤ 150 KB gzipped (`npm run size`, now 59.3 KB). New logic loads lazily where the map/combat chunks already do.
- `npx vitest run` passes, `npm run check` clean, `npm run build` succeeds.
- Sync safety: allowlists to players, every guest message validated in `src/lib/sync/protocol.ts` and re-checked on the fresh record,
  no record ids, hidden tokens, fogged tokens or hidden item bonuses reaching players.
- Speed used everywhere (player clamp, host check, DM readout) = `computeSheet(ch, { settings, viewer: 'player' }).speed.walk` for PCs,
  monster stat block `speed.walk` for monsters, then `effectiveSpeed` (Task A1).
- Tokens only for colours (`var(--accent)` etc.), except arrow colours, which reuse `tokenColor` from `src/lib/map/scene.ts`.
- Phones: 44 px touch targets, no horizontal scroll at 375 px. Every new control is a labelled button.
- Agents: no shell heredocs, no complex `node -e`; commit with `git commit -F <file>`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never push.

## Rulings made while planning (spec silent or in tension)
- **P1:** Prepared encounters keep today's **Start** behaviour: their monsters join the *current* fight (reinforcements), no prompt. Only
  saved fights **Resume** (replace the live fight, with the save-first prompt). The spec's "fresh setup-state combat" applies when there is
  no fight. Cost if wrong: one extra prompt path.
- **P2:** DM drags of the current combatant count toward its budget (spec). So the DM can fix a mistake, the turn bar's "⋯" gets
  **Reset movement** (current combatant: feet 0, Dashes 0). Cost if wrong: one menu item.
- **P3:** Per-player arrow colour = `tokenColor(playerId)` (the existing token palette, stable per player) instead of "by roster order".
- **P4:** Declared actions carry `duringFight?: true` so "ends when combat ends (arrows made during combat)" can be applied to arrows
  without a source token.

## Review Focus
1. A player reloads or reconnects mid-turn: their remaining movement must be what it was (it lives in `Combat`, not on the device). Test in A2.
2. The DM drags a player's token back to undo a move: the player must not be left without movement → Reset movement (P2). Test in A1 + B1 check.
3. A drag ending exactly on the budget boundary, with `5-10-5` diagonals and on hex grids, must land on the last legal cell and never one
   past it. Test in A1.
4. Resuming a saved fight while players are connected: stale arrows from the old fight disappear and players get the new tracker and
   scene without reloading. Test in D1 (board) and C1 (restore).
5. Starting a prepared encounter mid-fight still adds its monsters to the running fight without asking (P1). Test in C2.

---

## Group A: movement core

### Task A1: movement model and turn reset

**Files:**
- Modify: `src/lib/types.ts` (Combat)
- Create: `src/lib/combat/movement.ts`
- Modify: `src/lib/combat/combat.ts` (`start`, `pass`, `removeStep`; export `currentRun`)
- Test: `tests/combat/movement.test.ts`

**Interfaces:**
- Produces (types.ts):
  - `export interface Movement { feet: number; dashes: number }`
  - `Combat.movement?: Record<string, Movement>`: combatant id → this turn's movement.
  - `Combat.encounterId?: string`: added here so Group C needn't touch the type again.
- Produces (`combat.ts`): `export function currentRun(c: Combat): Set<string>`. These are the combatant ids acting on the current turn (a
  grouped run is several). The set is empty in round 0 or with no turn.
- Produces (`movement.ts`, pure):
  - `export const STOP_CONDITIONS: readonly string[]`, holding `['grappled','restrained','paralyzed','petrified','stunned','unconscious']`.
  - `export function effectiveSpeed(walk: number, conditions: readonly string[], exhaustion = 0): number`. Returns 0 for any stop
    condition (case-insensitive) or exhaustion ≥ 5. Exhaustion 2–4 halves it, rounded down to a multiple of 5.
  - `export function remainingFeet(speed: number, m: Movement | undefined): number`, which is `max(0, speed × (1 + dashes) − feet)`.
  - `export function combatantForToken(c: Combat, t: { characterId?: string; combatantId?: string }): Combatant | undefined`
  - `export function budgetApplies(c: Combat | undefined, settings: { freeMovement: boolean }): boolean`. True only for a running fight
    (round ≥ 1) with `freeMovement` off.
  - `export function recordMove(c: Combat, combatantId: string, feet: number): Combat`. Feet < 0 or NaN are ignored and return `c`.
  - `export function addDash(c: Combat, combatantId: string): Combat`
  - `export function undoDash(c: Combat, combatantId: string, speed: number): Combat`. Returns `c` (the same object) unless dashes ≥ 1
    and `feet ≤ speed × dashes`.
  - `export function resetMovement(c: Combat, combatantId: string): Combat`
  - `export function clampMove(g: Grid, from: Pt, to: Pt, size: Size, left: number, diagonal: '5-5-5' | '5-10-5'): Pt`

- [ ] **Step 1: Write the failing tests** in `tests/combat/movement.test.ts`:
  - `effectiveSpeed(30, ['Grappled']) === 0`, `effectiveSpeed(30, [], 5) === 0`, `effectiveSpeed(30, [], 2) === 15`, `effectiveSpeed(25, [], 3) === 10`, `effectiveSpeed(30, ['prone']) === 30`.
  - `remainingFeet(30, undefined) === 30`; `remainingFeet(30, { feet: 20, dashes: 1 }) === 40`; never negative.
  - `recordMove` accumulates (10 then 15 → 25), creates the entry, ignores −5.
  - `undoDash`: with `{ feet: 25, dashes: 1 }` and speed 30 it removes the Dash. With `{ feet: 35, dashes: 1 }` it returns the same object.
  - **Turn reset:**
    - After `start`, the first combatant's movement is gone.
    - `next` resets only the new run's entries; other combatants' entries survive.
    - `next` → `prev` → `next` resets the returning combatant only once: use the `done` guard, i.e. the reset happens only where
      `startTurn` runs. A test records 10 ft after the first `next`, then does `prev` + `next` and expects 10 ft still there.
    - `prev` alone never changes `movement`.
    - In a grouped run, each member keeps its own entry and all of them reset at the run's turn start.
    - `removeStep` drops the removed id's entry.
  - **Review Focus 3, `clampMove` on a square grid (size 50, feet 5):**
    - From cell (0,0) toward (10,0) with left 30, it lands on cell 6.
    - With left 0, it stays put.
    - A target within budget snaps to the target.
    - Diagonal toward (10,10) with `5-10-5` and left 30 lands where `feetBetween` = 30, never 35.
    - On a `hex-flat` grid it never exceeds `left`.
- [ ] **Step 2:** `npx vitest run tests/combat/movement.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement.** In `combat.ts`, wherever `startTurn` runs on a fresh boundary (`start`, and `pass` when `fresh`), drop
  `movement[id]` for every id in that run. Do not touch `prev`. `clampMove` algorithm:
  - Snap `from`, then walk from `from` to `to` in steps of `g.size / 4`.
  - Snap each sample (`snap(g, p, size)`) and keep the last one whose `feetBetween(g, fromSnapped, p, diagonal) ≤ left`.
  - Return `snap(to)` if it is within budget, else the last kept point.
- [ ] **Step 4:** `npx vitest run`. Everything passes (existing combat tests unchanged).
- [ ] **Step 5:** Commit `feat: movement budget model, reset at each combatant's own turn start`.

### Task A2: host enforcement, Dash from players, remaining movement in the player tracker

**Files:**
- Modify: `src/lib/sync/scene.ts` (`moveProblem`; add `moveCost`)
- Modify: `src/lib/sync/project.ts` (`TrackerRow`, `trackerForPlayers`)
- Modify: `src/lib/sync/protocol.ts` (guest message `dash`)
- Modify: `src/lib/sync/host.ts` (deps `updateCombat?`; `#move` records; `dash` handler)
- Modify: `src/lib/sync/guest.ts` (`sendDash`)
- Modify: `src/lib/sync/session.svelte.ts` (wire `updateCombat` dep; export `sendDash`)
- Test: `tests/sync/movement.test.ts` (use `tests/sync/fakes.ts` like `scene.test.ts`)

**Interfaces:**
- Consumes A1: `budgetApplies`, `combatantForToken`, `effectiveSpeed`, `remainingFeet`, `recordMove`, `addDash`, `Movement`.
- Produces:
  - `export function moveCost(s: Scene, m: { tokenId: string; x: number; y: number }, ch: Character, combat: Combat | undefined, settings: CampaignSettings): { combatantId: string; feet: number; left: number } | undefined`.
    It is undefined when no budget applies, or when the character has no combatant.
  - `moveProblem` additionally returns `{ error: 'too far', violation: false }` when `moveCost(...).feet > left`.
  - `TrackerRow.moved?: Movement`, set on **player-character rows only** (never monsters), when `budgetApplies`.
  - `HostDeps.updateCombat?(fn: (c: Combat) => Combat): Promise<Combat | undefined>`. It only changes an existing combat. Wire it in
    the session as `db.combat.update(cid, (c) => c && fn(c))`.
  - `GuestMsg` adds `{ t: 'dash'; characterId: string }`. The host accepts it only from the character's owner, when `budgetApplies`,
    and when the character is the `currentActor` of the players' tracker view. A non-owner sending it is a violation. A stale one is
    ignored quietly.
  - `guest.sendDash(characterId: string): void`, with session export `sendDash(characterId: string): void`.
- PC speed in `moveCost` = `effectiveSpeed(computeSheet(ch, { settings, viewer: 'player' }).speed.walk, ch.state.conditions, ch.state.exhaustion)`.
  Feet = `feetBetween(s.grid, token centre, snap(s.grid, m, t.size), settings.diagonal)`.

- [ ] **Step 1: Write the failing tests** in `tests/sync/movement.test.ts`:
  - **Moves:**
    - A player move within budget is applied, and `combat.movement[pc].feet` grows by its cost.
    - A move beyond the remaining budget is refused with `'too far'`: the scene is unchanged, the link gets the scene re-sent, and it is
      not a violation.
    - With `freeMovement` on, or in round 0, there is no budget and nothing is recorded.
  - **Hidden turn:** a hidden monster's turn after the PC (players' view keeps the PC current) leaves the PC's leftover feet intact,
    and a move within them is accepted.
  - **Dash:**
    - A `dash` from the owner on their turn adds a Dash, so the budget doubles.
    - From a non-owner it's a violation.
    - Off-turn, it's ignored.
  - **Review Focus 1:** `trackerForPlayers` carries `moved` for the player's own PC row and none for monster rows. A fresh guest (a
    reconnect) gets the same `moved` in its first tracker.
- [ ] **Step 2:** run the file and expect FAIL.
- [ ] **Step 3: Implement.** In `host.#move`, after the scene write succeeds, call `this.#deps.updateCombat?.((c) => recordMove(c, cost.combatantId, cost.feet))`
  with `cost` computed on the same fresh scene record. The existing db change notification re-sends the tracker; don't broadcast it by hand.
- [ ] **Step 4:** `npx vitest run` and `npm run check`. All pass.
- [ ] **Step 5:** Commit `feat: host enforces movement budgets; players can Dash; tracker carries own movement`.

## Group B: movement on screen

### Task B1: clamp while dragging, readouts, Dash/undo/reset controls

**Files:**
- Modify: `src/ui/map/MapCanvas.svelte` (prop `limitOf`; drag clamp; drag label)
- Modify: `src/ui/map/DmMap.svelte` (limits for the current run; record DM drags)
- Modify: `src/ui/map/PlayerMap.svelte` (limit, status line, Dash button)
- Modify: `src/ui/initiative/Tracker.svelte` (turn bar readout, Dash button, "⋯" Undo Dash / Reset movement)
- Test: no new unit tests (logic is in A1/A2). Do a browser check at 1280 px and at 375 px (mobile preset).

**Interfaces:**
- Consumes A1/A2: `currentRun`, `combatantForToken`, `effectiveSpeed`, `remainingFeet`, `recordMove`, `addDash`, `undoDash`,
  `resetMovement`, `clampMove`, `budgetApplies`, `TrackerRow.moved`, `sendDash`.
- Produces (MapCanvas): it replaces nothing; it adds the optional prop
  `limitOf?: (id: string) => { left: number; clamp: boolean } | undefined`.
  - While dragging a token that has a limit, the ghost is `clampMove(grid, tokenCentre, pointer, size, left, diagonal)` when `clamp`.
    Without `clamp` the ghost follows the pointer, and the label turns red past `left`.
  - The existing drag label (feet / speed, `MapCanvas.svelte` ~line 385) reads `"<moved> ft · <left − moved> left"`.
  - `speedOf` stays for tokens without a limit.

- [ ] **Step 1: DmMap.**
  - `limitOf` covers tokens whose combatant is in `currentRun(combat)` when `budgetApplies`: `left = remainingFeet(speed, combat.movement?.[id])`,
    `clamp: false`.
  - Monster speed comes from the monster's stat block (`speed.walk`) and `combatant.conditions`. PC speed follows Global Constraints.
  - After `onmove` writes the scene, record the feet for each moved token whose combatant is in the current run
    (`updateCombat(cid, (c) => recordMove(c, id, feet))`).
- [ ] **Step 2: PlayerMap.**
  - `limitOf` covers own tokens when the budget applies: `left` comes from the PC's `TrackerRow.moved` plus the same speed, with
    `clamp: true`.
  - Status line: "Your turn: 20 ft left." (or "…20 ft left · Dashed ×1"), plus a **Dash** button
    (`aria-label="Dash"`, calls `sendDash(characterId)`).
  - Keep the existing status strings for the other cases.
- [ ] **Step 3: Tracker turn bar.**
  - Next to "<name>'s turn", show the current combatant's remaining feet in mono (`25 ft left`, with `· Dashed ×2` when dashes > 0).
  - A **Dash** button (default style) adds a Dash. For a grouped run, the readout and Dash use the run's first combatant.
  - The "⋯" Menu gains **Undo Dash** (disabled when `undoDash` would return the same object) and **Reset movement** (P2).
  - All of this shows only when `budgetApplies`.
- [ ] **Step 4: Browser check.**
  - Seed a campaign: a scene, two PCs, a goblin, a started combat.
  - As DM, drag the current PC 40 ft: the label goes red past 30, the drop is allowed, and the readout shows 0 ft left. Reset
    movement brings it back to 30 ft.
  - In Player view (viewer toggle), drag your token past its speed: the ghost stops at the limit. Dash doubles it.
  - Check the 375 px layout: no horizontal scroll, and Dash is 44 px.
- [ ] **Step 5:** `npx vitest run`, `npm run check`, `npm run size`. Commit `feat: movement limits on the map and in the turn bar`.

## Group C: encounters as saved fights

### Task C1: snapshot, restore, validation, backups

**Files:**
- Modify: `src/lib/types.ts` (Encounter)
- Create: `src/lib/combat/encounters.ts`
- Modify: `src/lib/recordShape.ts` (`encounterProblem` accepts `fight`; factor `tokensProblem` out of `sceneProblem`)
- Modify: `src/lib/combat/store.ts` (flows below)
- Test: `tests/combat/encounters.test.ts`, plus a case in `tests/backup.test.ts`

**Interfaces:**
- Produces (types.ts):
  `export interface SavedFight { combat: Combat; map?: { sceneId: string; tokens: Token[]; fog?: string }; savedAt: number }`.
  `Encounter.fight?: SavedFight`. `monsters` stays required (`[]` for a saved fight) so old records and the old validator shape still hold.
- Produces (`encounters.ts`, pure):
  - `export function snapshotFight(c: Combat, scene: Scene | undefined): SavedFight`. A deep copy (`structuredClone`), minus
    `encounterId`, with `map` only when a scene is given.
  - `export function restoreCombat(f: SavedFight, encounterId: string, characters: Character[], campaignId: string): { combat: Combat; dropped: string[] }`
    - PC combatants whose character no longer exists in the campaign are removed, and their names listed in `dropped`. If the turn
      was theirs, it moves on via the same rule as `removeStep`, without ticking durations.
    - Remaining PC combatants lose `durations`, `concentrating` and `reactionUsed` (spec).
    - Sets `encounterId`, `campaignId` and `updatedAt: Date.now()`.
  - `export function restoreScene(s: Scene, f: SavedFight, characterIds: Set<string>): Scene`. Takes the snapshot's tokens (and
    `fog` when saved; otherwise `s.fog` is kept). Tokens of deleted characters are dropped, and so are tokens outside `s.width × s.height`.
- Produces (`recordShape.ts`):
  - `export function tokensProblem(tokens: unknown): string | undefined`, with `sceneProblem` reusing it.
  - `encounterProblem` validates `fight` when present: a combat object, `combatants` an array ≤ `MAX_COMBATANTS` (200), round an
    integer ≥ 0, map tokens via `tokensProblem`, and `fog` a string when present.
- Produces (`combat/store.ts`). The caller handles prompts; these just do it:
  - `export const saveFightAs = (cid: string, name: string): Promise<Encounter>` snapshots the live combat and `db.scenes.shown(cid)`,
    puts a new encounter, and sets `combat.encounterId`.
  - `export const saveFight = (cid: string): Promise<Encounter | undefined>` overwrites the linked encounter. It is undefined when
    the fight isn't linked.
  - `export const resumeFight = (cid: string, e: Encounter): Promise<{ dropped: string[]; sceneMissing: boolean }>`
    - Writes the restored combat.
    - When `fight.map` exists and its scene still exists, writes `restoreScene` and `db.scenes.show(cid, sceneId)`.
    - `sceneMissing` is true when the map was saved but its scene is gone.
  - `export const deleteEncounter = (cid: string, id: string): Promise<void>` deletes the encounter and removes `encounterId` from the
    live combat when it pointed at it.

- [ ] **Step 1: Write the failing tests** in `tests/combat/encounters.test.ts`:
  - **Round trip:** snapshot → restore gives equal monsters (HP, conditions, durations, legendary), order, round, turn and movement.
  - **PCs on restore:**
    - PC `durations`, `concentrating` and `reactionUsed` are stripped.
    - A deleted character's combatant is dropped and named. If it held the turn, the turn passes to the next combatant.
  - **Scene:** `restoreScene` drops tokens of deleted characters and tokens off a now-smaller scene, and keeps the current fog when
    none was saved.
  - **Validation:** `encounterProblem` accepts an old record (no `fight`), accepts a saved fight, rejects 201 combatants, and rejects
    a token with a bad size.
  - **Store flows** (fake-indexeddb, as `tests/combat/storage.test.ts`):
    - `saveFightAs` links the fight; `saveFight` updates the same id.
    - `resumeFight` with a deleted scene returns `sceneMissing: true` and still loads the combat.
    - `deleteEncounter` on the linked one unlinks it.
  - **Backups:** in `tests/backup.test.ts`, a backup holding a saved fight round-trips, and an old backup without `fight` still loads.
- [ ] **Step 2:** run the files and expect FAIL.
- [ ] **Step 3:** Implement the pure module first, then the validator, then the store flows (use `db.combat.update`, `db.encounters.put`,
  `db.scenes.update`, `db.scenes.show`; serialise with the store's existing `serial`).
- [ ] **Step 4:** `npx vitest run` and `npm run check`. All pass.
- [ ] **Step 5:** Commit `feat: encounters can hold a saved fight with its map`.

### Task C2: encounter UI

**Files:**
- Modify: `src/ui/initiative/Encounters.svelte`
- Modify: `src/ui/initiative/Tracker.svelte` ("⋯" items; End combat dialog)
- Test: `tests/combat/encounters.test.ts` (P1 case) and a browser check.

**Interfaces:**
- Consumes C1: `saveFightAs`, `saveFight`, `resumeFight`, `deleteEncounter`, `Encounter.fight`, `Combat.encounterId`.
- **Dialogs:** use a native `<dialog>` with labelled buttons, styled with tokens (no new kit component). Copy:
  - **"Save the current fight first?"** with the buttons **Save as encounter…** / **Discard** / **Cancel**. Save as asks for a name
    inline in the same dialog.
  - **End combat on a linked fight:** "End combat" with the buttons **Keep the encounter for later** (saveFight, then end) /
    **Delete it** (deleteEncounter, then end) / **Cancel**. Keep the existing map write-back that already runs before `endCombat`.

- [ ] **Step 1: Write the failing test (Review Focus 5 / P1).** Factor the body of today's `start(e)` into
  `export async function addPreparedToFight(cid: string, e: Encounter, lookup: (id: string) => MonsterDef | undefined, hpMode: 'average' | 'roll'): Promise<{ added: Combatant[]; missing: string[] }>`
  in `combat/store.ts`. The test: with a running fight, the monsters are added to it, the existing combatants stay, and `encounterId`
  is unchanged.
- [ ] **Step 2:** run it and expect FAIL; implement; it passes.
- [ ] **Step 3: Encounters tab.**
  - **Each row shows its kind.**
    - Saved fight: "Round 3 · 7 combatants". **Resume** is primary.
    - Prepared list: "5 monsters". **Start** (P1) and **Edit**.
    - **Delete** (danger, confirm) on both.
    - The linked encounter shows a "Current" Pill.
  - **Resume** while a fight runs:
    - If the fight is linked, `saveFight` runs first.
    - If it isn't linked, open the "Save first?" dialog.
    - Then `resumeFight`. Toast `dropped` names and `sceneMissing` ("The saved map's scene was deleted; loaded the fight without it.").
  - Keep the existing aria-labels (`Start {name}`, `Edit {name}`, `Delete {name}`) and add `Resume {name}`.
- [ ] **Step 4: Turn bar "⋯".** Add **Save as encounter…** (name via the dialog) and, when linked, **Save encounter**. End combat on a
  linked fight opens the End dialog. Unlinked fights keep today's behaviour.
- [ ] **Step 5: Browser check.**
  - Save a running fight with a moved token, change HP, then Resume: HP, positions and round come back, and PC HP is unchanged.
  - Delete the scene, then Resume: you get the toast and the fight loads.
  - Start a prepared encounter mid-fight: its monsters are added.
  - Check 375 px.
- [ ] **Step 6:** `npx vitest run`, `npm run check`, `npm run size`. Commit `feat: save, resume and delete fights from the encounter list`.

## Group D: declared actions

### Task D1: action record, board, protocol, host and guest

**Files:**
- Create: `src/lib/map/actions.ts`
- Modify: `src/lib/sync/protocol.ts`, `src/lib/sync/host.ts`, `src/lib/sync/guest.ts`, `src/lib/sync/session.svelte.ts`
- Test: `tests/map/actions.test.ts`, `tests/sync/actions.test.ts`

**Interfaces:**
- Produces (`actions.ts`, pure):
  - `export const ACTION_KINDS = ['intent'] as const; export type ActionKind = (typeof ACTION_KINDS)[number];`
  - `export type ActionEnd = { tokenId: string } | { x: number; y: number };`
  - `export interface ActionRequest { sceneId: string; from: ActionEnd; to: ActionEnd; kind: ActionKind; data?: unknown }`
  - `export interface DeclaredAction extends ActionRequest { id: string; by: string /* player ID or 'dm' */; endsWith?: string /* combatant id */; duringFight?: true; at: number }`
  - `export type PlayerAction = Omit<DeclaredAction, 'endsWith' | 'duringFight'>`
  - `export function cleanActionRequest(v: unknown): ActionRequest | undefined`. Shape only. Unknown `kind` is rejected; ids are
    strings ≤ 100; points are finite. `data` must be undefined for `'intent'`. This is the one place a future kind adds its payload check.
  - `export const MAX_ACTIONS = 100`
  - `export class ActionBoard`, pure and with no I/O:
    - `list(): DeclaredAction[]`
    - `set(a: DeclaredAction): void`. Replaces the owner's slot: for a player, every action with the same `by`. For the DM, the
      same `by` and the same `from.tokenId`, or the one with no token. Drops the oldest beyond `MAX_ACTIONS`.
    - `clear(by: string, id?: string): boolean`. A player clears their own; `'dm'` may clear any id, or all when `id` is undefined.
    - `onCombat(c: Combat | undefined): boolean`. Expires actions whose `endsWith` is in the previous `currentRun` but not the new one.
      With no combat, it drops every action with `endsWith` or `duringFight`. Returns whether anything changed. Keep the previous run
      inside the board.
    - `onScene(shownSceneId: string | undefined): boolean` drops actions for other scenes.
  - `export function actionProblem(r: ActionRequest, view: PlayerScene | undefined, ownTokenIds: Set<string>): string | undefined`.
    This is the player check:
    - The scene must be the shown one.
    - A token `from` must be in `ownTokenIds` and in the view.
    - A token `to` must be in the view, which is already filtered for hidden and fogged tokens.
    - Points must be inside the scene and not fogged (`isRevealed` on `view.fog`).
  - `export function actionsForPlayers(list: DeclaredAction[], view: PlayerScene | undefined): PlayerAction[]`. Keeps only actions on
    the view's scene whose token ends are all in `view.tokens` and whose point ends aren't fogged, and strips `endsWith`/`duringFight`.
- Produces (protocol): guest→host `{ t: 'action'; action: ActionRequest }` and `{ t: 'clearAction' }`. Host→guest
  `{ t: 'actions'; actions: PlayerAction[] }`, with a guest-side clean that caps the list at `MAX_ACTIONS`.
- Produces (host):
  - It owns an `ActionBoard`.
  - On `action`, it runs `actionProblem` against `#scene(camp)`:
    - A crafted request (a foreign token as `from`) is a violation.
    - A stale one is ignored.
    - When accepted it sets `{ id: uid(), by: playerId, endsWith: <the PC combatant of from.tokenId, if in a fight>, duringFight, at }`.
  - `trackerChanged`/`sceneChanged` call `onCombat`/`onScene`. Any change broadcasts `actions` per link: `actionsForPlayers`, plus the
    M1 dedupe as for `scene`.
  - Public `setDmAction(r: ActionRequest): void`, `clearAction(id?: string): void` and dep `onActions?(list: DeclaredAction[]): void`.
    The DM's action gets `endsWith` = `combatantForToken(combat, sourceToken)?.id` when a fight runs (a monster or PC source), and
    `duringFight` likewise.
- Produces (session):
  - State `session.actions: (DeclaredAction | PlayerAction)[]`.
  - `declareAction(r: ActionRequest): void` and `clearDeclared(id?: string): void`, routed by role:
    - Host: `host.setDmAction` / `host.clearAction`.
    - Guest: send `action` / `clearAction`.
    - DM not hosting: a local `ActionBoard`, fed `onCombat`/`onScene` from the same db change hook as the host.

- [ ] **Step 1: Write the failing tests.**
  - **`tests/map/actions.test.ts`:**
    - `cleanActionRequest` rejects `kind: 'attack'`, NaN points and 101-character ids.
    - `set` replaces a player's previous arrow; the DM keeps one per token plus one with no token.
    - `onCombat`:
      - Moving from turn A to B expires A's arrows only.
      - `prev` back to A doesn't resurrect them.
      - Ending the fight drops `duringFight` arrows and keeps others.
      - (Review Focus 4) Resuming a different fight (new combatant ids) drops the old fight's arrows.
    - `onScene` drops other scenes.
    - `actionsForPlayers` hides an arrow whose source token is hidden or fogged, and strips `endsWith`.
  - **`tests/sync/actions.test.ts`:**
    - A player's arrow reaches the other player.
    - A request `from` someone else's token is a violation.
    - Targeting a hidden token is refused without a violation.
    - The DM's arrow from a hidden monster is not sent to players.
    - Next turn clears the acting player's arrow for everyone.
- [ ] **Step 2:** run them and expect FAIL.
- [ ] **Step 3:** Implement `actions.ts`, then protocol, host, guest and session.
- [ ] **Step 4:** `npx vitest run` and `npm run check`. All pass.
- [ ] **Step 5:** Commit `feat: declared actions: record, board and sync`.

### Task D2: arrow gesture and drawing

**Files:**
- Modify: `src/ui/map/MapCanvas.svelte` (gesture, drawing, clear hit-target)
- Modify: `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte` (resolve and pass arrows; Clear controls)
- Test: browser check (the logic is in D1).

**Interfaces:**
- Consumes D1: `session.actions`, `declareAction`, `clearDeclared`, `ActionRequest`, `tokenColor`.
- **MapCanvas gains:**
  - Prop `arrows?: { id: string; from: Pt; to: Pt; color: string; target?: string /* token id to ring */; clearable: boolean }[]`.
  - Callback `ondeclare?: (d: { from: Pt; fromToken?: string; to: Pt; toToken?: string }) => void`.
  - Callback `onclear?: (id: string) => void`.
- **Gesture:**
  - A right-button (`e.button === 2`) pointer-down in any tool starts arrow mode, and `contextmenu` is prevented on the canvas.
  - On touch, a press held ≥ 500 ms that moves < 4 px turns the current press/pan into arrow mode.
  - Pinch and two-finger gestures cancel it.
  - On release, a drag shorter than one grid cell is ignored. Otherwise `ondeclare` fires, with the tokens under each end
    (`tokenAt`, the same visibility as taps).
- **Drawing:** a straight 2.5 px line with a head at `globalAlpha` 0.85, drawn after tokens and before the ruler/templates. The target
  token gets a 2 px ring in the arrow's colour. A `clearable` arrow draws a small ✕ disc at its head; tapping it calls `onclear`.
- **Pages:**
  - **Resolving arrows:** each page resolves `ActionEnd`s to points (a token's centre, or the point) and skips arrows whose token
    is gone.
  - **Colour:** the source token's colour; with no token, `tokenColor(by)`; the DM's no-token arrow uses the computed `--text-strong`.
  - **Who may clear:**
    - DM: every arrow is clearable, and the corner/Tokens area gets **Clear all arrows**.
    - Player: only their own, plus **Clear arrow** in the status line while they have one.
  - **Players:** `fromToken` is used only if it's their own token (else the point). They can't start arrows while offline (same rule
    as moves).
  - **DM:** `fromToken` may be any token.

- [ ] **Step 1:** Implement the MapCanvas prop, gesture and drawing.
- [ ] **Step 2:** Wire DmMap and PlayerMap.
- [ ] **Step 3: Browser check.**
  - At 1280 px, right-drag from a PC to a goblin: the arrow and ring appear, ✕ clears it, and a new arrow replaces the old.
  - Next turn clears it.
  - At the mobile preset, long-press-drag draws an arrow, while a quick drag still moves the token and two fingers still pinch.
  - Switch to Player view and check it draws arrows from `session.actions`. The D1 tests cover sync, so a live two-device run isn't required.
- [ ] **Step 4:** `npx vitest run`, `npm run check`, `npm run size`. Commit `feat: right-click / long-press arrows on the battle map`.

---

## After all groups
- Final whole-branch review (most capable model) against the spec, the Global Constraints and the Review Focus list.
- Then push `main` by hash, watch the Pages deploy, and check the live site on the user's phone flow.
