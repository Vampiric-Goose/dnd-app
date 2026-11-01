# Map ↔ combat integration: movement, saved encounters, declared actions

The user runs fights on the battle map and finds the link between map and combat "underfunctional". Three problems, in their words:
- "Even without free movement on their turn a player could move their character wherever they want."
- "Encounters should not just be a template for monsters but a save state for a combat that can be pulled up or removed."
- "Right click on the map should allow players and the DM to show their intended action, like if there are 3 orcs and a player wants
  to attack one, they can drag an arrow to it." Plus: "Build in a framework for actions/rolls though, those are the next steps."

Base spec: `docs/superpowers/specs/2026-10-30-dnd-app-design.md` (stages 4 initiative and 5 battle map). Look: the Abyssal redesign
(`2026-11-01-abyssal-redesign-design.md`, kit in `src/ui/kit`). 2014 rules only.

## Goals
1. **Movement budget.** On a combatant's turn the map knows its speed and how far it has moved this turn, and a player's token stops at
   the limit.
2. **Encounters are saved fights.** An encounter is a snapshot of a whole combat plus its map state; it can be saved, resumed and deleted.
3. **Declared actions.** Anyone at the table can right-click (long-press on touch) and drag an arrow from their token to a target; everyone
   sees it until its owner clears it or the owner's turn ends. The arrow is the first kind of a general "declared action" record that
   later carries attacks and rolls.

## Non-goals (this round)
- No rolling, attack resolution or damage from an arrow. Only the record shape that will hold them.
- No difficult terrain, no movement-path drawing around walls, no opportunity-attack detection.
- No change to who may move what: the DM still drags anything anywhere; "free movement" keeps its meaning (players may move outside
  their turn), and a budget only applies during a running combat.

## Anti-goals
- A player being able to exceed their movement by any route (drag, crafted message, reconnect, Previous/Next turn).
- Rolling back player characters' HP or conditions when an encounter is loaded (those live on the character and belong to the player).
- An arrow revealing a hidden or fogged token to players.
- New clutter: the new controls follow the three tiers (always visible / one tap away / tucked away).

## 1. Movement budget

**Speed.** A PC's speed is `computeSheet(..., { viewer: 'player' }).speed.walk` (this already includes race, effects, encumbrance and the
override). The **player view** is used everywhere, host check included, so the player's clamp and readout agree with the host and a
hidden item's speed bonus never leaks. A hidden item that adds speed is therefore only honoured when the DM drags (my call: rare,
and the DM is never blocked). A monster's
is its stat block `speed.walk`. Speed is 0 while the creature has a condition that sets speed to 0 in 2014 rules (grappled, restrained,
paralyzed, petrified, stunned, unconscious) or exhaustion 5+; exhaustion 2–4 halves it. *Builder: check whether computeSheet already
applies any of these and don't apply them twice.* Other speeds (fly, swim, climb, burrow) are out of scope: walk only (my call; the DM
can still drag).

**Tracking.** The live `Combat` keeps movement per combatant: feet used and the number of Dashes taken. A combatant's entry resets only
when **its own turn starts** (Start, Next, or Next onto it after a removal), recorded with the same turn-boundary guard as `done`, so
Next → Previous → Next never resets twice and Previous never hands back a fresh budget: going back to a combatant returns to its
movement as it was. A hidden combatant's turn doesn't touch anyone else's entry. While a hidden combatant acts, players still see the last
visible turn (S4-R4), and that player keeps their leftover feet, with no fresh budget and no refusal that would give the hidden turn away.
Movement state is part of what syncs, as follows: a player gets only their own characters' remaining feet; no monster movement reaches
players. Feet are measured per move as the
grid distance between where the token was and where it lands (`feetBetween`, using the campaign's diagonal rule), summed over the turn;
moving back costs movement too (2014 rules). A grouped monster turn (several tokens act as one) tracks each token separately.

**Limit.** Budget = speed × (1 + Dashes taken this turn). Dash stacks (2014 rules allow it: Cunning Action, Action Surge), so it's a
count rather than a yes/no. While dragging, a player's own token on its own turn **stops at the limit**: the drop point is
clamped to the furthest reachable cell along the drag line (the token visibly won't go further). The host re-checks every `move`
message (`moveProblem` in `src/lib/sync/scene.ts`): a move beyond the remaining budget is refused (not a violation: it can come from a
stale view) and the player's screen snaps back, as other refusals already do. With free movement on, outside combat, or in setup
(round 0) there is no budget.

**DM.** Never blocked. When the DM drags the current combatant's token the same budget is counted and shown (so the DM sees "25 ft
left"), but the drop is not clamped.

**Visible.** During the current combatant's turn its token shows a small remaining-movement readout while selected/dragged (e.g. `15 ft`)
and the turn bar shows it next to the name. Players see their own remaining movement in the player map's status line ("Your turn: 20 ft
left."). **Dash** is a button: in the turn bar for the DM (current combatant) and in the player map status area for the player on their
own turn. Each tap adds one Dash, and the turn bar shows the count to the DM ("Dashed ×2"). It works on the honour system, like
declaring it at a real table (my call). The DM can undo one Dash (a mistaken tap) as long as the extra movement is unused.

## 2. Encounters as saved fights

**What an encounter holds.** Name, campaign, updatedAt, and either:
- a **saved fight**: a full `Combat` snapshot (order, initiative, round, current turn, monster HP/temp HP/conditions/durations/
  concentration/legendary/reactions/notes, groupMonsters, movement state) plus **map state**: the id of the scene it was fought on and
  that scene's tokens and fog at save time; or
- a **prepared list** (today's `monsters` lines): existing encounters keep working and are still creatable; starting one adds its monsters
  to a fresh setup-state combat exactly as now. A prepared encounter becomes a saved fight the first time it's saved from a running fight.
Players' characters appear in the snapshot only as combatants: order, initiative, tiebreaks, hidden and notes. Their HP, conditions and death saves are **not**
restored on load: they stay as they are on the character now. Their combatant-level `durations`, `concentrating` and `reactionUsed`
are also dropped on load (my call). Restoring a duration would later let expiry strip a same-named condition the character picked up
after the save, which amounts to rolling back their conditions. Timed effects on PCs therefore have to be set again after resuming.

**Link.** The live `Combat` remembers the encounter it came from (`encounterId`).

**Actions** (Encounters tab of the combat panel; the turn bar's "⋯" menu gets "Save as encounter…" and, when linked, "Save encounter"):
- **Save as encounter…**: name it; snapshot the live fight and the shown scene (or, if no scene is shown, no map state). Links the fight.
- **Save encounter**: overwrite the linked encounter with the current state.
- **Resume / Start** an encounter: if a fight is running and linked, it is saved back into its encounter first; if running and not linked,
  ask "Save the current fight first?" (Save as encounter… / Discard / Cancel). Then the encounter's combat becomes the live combat and,
  when it has map state and its scene still exists, that scene's tokens and fog are restored and the scene is shown. If the scene was
  deleted, the fight loads without the map and a toast says so. Missing characters (deleted since) are dropped with a toast; missing
  monster definitions keep the saved name (as prepared lines already do).
- **Delete** an encounter (red, confirms). Deleting the linked one unlinks the live fight; the fight continues.
- **End combat** on a linked fight asks: "Keep the encounter for later" (saves current state, then ends) / "Delete it" / "Cancel".
- **Edit** stays for prepared lists. For a saved fight, edit = resume it and change things live.
The list shows each encounter's kind (saved fight: round and number of combatants; prepared: monster count) and marks the linked one.

**Where it lives.** The existing `encounters` store (DM device only, in backups, deleted with the campaign). Never synced to players:
players only see the live fight and shown scene, as now. Old backups and old encounter records must still load.

## 3. Declared actions (intent arrows)

**Gesture.** Desktop: right-button drag on the map (any tool); release draws the arrow; the browser context menu is suppressed on the map
canvas. Touch: long-press (≈500 ms without moving) then drag; must not break token drag, pan or pinch. Starting on your own token makes it
the source; starting elsewhere uses that point as the source (a player with no token on the map can still point). Releasing on a visible
token targets the token; otherwise the point. A tiny drag (< one cell) is ignored.

**Record** (a "declared action", pure TS in `src/lib`, shared by host and guest):
```
{ id, by: playerId | 'dm', sceneId,
  from: { tokenId } | { x, y }, to: { tokenId } | { x, y },
  kind: 'intent',                 // the only kind this round; future: 'attack', 'spell', 'roll', …
  data?: …,                       // per-kind payload; none for 'intent'
  endsWith?: combatantId,         // the turn that ends it; absent = until cleared
  at }
```
The host validates `kind` against a known list and rejects unknown kinds, so adding a kind later is: add it to the union and the
validator, give it a payload shape, and (for rolls) a resolver. Keep the record and its validation in one module so that is obvious.

**Rules.**
- One declared action per person at a time (per player ID; the DM gets one per token plus one with no token): drawing again replaces it.
- Ends when its owner clears it (a ✕ on the arrow's head or "Clear arrow" in the status area), when the DM clears it (DM can clear any;
  "Clear all arrows" in the map "⋯"), when the `endsWith` combatant's turn ends, when the scene changes, or when combat ends (for
  arrows made during combat). Outside combat it lasts until cleared.
- `endsWith`: the source token's combatant (a player's character, or the monster the DM pointed from); none if there's no source token.
- Players may only point from their own token or a point, and only at tokens they can see. Players receive only actions whose source and
  target are both visible to them (not hidden, not fogged): a DM arrow from a hidden monster stays DM-only. A player's action pointing at
  a token that becomes hidden is dropped from what players get.
- Colour: the source token's colour; without a source token, a per-player colour (stable by roster order, from a small fixed set that is
  not the accent); the DM's no-token arrow uses `--text-strong`.

**Sync.** New guest→host message to set/clear the player's action, host→guest broadcast of the visible actions (same pattern and size
limits as `move` and `scene`). Actions are live table state held by the host (DM device) and are **not** persisted or backed up (my call:
they're momentary; a DM reload clears them). The DM's own map shows all of them.

**Drawing.** A straight arrow with a head, 2–3 px, slightly transparent, drawn above tokens and below the ruler/templates; the target token
gets a thin ring in the arrow's colour. Must stay legible on busy maps and on phones.

## Constraints
- Svelte 5, existing code and kit; no new dependencies; first load ≤ 150 KB gzipped (now 59.3 KB). Pure logic in `src/lib` with Vitest
  tests (movement math and clamping, budget reset on every turn change path, host refusal of over-budget and crafted moves, encounter
  save/load/round-trip incl. old records and backups, declared-action validation and visibility filtering, turn-end expiry).
- Sync safety as in stages 3–5: allowlists to players, validation of every guest message, no record ids or hidden info leaking.
- Accessibility: Dash, clear-arrow and encounter actions are buttons with labels; arrows are a visual aid (the gesture has no keyboard
  equivalent this round, my call). 44 px touch targets on phones.

## Left to the builder
Exact field names and where per-turn movement lives inside `Combat`; how clamping walks the drag line on hex grids; readout placement;
long-press timing details; the per-player colour set; how the Encounters tab lays out the two kinds; the confirm dialogs' wording.
