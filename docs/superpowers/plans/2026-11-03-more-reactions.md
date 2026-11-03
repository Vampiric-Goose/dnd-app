# Every Reaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer every remaining SRD/PHB/XGE/TCE reaction at its moment on the existing card, pay its cost, and work out its effect where it fits a shape (else a "settle by hand" reminder).

**Architecture:** One pure name table (`reactionTable.ts`) says, per reaction, its window, who and how far, its conditions, cost and shape; `tableReactors(window, …)` turns it into card options (`id: 'more'`, `key: <name>`). `reactionFlow.ts` opens the new windows (attack declared, hit for allies too, miss, after the attack, damaged, death, save, entering reach, cast) and applies each shape with the machinery it already has (`rejudge`, `halved`, `strike`, `workOut` through a synthesised action for damage back, a note-only Resolution for reminders).

**Tech Stack:** Svelte 5, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-more-reactions-design.md`

## Global Constraints
- 2014 rules only; mechanics keyed by name only, no book text bundled.
- Nothing waits unless a reaction is available; only the eligible are asked; the card auto-passes after 10 s (`AUTO_PASS_MS`).
- Players never learn monster AC, saves, immunities or combatant ids; a hidden attacker stays "Something" on their card.
- The DM's device validates every player answer (`answer()` checks the offered option, now including `key`).
- Costs are paid through `pay` (the pip, `payment`/`spendOn` for slots, `resourcesUsed` for a resource). A resource on the sheet with none left: not offered. A resource the sheet doesn't track: offered, nothing spent.

## Review Focus
1. A player's card for an ally window must not reveal the roll or the attacker's AC (declared window shows no roll at all).
2. An option answered twice, or with a `key` not offered, is refused by `answer()`.
3. A reaction already spent (pip used) on an earlier window of the same attack is not offered again in a later window.
4. Disadvantage after the roll: a hit that becomes a miss drops its damage; a miss stays a miss; a natural 20 that becomes lower is judged again.
5. Reminder answers pay the cost and leave one note on the Results list; they never change HP.

---

### Task 1: The name table and its dice

**Files:** Create `src/lib/combat/reactionTable.ts`; Modify `src/lib/combat/reactions.ts` (`ReactOption`, `Body.stats`); Test `tests/combat/reactionTable.test.ts`

**Interfaces:**
- Produces:
  - `type Window = 'declared' | 'hit' | 'miss' | 'after' | 'damaged' | 'enter' | 'cast' | 'died' | 'saved'`
  - `ReactOption` gains `id: … | 'more'`, `key?: string` (the table name), `strike?: true` (the player's device rolls its Opportunity Attack aim), `spell?: string` (War Caster's cantrip).
  - `Body` gains `stats?: { prof: number; mods: Record<Ability, number>; levels: Record<string, number> /* class name → level */; left: Record<string, number> /* resource → uses left */; dc?: number }` (PCs only).
  - `interface Trigger { window: Window; actor: Body /* attacker, mover, caster, the one who died */; target?: Body; melee?: boolean; ranged?: boolean; damage?: number; type?: string /* damage type */; crit?: boolean; edge?: boolean /* the roll had adv/dis */ }`
  - `tableReactors(g, diagonal, t: Trigger, all: Body[]): Reactor[]`
  - `amount(key: string, b: Body, slot?: number): string` (the dice expression, e.g. `'1d8+3'`)
  - `entry(key): Rx | undefined`; `Rx.shape: 'ac' | 'dis' | 'cut' | 'resist' | 'back' | 'attack' | 'roll' | 'miss' | 'nemesis' | 'note'`
- Die sizes: superiority d8, d10 at Fighter 10, d12 at 18; Bardic d6, d8 at Bard 5, d10 at 10, d12 at 15; psi die d6 (Fighter 3), d8 at 5, d10 at 11, d12 at 17.

- [ ] **Step 1: failing tests** — `tableReactors` for: Protection (ally within 5 ft, `declared`, label `Protection (disadvantage)`); Parry maneuver (`hit`, melee only, label `Parry (−1d8+3)` for Fighter 3 with Dex +3; `1d10+3` at Fighter 10); Interception (ally within 5, `hit`, `1d10+2`); Deflect Missiles only on a ranged hit; Defensive Duelist only with a finesse weapon on a melee hit (`+prof AC`); Warding Flare not offered when its tracked resource has 0 left, offered when untracked; Song of Defense one option per free slot (`slot` set); Cutting Words for an ally within 60 ft; Absorb Elements only on acid/cold/fire/lightning/thunder; a used reaction or a Blinded reactor that must see gets nothing; a monster's non-Parry reaction trait comes back as a `note` option only in `hit` when it is the target.
- [ ] **Step 2: run** `npx vitest run tests/combat/reactionTable.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: implement** the table (one `Rx` per name listed in the spec's shapes table and windows, `when` predicates on the `Trigger`), `amount`, `tableReactors`. Detection: a PC has it when `features` holds the name or it has a reaction action of that name (spells); a monster: its reaction actions other than the AC kind.
- [ ] **Step 4: run** — Expected: PASS; `npx vitest run tests/combat` green.
- [ ] **Step 5: commit** `Reactions: a name table for every remaining reaction (windows, who, cost, shape, dice)`

### Task 2: Answers carry the table name

**Files:** Modify `src/lib/combat/reactionStack.svelte.ts`, `src/lib/sync/protocol.ts`, `src/lib/sync/guest.ts`, `src/lib/sync/host.ts`, `src/ui/map/ReactionsPlayer.svelte`, `src/ui/map/ReactionsDm.svelte`, `src/ui/map/ReactionCard.svelte` (keyed each by `id+key+slot`); Test `tests/combat/reactionStack.test.ts`, `tests/sync/protocol.test.ts`

**Interfaces:** `Answer.key?: string`; `react` message `key?: string` (≤ 100 chars); `answer()` accepts only an option whose `id`, `slot` and `key` all match one offered.

- [ ] **Step 1: failing tests** — `answer()` refuses `{ option: 'more', key: 'Riposte' }` when only `Parry` was offered and accepts `Parry`; `parseGuest` keeps `key` and rejects a 101-char one; `cleanReactions` keeps `key`, `strike`, `spell`.
- [ ] **Step 2: run** — Expected: FAIL.
- [ ] **Step 3: implement**; the player's device sends `strike` options with an Opportunity Attack aim (War Caster: that cantrip's aim), others with `key` (and `slot`).
- [ ] **Step 4: run** `npx vitest run tests/combat tests/sync` — Expected: PASS.
- [ ] **Step 5: commit** `Reactions: answers name the table reaction they use`

### Task 3: The attack windows in `land`

**Files:** Modify `src/lib/combat/reactionFlow.ts`, `src/lib/combat/reactions.ts` (`disadvantaged(o, d20)`, `lowered(o, n)`); `src/lib/combat/flowCtx.ts` (`dice(label, expr): number`, private roll); Test `tests/combat/reactionFlow.test.ts`

**Interfaces:**
- `disadvantaged(o: Outcome, d20: number): Outcome` — keeps the lower natural die; judged again (a hit that misses drops `damage`, `later`, riders as `rejudge` does).
- `lowered(o: Outcome, n: number): Outcome` — the roll minus `n`, judged again (Cutting Words, Bend Luck).
- `FlowCtx.dice?(label: string, expr: string): number`.

- [ ] **Step 1: failing tests** (`land` with fake-indexeddb as the existing flow tests do): Protection answered turns a 15-vs-14 hit into a miss when the second d20 is lower; Parry maneuver cuts the damage by the rolled amount and spends one Superiority Dice use; Riposte after a melee miss lands an attack on the attacker; Wrath of the Storm after a hit deals damage to the attacker with its Dex save; a reminder (Misty Escape) adds a note-only result and spends the Reaction; a reaction spent in `declared` is not offered in `hit`.
- [ ] **Step 2: run** — Expected: FAIL.
- [ ] **Step 3: implement** in `land`, per attack outcome: `declared` ask (target and allies; no roll in either line) → `hit`/`miss` asks (today's plus the table's, allies included) → apply → `after` (Sentinel, Giant Killer, Glorious Defense's attack) and `damaged` asks (today's Rebuke plus the table's) → `died` and `saved` reminders. `back` runs through `strike` with a synthesised reaction action (`cast.read` save + dice, `cast.dc` from `stats.dc`); `attack` through `strike` with `oaAction` (its die added to the weapon damage); `note` through `remind(ctx, b, rx, about)`.
- [ ] **Step 4: run** `npx vitest run` — Expected: all green.
- [ ] **Step 5: commit** `Reactions: attack declared, hit, miss, after and damaged windows for the table`

### Task 4: Movement and casting windows

**Files:** Modify `src/lib/combat/reactions.ts` (`leaveStep` → also entering reach; Sentinel ignores Disengage), `src/lib/combat/reactionFlow.ts` (`walk`, `guardCast`); Test `tests/combat/reactions.test.ts`, `tests/combat/reactionFlow.test.ts`

- [ ] **Step 1: failing tests** — a mover entering a Polearm Master's 10-ft reach stops on the entered square with an `enter` ask; a Disengaged mover still provokes a Sentinel; Halo of Spores asks at 10 ft; Mage Slayer is asked when a creature within 5 ft casts; Magic-User's Nemesis's failed save counters the spell; War Caster offers the reactor's one-target cantrips as `spell` options on the Opportunity Attack card.
- [ ] **Step 2: run** — Expected: FAIL.
- [ ] **Step 3: implement**.
- [ ] **Step 4: run** `npx vitest run`, `npx svelte-check` — Expected: green, 0 errors.
- [ ] **Step 5: commit** `Reactions: entering reach, Sentinel past Disengage, Mage Slayer, Nemesis, War Caster`

### Task 5: Check it in the app, review, ship
- [ ] Browser: a PC Battle Master is hit by a monster → card shows Parry with its die; answering cuts the damage on the Results list.
- [ ] Final whole-branch review (most capable model); one fix pass.
- [ ] Push by hash to main; watch the deploy.
