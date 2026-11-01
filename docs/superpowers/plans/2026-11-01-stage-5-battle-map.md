# Stage 5 (Battle map and live sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
>
> **Execution model (as in stages 2–4, compressed for the deadline):** three groups, ordered by value. Each **Group** is ONE
> implementer dispatch (a commit per task, about 30–45 minutes) followed by ONE review of the group's diff. The next group may
> build while the previous one is reviewed. Fixes wait until the active implementer finishes (one writer at a time). **Each
> group ships on its own:** if time runs out after Group B, the app is coherent (no fog tools, no templates, no tracker links).

**Goal:** The DM preps scenes (an image, a square or hex grid, tokens linked to characters and monsters), measures on them,
and shows one to players. Players see it live in a Map tab and drag their own token on their turn. Area templates, fog of war
and the tracker links come last.

**Architecture:**
- **Engine (pure, `src/lib/map/`):** `grid.ts` (cells, centres, snapping, footprints, distances), `view.ts` (pan, zoom,
  pinch), `scene.ts` (scene and token operations), then `templates.ts` and `fog.ts` in Group C. No DOM, no db. Exact tests.
- **Storage:** a `scenes` store (IndexedDB **version 4**), one record per scene holding its grid, tokens and fog. Every page
  write is a read-modify-write of the fresh record (`db.scenes.update`), so a player's move and a DM edit never overwrite
  each other. The shown scene is a `shown: true` flag, at most one per campaign. Scenes travel in backups.
- **Rendering:** **canvas.** Spec 7 decides it ("The battle map draws on an HTML canvas"), and one bitmap draw beats 50+
  DOM/SVG nodes over a 4096 px image when panning on a weak phone. Redraw only on change (one `requestAnimationFrame` per
  dirty flag). No new dependency.
- **Players:** the host builds a `PlayerScene` with the pure `sceneForPlayers` (new `src/lib/sync/scene.ts`, an allowlist)
  and sends it in a `scene` message. A guest sends `move` for its own token. The host validates it (shape, owner, turn,
  bounds), snaps it, stores it and re-broadcasts. Background and portrait images reach players through a chunked
  `blobWant`/`blobChunk` transfer that reuses the pack-chunk pattern (content hash, `MAX_CHUNK`, drain).
- **UI:** the `#/map` route is its own lazy chunk. `MapCanvas.svelte` is shared by the DM map and the player map.

**Tech Stack:** the stage 1–4 stack (Svelte 5 runes, Vite, TS, Vitest, idb, PeerJS). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-30-dnd-app-design.md`:
- 3.8 (all of it; the authority)
- 3.6 ("What players receive": only the shown scene, no hidden tokens, no tokens under fog, monster tokens as name, size,
  portrait, condition icons and a health word; the DM validates every message, including "their own token")
- 3.7 (deferred from stage 4: add combatants from tokens; starting an encounter places tokens on the current scene; the turn
  change gates token movement)
- 3.9 (`Fog of war` off; `Diagonal rule` 5-5-5; `Free token movement` off; `Show monster health status to players` on) —
  all already in `DEFAULT_SETTINGS` and on the Settings page; **`settings.ts` is not touched**
- 5 (slow or janky on a weak phone; leaks of hidden tokens and fogged tokens)
- 6 (150 KB first load, map loads lazily, redraw only on change, 50 tokens on a 4096 px map on a budget phone)
- 8 ("Known leak": the background image is sent whole; only tokens under fog are withheld)
- 9, stage 5

Rulings carried from earlier stages: R2 (monsters are DM information), R12 (Player view shows only what a player would see),
R13 (a DM-only character, no `ownerId`, is not party data), stage 4's `healthStatus` and its gate.

**Consumed from stage 4 (committed on `main` as of `a28deec`):** `Combat` (`turn`, `round`, `combatants`), combatant ids
(`pc:<characterId>`, `lair`, a uid for monsters), `pcCombatant`, `monsterCombatant`, `addCombatants`, `numberedNames`,
`updateCombat` (`combat/store.ts`), `db.combat.get`, `healthStatus`, `TrackerView`, `currentActor()`, `session.tracker`,
`HostDeps.loadCombat`, db version 3. Group C also hooks stage 4's UI (`Encounters.svelte`, `Tracker.svelte`; Task C3).

## Worktree and merge

- **Branch:** `git worktree add .claude/worktrees/stage-5 -b stage-5 main` (main at or after `061bd9d`, which holds stage 4
  Tasks 1–3). Run `npm ci` in it. Dev server for checks: `npx vite --port 5174` (stage 4 uses 5173).
- **Before Group C:** `git merge main` to bring stage 4's UI (Task 4). If stage 4 Task 4 is not committed yet, C3 still
  ships its pure functions, store and the map-side **Add to combat**; the two stage 4 UI hooks then go in at the final merge
  (listed below), not before.
- **Files both stages touch** — stage 5's edits are small and additive; resolve each conflict by keeping both sides:

| File | Stage 5's edit |
| --- | --- |
| `src/App.svelte` | one route `['map', 'Map', () => import('./ui/pages/Map.svelte')]`; nav `['Map', 'map']` right after `Combat`; a `wide-only` class on the `Packs` and `About` nav links (hidden below 768 px) |
| `src/lib/types.ts` | `Grid`, `Token`, `Scene` appended at the end |
| `src/lib/db.ts` | version 4 + `scenes` store; `ChangeKind` gains `'scene'`; `db.scenes`; `db.blobs.has`; campaign delete clears scenes; `Snapshot.scenes?`, restore and `countReplaced` |
| `src/lib/sync/protocol.ts` | `move`, `blobWant` (guest); `scene`, `blobChunk` (host); `MAX_BLOB`, `BLOB_CHUNK`, `IMAGE_TYPES`, `HASH`; two parse cases |
| `src/lib/sync/host.ts` | deps `loadScene`, `updateScene`, `loadBlob`; `sceneChanged()`; scene in welcome and beside every tracker send; `#move`; `#blobWant` reusing `#drained` |
| `src/lib/sync/guest.ts` | deps `onScene`, `hasBlob`, `saveBlob`; `sendMove`; `scene` and `blobChunk` cases |
| `src/lib/sync/session.svelte.ts` | `session.scene`; the deps wiring; `kind === 'scene'` in `onLocalChange`; `sendMove` |
| `src/lib/settings.ts` | **none** |
| also: `backup.ts`, `recordShape.ts`, `tests/sync/fakes.ts`, `Campaigns.svelte` | scenes in backups (`base64.ts` extracted); `sceneProblem`; `Device.scenes`/`blobs`; links to Packs and About |

- **Final merge checklist (controller):** merge `stage-5` into `main` after stage 4 is released. Check: `openDB(NAME, 4…)`
  keeps the `< 3` encounters line; `onLocalChange` has the `combat` and `scene` branches; nav order is Campaigns,
  Characters, Combat, Map, Compendium, Monsters (DM), Items, Packs*, Settings, About* (* wide only); the C3 hooks are in
  stage 4's `Encounters.svelte` Start and `Tracker.svelte` End combat. Then `npx vitest run`, `npm run check`,
  `npm run build`, `npm run size`.

## Global Constraints

- Everything in the stage 1–4 Global Constraints still holds: SRD-only repo, no fetching content sites; `.ts` imports and no
  Vite-only syntax in `src/lib` (except `content/srd.ts`); 375 px with labelled controls; no heredocs for agents; never copy
  test data into the repo; the controller pushes by hash.
- **Lazy loading.** Nothing under `src/lib/map/`, `src/lib/sync/scene.ts` or `src/ui/map/` enters the first-load bundle.
  `db.ts`, `session.svelte.ts` and `App.svelte` import only types from them. `host.ts` and `guest.ts` (already lazy) may import
  `sync/scene.ts`, `map/grid.ts`, `map/scene.ts` and `map/fog.ts`. **`map/scene.ts` must not import `combat/`** (that would
  pull the combat engine into the host chunk); builders that need `monsterCombatant` live in `map/store.ts`.
  `npm run size` ≤ 150 KB (about 53 KB now).
- **Players never receive** (spec 3.6, enforced in `sceneForPlayers`, tested by serializing and searching):
  - a hidden token, or (fog on) a token whose centre is in a fogged cell
  - a token's `monsterId`, `hp`, `maxHp`, `combatantId`, `hidden`, or any stat; a DM-only character's id (R13)
  - a scene that is not shown; the blob of anything not in the current `PlayerScene` (a hidden token's portrait)
- **Health words** are stage 4's `healthStatus`, with stage 4's gate for everything that is not an owned PC:
  `settings.showMonsterHealth && settings.initiativeModules.hp`. Owned PC tokens always carry theirs (the roster shows PC HP
  anyway).
- **Every incoming `move` is validated** (Task B1): shape; the scene is the shown one; the token exists, is visible to
  players, and is linked to a character this player owns in this campaign; it is that character's turn
  (`combat.round > 0` and the turn's combatant has that `characterId`) unless `settings.freeMovement`; the snapped target lies
  inside the scene.
- **Limits:**
  - `MAX_SIDE = 4096` (scene image longest side, after `resizeImage(file, 4096)`); portraits `resizeImage(file, 256)`
  - `MAX_TOKENS = 200` per scene
  - `MAX_BLOB = 8 * 1024 * 1024` bytes; `BLOB_CHUNK = 45_000` bytes per chunk (60 000 base64 chars, under `MAX_CHUNK`)
  - `IMAGE_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif']`
  - grid `size` 10–500 px; `feet` 1–100 (default 5); `opacity` 0–1; scene and token names ≤ 100 characters
  - `FOG_CELL = 16` px (Group C); `blobWant` ≤ 201 hashes
- **Copy (exact):**
  - nav `Map`; empty states "Open a campaign to use the map." and "The DM isn't showing a map right now."
  - `New scene`, `Show to players`, `Stop showing`, `Shown to players` (badge), `Add character token`, `Add monster token`
  - tools `Select`, `Box select`, `Ruler`, `Zoom in`, `Zoom out`, `Fit`; checkbox `Free movement`
  - player status "Your turn: drag your token.", "Wait for your turn to move.", "Free movement is on."
  - drag label `35 ft`, and past speed `35 ft · past speed 30 ft` (shown, never blocking)
  - Group C: `Fog`, `Brush`, `Rectangle`, `Reveal`, `Hide`, `Reveal all`, `Hide all`, `Template`, `Cone`, `Sphere / circle`,
    `Cube`, `Line`, `Cylinder`, `Clear template`, `Inside:`, `Add to combat`

## Review Focus

1. **A hidden token, a fogged token or a monster's numbers reaching a player** through a `scene` message, or a hidden
   token's portrait through `blobWant`. None may appear (Tasks B1, C2).
2. **A crafted or late `move`:** someone else's token, a hidden token's id, a monster token, `NaN`, off the map, a scene that
   is no longer shown, or a drag dropped just after the turn passed. Each is refused and the scene unchanged; the off-turn
   case is not a violation and snaps the player's token back (Task B1).
3. **A player's move and a DM edit at the same moment.** The DM page holds a copy of the scene; its writes go through
   `db.scenes.update` on the fresh record, so the move survives the DM renaming a token (Task A2).
4. **Moving a multi-selection partly off the map, or a Large token on a hex grid.** The whole move is refused if any token
   would leave the scene; even-sized square tokens stay on vertices, all hex tokens on hex centres (Task A1).
5. **A big scene on the wire:** 200 tokens with 100-character names and full fog stay under `MAX_MESSAGE`; a blob over
   `MAX_BLOB` is never streamed or stored; a chunk out of order or a hash mismatch stores nothing (Tasks B1, C2).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/types.ts` (modify) | `Grid`, `Token`, `Scene`. |
| `src/lib/map/grid.ts` (create) | Cells, centres, hex math, snapping, footprints, distances. |
| `src/lib/map/view.ts` (create) | Screen↔scene transform, zoom at a point, pinch, fit. |
| `src/lib/map/scene.ts` (create) | Scene and token operations, `DEFAULT_GRID`, `MAX_TOKENS`, `MAX_SIDE`, initials and colors. |
| `src/lib/map/store.ts` (create, lazy) | db-backed helpers: `editScene`, token builders that use `combat.ts`; Group C tracker links. |
| `src/lib/map/templates.ts`, `src/lib/map/fog.ts` (create, C) | Area templates; the fog bitset. |
| `src/lib/base64.ts` (create) | `toBase64`/`fromBase64`, moved out of `backup.ts`. |
| `src/lib/db.ts`, `recordShape.ts`, `backup.ts` (modify) | Version 4, `db.scenes`, `db.blobs.has`; `sceneProblem`; scenes in backups. |
| `src/lib/sync/scene.ts` (create) | `PlayerScene`, `sceneForPlayers`, `sceneBlobs`, `moveProblem`, `cleanScene`. |
| `src/lib/sync/code.ts` (modify) | `sha256Bytes`. |
| `src/lib/sync/protocol.ts`, `host.ts`, `guest.ts`, `session.svelte.ts` (modify) | `scene`, `move`, `blobWant`, `blobChunk`, wiring. |
| `src/ui/pages/Map.svelte` (create) | The `#/map` page: DM map, or player map. |
| `src/ui/map/MapCanvas.svelte` (create) | Shared canvas: draw, pan, zoom, pinch, drag, select, ruler (+ fog and template tools in C). |
| `src/ui/map/DmMap.svelte`, `TokenList.svelte`, `GridForm.svelte` (create) | Scenes, image import, grid settings, tokens. |
| `src/ui/map/PlayerMap.svelte` (create, B) | Players' live map. |
| `src/App.svelte`, `src/ui/pages/Campaigns.svelte` (modify) | Route and nav; links to Packs and About. |
| Tests | `tests/map/grid.test.ts`, `view.test.ts`, `scene.test.ts`, `storage.test.ts`, `templates.test.ts`, `fog.test.ts`, `links.test.ts`; `tests/sync/scene.test.ts`; `tests/sync/fakes.ts`. |

---

## Group A — Core map (Tasks A1–A3)

### Task A1: The map engine (grid, view, scene)

**Files:** modify `src/lib/types.ts`; create `src/lib/map/grid.ts`, `view.ts`, `scene.ts`; tests `tests/map/grid.test.ts`,
`view.test.ts`, `scene.test.ts`.

**Interfaces — Produces:**
```ts
// types.ts (append)
export interface Grid { type: 'square' | 'hex-flat' | 'hex-pointy'; size: number /* px between neighbouring cell centres */; offsetX: number; offsetY: number; color: string /* #rrggbb */; opacity: number; feet: number }
export interface Token { id: string; name: string; x: number; y: number /* centre, scene px */; size: Size; color: string; portrait?: string /* blob hash */; hidden?: boolean;
  characterId?: string; monsterId?: string; hp?: number; maxHp?: number /* monster instance state */; combatantId?: string /* C3: linked monster combatant */ }
export interface Scene { id: string; campaignId: string; name: string; image?: string /* blob hash */; width: number; height: number; grid: Grid; tokens: Token[]; fog?: string /* C */; shown?: boolean; updatedAt: number }

// map/grid.ts
export interface Pt { x: number; y: number }
export interface Cell { q: number; r: number }            // square: column, row; hex: axial
export const SIZE_CELLS: Record<Size, number> = { T: 0.5, S: 1, M: 1, L: 2, H: 3, G: 4 };
export function cellAt(g: Grid, p: Pt): Cell;
export function cellCenter(g: Grid, c: Cell): Pt;
export function cellsIn(g: Grid, x0: number, y0: number, x1: number, y1: number): Cell[]; // cells whose centre is in the box (drawing culls with it)
export function hexCorners(g: Grid, c: Cell): Pt[];       // 6 points, for drawing
export function cellDistance(g: Grid, a: Cell, b: Cell, diagonal: '5-5-5' | '5-10-5'): number; // in cells
export function feetBetween(g: Grid, a: Pt, b: Pt, diagonal: '5-5-5' | '5-10-5'): number;       // cellDistance(cellAt(a), cellAt(b)) × g.feet
export function snap(g: Grid, p: Pt, size: Size): Pt;
export function footprint(g: Grid, t: Pt & { size: Size }): Cell[];

// map/view.ts
export interface View { x: number; y: number; scale: number }  // screen = scene × scale + (x, y)
export const MIN_SCALE = 0.05, MAX_SCALE = 8;
export function toWorld(v: View, s: Pt): Pt; export function toScreen(v: View, w: Pt): Pt;
export function zoomAt(v: View, s: Pt, factor: number): View;   // the scene point under s stays under s; scale clamped
export function pinch(v: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View;
export function fit(w: number, h: number, vw: number, vh: number): View; // whole scene, centred

// map/scene.ts (pure; never imports combat/)
export const MAX_TOKENS = 200, MAX_SIDE = 4096, BLANK = { width: 1400, height: 1000 };
export const DEFAULT_GRID: Grid = { type: 'square', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.35, feet: 5 };
export type NewToken = Omit<Token, 'id' | 'x' | 'y' | 'color'> & Partial<Pick<Token, 'x' | 'y' | 'color'>>;
export function newScene(campaignId: string, name: string, image?: { hash: string; width: number; height: number }): Scene;
export function initials(name: string): string;
export function tokenColor(name: string): string;          // a fixed 8-color palette, by a string hash
export function freeSpot(s: Scene, near: Pt, size: Size): Pt | undefined; // nearest snapped spot (ring search) not overlapping another token's footprint
export function addTokens(s: Scene, list: NewToken[]): Scene; // each placed at its snapped x/y, else freeSpot(centre); stops at MAX_TOKENS
export function moveTokens(s: Scene, ids: string[], primary: string, to: Pt): Scene;
export function patchToken(s: Scene, id: string, patch: Partial<Token>): Scene;
export function removeTokens(s: Scene, ids: string[]): Scene;
export function tokenAt(s: Scene, p: Pt, dm: boolean): Token | undefined; // topmost (last) within its drawn radius; hidden ones only when dm
export function tokensInRect(s: Scene, a: Pt, b: Pt, dm: boolean): string[]; // centre inside the box
export function liveHp(t: Token, combat: Combat | undefined): { hp?: number; maxHp?: number; conditions: string[] }; // linked live combatant wins, else the token
```
- **Square:** cell `(q, r)` covers `[offsetX + q·size, +size) × [offsetY + r·size, +size)`; floor with `+1e-6` so exact
  vertices are stable.
- **Hex (axial, `size` = centre-to-centre distance = width across flats):**
  - pointy: `x = offsetX + size·(q + r/2)`, `y = offsetY + size·(√3/2)·r`
  - flat: `x = offsetX + size·(√3/2)·q`, `y = offsetY + size·(r + q/2)`
  - `cellAt` inverts and cube-rounds. Distance `(|dq| + |dr| + |dq + dr|) / 2`; the diagonal rule is ignored on hex.
- **Square distance:** `5-5-5` → `max(dx, dy)`; `5-10-5` → `max + floor(min / 2)` (every second diagonal costs double).
- **Snapping:** square tokens of an odd or fractional cell count (T, S, M, H) snap to the cell centre; even (L, G) to the
  nearest vertex. Every hex token snaps to a hex centre.
- **Footprint:** square → the `n×n` cells around the centre (T and S/M → the one cell); hex → hexes whose centre is within
  `n·size/2` of the token centre (`+1e-6`).
- **`moveTokens`:** the primary snaps to `to`; the others move by the same delta (lattice-preserving). If any moved token's
  centre leaves `[0, width] × [0, height]`, the scene is returned unchanged.
- **Drawn radius:** `SIZE_CELLS[size] · grid.size / 2` (all tokens are circles).

- [ ] **Step 1: Failing tests.**
  - `grid.test.ts`, `square cells and snapping` (size 50, offset 0 unless said):
    - `cellAt({x:75,y:20})` → `{q:1,r:0}`; `cellCenter({q:1,r:0})` → `{x:75,y:25}`
    - offset (10, 20): `cellAt({x:10,y:20})` → `{q:0,r:0}`; `cellAt({x:9,y:20})` → `{q:-1,r:0}`
    - `snap(g,{x:60,y:99},'M')` → `{x:75,y:75}`; `'L'` → `{x:50,y:100}`; `'T'` → `{x:75,y:75}`; `'H'` → `{x:75,y:75}`
  - `square distances`: (0,0)→(3,3): 5-5-5 → 15 ft, 5-10-5 → 20 ft; (2,2) 5-10-5 → 15; (1,1) → 5; (4,1) either → 20;
    (5,5) 5-10-5 → 35; feet 10, (3,3), 5-5-5 → 30. Also `feetBetween` from `{x:50,y:50}` to `{x:150,y:150}` (two L
    vertices, 5-5-5) → 10.
  - `hex cells`: pointy size 60 → `cellCenter({q:1,r:0})` `{x:60,y:0}`, `({q:0,r:1})` `{x:30, y:≈51.96}`; `cellAt({x:58,y:3})`
    → `{q:1,r:0}`; flat size 60 → `({q:1,r:0})` `{x:≈51.96,y:30}`, `({q:0,r:1})` `{x:0,y:60}`; every centre of
    `cellsIn(g,-200,-200,200,200)` maps back to its own cell.
  - `hex distances ignore the diagonal rule`: `{0,0}`→`{2,-1}` → 2 cells (10 ft) under both rules; `{0,0}`→`{3,0}` → 15 ft.
  - `footprints`: square 50: L at (50,50) → 4 cells `{0,0},{1,0},{0,1},{1,1}`; M at (75,75) → `[{1,1}]`; T → `[{1,1}]`;
    hex pointy 50: M → 1 cell, L → 7 cells.
  - `view.test.ts`: `zoomAt({x:0,y:0,scale:1},{x:100,y:100},2)` → `{x:-100,y:-100,scale:2}`; factor 1000 → scale 8, factor
    0.0001 → 0.05; `pinch(identity, (0,0),(100,0), (0,0),(200,0))` → `{x:0,y:0,scale:2}`; pinch moving both fingers +50 x at
    the same spread → `{x:50,y:0,scale:1}`; `fit(2000,1000,400,800)` → `{x:0,y:300,scale:0.2}`; `toWorld(toScreen(v,p))` ≈ p.
  - `scene.test.ts`:
    - `initials`: 'Goblin 1' → 'G1', 'Thorin Oakenshield' → 'TO', 'ogre' → 'O', '' → '?'
    - `newScene` blank → 1400×1000, `DEFAULT_GRID`, no image, `tokens []`
    - `addTokens` of three M tokens without x/y on an empty scene → three distinct snapped centres, none overlapping; 250 →
      200 (`MAX_TOKENS`)
    - `moveTokens` (**Review Focus 4**): two M tokens at (35,35) and (105,35), primary the first, to (180,40) → (175,35)
      and (245,35); the same group to (1390, 40) (the second would leave the 1400 px scene) → unchanged; a hex L token moved
      lands on a hex centre
    - `tokenAt` returns the topmost of two overlapping tokens; a hidden token only with `dm` true
    - `tokensInRect` from (0,0) to (100,100) → the ids whose centres are inside
    - `liveHp`: token `{hp 7, maxHp 7, combatantId 'g1'}` with a combat holding `g1` at hp 3, conditions ['Prone'] →
      `{hp 3, maxHp 7, conditions ['Prone']}`; without the combat → `{hp 7, maxHp 7, conditions []}`
- [ ] **Steps 2–4:** run `npx vitest run tests/map` → FAIL; implement; → PASS.
- [ ] **Step 5: Commit** `feat: battle map engine (grids, distances, snapping, view, tokens)`.

### Task A2: Scenes in storage and backups

**Files:**
- Modify: `src/lib/db.ts`, `src/lib/recordShape.ts`, `src/lib/backup.ts`
- Create: `src/lib/base64.ts`, `src/lib/map/store.ts`
- Test: `tests/map/storage.test.ts`

**Interfaces — Consumes:** A1's types and `scene.ts`. **Produces:**
```ts
// db.ts
// open(): version 4; `if (oldVersion < 4) d.createObjectStore('scenes', { keyPath: 'id' }).createIndex('campaignId', 'campaignId')`
type ChangeKind = 'character' | 'campaign' | 'combat' | 'scene';   // 'scene' carries the campaign id
db.scenes: {
  list(cid: string): Promise<Scene[]>; get(id: string): Promise<Scene | undefined>; shown(cid: string): Promise<Scene | undefined>;
  put(s: Scene): Promise<void>;
  /** One transaction: fn gets the stored scene. Returning it unchanged writes nothing. `network` writes are not reported. */
  update(id: string, fn: (s: Scene) => Scene, o?: { network?: boolean }): Promise<Scene | undefined>;
  delete(id: string): Promise<void>;
  /** One transaction: `shown: true` on that scene (undefined = none), removed from the campaign's others. */
  show(cid: string, id: string | undefined): Promise<void>;
}
db.blobs.has(hash: string): Promise<boolean>;
// Snapshot gains `scenes?: Scene[]`; recordShape: export function sceneProblem(r: unknown): string | undefined
// base64.ts
export function toBase64(b: ArrayBuffer | Uint8Array): string; export function fromBase64(s: string): Uint8Array;
// map/store.ts (lazy; db + combat.ts)
export function editScene(id: string, fn: (s: Scene) => Scene): Promise<Scene | undefined>; // = db.scenes.update, stamps updatedAt
export function tokenForMonster(m: MonsterDef, name: string, hpMode: 'average' | 'roll', rng?: () => number): NewToken; // size m.size[0], hp/maxHp from monsterCombatant
export function tokenForCharacter(c: Character, size: Size): NewToken;  // name, characterId, portrait = details.portrait
```
- **Change reports:** `put`, `update` (not `network`), `delete` and `show` report `('scene', campaignId)` only when the scene
  was or becomes shown. Prep edits on other scenes stay quiet (no needless broadcasts).
- `db.campaigns.delete` adds `scenes` to its transaction and deletes the campaign's scenes by index. Blobs stay (shared by
  hash, as today).
- **Backups:** campaign and full exports carry the campaigns' scenes; `readBackup` validates with `sceneProblem`; `scenes`
  absent in old files means none; `BackupCounts` and `countReplaced` include scenes. `sceneProblem`: `id`, `campaignId`,
  `name` strings; `width`/`height` integers 1–4096; grid `type` one of three, `size` 10–500, finite offsets, `color`
  `/^#[0-9a-f]{6}$/i`, `opacity` 0–1, `feet` 1–100; `tokens` an array ≤ 200 of `{id, name: string, x, y: finite, size: a Size,
  color: string}`; `fog` undefined or a string.
- `backup.ts` imports `toBase64`/`fromBase64` from `base64.ts` (same behaviour, Uint8Array-friendly).

- [ ] **Step 1: Failing tests** (fake-indexeddb, `beforeEach(resetDb)`):
  - `a version 3 database upgrades to version 4 keeping its encounters, with an empty scenes store` (build v3 with `openDB`
    as stage 4's v2→v3 test does).
  - `scenes are per campaign, and only one is shown`: two scenes in c1, one in c2; `show('c1', a)` then `show('c1', b)` →
    `shown('c1')` is b, a has no `shown`; `show('c1', undefined)` → none; c2 untouched.
  - `only shown-scene writes are reported`: editing an unshown scene reports nothing; editing the shown one reports
    `('scene','c1')`; a `network` update reports nothing.
  - `a network move and a DM edit both survive` (**Review Focus 3**): a page holds scene S; `update(S.id, move token t1,
    {network:true})`; then `editScene(S.id, s => patchToken(s, 't2', {name:'Boss'}))` → stored t1 at the new spot and t2
    named Boss.
  - `deleting a campaign removes its scenes`.
  - `backups carry scenes`: export c1 → restore into an empty db → the scene and its tokens are back; an old backup without
    `scenes` restores; a scene with `width: 5000` → damaged.
  - `base64 round-trips 70 000 random bytes`.
  - `tokenForMonster`: SRD goblin, average → `{ name: 'Goblin 1', size: 'S', monsterId: 'monster:goblin@SRD', hp: 7, maxHp: 7 }`
    (called with name 'Goblin 1').
- [ ] **Steps 2–4:** FAIL → implement → PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat: store battle map scenes per campaign`.

### Task A3: The DM's map page

**Files:**
- Create: `src/ui/pages/Map.svelte`, `src/ui/map/MapCanvas.svelte`, `src/ui/map/DmMap.svelte`, `src/ui/map/TokenList.svelte`,
  `src/ui/map/GridForm.svelte`
- Modify: `src/App.svelte`, `src/ui/pages/Campaigns.svelte`

**Interfaces — Consumes:** A1, A2; `resizeImage` (`images.ts`); `filterMonsters`, `SIZE_NAMES` (`monsters/library.ts`);
`numberedNames` (`combat/combat.ts`); `computeSheet`; `getIndex`, `saveCampaign`, `app` (`store.svelte.ts`); `session.rev`.
**Produces** (B and C reuse it):
```ts
// MapCanvas.svelte props
{ width: number; height: number; image?: string; grid: Grid;
  tokens: (Pick<Token, 'id' | 'name' | 'x' | 'y' | 'size' | 'color' | 'portrait' | 'hidden'> & { hp?: number; maxHp?: number; conditions?: string[]; health?: string })[];
  dm: boolean; diagonal: '5-5-5' | '5-10-5'; selected: string[];
  canDrag: (id: string) => boolean; speedOf?: (id: string) => number | undefined;
  onselect: (ids: string[]) => void; onmove: (ids: string[], primary: string, to: Pt) => void;
  rev?: number /* bump to reload images from the db */ }
```
- **Route and nav:** see the merge table. The page:
  - no campaign → "Open a campaign to use the map."
  - a joined campaign or Player view → `PlayerMap` (Task B2; until then "The DM isn't showing a map right now.")
  - otherwise `DmMap`. `?scene=<id>` picks the scene (a query change keeps the page mounted).
  - Bottom bar below 768 px: `Packs` and `About` get `class="wide-only"` (hidden), and Campaigns gets plain links to both.
    The DM's bar then holds 8 labels, as today; the 375 px check must show no horizontal scroll.
- **`MapCanvas`:**
  - One `<canvas aria-label="Battle map">` with `touch-action: none`, sized by a `ResizeObserver`, device pixel ratio capped
    at 2. A `schedule()` sets a dirty flag and requests one frame; no loop.
  - Draw order: background (the image from `db.blobs.get` → `createImageBitmap`, cached by hash; a plain fill without one),
    grid (only `cellsIn` the visible box; skipped when a cell is under 6 screen px), tokens (portrait clipped to a circle
    from a per-hash bitmap cache, else the color circle with `initials`), selection rings, then the HP bar and condition
    badges (first two letters) for selected or hovered tokens when `dm`. Hidden tokens at 40 % alpha with a dashed ring.
  - **Input (pointer events):** two pointers → `pinch`; wheel → `zoomAt` (factor `1.1` per notch); one pointer on a token
    that `canDrag` → drag (after a 4 px threshold), with a snapped ghost and the label `feetBetween(start, ghost)` as `35 ft`,
    or `35 ft · past speed 30 ft` when `speedOf` says so; drop → `onmove` (a single write per drop). One pointer on empty
    space → pan, or a box in `Box select` mode (Shift+drag with a mouse) → `onselect(tokensInRect)`. A tap selects; Shift or
    Ctrl toggles.
  - Toolbar buttons with `aria-pressed`: `Select`, `Box select`, `Ruler` (drag measures `feetBetween` with the campaign's
    diagonal rule; cleared by the next tap), `Zoom in`, `Zoom out`, `Fit`.
- **`DmMap`:**
  - Scene list: select, `New scene` (name, optional image: `resizeImage(file, 4096)`, refused with a message above `MAX_BLOB`
    = 8 MiB; `createImageBitmap` for width and height; `db.blobs.put`), Rename, Delete (confirm), and `Show to players` /
    `Stop showing` (`db.scenes.show`) with a `Shown to players` badge. A scene's image is fixed at creation (make a new scene
    for a new image).
  - `GridForm`: type select (Square, Hex (flat top), Hex (pointy top)), cell size, X offset, Y offset, color
    (`<input type="color">`), opacity (range 0–1), feet per cell. Each change → `editScene`.
  - `Add character token`: a select of the campaign's characters → `tokenForCharacter` with the race's size from the index
    (`M` when unknown). `Add monster token`: a search over the campaign's monsters plus `index.all('monster')` through
    `filterMonsters` (first 20), a count 1–20, names from `numberedNames(name, count, token names on the scene)`, HP mode
    `settings.monsterHp` → `tokenForMonster`.
  - `TokenList`: per token: name input (maxlength 100; renaming masks a monster from players), `Hidden from players`
    checkbox, size select, `Portrait` file (`resizeImage(file, 256)`), HP and max HP for monster tokens, Remove. `Remove
    selected` for the selection.
  - Moves: `onmove` → `editScene(id, s => moveTokens(...))`. `speedOf`: PC → `computeSheet(c, {settings, viewer:'dm'}).speed.walk`;
    monster → `speed.walk`. Every write reads fresh (A2); the page re-reads the scene on `session.rev` and after each write.
  - `canDrag` = always true for the DM.
- [ ] **Steps:** implement → `npx vitest run` → `npm run check` → `npm run build` → `npm run size` (≤ 150 KB; the map is its
  own chunk) → quick browser look at `http://localhost:5174/dnd-app/#/map`: new scene with an image, hex grid lined up, a
  Large monster token and a PC token, pinch emulated or wheel zoom, box select and move two tokens, ruler shows 15 ft for three
  cells → commit `feat: battle map page for the DM (scenes, grids, tokens, ruler)`.

---

## Group B — Live map (Tasks B1–B2)

### Task B1: The player scene, moves and image transfer

**Files:**
- Create: `src/lib/sync/scene.ts`
- Modify: `src/lib/sync/protocol.ts`, `host.ts`, `guest.ts`, `session.svelte.ts`, `code.ts`; `tests/sync/fakes.ts` (`scene?:
  Scene` and `blobs: Map<string, {type, data}>` on `Device`, with the deps below)
- Test: `tests/sync/scene.test.ts`, plus one test in `tests/sync/session.test.ts`

**Interfaces — Consumes:** A1–A2; stage 4's `healthStatus`, `Combat`, `HostDeps.loadCombat`. **Produces:**
```ts
// sync/scene.ts (pure)
export interface PlayerToken { id: string; name: string; x: number; y: number; size: Size; color: string; portrait?: string; characterId?: string; conditions: string[]; health?: HealthStatus }
export interface PlayerScene { id: string; name: string; image?: string; width: number; height: number; grid: Grid; fog?: string /* C */; tokens: PlayerToken[] }
export function sceneForPlayers(s: Scene | undefined, characters: Character[], combat: Combat | undefined, settings: CampaignSettings): PlayerScene | undefined;
export function sceneBlobs(v: PlayerScene | undefined): string[];  // image + visible portraits, unique
export function moveProblem(s: Scene | undefined, m: { sceneId: string; tokenId: string; x: number; y: number }, playerId: string,
  characters: Character[], combat: Combat | undefined, settings: CampaignSettings): { error: string; violation: boolean } | undefined;
export function cleanScene(v: unknown): PlayerScene | undefined;
// code.ts
export function sha256Bytes(b: ArrayBuffer | Uint8Array): Promise<string>;
// protocol.ts
export const MAX_BLOB = 8 * 1024 * 1024, BLOB_CHUNK = 45_000, IMAGE_TYPES: readonly string[] = ['image/webp', 'image/png', 'image/jpeg', 'image/gif'];
export const HASH = /^[0-9a-f]{64}$/;
GuestMsg |= { t: 'move'; sceneId: string; tokenId: string; x: number; y: number } | { t: 'blobWant'; hashes: string[] };
HostMsg  |= { t: 'scene'; scene: PlayerScene | null } | { t: 'blobChunk'; hash: string; type: string; size: number; seq: number; total: number; data: string /* base64 */ };
// host.ts
HostDeps.loadScene?(): Promise<Scene | undefined>;                                   // db.scenes.shown(cid)
HostDeps.updateScene?(id: string, fn: (s: Scene) => Scene): Promise<Scene | undefined>; // network write (not reported)
HostDeps.loadBlob?(hash: string): Promise<{ type: string; data: ArrayBuffer } | undefined>;
Host.sceneChanged(): void;
// guest.ts
GuestDeps.onScene?(s: PlayerScene | undefined): void;
GuestDeps.hasBlob?(hash: string): Promise<boolean>;
GuestDeps.saveBlob?(type: string, data: Uint8Array): Promise<void>;
Guest.sendMove(sceneId: string, tokenId: string, to: Pt): void;
// session.svelte.ts
session.scene: PlayerScene | undefined;            // player: as the DM last sent it; cleared by stopSession
export function sendMove(sceneId: string, tokenId: string, to: Pt): void;
```
- **`sceneForPlayers`** (an allowlist; undefined without a scene or when it is not `shown`):
  - skips `hidden` tokens (and, Group C, fogged ones)
  - every token: `{id, name, x, y, size, color, portrait?, conditions}`; `portrait` = `token.portrait ?? character.details.portrait`
  - owned PC (character with `ownerId`): `characterId`, conditions from `state.conditions`, `health` from
    `healthStatus(state.hp, computeSheet(c, {settings, viewer:'player'}).maxHp)`, always
  - anything else (monsters, a DM-only character, R13): no `characterId`; conditions and HP from `liveHp(token, combat)`
    (a DM-only character: its `state`); `health` only under stage 4's gate
- **`moveProblem`**, checked in this order:
  1. scene missing, not shown, or `sceneId` differs → `{error:'not the shown scene', violation:false}`
  2. token missing or hidden → `{'no such token', false}` (it may have just been hidden)
  3. token without `characterId`, or that character's `ownerId !== playerId` or other campaign → `{'not their token', true}`
  4. not `freeMovement`, and not (`combat.round > 0` and the turn's combatant's `characterId` is the token's) →
     `{'not your turn', false}`
  5. `snap(target)` outside the scene → `{'off the map', false}`
- **Protocol parse:** `move`: `sceneId`/`tokenId` strings ≤ 100, `x`/`y` finite in `[0, MAX_SIDE]`. `blobWant`: an array of
  1–201 strings matching `HASH`.
- **Host:**
  - `#scene(camp)` = `sceneForPlayers(await loadScene(), campaign characters, await loadCombat?.(), camp.settings)`;
    `#sendScene(camp)` broadcasts `{t:'scene', scene: view ?? null}` to admitted links.
  - Sent after each welcome (after the tracker), on `sceneChanged()`, in `trackerChanged()` and `campaignChanged()`, and
    beside each stage 4 `#trackerIfFighting(camp, ids)` call through a new `#sceneIfLinked(camp, ids)` (re-sends when the
    shown scene has a token whose `characterId` is in `ids`).
  - `#move`: `moveProblem`; a violation → `#violation`; any other error → re-send the current scene to that link only (snaps
    the player's token back); ok → `updateScene(id, s => moveTokens(s, [tokenId], tokenId, {x, y}))`, then `#sendScene`.
  - `#blobWant`: every hash must be in `sceneBlobs(await #scene(camp))`, and not streamed on this link before (a per-link
    `blobs` set) → else `#violation('a blob that was not offered')`. Each is streamed on the link's existing `packs` chain:
    `loadBlob`; skipped when missing, over `MAX_BLOB`, or its type is not in `IMAGE_TYPES`; `ceil(size / BLOB_CHUNK)` chunks
    (at least 1), each after `#drained(c)`, `data` = `toBase64(slice)`.
- **Guest:**
  - `scene` → `onScene(m.scene === null ? undefined : cleanScene(m.scene))`; then, for `sceneBlobs` it lacks (`hasBlob`) and
    has not asked for on this link (a set reset on `connect`), one `blobWant`.
  - `blobChunk`: one blob at a time, chunks in order (as `#packChunk`): the hash was asked for, `type` in `IMAGE_TYPES`,
    `size` ≤ `MAX_BLOB`, bytes so far ≤ `size`; at the end `sha256Bytes(bytes) === hash` → `saveBlob(type, bytes)`; anything
    else discards that blob.
  - `cleanScene`: `id` ≤ 100, `name` ≤ 200, `width`/`height` integers 1–4096, the grid as `sceneProblem` checks it (bad →
    undefined scene); `image` kept only when it matches `HASH`; at most 200 tokens, a token dropped without string `id`/`name`
    or finite `x`/`y` or a valid `size`; `color` must match `/^#[0-9a-f]{6}$/i` else `'#888888'`; a bad `portrait`,
    `characterId` or `health` omitted; `conditions` strings ≤ 40, at most 20.
  - `sendMove` sends only while online, for a token whose `characterId` is a local character this player owns in this campaign.
- **Session:** `loadScene = () => db.scenes.shown(cid)`; `updateScene = (id, fn) => db.scenes.update(id, fn, {network:true}).then((s) => (changed(r), s))`;
  `loadBlob` reads `db.blobs.get` → `{type, data: await b.arrayBuffer()}`; `onLocalChange` kind `'scene'` for the hosted
  campaign → `r.host?.sceneChanged()`; guest `onScene` sets `session.scene`; `hasBlob = db.blobs.has`; `saveBlob = (type, d) =>
  save(db.blobs.put(new Blob([d], {type})))`.

- [ ] **Step 1: Failing tests** (`tests/sync/scene.test.ts`; Thorin is A1's character from `tests/sync/tracker.test.ts`):
  - `sceneForPlayers sends only the allowlist` (**Review Focus 1**). A shown scene holds Thorin's token; goblin
    `{name 'Goblin 1', monsterId 'monster:goblin@SRD', hp 3, maxHp 7}`; a hidden `Assassin`; `Shadowy figure` with monsterId
    `monster:lich@SRD`; a DM-only character `Spy`'s token:
    - names in order: Thorin, Goblin 1, Shadowy figure, Spy
    - goblin keys `['color','conditions','health','id','name','size','x','y']`, `health 'Bloodied'`
    - Thorin has `characterId`; Spy has none
    - `JSON.stringify(view)` contains none of `Assassin`, `monster:`, `lich`, `"hp"`, `maxHp`, `combatantId`, `hidden`
  - `health follows stage 4's gate`: `showMonsterHealth` false → goblin has no `health`, Thorin still has; `initiativeModules.hp`
    false → the same.
  - `live state comes from the combat or the character`: goblin linked to combatant `g1` at hp 0 with ['Prone'] →
    `health 'Down'`, `conditions ['Prone']`; Thorin with `state.conditions ['Poisoned']` → his token's conditions.
  - `an unshown scene sends nothing`: `shown` false → undefined; `sceneForPlayers(undefined, …)` → undefined.
  - `sceneBlobs`: image `a…a` and portraits on Thorin and the hidden Assassin → `[image, thorin's]` only.
  - `moveProblem` (**Review Focus 2**), with a started combat whose turn is `pc:<Thorin>`:
    - A1, Thorin, in bounds → undefined
    - the turn on the goblin → `{error:'not your turn', violation:false}`; the same with `freeMovement` → undefined
    - no combat, or round 0 → `'not your turn'`
    - A2 moving Thorin → `{'not their token', true}`; A1 moving the goblin → `{'not their token', true}`
    - the Assassin's id → `'no such token'`; another scene id → `'not the shown scene'`; x 5000 → `'off the map'`
  - `cleanScene`: a token `{id: 5}` dropped; `health 'Wounded'` omitted; grid type `'triangle'` → undefined; 300 tokens → 200;
    `image 'abc'` → no image; `x NaN` → token dropped.
  - `a full scene fits in one message` (**Review Focus 5**): 200 tokens with 100-character names → `size({t:'scene', scene})`
    < `MAX_MESSAGE`.
  - Engine, with `Device` fakes and `memoryPair`:
    - the DM shows a scene → `host.sceneChanged()` → A1's `onScene` gets it; a player joining later gets it after its welcome
    - A1 sends `move` for Thorin on his turn → the DM's scene has Thorin at the snapped spot, and A1 and A2 receive the new scene
    - off-turn → the DM's scene unchanged, A1 receives the scene again, and no violation is counted
    - A2 moving Thorin → unchanged, one violation
    - the parse refuses `x: '5'`, `x: Infinity`, a 101-character `tokenId`
  - `images reach players` (**Review Focus 1, 5**): the DM device holds a 300 000-byte `image/webp` blob as the scene image →
    after `idle()`, A1's device holds it under the same hash (several chunks); a `blobWant` for the hidden Assassin's portrait
    → a violation and no chunk; a blob of `MAX_BLOB + 1` bytes → never streamed; a chunk with flipped bytes → not stored.
  - `session.test.ts`, `the shown scene reaches the player, and the player's move lands`: with the fake transport and
    `freeMovement` on, the DM hosts with a shown scene holding A1's token → the player's `session.scene.tokens` has it;
    `sendMove(...)` → `db.scenes.get` on the DM side shows the snapped position.
- [ ] **Steps 2–4:** FAIL → implement → PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat: send players the shown scene, take their token moves, and share its images`.

### Task B2: The players' map tab

**Files:** create `src/ui/map/PlayerMap.svelte`; modify `src/ui/pages/Map.svelte`, `src/ui/map/DmMap.svelte`.

**Interfaces — Consumes:** `MapCanvas` (A3); `session.scene`, `session.tracker`, `sendMove` (B1, stage 4); `currentActor`;
`sceneForPlayers` (B1); `computeSheet`; `saveCampaign`.
- **Source of the view:** a joined campaign → `session.scene`. The DM's device in Player view → `sceneForPlayers(shown
  scene, characters, combat, settings)` built locally (R12), read-only (`canDrag` false).
- **No scene** → "The DM isn't showing a map right now."
- **Dragging** (joined only): `canDrag(id)` = the token's `characterId` is a local character with `ownerId ===
  sync.playerId`, and (`settings.freeMovement` or `currentActor(session.tracker) === characterId`).
  - Drop → the token moves locally at once (optimistic), then `sendMove`. The next `scene` message replaces it (a refusal
    snaps it back).
  - `speedOf` = the player's own `computeSheet(c, {settings, viewer:'player'}).speed.walk`, so the label warns past speed
    without blocking.
- **Status line** (polite live region) when the player owns a token on the scene: "Free movement is on." / "Your turn: drag
  your token." / "Wait for your turn to move."
- Images: `rev = session.rev`, so a blob that just arrived is drawn.
- **DM:** a `Free movement` checkbox in the `DmMap` toolbar writes `settings.freeMovement` through `saveCampaign` (the same
  field the Settings page edits).
- [ ] **Steps:** implement → `npm run check`, `npm run build`, `npm run size` → two-tab smoke test (DM
  `http://localhost:5174/dnd-app/`, player `http://127.0.0.1:5174/dnd-app/`): the shown scene and its image appear for the
  player; the player drags their token on their turn and the DM sees it; off-turn the token will not drag → commit
  `feat: players' live map tab with turn-gated movement`.

---

## Group C — Templates, fog and tracker links (Tasks C1–C3)

### Task C1: Templates and fog engines

**Files:** create `src/lib/map/templates.ts`, `src/lib/map/fog.ts`; tests `tests/map/templates.test.ts`, `tests/map/fog.test.ts`.

**Interfaces — Produces:**
```ts
// map/templates.ts
export type Shape = 'cone' | 'sphere' | 'cube' | 'line' | 'cylinder';
export interface Template { shape: Shape; origin: Pt; aim: Pt /* direction point */; feet: number /* length, radius or side */; width?: number /* line, ft, default 5 */ }
export function inTemplate(t: Template, g: Grid, p: Pt): boolean;
export function affectedCells(t: Template, g: Grid, w: number, h: number): Cell[];   // cells (inside the scene) whose centre is inside
export function tokensInTemplate(t: Template, g: Grid, tokens: Token[]): string[];  // any footprint cell affected
// map/fog.ts  (bit = 1: revealed; a missing fog string = all fogged)
export const FOG_CELL = 16;
export function fogSize(w: number, h: number): { cols: number; rows: number };     // ceil(w/16), ceil(h/16)
export function newFog(w: number, h: number, revealed: boolean): Uint8Array;
export function paintRect(f: Uint8Array, w: number, h: number, a: Pt, b: Pt, reveal: boolean): Uint8Array;   // fog cells whose centre is in the box
export function paintBrush(f: Uint8Array, w: number, h: number, c: Pt, radius: number, reveal: boolean): Uint8Array;
export function isRevealed(f: Uint8Array | undefined, w: number, h: number, p: Pt): boolean;
export const encodeFog = (f: Uint8Array): string => toBase64(f), decodeFog = (s: string, w: number, h: number): Uint8Array | undefined; // wrong length → undefined
```
- `pxPerFoot = g.size / g.feet`. With `u` the unit vector origin→aim, `t = (p − origin)·u`, `d` = the perpendicular distance:
  - cone: `0 < t ≤ L` and `d ≤ t / 2` (width equals the distance from the origin)
  - sphere and cylinder: `|p − origin| ≤ R` (origin = centre)
  - cube: `0 ≤ t ≤ S` and `d ≤ S / 2` (origin = the middle of one face)
  - line: `0 ≤ t ≤ L` and `d ≤ width / 2`
  - a 1e-6 tolerance on each bound. Cell-centre test (spec 3.8 allows it). Aim = origin → direction `+x`.
- Bit `i = row·cols + col`, byte `i >> 3`, bit `i & 7`. The paint functions return a new array.

- [ ] **Step 1: Failing tests** (square grid size 50, feet 5 → 10 px per foot):
  - `sphere`: 10 ft at (250,250) → `affectedCells` has 12 cells; the same on hex pointy size 50 around a hex centre, 5 ft →
    7 cells
  - `cone` 30 ft from (0,0) aiming (1,0): (200,90) in, (200,110) out, (310,0) out, (−10,0) out; aiming (0,1): (90,200) in
  - `line` 30 ft: (150,24) in, (150,26) out, (301,0) out; width 10: (150,49) in
  - `cube` 10 ft: (50,49) in, (50,51) out, (101,0) out
  - `cylinder` 10 ft: a point 99 px away in, 101 px out
  - `tokensInTemplate`: goblin M at (75,75), ogre L at (200,200); sphere 10 ft at (250,250) → `['ogre']`
  - `fog`: `fogSize(100,40)` → `{cols:7, rows:3}`; `newFog(100,40,false)` → (5,5) fogged; `paintRect` reveal (0,0)–(32,16)
    → (5,5) and (20,5) revealed, (40,5) and (5,20) fogged; `paintBrush` reveal at (50,20) r 10 → (52,20) revealed, (44,20)
    fogged; hiding again → (52,20) fogged; `isRevealed(undefined, …)` → false; `decodeFog(encodeFog(f))` equals f; a 4096×4096
    fog encodes to 10 924 characters; a wrong-length string decodes to undefined
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: area templates and fog of war engines`.

### Task C2: Fog and templates on the map, and fog for players

**Files:** modify `src/lib/sync/scene.ts`, `src/ui/map/MapCanvas.svelte`, `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte`;
test additions in `tests/sync/scene.test.ts`.

**Interfaces — Consumes:** C1; `Scene.fog`; `settings.fog`. **Produces:** `MapCanvas` gains props `fog?: string` and
`fogStyle?: 'black' | 'shade'`, and `onfog?: (a: Pt, b: Pt | number, reveal: boolean) => void` (rect, or brush radius).
- **Projection:** with `settings.fog` on, `sceneForPlayers` drops tokens whose centre `!isRevealed(...)`, and sets
  `fog = scene.fog ?? encodeFog(newFog(w, h, false))`. Off → no `fog` field and every visible token. `cleanScene` keeps
  `fog` only when `decodeFog` accepts it, and otherwise (a `fog` that was present but bad) uses the all-fogged encoding.
- **Drawing:** fog is drawn from a `cols×rows` offscreen canvas (one pixel per fog cell, rebuilt only when the fog string
  changes), scaled up with smoothing off: black (`#000`, opaque) for players, `rgba(0,0,0,0.5)` for the DM. It is drawn only
  when `settings.fog` is on.
- **DM fog tools** (shown when `settings.fog`): a `Fog` group with `Brush` (radius range 16–256 px) and `Rectangle`, a
  `Reveal`/`Hide` toggle, `Reveal all` and `Hide all` (confirm). Each stroke or rectangle is one `editScene` on pointer up
  (`paintBrush` per pointer-move sample, applied to the fresh record) — never a write per move.
- **Templates (DM and players; local to the device, not synced):** `Template` tool: a shape select (`Cone`, `Sphere /
  circle`, `Cube`, `Line`, `Cylinder`), size in ft (default 20; line width 5), drag origin → aim. The affected cells are
  tinted, a list `Inside: Goblin 1, Thorin` names the visible tokens inside, and `Clear template` removes it.
- [ ] **Step 1: Failing tests** (**Review Focus 1**):
  - `fogged tokens never reach players`: fog on, fog revealed only around Thorin → the goblin is absent and `fog` is set;
    fog off → the goblin present, no `fog`.
  - `a scene with fog and no fog string is all black`: `fog` equals the all-fogged encoding; every non-revealed token is absent.
  - `cleanScene` with a wrong-length fog → the all-fogged encoding.
  - `full fog still fits`: 200 tokens with 100-character names on a 4096×4096 scene with full fog → under `MAX_MESSAGE`.
  - `sceneBlobs` skips a fogged token's portrait.
- [ ] **Steps 2–4:** FAIL → implement → PASS. Then `npm run check`, `npm run build`, `npm run size`.
- [ ] **Step 5: Commit** `feat: fog of war and area templates on the battle map`.

### Task C3: Tracker links (deferred from stage 4)

**Files:**
- Modify: `src/lib/map/scene.ts`, `src/lib/map/store.ts`, `src/ui/map/DmMap.svelte`; after merging stage 4's Task 4:
  `src/ui/initiative/Encounters.svelte` (Start), `src/ui/initiative/Tracker.svelte` (End combat)
- Test: `tests/map/links.test.ts`

**Interfaces — Consumes:** stage 4's `addCombatants`, `pcCombatant`, `monsterCombatant`, `updateCombat`, `db.combat`.
**Produces:**
```ts
// map/scene.ts (pure)
export function tokensFromCombat(s: Scene, c: Combat | undefined): Scene; // linked monster tokens take the combatant's hp/maxHp; links to missing combatants dropped
// map/store.ts
export function combatantsFromTokens(s: Scene, ids: string[], c: Combat, chars: Character[], sheetOf: (c: Character) => Sheet,
  lookup: (id: string) => MonsterDef | undefined, hpMode: 'average' | 'roll', rng?: () => number): { combat: Combat; scene: Scene; missing: string[] }; // pure
export function addTokensToCombat(cid: string, sceneId: string, ids: string[], o: { chars: Character[]; sheetOf: (c: Character) => Sheet; lookup: (id: string) => MonsterDef | undefined; settings: CampaignSettings }): Promise<{ missing: string[] }>;
export function placeCombatants(cid: string, added: Combatant[], lookup: (id: string) => MonsterDef | undefined): Promise<number>; // tokens placed
export function endCombatWriteBack(cid: string): Promise<void>;  // every scene of the campaign: tokensFromCombat(scene, current combat)
```
- **`combatantsFromTokens`:**
  - A PC token → `pcCombatant(char, sheetOf(char))` (id `pc:<characterId>`; `addCombatants` skips one already in).
  - A monster token already linked to a live combatant → skipped.
  - Otherwise `monsterCombatant(lookup(monsterId), token.name, hpMode, rng)`, with the token's `hp`/`maxHp` when set and
    `hidden` copied from the token; the token gets `combatantId`. A monster `lookup` cannot find → its token name in `missing`.
- **While linked**, the map shows and edits the combatant's HP (`liveHp`); `TokenList` HP edits on a linked token go through
  `updateCombat(cid, c => patchCombatant(...))`, so there is one authority.
- **`placeCombatants`:** the target scene is the shown one, else the most recently updated; none → 0 (the caller toasts "No
  scene to place tokens on."). One token per monster combatant without a linked token: name = combatant name, size =
  `lookup(monsterId)?.size[0] ?? 'M'`, `hp`/`maxHp`/`hidden` from the combatant, `combatantId`, at `freeSpot` near the scene
  centre.
- **UI:**
  - `DmMap`: `Add to combat` for the selection → `addTokensToCombat`; a toast names `missing`.
  - Stage 4 `Encounters.svelte` Start: after `addMonsters`, `void import('../../lib/map/store.ts').then((m) =>
    m.placeCombatants(cid, added, lookup))`, where `added` = combatants whose ids were not in the combat before.
  - Stage 4 `Tracker.svelte` End combat: `await (await import('../../lib/map/store.ts')).endCombatWriteBack(cid)` before
    the combat is ended.
  - If stage 4's Task 4 is not in this branch yet, these two hooks go in at the final merge (checklist above).
- [ ] **Step 1: Failing tests** (`tests/map/links.test.ts`; SRD goblin; `half` rng):
  - `tokens join the fight`: a scene with Thorin's token and two goblin tokens (one at hp 4/7, one hidden) → the combat gains
    `pc:<Thorin>` and two monsters; the first has `hp 4`, `maxHp 7`; the hidden token's combatant is `hidden`; both goblin
    tokens now carry their combatant ids. Running it again adds nothing.
  - `a deleted monster is reported`: a token named 'Gone 1' with `monsterId 'monster:gone@X'` → `missing ['Gone 1']`, and the
    combat is unchanged.
  - `the fight's damage stays on the tokens`: `tokensFromCombat` with the linked goblin's combatant at hp 1 → token hp 1;
    with the combatant removed → the token keeps its hp and loses `combatantId`.
  - `an encounter's monsters are placed` (fake-indexeddb): a shown scene and 3 goblin combatants → `placeCombatants` returns
    3, three tokens with distinct snapped spots linked by `combatantId`; called again → 0; no scenes → 0.
- [ ] **Steps 2–4:** FAIL → implement → PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat: add combatants from tokens and place encounter tokens on the map`.

---

## Task D: Browser check and release (controller)

- [ ] Whole-branch review of stage 5 (most capable model), reading in full any group that had no review of its own; one fix
  pass and a scoped re-review.
- [ ] `npx vitest run`, `npm run check`, `npm run build`, `npm run size` (≤ 150 KB first load; the map a separate chunk).
- [ ] **Browser check (required).** Dev server `npx vite --port 5174`; DM tab `http://localhost:5174/dnd-app/`, player tab
  `http://127.0.0.1:5174/dnd-app/` (different origins, separate IndexedDB). The DM hosts; the player joins as A1 with a
  character that has a portrait.
  - DM, Map: `New scene` with a large image (over 4096 px; stored downscaled). Hex (pointy top) grid, size and offset lined
    up, opacity changed. Add Thorin's token and three goblin tokens; hide one; make one a Large ogre.
  - Ruler: three hexes → `15 ft`; switch to Square and check 5-5-5 vs 5-10-5 on a 3×3 diagonal (`15 ft` / `20 ft`).
  - Box select two goblins and move them; pinch-zoom with touch emulation; drag a token with touch emulation.
  - `Show to players`. Player, Map: the image and Thorin's portrait load; the hidden goblin is absent; goblins show health
    words, no HP.
  - Combat: add party, Start. On another combatant's turn the player cannot drag. On Thorin's turn the player drags 35 ft
    (speed 30) → `35 ft · past speed 30 ft` shows, the move lands, and the DM's tab updates. DM ticks `Free movement` → the
    player drags off-turn.
  - Group C (when built): fog on → the player sees black, the DM a shade; reveal with `Brush` and `Rectangle`; a goblin under
    fog is absent for the player. `Template` → a 20 ft sphere lists the tokens inside. Select goblin tokens → `Add to combat`.
    Start the encounter "Ambush" → tokens appear on the shown scene. Damage a goblin, End combat → its token keeps the HP.
  - DM reloads: scene, tokens, grid, fog and the shown flag are restored.
  - Player tab at 375 px: no horizontal scroll, the nav fits, and the map pans and zooms.
  - If the public signaling server is unreachable, say so, and rely on the fake-transport tests for the sync half.
- [ ] Merge per the checklist, push by hash, `git tag stage-5 && git push origin stage-5`.
