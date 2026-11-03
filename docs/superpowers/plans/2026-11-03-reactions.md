# Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opportunity Attacks, Counterspell, Hellish Rebuke, and answers to a hit (Shield, Uncanny Dodge, a monster's "adds N to its AC") are offered automatically as a stack of small cards that pass by themselves after 10 s.

**Architecture:** There are four layers:
- Pure rules decide who may react (`reactions.ts`).
- An in-memory stack on the DM's device holds open asks and times them out (`reactionStack.svelte.ts`).
- A flow module on the DM's device pauses moves and casts, asks, executes the answers and lands results (`reactionFlow.ts`).
- The host relays each player's own prompts and validates their answers.

The DmMap and the host both call the same flow functions.

**Tech Stack:** Svelte 5, TypeScript, Vitest, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-11-03-reactions-design.md`

## Global Constraints
- 2014 rules only. Mechanics are keyed by name; no book text is bundled.
- Players never learn monster AC, saves, immunities, combatant ids, or the name or level of a spell a monster casts.
- The DM's device (`host.ts`) validates everything a player sends. A refused answer counts as a pass, and the player gets a `useRefused` message.
- An ask times out after `AUTO_PASS_MS = 10_000`.
- Asks happen only when all of these hold: round ≥ 1, `targetingOn(settings)`, and `settings.reactions !== false`.
- Only the moves of the creature whose turn it is (the current run) provoke. Group moves and the DM's repositioning of others never do.

## Review Focus
1. **An ask opened while another is open (nested).** The inner one resolves first, and the outer one's timer keeps running. Test it in Task 2.
2. **A mover that drops to 0 HP, or gets speed 0 from Sentinel, during its OA.** It stays at the reach edge and the rest of the move is dropped. Test it in Task 4.
3. **A player answering a card twice, for a character that isn't theirs, or with an option or slot it wasn't offered.** The first is ignored, the second is a violation, and the third is a refusal. Test it in Task 3.
4. **A countered spell.** Its slot and pip are spent, and nothing else happens: no result, no buff, no summons. Test it in Task 4.
5. **A DM reload with asks open.** `reset()` resolves every open ask as passed, so no paused move hangs. Test it in Task 2.

---

### Task 1: Pure rules (`src/lib/combat/reactions.ts`)

**Files:**
- Create: `src/lib/combat/reactions.ts`
- Modify: `src/lib/combat/turnActions.ts`. `applyUse` marks `disengaging: true` for `std:disengage` and `cunning:disengage`, next to `std:dodge`.
- Modify: `src/lib/types.ts`. Add `disengaging?: boolean` to the economy type.
- Test: `tests/combat/reactions.test.ts`

**Interfaces (produces):**
```ts
export type ReactKind = 'opportunity' | 'counterspell' | 'hit' | 'rebuke';
export interface ReactOption { id: 'oa' | 'counterspell' | 'shield' | 'uncanny' | 'parry' | 'rebuke'; label: string; slot?: number; bonus?: number }
export interface Reactor { id: string /* combatant */; name: string; options: ReactOption[] }
export interface Body { x: Combatant; pt: Pt & { size: Size }; conditions: readonly string[]; actions: TurnAction[]; features: readonly string[]; slots: number[] /* free slot levels, ascending */; reach: number; pc: boolean; name: string }
export const canReact: (b: Body) => boolean; // !reactionUsed and no incapacitating condition (economy.ts list)
export function leaveStep(g: Grid, diagonal, mover: Body, foes: Body[], to: Pt, disengaged: boolean): { at: Pt; reactors: Reactor[] } | undefined;
export function counterReactors(g: Grid, diagonal, caster: Body, others: Body[]): Reactor[];
export function hitReactors(target: Body, attacker: Body, o: { melee: boolean }): Reactor[];
export function rebukeReactors(g: Grid, diagonal, victim: Body, source: Body): Reactor[];
export const countered: (spellLevel: number, slot: number, checkTotal?: number) => boolean;
export function rejudge(o: Outcome, bonus: number): Outcome;
export const halved: (o: Outcome) => Outcome;
export function acReaction(t: { name: string; text: string }): { bonus: number; melee: boolean } | undefined;
```

**Rules:**
- **`leaveStep`:** walks the straight line cell by cell (each sample snapped to the grid). It stops at the first cell where some foe that can react, that is hostile (`pc` differs) and that sees the mover leaves its reach. A foe sees the mover when the mover isn't Invisible and the foe isn't Blinded. `at` is the last cell inside that foe's reach.
- **`counterReactors`:** creatures within 60 ft that can react and have an action named Counterspell with cost `reaction` and a free slot of 3 or higher. There is one option per such slot.
- **`hitReactors`:**
  - Shield: a reaction action named Shield and a free slot of 1 or higher.
  - Uncanny Dodge: a PC with the feature who sees the attacker.
  - Parry: the monster's reaction traits through `acReaction`, skipping melee-only ones when `!o.melee`.
- **`rebukeReactors`:** the victim, if it can react, isn't at 0 HP, sees the source within 60 ft, and has a Hellish Rebuke reaction with a free slot. There is one option per slot.

- [ ] **Step 1: Write the failing tests.** Grid size 50 px = 5 ft, with cell (i, j) at (50i, 50j).
```ts
test('leaving a goblin’s reach stops the move where it is, and the goblin may attack', () => {
  // goblin (reach 5) at (0,0), PC at (1,0) moving to (4,0)
  expect(leaveStep(g, '5-5-5', pc, [gob], { x: 200, y: 0 }, false)).toEqual({ at: { x: 50, y: 0 }, reactors: [{ id: 'gob', name: 'Goblin', options: [{ id: 'oa', label: 'Attack (Scimitar)' }] }] });
});
test('a reach-10 foe gets its attack one cell further', () => { expect(leaveStep(g, '5-5-5', pc, [ogreReach10], { x: 200, y: 0 }, false)?.at).toEqual({ x: 100, y: 0 }); });
test('moving around a foe inside its reach, Disengage, an ally, a used reaction, or an invisible mover: no step', () => {
  expect(leaveStep(g, '5-5-5', pc, [gob], { x: 50, y: 50 }, false)).toBeUndefined();
  expect(leaveStep(g, '5-5-5', pc, [gob], { x: 200, y: 0 }, true)).toBeUndefined();
  expect(leaveStep(g, '5-5-5', pc, [allyPc], { x: 200, y: 0 }, false)).toBeUndefined();
  expect(leaveStep(g, '5-5-5', pc, [{ ...gob, x: { ...gob.x, reactionUsed: true } }], { x: 200, y: 0 }, false)).toBeUndefined();
  expect(leaveStep(g, '5-5-5', { ...pc, conditions: ['Invisible'] }, [gob], { x: 200, y: 0 }, false)).toBeUndefined();
});
test('Counterspell: one option per free slot of 3rd or higher, within 60 ft only', () => {
  expect(counterReactors(g, '5-5-5', caster, [wizardAt30ftSlots_1_3_4, wizardAt65ft]).map((r) => r.options.map((o) => o.slot))).toEqual([[3, 4]]);
});
test('countered: 3rd or lower always; higher needs the slot or a check of 10 + level', () => {
  expect(countered(3, 3)).toBe(true); expect(countered(5, 5)).toBe(true);
  expect(countered(5, 3)).toBe(false); expect(countered(5, 3, 15)).toBe(true); expect(countered(5, 3, 14)).toBe(false);
});
test('rejudge: Shield turns a 17 against AC 15 into a miss; a natural 20 still hits', () => {
  expect(rejudge({ id: 'a', part: 'hit', hit: true, roll: 17, ac: 15, damage: 8 }, 5)).toMatchObject({ hit: false, damage: 0, ac: 20 });
  expect(rejudge({ id: 'a', part: 'hit', hit: true, nat: 20, roll: 25, ac: 15, damage: 8 }, 5)).toMatchObject({ hit: true, damage: 8 });
});
test('halved rounds down', () => { expect(halved({ id: 'a', damage: 9 }).damage).toBe(4); });
test('acReaction reads Parry', () => { expect(acReaction({ name: 'Parry', text: 'The knight adds 2 to its AC against one melee attack that would hit it.' })).toEqual({ bonus: 2, melee: true }); });
test('hitReactors: Shield needs a slot; Uncanny Dodge needs to see the attacker', () => { /* wizard with slots [1] → shield; rogue with Uncanny Dodge, attacker Invisible → none */ });
test('Disengage marks the turn', () => { expect(applyUse(k, x, disengage, 1).combatants[0].economy?.disengaging).toBe(true); });
```
- [ ] **Step 2:** `npx vitest run tests/combat/reactions.test.ts`. Expected: FAIL, because the module doesn't exist yet.
- [ ] **Step 3:** Implement. For distance, reuse `tokenFeet` (`src/lib/map/grid.ts`). For reach, use `reachOf(a)?.melee ?? 5` (`targeting.ts`), which the flow passes in as `Body.reach`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `Reactions: who may react, where a move leaves reach, Counterspell and Shield maths`.

### Task 2: The stack (`src/lib/combat/reactionStack.svelte.ts`)

**Interfaces (produces):**
```ts
export const AUTO_PASS_MS = 10_000;
export interface Ask { id: string; kind: ReactKind; trigger: string /* the DM's line */; playerTrigger: string /* players' line: no hidden info */; reactors: Reactor[]; waiting: string /* the combatant whose thing waits */ }
export interface Answer { reactor: string; option: ReactOption['id']; slot?: number; aim?: Aim; d20?: number }
export interface Open extends Ask { answered: string[]; answers: Answer[]; deadline: number }
export const reactions: { open: Open[] }; // $state; the newest is last
export function ask(a: Ask, now?: () => number): Promise<Answer[]>; // no reactors: resolves [] at once and pushes nothing
export function answer(askId: string, a: Answer): boolean; // false: no such open ask, reactor not in it, already answered, or option/slot not offered
export function pass(askId: string, reactor?: string): void; // reactor undefined: all of them
export function onChange(fn: () => void): () => void;
export function reset(): void; // every open ask resolves with the answers it has
```

- [ ] **Step 1: Failing tests** (`tests/combat/reactionStack.test.ts`, using `vi.useFakeTimers()`):
  - `an ask resolves with the chosen answers once every reactor has answered or passed`
  - `an unanswered ask passes by itself after 10 seconds`: advance 9 999 ms and it's still open; advance 1 ms more and it resolves to `[]`.
  - `a nested ask resolves first and the outer one stays open`
  - `answer refuses an option or slot it wasn’t offered, and a second answer`
  - `reset resolves open asks`
  - `an ask with no reactors never opens`
- [ ] **Step 2:** Run the tests and watch them FAIL.
- [ ] **Step 3:** Implement. Each ask holds its own `setTimeout`. `onChange` fires on push, answer and pop.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Reactions: the stack of open asks, passing by itself after 10 s`.

### Task 3: Players' cards and answers (protocol, project, host, guest, session)

**Files:**
- `src/lib/sync/protocol.ts`, `src/lib/sync/project.ts`, `src/lib/sync/host.ts`, `src/lib/sync/guest.ts`, `src/lib/sync/session.svelte.ts`
- Test: `tests/sync/reactions.test.ts`

**Interfaces (produces):**
- `HostMsg | { t: 'reactions'; prompts: ReactPrompt[]; waiting: boolean }`
- `GuestMsg | { t: 'react'; ask: string; characterId: string; option: ReactOption['id'] | 'pass'; slot?: number; aim?: Aim; d20?: number }`
- In `project.ts`:
  - `export interface ReactPrompt { ask: string; trigger: string; ms: number; reactors: { characterId: string; name: string; options: ReactOption[] }[] }`
  - `export function promptsFor(open: Open[], charOf: (combatantId: string) => string | undefined /* that player's own character id */, now: number): ReactPrompt[]`
  - It includes only reactors that are that player's own characters and haven't answered yet. `trigger` comes from `playerTrigger`.
- `HostDeps.reactions?: { open: () => Open[]; answer: typeof answer; pass: typeof pass; onChange: typeof onChange }`.
- The host subscribes in its constructor. On each change it sends every connected player `{ t: 'reactions', prompts, waiting }`.
  - `waiting` is true when some open ask waits on that player's character.
- **`#react`:**
  - The character isn't theirs: a violation.
  - The reactor isn't in the ask: ignored.
  - `'pass'`: `pass(ask, combatantId)`.
  - Otherwise `answer(...)`. A `false` result sends `useRefused('that reaction is not open')`.
- `parseGuestMessage('react')`:
  - checks every field's shape, reusing `cleanAim`;
  - `d20` is 1–20;
  - `slot` is 1–9.
- The guest keeps `session.reactions = { prompts, waiting }`. `sendReact(...)` goes in `session.svelte.ts`.
- `session.connected(): Set<string>` gives the player ids with an open link, for the DM card's offline-PC rule.

- [ ] **Step 1: Failing tests**, following the existing host tests' fakes (`tests/sync/fakes.ts`):
  - `a player gets only their own character’s card, with the players’ line and no combatant ids`. The JSON of the message doesn't contain the monster's combatant id or `"Fireball"`.
  - `the waiting player sees waiting: true`
  - `an answer for someone else’s character is a violation; a slot not offered is refused; pass passes`
  - `parseGuestMessage rejects a react with d20 21 or slot 10`
- [ ] **Step 2:** Run the tests and watch them FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Reactions: players get their own cards and answer them; the DM's device checks each answer`.

### Task 4: The flow (`src/lib/combat/reactionFlow.ts`, DM device)

**Interfaces (produces):**
```ts
export interface FlowCtx { cid: string; settings: CampaignSettings; scene: () => Promise<Scene | undefined>; monster: (id: string) => MonsterDef | undefined; spell: (name: string) => SpellDef | undefined; rng?: () => number }
/** The whole move of the current-turn mover's token: step by step to `to`, asking at each reach edge; returns where it ended. */
export async function guardMove(ctx: FlowCtx, tokenId: string, to: Pt): Promise<Pt>;
/** Before a spell's effects: Counterspell asks (nested, so a Counterspell can be countered). true: it goes ahead. Its cost is already paid. */
export async function guardCast(ctx: FlowCtx, casterId: string, spell: { name: string; level: number }): Promise<boolean>;
/** applyResolution with the reactions around it: hit asks on each hit outcome before, Hellish Rebuke asks after. */
export async function land(ctx: FlowCtx, res: Omit<Resolution, 'applied'>, before?: Snap): Promise<void>;
export async function bodies(ctx: FlowCtx): Promise<Map<string, Body>>; // every combatant with a token on the scene
```

**Rules:**
- `guardMove` writes the token to `at`, keeping the existing `recordMove` / `noteEntries` calls. It then asks and executes the answers, and repeats from `at` until there's no further step.
- It stops early when the mover is at 0 HP, has a condition from `economy.ts`'s list, is Grappled, or a Sentinel hit happened. A Sentinel hit sets `movement[id].mult = 0`.
- **Executing an answer:**
  - **`oa`:**
    - The reactor's action is `react:opportunity` (PC) or the first melee attack from `monsterActions` (monster).
    - The dice come from `answer.aim.rolled`, or are rolled on this device with `rollAim` for monsters and DM-controlled PCs.
    - It's worked out with `workOut`, with `{ target: moverId }`.
    - Payment goes through `applyUse` with cost `reaction`. Then it calls `land`, which nests the mover's Shield ask.
  - **`shield` / `parry`:**
    - Shield puts the `Shield` condition on the reactor, with `{ rounds: 1, at: 'start', of: reactor }`, and spends a slot.
    - Both `rejudge` the outcome by `+5` or `+bonus`. Magic Missile outcomes go to damage 0 under Shield.
  - **`uncanny`:** `halved`.
  - **`counterspell`:**
    - Pays the reaction and the slot.
    - `guardCast` itself takes Counterspell at that slot level.
    - If that goes ahead: `countered(level, slot, d20 + spellcasting mod)`. The d20 comes from the answer, or is rolled here.
  - **`rebuke`:** pays, runs `guardCast`, then `workOut` of the Hellish Rebuke action at that slot against the source, then `land`.
  - A payment that fails becomes a pass, and the player is told why.

- [ ] **Step 1: Failing tests** (`tests/combat/reactionFlow.test.ts`, fake-indexeddb as in `resolveStore.test.ts`). Answer through the stack's `answer` from a `queueMicrotask`.
  - `a PC walking away from a goblin waits at the edge; the goblin’s attack lands; the PC goes on to the end`
  - `a PC dropped to 0 by the attack stays at the edge`
  - `a Sentinel hit stops the move`
  - `nobody answers: the move finishes after 10 s`
  - `a countered Fireball spends its slot and changes nobody’s HP`
  - `a Counterspell countered back lets the spell through`
  - `Shield turns the hit into a miss and leaves the Shield condition until the wizard’s next turn`
  - `Hellish Rebuke after damage hits the attacker for its fire damage`
  - `settings.reactions === false or targeting off: no asks at all`
- [ ] **Step 2:** Run the tests and watch them FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Reactions: moves and casts wait for the stack; hits and damage open their own asks`.

### Task 5: Wiring and the setting

**Files:**
- `src/ui/map/DmMap.svelte`:
  - `onmove`: a single token that's the current run → `guardMove`.
  - `fire`, `useAction` and `summonAction`: a spell → `guardCast` after `pay`. False means stop after the payment.
  - `applyResolution` → `land`.
- `src/lib/sync/host.ts`:
  - `#move`: the current-turn mover → `deps.guardMove`.
  - `#use`: the spell → `deps.guardCast` after payment.
  - `deps.resolve` → `land`.
- `src/lib/sync/session.svelte.ts`: the deps.
- `src/lib/types.ts`: `CampaignSettings.reactions?: boolean`.
- `src/ui/pages/CampaignSettings.svelte`: an "Ask about reactions" checkbox next to Targeting.
- `DmMap` calls `reset()` on load.
- Test: `tests/sync/reactions.test.ts`, extended:
  - `a player’s move away from a goblin stops at the edge until the DM passes, then finishes`
  - `a player’s spell countered by a monster spends the slot and sends no outcome`

- [ ] **Steps 1–5:** failing tests, then RED, implement, GREEN, then commit `Reactions: the map and players' devices go through the stack`.

### Task 6: The card (UI)

**Files:**
- Create: `src/ui/map/ReactionCard.svelte`, docked at the bottom.
  - Props: `prompts: ReactPrompt[]`, `waiting: string | undefined`, `onanswer(ask, characterOrCombatantId, option, slot?)`, `onpass(ask, id?)`.
  - One row per reactor: its name, its option buttons (one button per slot, "Counterspell 3"), and Pass. The card also has "Pass all".
  - A CSS countdown bar with `animation-duration: ${ms}ms`. It isn't modal, and the map stays usable.
- `DmMap.svelte` renders the DM card from `reactions.open`:
  - reactors that are monsters, or PCs whose `ownerId` isn't in `session.connected()`;
  - "Waiting on reactions: names…" when some other reactor is still open;
  - Pass for anyone, from the Results list's Reactions drawer.
- `PlayerMap.svelte` renders `session.reactions`.
  - An OA answer rolls with `rollAim` from that character's `react:opportunity` plan.
  - Counterspell sends a rolled d20, and Hellish Rebuke a rolled aim.
  - `waiting` shows "Waiting on reactions…".
- **Verify in the browser** (DM tab plus a player tab, as in earlier sessions):
  - a goblin's OA card appears when the PC walks away;
  - Pass finishes the move;
  - an untouched card passes after about 10 s.
- [ ] **Commit:** `Reactions: the card`.

### Final
- Full suite, `npx svelte-check`, then the audit command (unchanged count).
- Then one fresh whole-branch review, push by hash, and watch the deploy.
