# Walls, Doors and Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Walls, low walls, arrow slits and doors drawn by the DM on a scene give 2014 cover (half, three-quarters, total), stop spell areas and movement, and doors toggle.

**Architecture:** One pure geometry module (`src/lib/map/walls.ts`) holds segment tests, the DMG corner rule, route clipping and door reach. The flow plugs it in at four points:
- `workOut` (aiming.ts) for cover and areas;
- `leaveStep` for Opportunity Attacks;
- `moveRoute` on the host plus the drag preview in MapCanvas for movement;
- MapCanvas and DmMap for drawing and toggling, with a `door` guest message.

**Tech Stack:** Svelte 5, TypeScript, Vitest. **Spec:** `docs/superpowers/specs/2026-11-04-walls-cover-design.md`

## Global Constraints
- Walls live on the Scene (`walls?: Wall[]`, pixel endpoints) and are checked in `sceneProblem`.
- Players receive walls and doors; their canvas draws doors only.
- The DM device validates a player's door toggle: a token of theirs within one square of the door.
- Total cover refuses a direct target ('total cover'). Half and three-quarters add +2/+5 to AC and Dex saves.

## Review Focus
1. A wall drawn exactly on a grid line between two adjacent creatures gives total cover; one beside a creature but not between gives none.
2. A diagonal step through the corner where two walls meet is blocked.
3. An area's origin sitting on a wall line doesn't drop everyone; corners and centres are inset.
4. A player toggling a door far from their tokens is refused without changing the scene.
5. A scene without walls behaves exactly as before. Every check treats `walls` undefined as [].

---

### Task 1: Geometry and saved walls
**Files:** Create `src/lib/map/walls.ts`; Modify `src/lib/types.ts` (`Wall`, `Scene.walls`), `src/lib/recordShape.ts` (`sceneProblem`); Test `tests/map/walls.test.ts`, `tests/recordShape.test.ts`

**Produces:**
- Line and step tests: `lineBlocked(walls, p, q): boolean` and `stepBlocked(walls, p, q): boolean`.
- `clipRoute(walls, from, route): Pt[]` returns the route up to the first blocked step.
- `cover(g, walls, from: (Pt & { size }) | Pt, to: Pt & { size }, others: (Pt & { size })[]): 0 | 2 | 5 | 'total'`.
- `nearDoor(g, w, t): boolean` is true when the token's centre is within one square of the segment.
- `toggleDoor(s, id): Scene`.

- [ ] Tests:
  - A wall on the grid line between two adjacent Medium creatures gives 'total'.
  - A wall jutting to cover two of the target's corners gives 2.
  - With no walls the result is 0.
  - A low wall between the centres gives 2, and an arrow slit gives 5.
  - A creature between the centres gives 2.
  - An open door gives 0.
  - A diagonal step through a wall corner is blocked.
  - `clipRoute` stops before the wall.
  - `sceneProblem` rejects a wall with a bad kind or a non-finite point.
- [ ] Run, watch the tests fail, implement, run again and watch them pass. Commit.

### Task 2: Movement and Opportunity Attacks
**Files:** `src/lib/sync/scene.ts` (`moveRoute` gains `walls`), `src/lib/sync/host.ts`, `src/lib/combat/reactions.ts` (`leaveStep` gains `blocked?`), `src/lib/combat/reactionFlow.ts`, `src/ui/map/MapCanvas.svelte` (the drag route is clipped unless the DM holds Alt).
- [ ] Tests:
  - A player's move across a wall is clipped before it.
  - A foe across a wall isn't asked for an Opportunity Attack.
- [ ] Commit.

### Task 3: Cover in attacks, saves and areas
**Files:** `src/lib/combat/aiming.ts` (`workOut`).
- [ ] Tests:
  - An attack through half cover hits against AC + 2, and its Results note says "half cover".
  - A target behind total cover is refused.
  - A Fireball doesn't catch a creature behind a wall from its origin.
  - A caught creature with half cover gets +2 on its Dex save.
- [ ] Commit.

### Task 4: Drawing, doors and players
**Files:**
- `src/ui/map/MapCanvas.svelte`: the Walls tool, styling, a door tap in Select.
- `src/ui/map/DmMap.svelte`: save walls, toggle doors.
- `src/lib/sync/protocol.ts`, `guest.ts`, `host.ts`, `session.svelte.ts`: the `door` message.
- `src/lib/sync/scene.ts`: `sceneForPlayers` passes walls.
- [ ] Tests:
  - `parseGuestMessage` accepts a door message.
  - The host toggles a door next to the player's token and refuses a far one.
  - `sceneForPlayers` passes walls.
- [ ] Commit.

### Task 5: Check in the app, final review, push and watch the deploy.
