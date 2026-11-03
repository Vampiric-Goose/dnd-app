# Route Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A drag plans the route the token walks. Opportunity Attacks and movement cost follow that route, and every viewer sees the token slide square by square along it.

**Architecture:**
- Pure route maths in `src/lib/combat/movement.ts`: extending and cutting back a route, per-step cost, and the running cost in `Movement`.
- The reaction flow walks a route instead of a straight line, one step at a time, charging cost as it goes.
- Each write carries a transient `trail` on the token. The host checks a player's route, and `MapCanvas` collects the route while dragging and animates any token that moved.

**Tech Stack:** Svelte 5, TypeScript, Vitest, fake-indexeddb.

**Spec:** the design the user approved in chat on 2026-11-03, copied here verbatim in substance.
- **Dragging plans a route:**
  - Every square the token passes through is recorded; squares the pointer skipped are filled in.
  - Doubling back over earlier squares cuts the route back to that square, so a wiggle costs nothing.
  - The route is drawn as a line with the ghost at the end, and it stops growing when movement runs out.
- **Letting go walks it:**
  - The token slides square by square along the route, about 100 ms per square, eased on each square.
  - It stops at the edge of an enemy's reach while the card is open, then walks the rest.
  - The DM and players see the same walk, and the token is never pulled back to its start.
- **Cost follows the route:**
  - The turn keeps a running total of feet walked; 5-10-5 diagonals count across the whole turn.
  - Walking back no longer refunds movement.
  - Dash, standing up from prone, and Reset movement work as before.
  - The reachable highlight shows what's left from where the token now stands.
  - On a player's move, the DM's device rejects a route with a gap in it or one that costs more than is left.
- **Group drags:** only the current-turn creature walks its route and is checked for Opportunity Attacks; the rest of the selection moves by the same offset at no cost.
- **Busy tokens:** a token that is walking or waiting on a card can't be dragged until it's done.
- **Fog:** if the route crosses a fogged square, players don't get that route. They see the token slide straight, so fog never reveals where something walked.
- **Outside combat or with free movement:** the token still slides along its route and nothing is charged.

## Global Constraints
- 2014 rules.
- The DM's device validates everything a player sends.
- Players never learn hidden or fogged positions, monster AC, saves or combatant ids.
- Path messages are at most 200 points, and every step is one square (a king move).
- Animation is roughly 100 ms per square, eased per square. With `prefers-reduced-motion`, the token jumps instead.
- Old saved fights whose `Movement` has no `used` still work: their used feet fall back to today's origin-distance rule.
- The reaction rules are unchanged:
  - only the current-turn creature's moves provoke;
  - nothing waits unless a reaction is actually available;
  - hidden creatures stay hidden.

## Review Focus
1. **A drag that loops around a goblin and comes back inside its reach:** the Opportunity Attack is asked at the first step that leaves reach. Test it in Task 2.
2. **A route that backtracks:** it costs only the kept squares, and the host's check agrees with the player's screen to the foot, including 5-10-5 parity carried from an earlier move this turn. Test it in Tasks 1 and 2.
3. **A crafted player path** with a gap, a diagonal jump, more than 200 points, or a start not next to the token: a violation, or refused without moving. Test it in Task 2.
4. **A route through fog on a fog-on scene:** the player gets no trail for it. Test it in Task 2.
5. **A second drag of a token that's walking or waiting:** not possible, because `canDrag` is false for it. If one arrives anyway (a crafted message), it's ignored. Test it in Task 2.

---

### Task 1: Route maths (`src/lib/combat/movement.ts`, `src/lib/types.ts`)

**Interfaces (produces):**
```ts
/** The squares from cell a to cell b, one king step at a time (b included, a not). */
export function stepsBetween(g: Grid, a: Pt, b: Pt, size: Size): Pt[];
/** The route with `to` reached from its last square: steps filled in; landing on a square already in it cuts it back there (the start included). */
export function extendRoute(g: Grid, start: Pt, route: Pt[], to: Pt, size: Size): Pt[];
/** Feet for walking `route` from `start`, with `diags` diagonals already walked this turn (5-10-5: every second diagonal costs 10). */
export function routeFeet(g: Grid, start: Pt, route: Pt[], diagonal: '5-5-5' | '5-10-5', diags?: number): { feet: number; diags: number };
/** The route cut to what `feet` left pays for. */
export function affordable(g: Grid, start: Pt, route: Pt[], feet: number, diagonal: '5-5-5' | '5-10-5', diags?: number): Pt[];
/** A walked route charged to the combatant's Movement: sets the origin on the first move, adds `used` feet and `diags`. */
export function chargeRoute(c: Combat, combatantId: string, from: Pt, cost: { feet: number; diags: number }): Combat;
```
- `Movement` gains `used?: number` and `diags?: number`.
- `usedFeet` returns `m.used` when present, else today's origin distance.
- `entry()` keeps `used` and `diags`.
- `resetMovement`, Dash and standing up are unchanged.
- `reachableCells` gets an optional diagonal-parity argument, so the highlight can be drawn from the current position with the feet remaining.

- [ ] **Step 1: Failing tests** in `tests/combat/movement.test.ts`, with grid size 70 and 5 ft cells:
  - `stepsBetween fills a jump of three squares with king steps`: from (0,0) to (3,1) gives 3 steps ending at (3,1).
  - `extendRoute cuts back when the pointer returns to an earlier square, and to nothing at the start`
  - `routeFeet 5-10-5 counts every second diagonal as 10, carrying diagonals from earlier this turn`: two diagonals from 0 is 15 ft; one diagonal with `diags` 1 is 10 ft.
  - `affordable stops the route where the feet run out`
  - `chargeRoute adds to used and keeps the first origin; usedFeet falls back to the origin distance for an old entry`
- [ ] **Step 2:** Run the tests and watch them FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and see them PASS. Then run the full suite.
- [ ] **Step 5:** Commit: `Moves: routes, their cost, and a running total for the turn`.

### Task 2: Walking a route (flow, DmMap move path, host, protocol, players' scene)

**Files:**
- `src/lib/combat/reactionFlow.ts`
- `src/lib/sync/protocol.ts`
- `src/lib/sync/host.ts`
- `src/lib/sync/scene.ts`
- `src/lib/types.ts` (`Token.trail?: Pt[]`, transient)
- `src/ui/map/DmMap.svelte` (`onmove` signature only)

**Interfaces (produces):**
- `guardMove(ctx, tokenId, route: Pt[]): Promise<Pt>` walks the route one step at a time.
  - For each step it runs `leaveStep` on that one-square segment and asks as today.
  - When the budget applies, it charges each step through `chargeRoute`.
  - Each scene write sets the token's `trail` to the squares walked since the last write.
  - It stops as today: 0 HP, conditions, Sentinel, the turn ending.
- `export const isWalking = (tokenId: string) => walking.has(tokenId)`.
- `DmMap onmove(ids, primary, to, route?)`:
  - The current-turn primary walks its route through `guardMove`.
  - Other selected tokens move by the final offset, as today.
  - A non-turn move stays the plain move, plus a `trail` so it animates.
- **Protocol:** `move` gains `path?: Pt[]` (1–200 points, each within the scene). The host's `moveProblem` and `moveCost` use the route:
  - every step is one square;
  - the first step is next to the token;
  - the last point equals `x`/`y` (after snapping);
  - the cost is no more than what's left.
  - A malformed shape is a violation; too far or stale is a refusal.
  - With no `path`, an old client's move still works, as a straight route from `stepsBetween`.
- **`sceneForPlayers`:** a token's `trail` is dropped when fog is on and any trail square is fogged (or the token is hidden, which already drops the token). `cleanScene` accepts `trail` as an array of at most 200 finite points.

- [ ] **Step 1: Failing tests**
  - Flow, in `tests/combat/reactionFlow.test.ts`:
    - `a route that loops around a goblin and back inside its reach is asked at the first step that leaves it`
    - `a walked route charges its own length, not the distance from the start`
    - `a walk writes the squares it took as the token’s trail`
  - Host, in `tests/sync/movement.test.ts` or `reactions.test.ts`:
    - `a player route with a gap, a diagonal jump, or over 200 points is a violation; one that costs more than is left is refused`
    - `a player route is charged by its length`
    - `a move without a path still works as a straight route`
  - Scene, in `tests/sync/scene.test.ts`:
    - `a trail through fog never reaches players; one in the open does`
- [ ] **Step 2:** Run the tests and watch them FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and see them PASS. Then run the full suite and svelte-check.
- [ ] **Step 5:** Commit: `Moves: the token walks the route it was dragged along; players' routes are checked`.

### Task 3: Drag and slide (`src/ui/map/MapCanvas.svelte`, DmMap, PlayerMap)

- **Drag:**
  - `mode.drag` keeps `route: Pt[]`. Each new ghost square extends it with `extendRoute`, cut to `affordable` when `limitOf` gives a budget (the remaining feet and diagonal parity, from Task 1).
  - The ghost sits at the route's last square, and the route is drawn as a line from the token through its squares.
  - On drop, it calls `onmove(ids, id, ghost, route)`.
  - The highlight comes from `reachableCells` at the token's current position with the feet remaining.
- **Slide:**
  - When a token's position changes between renders, animate it.
  - The squares come from the token's `trail` when that trail ends at the new position and starts next to the old one. Otherwise they come from `stepsBetween(old, new)`.
  - Each square takes about 100 ms and is eased (ease-in-out per square). Keep scheduling frames while any token animates.
  - With `prefers-reduced-motion`, the token jumps.
  - A new position arriving mid-slide continues from where the token is drawn.
- **Busy tokens:** DmMap's `canDrag` is false for a token where `isWalking(token)` is true.
- **PlayerMap:**
  - It sends the route as `path` with its move.
  - Its pending ghost shows the route line until the scene update arrives. The token then slides; it never jumps to the drop point first.
  - The player can't drag again while their own move is pending.
- [ ] Unit-test any pure helper you extract (for example the slide's position at time `t`). Run the full suite, svelte-check and `vite build`, then commit: `Moves: drag draws the route; tokens slide square by square`.
- **Browser check (controller):**
  - Dragging around a goblin draws a route.
  - The token slides square by square, stops at the reach edge while the card is open, then continues.
  - Backtracking cuts the route.
  - The highlight shrinks by the route's length.
  - No snap-back flicker on drop.
