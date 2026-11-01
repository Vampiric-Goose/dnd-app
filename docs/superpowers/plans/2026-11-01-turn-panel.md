# Turn Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a fight, the map's right panel runs the acting creature's turn: a turn strip, HP, conditions with their limits, movement,
Action / Bonus action / Reaction pips, a primary action card plus a pop-up of every action grouped by cost, and End turn (players) or
Next (DM).

**Architecture:**
- **Pure logic:** turn economy in `src/lib/combat/economy.ts`, and the list of a creature's actions in `src/lib/combat/turnActions.ts`.
- **Players:** they act through two host-checked guest messages ("use", "endTurn"). The host spends pips on the combat and slots or
  resources on the character in one go.
- **UI:** one `TurnPanel` plus an `ActionsDialog`, used by both map pages.

**Tech Stack:** Svelte 5, TypeScript, Vitest, IndexedDB (idb), relay sync.

**Spec:** `docs/superpowers/specs/2026-11-01-turn-panel-design.md` (read it whole, including "Calls made after the builder check").

**Execution:** native (the user asked for low usage): implemented in this session, one final review.

## Global Constraints
- 2014 rules only; no new dependencies; first load ≤ 150 KB gzipped (now 61.5 KB); panel and dialog load lazily with the map.
- Players never change combat state directly: only "use" and "endTurn", checked on the DM's device against the fresh combat and the
  players' tracker view (hidden turns stay hidden).
- A monster's pips, actions or stats never reach players; players get pips only for their own characters.
- Bonus action is one per turn and never added by extra Actions.
- Blocking conditions (incapacitated, stunned, paralyzed, petrified, unconscious) block Action, Bonus action and Reaction.
- Dash and Cunning Action: Dash are separate entries; each grants its movement. The old `dash` guest message is removed.
- The pop-up is a native `<dialog>` (sheet-style on phones), Escape closes it; 44 px targets; no horizontal scroll at 375 px.

## Rulings while planning
- **Player pip undo deferred:** "a player can clear a pip they set by mistake when the use spent nothing" is left out for now; the DM
  can fix any pip with `setPip`. If wrong, it costs a later `unuse` message.
- **Resource cost source:** a resource's cost is read in `turnActions.ts` from the same-named feature's text, instead of adding a
  `cost` field to the sheet. Same result, and the sheet's output type is untouched.

## Review Focus
1. A double tap on an action: the second use, with no Action left, is refused and spends nothing (economy test + host test).
2. Extra Attack: the 2nd attack of the Attack action spends no new Action; a 3rd (with 2 per action) needs another Action (economy test).
3. Off-turn: the Reaction works and the Action is refused (host test).
4. Conditions: Prone does not block, Incapacitated does (economy test).
5. End turn from a player who isn't acting is ignored; from the acting player it expires durations exactly as Next (host test).

---

### Task 1: Turn economy

**Files:**
- Create: `src/lib/combat/economy.ts`
- Modify: `src/lib/types.ts` (Combatant), `src/lib/combat/combat.ts` (`startTurn` reset)
- Test: `tests/combat/economy.test.ts`

**Interfaces (produces):**
- `Combatant.economy?: { used: number; extra: number; bonus: boolean; attacks: number }`. Absent means fresh. `reactionUsed` stays
  the Reaction.
- `export type Cost = 'action' | 'bonus' | 'reaction' | 'none'`
- `export const BLOCKING: readonly string[]`, the five blocking conditions, lower-case.
- `export const CONDITION_TEXT: Record<string, string>`: a short 2014 effect for each name in `CONDITIONS`. For example, Grappled is
  `'speed 0'`, Poisoned is `'disadvantage on attacks and ability checks'` and Prone is `'crawling costs double; melee attacks against you
  have advantage'`.
- `export function actionsLeft(x: Combatant): number`, computed as `1 + extra - used`.
- `export function useProblem(x: Combatant, cost: Cost, conditions: readonly string[], onTurn: boolean, attack?: { perAction: number }): string | undefined`
  The reason comes back as text, for example 'no Action left', 'not your turn', 'Stunned'.
- `export function spend(x: Combatant, cost: Cost, attack?: { perAction: number }): Combatant`
  - An attack that continues the current Attack action (`0 < attacks < perAction`) only increments `attacks`.
  - Any other action use does `used + 1` and sets `attacks` to `1` if it was an attack, else `0`.
  - A bonus use sets `bonus`; a reaction use sets `reactionUsed`.
- `export function grantAction(x: Combatant): Combatant` adds 1 to `extra`.
- `export function setPip(x: Combatant, pip: 'action' | 'bonus' | 'reaction', used: boolean): Combatant` is the DM's fix.

- [ ] **Step 1: Failing tests:**
  - fresh: 1 Action left.
  - spend action → 0 left, and a second action use gives `useProblem` 'no Action left' (RF1).
  - Attacks with `perAction` 2: the 1st spends the Action, the 2nd keeps `used` 1, the 3rd needs a 2nd Action. After `grantAction`,
    it's allowed (RF2).
  - Bonus is independent of extra Actions.
  - Off-turn: reaction allowed, action not.
  - Prone doesn't block and Incapacitated does, for all three (RF4).
  - After `start`/`next` reach a combatant, its `economy` and `reactionUsed` are fresh, and Next → Previous → Next doesn't reset twice.
- [ ] **Step 2:** `npx vitest run tests/combat/economy.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. In `startTurn` (combat.ts), drop `economy` alongside the existing `reactionUsed: false`. Strip `economy`
  from PC combatants in `restoreCombat`, as `reactionUsed` is stripped now.
- [ ] **Step 4:** Run it. PASS; full suite green.
- [ ] **Step 5:** Commit `feat: turn economy (actions, bonus action, reaction, Extra Attack)`.

### Task 2: A creature's actions

**Files:**
- Create: `src/lib/combat/turnActions.ts`
- Test: `tests/combat/turnActions.test.ts`

**Interfaces (produces):**
- `export interface TurnAction { id: string; name: string; cost: Cost; group: 'attack' | 'standard' | 'spell' | 'resource' | 'feature' | 'monster'; text?: RichText; attack?: Attack; spell?: { id: string; level: number; concentration: boolean }; resource?: string; uses?: { left: number; max: number }; grants?: 'action' | 'dash' }`
  `id` is stable across devices, for example `attack:<entryId>`, `std:dash`, `cunning:dash`, `spell:<spellId>`, `res:<name>`,
  `offhand:<entryId>`, `mon:<index>`.
- `export function costOfText(text: string): Cost`. It reads "as a bonus action" as bonus, "as an action" or "use your action" as
  action, "reaction" as reaction, and anything else as none.
- `export function castingCost(castingTime: string): Cost | undefined`. Returns undefined for anything longer than 1 reaction or
  bonus action or action (not offered).
- `export function attacksPerAction(features: { name: string }[]): number`. 1, plus the count from features named `Extra Attack`,
  `Extra Attack (2)` or `Extra Attack (3)`: the highest wins, giving 2, 3 or 4.
- `export function pcActions(c: Character, sheet: Sheet, features: FeatureItem[], spell: (id: string) => SpellDef | undefined): TurnAction[]`
  - **Attacks:** `sheet.attacks`, in order, each costing an Action (Unarmed Strike is already in the list). The first is the
    primary card.
  - **Off-hand attack:** when two light melee weapons are among the attacks, one entry costs the Bonus action. Its damage has no
    positive ability modifier.
  - **Standard actions:** Dash (grants `'dash'`), Disengage, Dodge, Help, Hide, Ready, Search and Use an Object, each costing an
    Action.
  - **Cunning Action:** with a feature named `Cunning Action`, three entries costing the Bonus action: `Cunning Action: Dash`
    (grants `'dash'`), `Cunning Action: Disengage` and `Cunning Action: Hide`.
  - **Spells:** the character's known and prepared spells plus cantrips, with `castingCost`; ones with no cost are left out.
  - **Resources:** `sheet.resources` with `uses`. The cost is `costOfText` of the feature with the same name. `Action Surge` costs
    none and grants `'action'`.
- `export const primaryAction = (list: TurnAction[]): TurnAction | undefined` returns the first attack.
- `export function monsterActions(m: MonsterDef): TurnAction[]`: `actions` cost an Action, `bonusActions` the Bonus action, and
  `reactions` the Reaction. Legendary actions are handled by the existing legendary uses, not here.

- [ ] **Step 1: Failing tests:**
  - `costOfText` on "you can use a bonus action to regain…" gives bonus, and "As an action, you can…" gives action.
  - `castingCost('1 bonus action')` is bonus; `'1 minute'` is undefined.
  - `attacksPerAction` for features [Extra Attack, Extra Attack (2)] gives 3.
  - A level 5 fighter with a longsword (fixture from tests/fixtures/records.ts plus the SRD) has Attack, Unarmed Strike and every
    standard action. Second Wind is bonus, Action Surge grants action, and it has no Cunning Action entries.
  - A rogue 2 has Dash under action and Cunning Action: Dash under bonus.
  - `monsterActions(goblin)` puts Scimitar and Shortbow under action.
- [ ] **Step 2:** Run it. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; full suite.
- [ ] **Step 5:** Commit `feat: a creature's actions grouped by cost`.

### Task 3: Sync: use, end turn, refusals

**Files:**
- Modify: `src/lib/sync/protocol.ts`, `src/lib/sync/host.ts`, `src/lib/sync/guest.ts`, `src/lib/sync/session.svelte.ts`,
  `src/lib/sync/project.ts`
- Test: `tests/sync/turn.test.ts` (fakes as in `tests/sync/movement.test.ts`)

**Interfaces (produces):**
- **Guest messages:** `{ t: 'use'; characterId: string; action: string; slot?: number; dropConcentration?: true }` and
  `{ t: 'endTurn'; characterId: string }`. Remove `{ t: 'dash' }` (and `sendDash`).
- **Host message:** `{ t: 'useRefused'; reason: string }`.
- **`TrackerRow.econ?: { used: number; extra: number; bonus: boolean; attacks: number; reaction: boolean; perAction: number }`**,
  on the viewer's own PC rows only, as `moved` is today.
- **HostDeps:** `endTurn?(): Promise<void>`, wired to combat store `turn(cid, 'next')`; and
  `editCharacter?(id: string, fn: (c: Character) => Character): Promise<boolean>`, the combat store's DM-side edit, which stamps sync
  clocks.
- **`host.#use` order:**
  1. Owner check (a violation if it fails).
  2. Build `pcActions` with the host's index.
  3. Find the action by id (stale if it's gone).
  4. `useProblem` with `onTurn = currentActor(players' view) === id` and the character's conditions.
  5. Refused: send `useRefused`.
  6. Accepted: in `updateCombat`, `spend` (plus `grantAction` for `'action'` grants, `addDash` for `'dash'` grants, and
     `concentrating` for a concentration spell). Then `editCharacter` spends the slot (`slotsUsed[slot-1]`, after checking a free slot
     ≥ the spell level) or the resource use (refused if none is left, before anything is written).
- **`host.#endTurn`:** owner, and `currentActor` is that character; else ignored. Then `endTurn()`.
- **Session exports:** `sendUse(characterId, action, slot?, dropConcentration?)`, `sendEndTurn(characterId)`, and a toast on
  `useRefused`.

- [ ] **Step 1: Failing tests:**
  - An attack use marks the Action and a second one is refused with a `useRefused` message and nothing spent (RF1).
  - A spell use with a slot spends the slot on the character.
  - A resource with 0 uses left is refused.
  - Off-turn, a reaction is accepted and an action refused (RF3).
  - A use for someone else's character is a violation.
  - `endTurn` from a non-acting player is ignored. From the acting player it advances the turn and expires a duration like Next (RF5).
  - Another player's tracker carries no `econ` for this PC.
  - The `dash` message is now 'unknown message'.
- [ ] **Step 2:** Run it. FAIL.
- [ ] **Step 3:** Implement; update the existing Dash tests to the "use" path (`std:dash` / `cunning:dash`).
- [ ] **Step 4:** PASS; full suite; `npm run check`.
- [ ] **Step 5:** Commit `feat: players use actions and end their turn through the DM's device`.

### Task 4: Turn panel and actions pop-up

**Files:**
- Create: `src/ui/turn/TurnPanel.svelte`, `src/ui/turn/ActionsDialog.svelte`
- Modify: `src/ui/map/PlayerMap.svelte`, `src/ui/map/DmMap.svelte` (panel tab), `src/ui/initiative/Tracker.svelte` (remove the
  free Dash button now covered by actions; keep the DM's Dash count, Undo Dash and Reset movement)
- Test: browser check (logic is covered in tasks 1-3)

**Interfaces:**
- Consumes 1-3: `TurnAction`, `pcActions`, `monsterActions`, `primaryAction`, `actionsLeft`, `useProblem`, `CONDITION_TEXT`,
  `TrackerRow.econ`, `sendUse`, `sendEndTurn`.
- `TurnPanel` props:
  - `strip: { name: string; init?: number; current: boolean }[]` (previous, acting, next, from the players' or DM's tracker), and
    `round`.
  - `hp`, `maxHp`, `tempHp?`, `conditions`, `moveLeft?`.
  - `econ` (the Combatant economy fields plus `reaction` and `perAction`).
  - `actions: TurnAction[]`, `onTurn: boolean`, `canEnd: boolean`.
  - `onuse(a: TurnAction, slot?: number)`, `onend()`, `dm: boolean`, and `onpip?(pip, used)` for the DM.
  - It shows the primary action card (roll buttons as the sheet's Attacks: `rollD20` / `rollTo`) and an "All actions" button that
    opens `ActionsDialog`.
- `ActionsDialog`:
  - Groups under Action, Bonus action, Reaction and No cost, with a disabled state and its reason from `useProblem`.
  - A spell asks for its slot level among the free slots ≥ its level; a concentration spell asks to drop the current one.
- **DmMap:** in a fight the panel's first tab is "Turn", following the acting combatant (grouped run: first, plus a switcher).
  Tapping a creature in the strip or on the map shows it without changing the turn. Next uses `turn(cid, 'next')`.
- **PlayerMap:** in a fight with one of the player's characters in it, the panel shows `TurnPanel` for the acting one (else their
  next), with a switcher between their characters.

- [ ] **Step 1:** Build `TurnPanel` and `ActionsDialog`; wire PlayerMap, then DmMap; remove the old Dash buttons.
- [ ] **Step 2: Browser check at 1280 px and the mobile preset** (a seeded fighter 5, a rogue 2 and a goblin, fight started):
  - The fighter's attack card rolls and lights the Action, and the 2nd attack is still allowed.
  - Second Wind spends the Bonus action and a use.
  - The rogue's Cunning Action: Dash adds movement.
  - Incapacitated greys everything out.
  - End turn (player view) and Next (DM) advance.
  - The pop-up opens and closes with Escape and works on a phone.
- [ ] **Step 3:** `npx vitest run`, `npm run check`, `npm run build`, `npm run size`. Commit `feat: turn panel on the map`.

### Task 5: Final review and ship
- [ ] One review of the branch diff (most capable model). Fix what it finds; push `main` by hash; watch the deploy.
