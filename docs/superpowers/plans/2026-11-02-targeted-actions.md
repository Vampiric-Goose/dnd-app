# Targeted Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attacks and damaging spells pick their target (a creature or a point) on the map, roll, and resolve against AC and saves, with damage applied, on the DM's device.

**Architecture:**
- **Rules:** pure functions in `src/lib/combat/targeting.ts` (range, options, defenses, area membership) and `src/lib/combat/resolve.ts` (one use → per-target outcomes).
- **Storage and undo:** the DM's device applies the outcomes through the existing `changeHp` and keeps an undo log on the Combat.
- **Players:** a player's device sends raw dice faces with `use`; the host resolves and answers the player alone with an allowlisted `outcome`.
- **PC saves:** pending on the Combat, projected to the owning player as an in-app prompt.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, IndexedDB, the relay sync.

**Spec:** `docs/superpowers/specs/2026-11-02-targeted-actions-design.md`

## Global Constraints

- **Rules:** 2014 rules only. No book text in the repo; spell facts come only from `readSpell` over imported text.
- **The setting:** `CampaignSettings.targeting?: boolean`. It counts as **on unless `=== false`**, so existing campaigns are on with no migration. When it's off, the turn panel behaves exactly as today.
- **Players never receive:**
  - a monster's AC, save bonus, save roll or result, or HP numbers beyond `showMonsterHealth`;
  - a hidden creature's id or name;
  - damage on a miss.
- **DCs:** the acting player gets the DC of a spell they cast; no one else does.
- **No browser dialogs** (`alert`, `confirm`, `prompt`) in new UI. Prompts are in-app.
- **Range (PHB):**
  - **Weapons:** beyond normal range, disadvantage; beyond long range, the target can't be picked.
  - **Spells:** one range only.
  - **Close combat:** a ranged attack (weapon or spell) has disadvantage when a non-incapacitated hostile is within 5 ft. The DM can clear it.
  - **Reach:** 5 ft, or 10 ft with the reach property.
- **Areas:** a creature is inside when any footprint cell is covered. Hidden creatures are caught but never listed to players.
- **Hits:** a natural 20 always hits and doubles the damage dice; a natural 1 always misses.
- **Repo rules:** commit and push only by explicit hash. Agents use no shell heredocs and no complex `node -e`.

## Review Focus

1. **A crafted `use`:** forged faces (a 25 on a d20, the wrong die count), a target out of range, or a hidden target. The host refuses it, and nothing is spent or applied. (Task 4 test.)
2. **A player's device:**
   - The disconnect test: the player goes offline after sending. The use resolves once on the host, and nothing is applied twice on reconnect. (Task 4 test: the same `use` sent twice spends twice only if the pip allows, so a second identical use is refused by `problemOf`.)
   - The leak test: an area catches a hidden monster and a PC. The PC's prompt arrives, and the hidden monster's id appears in no player message. (Task 4 test.)
3. **Undo after HP changed again:** the DM undoes resolution 1 after resolution 2 hit the same goblin. Undo restores only resolution 1's delta, not a stale snapshot. (Task 3 test.)
4. **Damage to 0 HP on a concentrating creature:** the existing concentration loss still happens. (Task 3 test, through `changeHp`.)
5. **Setting off:** no aim button, no outcome messages, and today's roll buttons. (Task 6 browser check.)

---

### Task 1: Spell text and dice faces

**Files:**
- Modify: `src/lib/combat/spellText.ts` (SpellRead, readSpell)
- Modify: `src/lib/dice.ts` (rollDice)
- Modify: `src/lib/rules/sheet.ts` (Attack.range)
- Modify: `src/lib/types.ts` (Attack)
- Test: `tests/combat/spellcasting.test.ts`, `tests/dice.test.ts`, `tests/rules/sheet.test.ts`

**Interfaces:**
- **Produces:**
  - `SpellRead.damage[i].on?: 'hit' | 'save'`. When a spell has both an attack and a save, damage in a sentence with "failed save" / "saving throw" is `'save'`, and the rest is `'hit'`.
  - `SpellRead.onSave?: 'half' | 'none'`: "half as much damage on a successful one" gives `'half'`; a save with no such phrase gives `'none'`.
  - `SpellRead.burst?: number`: "each creature within N feet of (it|the target|the point …)" gives N.
  - `SpellRead.range?: { feet: number } | 'self' | 'touch'`, parsed from `SpellDef.range` ("60 feet", "Self (15-foot cone)", "Touch", "1 mile" gives 5280).
  - `rollDice(...)` returns `{ total, detail, faces: number[] }`: every die rolled, in term order, both d20s with advantage.
  - `Attack.range?: [number, number]`, copied from `weapon.range`.

- [ ] **Step 1:** Tests in `tests/combat/spellcasting.test.ts`, with fixture text paraphrased (no book text):
  - `readSpell` on an Ice-Knife-like fixture gives `attack: 'ranged'`, `save: 'Dex'`, damage `[{dice:'1d10',type:'piercing',on:'hit'},{dice:'2d6',type:'cold',on:'save'}]`, `burst: 5`, `onSave: 'none'`.
  - A Fireball-like fixture gives `onSave: 'half'`, `range: { feet: 150 }`.
  - A Sleep-like fixture (no damage, a 20-ft sphere) gives `area.feet === 20` and `damage: []`.
  - `tests/dice.test.ts`: `rollDice('2d6+3', { rng: seq(0, 0.99) }).faces` equals `[1, 6]`, and the total is 10.
  - A sheet test: a longbow attack has `range: [150, 600]`.
- [ ] **Step 2:** Run `npx vitest run tests/combat/spellcasting.test.ts tests/dice.test.ts tests/rules/sheet.test.ts`. Expected: FAIL on the new fields.
- [ ] **Step 3:** Implement. readSpell keeps its current regex style; `faces` is collected where each die is rolled.
- [ ] **Step 4:** Run the same command. Expected: PASS, and the full suite stays green.
- [ ] **Step 5:** Commit: "Spell text: hit/save damage, burst, range; dice faces".

### Task 2: Targeting rules (pure)

**Files:**
- Create: `src/lib/combat/targeting.ts`
- Test: `tests/combat/targeting.test.ts`

**Interfaces:**
- **Consumes:** Task 1 (`Attack.range`, `SpellRead.range` and `burst`); `feetBetween` and `footprint` (`src/lib/map/grid.ts`); `tokensInTemplate` and `Template` (`src/lib/map/templates.ts`); `rollParts` (`src/lib/monsters/library.ts`).
- **Produces:**
  - `targetingOn(s: CampaignSettings): boolean`, meaning `s.targeting !== false`.
  - `type Reach = { melee: number } | { normal: number; long: number } | { spell: number } | 'self'`.
  - `reachOf(a: TurnAction): Reach | undefined`:
    - weapon `attack`: reach property gives `{melee:10}`, a ranged or thrown weapon with `range` gives `{normal,long}`, otherwise `{melee:5}`;
    - `cast.read.range`: feet gives `{spell}`, touch gives `{melee:5}`, self gives `'self'`;
    - monster text: "reach N ft" gives `{melee:N}`, "range N/M ft" gives `{normal:N,long:M}`.
  - `type Pickable = { ok: false } | { ok: true; disadvantage?: 'long range' | 'hostile within 5 ft' }`.
  - `canTarget(reach: Reach, feet: number, foeWithin5: boolean, ranged: boolean): Pickable`.
  - `attackToggles(a: TurnAction, features: string[]): { id: 'gwm' | 'ss'; name: string; toHit: -5; damage: 10 }[]`:
    - GWM: a melee attack whose properties include heavy, when features include "Great Weapon Master";
    - SS: a ranged weapon attack, when features include "Sharpshooter".
  - `type Defenses = { resist: string[]; immune: string[]; vulnerable: string[] }`.
  - `afterDefenses(amount: number, type: string, d: Defenses, magical: boolean): { amount: number; note?: string }`:
    - immune gives 0; resist gives `floor(amount / 2)`; vulnerable gives ×2.
    - A clause naming "nonmagical" applies to bludgeoning, piercing or slashing only when `magical` is false.
  - `inArea(t: Template, g: Grid, tokens: Token[]): string[]` returns token ids (hidden included), as a wrapper of `tokensInTemplate`.
  - `monsterAttack(a: TurnAction): { toHit: number; dmg: { expr: string; type: string }[]; ranged: boolean } | undefined`:
    - read from the monster action text: the `rollParts` hit part gives `toHit`, each damage part plus the word after it ("slashing") gives a `dmg` entry;
    - "Ranged Weapon Attack" gives `ranged`;
    - undefined when the text has no to-hit.
  - `finalMode(player: 'adv' | 'dis' | undefined, forced?: 'long range' | 'hostile within 5 ft'): 'adv' | 'dis' | undefined`: forced disadvantage combined with the player's pick, where advantage plus disadvantage cancel out.
- [ ] **Step 1:** Tests:
  - `canTarget({normal:150,long:600}, 200, false, true)` gives `{ok:true, disadvantage:'long range'}`.
  - 650 ft gives `{ok:false}`.
  - `canTarget({melee:5}, 10, …)` gives `{ok:false}`; `{melee:10}` at 10 is ok.
  - Spell `{spell:60}` at 60 is ok and at 65 is not; with `foeWithin5` and ranged it gives `'hostile within 5 ft'`.
  - `monsterAttack` on "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage." gives `{toHit:4, dmg:[{expr:'1d6+2', type:'slashing'}], ranged:false}`; text with no to-hit gives undefined.
  - `finalMode('adv', 'long range')` gives undefined; `finalMode(undefined, 'long range')` gives `'dis'`.
  - `attackToggles`:
    - a greatsword (heavy, melee) and "Great Weapon Master" gives `[gwm]`;
    - a longbow and "Great Weapon Master" gives `[]`;
    - no feat gives `[]`.
  - `afterDefenses`:
    - `(14, 'cold', {resist:['cold'],…}, false)` gives `{amount:7, note:'resistant to cold'}`;
    - `(10, 'slashing', {resist:['bludgeoning, piercing, and slashing from nonmagical attacks'],…}, true)` gives `{amount:10}`;
    - the same call with `magical: false` gives 5;
    - immune gives 0; vulnerable gives 20.
  - `inArea`: a 5-ft sphere on G2's centre includes G2, excludes a token 10 ft away, and includes a Large token with one footprint cell inside.
- [ ] **Step 2:** Run `npx vitest run tests/combat/targeting.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `targeting.ts`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: "Targeting rules: reach, range, toggles, defenses, areas".

### Task 3: Resolution and the undo log (DM device)

**Files:**
- Create: `src/lib/combat/resolve.ts`
- Modify: `src/lib/types.ts` (Combat)
- Modify: `src/lib/combat/store.ts`
- Test: `tests/combat/resolve.test.ts`

**Interfaces:**
- **Consumes:** Task 2; `changeHp` (store.ts).
- **Produces:**
  - `interface TargetInfo { id: string; ac: number; save: Record<Ability, number>; defenses: Defenses; pc: boolean; hidden: boolean }`.
  - `interface Rolled { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[]; crit?: boolean }`: raw faces, `dmg` in the order of the damage dice (doubled on a crit).
  - `interface Outcome { id: string; hit?: boolean; nat?: 20 | 1; save?: { roll: number; total: number; ok: boolean }; damage: number; note?: string; pending?: true }`.
  - `interface Resolution { id: string; actor: string; action: string; dc?: number; toHit?: number; outcomes: Outcome[]; at: number }`.
  - `checkFaces(exprs: string[], r: Rolled): string | undefined`: the problem with forged dice (count, or a face outside 1..sides), or undefined.
  - `resolveAttack(t: TargetInfo, toHit: number, dmgExprs: { expr: string; type: string }[], r: Rolled, magical: boolean, rng: () => number): Outcome`.
  - `resolveSpell(read: SpellRead, slot: number, dc: number | undefined, toHit: number | undefined, target: TargetInfo | undefined, caught: TargetInfo[], r: Rolled, rng: () => number): Outcome[]`:
    - attack part: on `target`, `on:'hit'` damage;
    - save part: each of `caught` (or the target, with no area); monsters roll `rng`; a PC gets `pending: true` with no roll;
    - `on:'save'` damage applies in full on a fail and by `onSave` on a success.
  - `Combat.resolutions?: Resolution[]` (the last 20) and `Combat.pendingSaves?: { resolution: string; target: string; ability: Ability; dc: number }[]`.
  - Store functions:
    - `applyResolution(cid: string, r: Resolution, settings: CampaignSettings): Promise<Combat>`: `changeHp` per outcome with damage > 0 that isn't pending, then appends.
    - `undoResolution(cid: string, rid: string, settings: CampaignSettings): Promise<Combat>`: heals each outcome's applied amount back with `changeHp({heal})`. A PC at 0 also gets its dying state restored from `before`, which `applyResolution` stores per outcome.
    - `settleSave(cid: string, rid: string, target: string, d20: number, settings: CampaignSettings): Promise<Combat>`.
- [ ] **Step 1:** Tests:
  - `checkFaces(['2d6+3'], {dmg:[7,1]})` gives a problem; `[3,4]` gives undefined; a crit expects 4 faces.
  - `resolveAttack` against AC 15: toHit 5, d20 `[10]` hits (15); `[9]` misses with damage 0; `[1]` misses whatever the bonus; `[20]` hits, `nat: 20`.
  - Advantage `[4,18]` uses 18; GWM is applied by the caller as toHit −5 / damage +10.
  - `resolveSpell` with the Ice-Knife read:
    - the target is hit for 1d10, and each caught monster saves;
    - a fail takes 2d6 cold; a success takes 0 (`onSave:'none'`);
    - a caught PC is `pending`.
  - With a Fireball read, a success halves the damage (floor).
  - Store: `applyResolution` lowers a goblin's hp, and `undoResolution` restores it.
  - Resolution 1 then 2 hit the same goblin: undoing 1 restores only 1's damage (Review Focus 3).
  - A concentrating monster at 0 loses concentration (Review Focus 4).
  - `settleSave` applies or halves, then clears the pending entry.
- [ ] **Step 2:** Run `npx vitest run tests/combat/resolve.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. The store functions go through `serial` like their neighbours. Undo heals the recorded applied amount, which is what makes it delta-based.
- [ ] **Step 4:** Run it again plus the full suite. Expected: PASS.
- [ ] **Step 5:** Commit: "Resolve targeted uses; undo log and pending PC saves".

### Task 4: Sync: aim on `use`, outcome back, PC save prompt

**Files:**
- Modify: `src/lib/sync/protocol.ts`, `host.ts`, `guest.ts`, `project.ts`, `session.svelte.ts`
- Test: `tests/sync/actions.test.ts`, `tests/sync/tracker.test.ts`

**Interfaces:**
- **Consumes:** Tasks 2 and 3.
- **Produces:**
  - The guest `use` gains `aim?: { target?: string; point?: { x: number; y: number }; rolled: Rolled; toggles: ('gwm' | 'ss')[] }`, validated in `parseGuest`: numbers are integers and arrays are at most 40 long.
  - New guest message: `{ t: 'save'; resolution: string; d20: number }` (1..20).
  - New host message: `{ t: 'outcome'; action: string; hit?: boolean; damage?: number; dc?: number; caught?: string[] }`, sent only to the acting connection:
    - `damage` is present only when `hit`;
    - `caught` lists the names of visible creatures only;
    - the message never includes an AC, a save roll or a monster's HP.
  - `TrackerView.saves?: { resolution: string; ability: Ability; dc: number; spell: string }[]`: the viewer's own characters' pending saves only.
  - `sendUse(characterId, action, slot?, target?, aim?)` and `sendSave(resolution, d20)` in session.svelte.ts.
  - Host `#use`, when `targetingOn(camp.settings)` and `aim` is present:
    - resolve the target alias (refuse hidden or unknown);
    - check `canTarget` from token positions on the shown scene. The host computes the mode itself with `finalMode(rolled.mode, forced)`: with two d20 faces and a normal result it uses the first; with one face and a forced disadvantage it refuses (the player's device rolls two whenever the forced disadvantage applies);
    - run `checkFaces`;
    - `resolveAttack` or `resolveSpell` (caught = `inArea` over every token, hidden included);
    - `applyUse` (pay), then `applyResolution`, then send `outcome`.
    - Any refusal happens before paying.
  - Host `#save`: only the owner of the pending target; then `settleSave`.
- [ ] **Step 1:** Tests in `tests/sync/actions.test.ts`, using the existing fakes:
  - A greatsword use with d20 `[17]` against an AC 15 goblin: the goblin loses the damage total, and the player's `outcome` is `{hit:true, damage}` with no `ac` key.
  - d20 `[2]`: the outcome is `{hit:false}` with no `damage` key, and the goblin is unchanged.
  - A forged d20 `[25]`, a wrong dmg count, an out-of-range target, or a hidden target: refused, nothing spent, HP unchanged (Review Focus 1).
  - An Ice-Knife use whose burst catches a hidden goblin and a PC:
    - the hidden goblin takes damage on the host;
    - its id and name appear in no message to any player;
    - the PC owner's tracker gets `saves[0]` with `dc` (Review Focus 2).
  - `save` from a non-owner is a violation; from the owner it applies.
  - A tracker test: another player's pending saves are not in this viewer's view.
- [ ] **Step 2:** Run `npx vitest run tests/sync`. Expected: FAIL.
- [ ] **Step 3:** Implement. Reuse `#aliases` for target ids; player-facing names come from `trackerForPlayers` rows.
- [ ] **Step 4:** Run `npx vitest run tests/sync` plus the full suite. Expected: PASS.
- [ ] **Step 5:** Commit: "Sync: targeted use, outcome, PC save prompt".

### Task 5: Map aiming

**Files:**
- Modify: `src/ui/map/MapCanvas.svelte`

**Interfaces:**
- **Consumes:** Task 2.
- **Produces:** a MapCanvas prop `aim?: { from: Pt; pickable: (t: Token) => Pickable; area?: { shape: Shape; feet: number; width?: number; on: 'creature' | 'point' | 'self' }; line: boolean; onpick: (p: { tokenId?: string; point: Pt; caught: string[] }) => void; oncancel: () => void }`.
- **Behaviour:**
  - While `aim` is set, pickable tokens get a ring, and other tokens dim.
  - With `line`, a dashed line runs from `from` to the hovered or picked target.
  - An area previews under the pointer (on a creature: centred on it; on a point: any cell in range; self: from `from`, aimed at the pointer), and the ids inside are reported.
  - On touch, a tap picks and a second tap on the same spot confirms. Escape or the panel's Cancel leaves aiming.
- [ ] **Step 1:** Implement, reusing the Template drawing and `inArea`. Rendering has no unit test; the browser check in Task 6 covers it.
- [ ] **Step 2:** Run `npm run check`. Expected: 0 errors.
- [ ] **Step 3:** Commit: "Map: aim mode (pickable ring, target line, area preview)".

### Task 6: Turn panel, DM log, setting

**Files:**
- Modify: `src/ui/turn/TurnPanel.svelte`, `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte`, `src/ui/pages/CampaignSettings.svelte`
- Create: `src/ui/initiative/SavePrompt.svelte`
- Modify: `src/App.svelte` (mount SavePrompt when `session.tracker?.saves?.length`)

**Interfaces:**
- **Consumes:** Tasks 1–5.
- **TurnPanel:**
  - New props `targeting: boolean` and `onaim?: (a: TurnAction, slot?: number, toggles: string[]) => void`.
  - When `targeting` is true and `reachOf(a)` exists (an attack, or a spell with an attack, save or area), the entry shows **Target** instead of the roll and Cast buttons.
  - GWM and SS toggles show above Target; advantage and disadvantage use the existing roll mode.
  - When `targeting` is false, the entry is unchanged.
- **Map pages** (DmMap and PlayerMap):
  - `onaim` sets the canvas `aim`.
  - On pick, the device rolls `rollDice` for the d20(s) and damage (crit if nat 20), keeping the faces. It shows the d20 roll at once and holds the damage.
  - **Player:** `sendUse(..., aim)`. On `outcome`, show "Hit" with the damage (shared via `rollTo`-style public entry) or "Miss", plus the DC for a spell and the caught names.
  - **DM:** builds TargetInfo from combatants and sheets, then resolves, `applyUse`, `applyResolution` locally.
- **DM log:** a "Results" list in the Turn tab shows each Resolution with every roll, AC, save and note (including "disadvantage: hostile within 5 ft"), an **Undo** button, and **Roll for them** on pending PC saves (it calls `settleSave` with a d20 rolled on the DM's device).
  - Ruling: for a player's attack, the DM "clears" a close-combat disadvantage after the fact by Undo, then the player attacks again. A one-message use can't wait for the DM before rolling. When the DM attacks with a monster, the panel offers a "No disadvantage" toggle before rolling.
- **SavePrompt:** "Dex save, DC 13 (Ice Knife)", with a Roll button that rolls a d20 and calls `sendSave`. It follows InitiativePrompt's pattern.
- **CampaignSettings:** a "Targeting" checkbox that writes `targeting` (checked unless false).
- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `npm run check && npx vitest run && npm run build`. Expected: 0 errors, all pass.
- [ ] **Step 3:** Browser check on the test campaign. Add a level 3 wizard PC with Ice Knife and Sleep from the SRD/test pack, if those spells are present; otherwise use the Mage's Fireball and Cone of Cold.
  1. The fighter targets an adjacent goblin with GWM: the d20 shows, and HP drops on a hit.
  2. On a miss, no damage shows.
  3. The DM's Results list shows the AC and an Undo that restores the HP.
  4. An area on an empty point lists who is inside.
  5. Ranged: a dashed line to the target.
  6. Setting off: today's buttons and no Target (Review Focus 5).
- [ ] **Step 4:** Commit: "Turn panel: Target flow, DM results log with Undo, save prompt, setting".

### Final review

One fresh review of the whole range on the most capable model, against the spec and the Review Focus. Fix Critical and Important findings with RED→GREEN tests, then push by hash.
