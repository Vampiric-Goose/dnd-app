# Every Spell Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every SRD/PHB/XGE/TCE spell resolves as the book says in a fight: right reads, buffs that change numbers, helpful spells on allies, summons in the fight; utility spells cast and track.

**Architecture:** The reader (`spellText.ts`) is fixed by wording class, checked against the book tags by the local audit. A spell's named condition carries its effects from one table (`SPELL_EFFECTS`), read by the sheet (PCs), `targetOf`/`attackEdge`/`resolveSpell` (everyone). Helpful spells and summons are new aim plans worked out by `workOut` and applied by `applyResolution`, so Undo, sync and one roster come for free.

**Tech Stack:** Svelte 5, TypeScript, Vitest, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-11-02-every-spell-design.md`

## Global Constraints

- 2014 rules only; nothing from 2024 enters.
- No book data in the repo or the bundle: tests use synthetic wording; the audit reads `SPELLS_5E` at run time. Name-keyed rules are mechanics only.
- Never silently wrong: anything not automated sets `SpellRead.manual`.
- Players never learn monster AC, saves, immunities or combatant ids (`UseOutcome` stays as it is).
- One roster: any creature a spell adds is in the fight and on the map; it leaves both together.
- A lasting spell leaves a condition named after itself on what it affects.
- Each task ends green: `npx vitest run` and `npx svelte-check --threshold error`, then a commit; push by hash after Tasks 3, 6, 8 and 9 with the deploy watched.

## Review Focus

1. A buff on a player's character (Bless) shows up in an attack the player sends from their own device (host path), not only on the DM's map. → Task 5 test.
2. Concentration ending takes a buff's numbers away: a PC's AC and a monster's AC both drop back. → Task 5 test.
3. Upcast target counts: Bless at a 2nd-level slot takes four creatures; healing at higher slots heals more. → Task 6 test.
4. A summon's creature and its token both go when concentration ends or it drops to 0 HP. → Task 7 test.
5. An enemy's Shield raises its AC without the player learning the number: the player's outcome stays hit or miss. → Task 5 test.

---

### Task 1: Saves and half damage, by every wording

**Files:** Modify `src/lib/combat/spellText.ts` (save and `onSave` reads, ~lines 68-71, 120). Test `tests/combat/spellText.test.ts`.

- [ ] **Step 1: Failing tests** (synthetic wording, each a `readSpell({ text, level, range })`):
  - `'... must make a Constitution saving throw. On a failed save, a creature takes 2d8 thunder damage. On a successful save, the creature takes half as much damage and isn\'t pushed.'` → `onSave: 'half'`.
  - `'... takes 2d6 necrotic damage on a failed save. On a successful save, a creature takes half damage, but suffers no other effect.'` → `'half'`.
  - `'A creature that succeeds on its saving throw takes half as much damage and isn\'t knocked prone.'` (with a Str save before it) → `'half'`.
  - `'... the target has advantage on Dexterity saving throws ...'` (Haste-like, no forcing phrase) → `save` undefined.
  - `'If you target an object held or worn by a hostile creature, that creature must succeed on a Dexterity saving throw to avoid the spell.'` on a spell with no damage or condition (Light-like) → `save` undefined.
  - `'... creature of your choice ... must make a Wisdom saving throw ...'` keeps `save: 'Wis'`.
- [ ] **Step 2:** `npx vitest run tests/combat/spellText.test.ts` → the new cases FAIL.
- [ ] **Step 3:** `save` comes only from a forcing phrase (`must (make|succeed on) a(n)? <Ability> saving throw`, `makes? a(n)? <Ability> saving throw`) unless `mech.save` says otherwise; Light's object clause is excluded when the spell has no damage and no condition. `onSave` is `'half'` when a sentence that mentions a success (`successful save|succeeds on`) also says `half (as much )?damage`.
- [ ] **Step 4:** Tests PASS; the full suite and the audit (`SPELLS_5E=… AUDIT_OUT=… npx vitest run scripts/spell-audit.test.ts`) show no spell whose text has "half … damage" on a success reading `none` (Thunderwave, Dissonant Whispers, Arms of Hadar, Tidal Wave, Spirit Guardians…).
- [ ] **Step 5:** Commit `Spell reader: half damage on a save in any wording; a save only when one is forced`.

### Task 2: Ranges, upcasts and areas

**Files:** Modify `src/lib/combat/spellText.ts`, `src/lib/combat/targeting.ts` (`reachOf`). Test `tests/combat/spellText.test.ts`, `tests/combat/aiming.test.ts`.

**Produces:** `SpellRead.reach?: number` (feet an attack of a range-Self spell reaches).

- [ ] **Step 1: Failing tests:**
  - Range `'Self'`, `'make a melee spell attack against a creature within your reach'` → `reachOf` gives `{ melee: 5 }`; `'hurl the flame at a creature within 30 feet of you ... ranged spell attack'` → `{ spell: 30 }` (workOut then hits a target 5 ft away instead of `'out of range'`).
  - Higher levels `'the damage increases by 1d8, for each slot level above 1st'` → `perSlot { dice: '1d8', above: 1, step: 1 }`; `'each target takes 1d6 extra damage of the type rolled for each slot level above 1st'` → `perSlot { dice: '1d6', above: 1, step: 1 }`.
  - `'each creature of your choice that you can see within 5 feet of you must succeed on a Constitution saving throw'` → `area { shape: 'sphere', feet: 5, self: true }`.
  - `'one creature of your choice that you can see within 15 feet of you'` with a Str save → no `area` (one target, range 15).
- [ ] **Step 2:** FAIL as expected.
- [ ] **Step 3:** Read `reach` for range-Self attacks (melee → 5; "within N feet" with a ranged attack → N); `reachOf` uses it before `'self'`. Widen the upcast pattern to allow a comma and the "N extra damage … for each slot level above" form. "Each creature of your choice within N feet of you" counts as the self sphere; "one creature" never does. The blade cantrips (Booming Blade, Green-Flame Blade: "make a melee attack with a weapon") get `manual: 'Make the weapon attack, then apply its extra effect by hand.'` and no spell attack.
- [ ] **Step 4:** PASS; audit shows no `BROKEN: out of range` left except spells with no attack and no save (those are `none`).
- [ ] **Step 5:** Commit `Spell reader: range-Self attacks reach, every upcast wording, areas of your choice`.

### Task 3: Damage parts that are not a sum

**Files:** Modify `src/lib/combat/spellText.ts` (`SpellRead.damage[].part`), `src/lib/combat/aiming.ts`, `src/lib/combat/resolve.ts`, `src/lib/combat/spellRules.ts`. Test `tests/combat/resolve.test.ts`, `tests/combat/spellText.test.ts`.

**Produces:** `damage[i].part?: 'alt' | 'later' | 'others'`; `Resolution.later?: { dice: {expr:string;type:string}[]; target: string; due: 'endOfTargetTurn' }`.

- [ ] **Step 1: Failing tests:**
  - Two dice where the second applies "instead … if the target is missing any of its hit points" (Toll the Dead wording) → second part `'alt'`; resolving against a target at full HP deals only the first; at less than full only the second.
  - "takes 3d8 radiant damage (if you are good or neutral) or 3d8 necrotic damage (if you are evil)" → one damage entry with `choices: ['radiant','necrotic']`.
  - Acid Arrow wording ("4d4 acid damage immediately and 2d4 acid damage at the end of its next turn. On a miss … half as much of the initial damage and no damage at the end of its next turn") → first part on hit, second `'later'`; a hit leaves `Resolution.later`; `turn()` past the target's turn end applies it once.
  - Lightning Arrow / Ice Knife wording ("each creature within 10 feet of the target") → the burst part is `'others'`: the target takes the hit part only, the others take the save part.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Set `part` in `readSpell`; `diceAt` keeps parts aligned; `resolveSpell` picks `alt` by the target's HP (`TargetInfo.hurt?: boolean`, filled by `info`), skips `later` (returned as `later` on the resolution), and gives `others` only to the caught that are not the target. `turn()` in `store.ts` applies a due `later` like `linger` does (one roll on the DM's device, DM "Roll" prompt for a PC caster as with linger). Hunger of Hadar's two per-turn parts become one rule entry in `SPELL_RULES` (cold at start, acid at end of turn) with `manual` for the end-of-turn part if not automated.
- [ ] **Step 4:** PASS; full suite green.
- [ ] **Step 5:** Commit `Spells: alternative, delayed and splash damage parts`; push by hash, watch deploy.

### Task 4: The audit as a scoreboard with the book tags as its oracle

**Files:** Modify `scripts/spell-audit.test.ts`.

- [ ] **Step 1:** Count rider spells (smites, Divine Favor, Hex: `read.rider`) as `ok: rider`, summons as `summon` until Task 7, and spells whose only effects are `SPELL_EFFECTS` as `ok: effect`.
- [ ] **Step 2:** For every spell with `mech`, compare the read to it and print a `DISAGREE` line per field: damage types (`mech.types` vs read types and choices), save ability, conditions (`mech.conditions` vs `read.conditions`), attack kind, area shape and size (`mech.area`). Totals line gains `disagree N`.
- [ ] **Step 3:** Run it; save the list to the scratchpad; it is Task 9's worklist. No commit gate beyond the suite (the audit is skipped without `SPELLS_5E`).
- [ ] **Step 4:** Commit `Spell audit: riders and effects counted, book-tag disagreements listed`.

### Task 5: Buffs and debuffs change the numbers

**Files:** Modify `src/lib/types.ts` (Effect), `src/lib/rules/constants.ts` (`SPELL_EFFECTS`), `src/lib/rules/sheet.ts`, Create `src/lib/combat/spellEffects.ts`, Modify `src/lib/combat/resolve.ts` (`targetOf`, `resolveSpell`, `resolveAttack`), `src/lib/combat/targeting.ts` (`attackEdge`), `src/lib/combat/store.ts` (`settleSave`), `src/lib/combat/aiming.ts`. Test `tests/combat/spellEffects.test.ts`, `tests/rules/sheet.test.ts`.

**Produces:**
- New `Effect` kinds: `{ type: 'acMin'; value: number }`, `{ type: 'rollDice'; on: 'attack' | 'save' | 'check'; dice: string /* '1d4', '-1d4' */ }`, `{ type: 'edge'; on: 'attacksBy' | 'attacksAgainst' | \`save.${Ability}\`; mode: 'adv' | 'dis' }`; `BonusTarget` gains `'hpMax'`.
- `spellMods(conditions: readonly string[]): { ac: number; acMin?: number; resist: string[]; immune: string[]; edges: Extract<Effect,{type:'edge'}>[]; dice: Extract<Effect,{type:'rollDice'}>[]; speed: number }` in `spellEffects.ts`.
- `SPELL_EFFECTS` entries (exact): Shield `bonus ac 5`; Shield of Faith `bonus ac 2`; Haste `bonus ac 2`, `edge save.dex adv`; Barkskin `acMin 16`; Bless `rollDice attack 1d4`, `rollDice save 1d4`; Bane `rollDice attack -1d4`, `rollDice save -1d4`; Guidance `rollDice check 1d4`; Resistance `rollDice save 1d4`; Faerie Fire `edge attacksAgainst adv`; Blur `edge attacksAgainst dis`; Stoneskin `damage resistance` ×3 (bludgeoning, piercing, slashing, nonmagical); Blade Ward the same three; Longstrider `speed walk 10`; Aid `bonus hpMax 5`; Foresight `edge attacksBy adv`, `edge attacksAgainst dis`, `edge save.* adv` (all six); Holy Aura `edge attacksAgainst dis` and six `save` adv; Protection from Energy as five names `Protection from Energy (acid|cold|fire|lightning|thunder)` each one resistance.

- [ ] **Step 1: Failing tests:**
  - Sheet: a character with `Shield of Faith` has AC +2; with `Barkskin` and AC 12 has 16, with AC 18 keeps 18; with `Aid` has max HP +5; with `Longstrider` walks +10.
  - `targetOf` of a monster whose combatant conditions include `Shield` has AC +5 and the same with `Stoneskin` resists nonmagical slashing.
  - `attackEdge` gives advantage against a target with `Faerie Fire` and disadvantage against `Blur`.
  - `resolveAttack` by an attacker with `Bless` adds a d4 rolled by `rng` and notes it (`note` contains `Bless +N`); with `Bane` subtracts one.
  - `resolveSpell`: a monster with `Haste` rolls its Dex save with advantage (two `rng` rolls, the higher kept); `settleSave` for a PC with `Bless` adds the d4.
  - Review Focus 1: the host path (`tests/sync`, a player's attack while their character has `Bless`) resolves with the d4.
  - Review Focus 2: `endedSpells` dropping `Shield of Faith` brings the monster's AC back; a PC's character condition removed brings its sheet AC back.
  - Review Focus 5: a player's `UseOutcome` against a Shielded monster has `hit` only, no AC.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** The sheet applies the new kinds (acMin after the AC sum; hpMax into maxHp; edges and dice are exposed on `Sheet.spellMods` for display). Combat reads `spellMods(conditionsOf(z))` in `targetOf` (monster AC/defenses; a PC's come from the sheet), in `attackEdge` (new `Sides.attackerMods/targetMods`), and adds `rollDice` dice on the DM's device with `rng` in `resolveAttack`, `resolveSpell`'s monster saves and `settleSave`.
- [ ] **Step 4:** PASS; svelte-check clean.
- [ ] **Step 5:** Commit `Spell effects: AC, dice on rolls, advantage, resistances, HP and speed while a spell is on a creature`.

### Task 6: Helpful spells land on allies

**Files:** Modify `src/lib/combat/aiming.ts` (`aimPlan`, `workOut`), `src/lib/types.ts` (`Outcome.heal?: number`), `src/lib/combat/store.ts` (`applyResolution`), `src/lib/combat/turnActions.ts` (drop the Mage-Armor-on-caster special case once this covers it), `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte`, `src/lib/sync/host.ts`. Test `tests/combat/aiming.test.ts`, `tests/combat/store.test.ts`, `tests/sync/*`.

**Produces:** `AimPlan.helps?: { max: number }` (pick up to `max` creatures, the caster included, within range; touch = 5 ft; range Self = the caster only, no pick).

- [ ] **Step 1: Failing tests:**
  - A spell with a `SPELL_EFFECTS` entry and no attack or save gets `helps`; Bless's `max` is 3 at 1st level and 4 at 2nd (read from "up to three creatures … one additional creature for each slot level above 1st"); Mage Armor touch `max` 1; Shield range Self has no pick and lands on the caster.
  - workOut on helps gives outcomes `{ id, damage: 0, inflict: [spell name] }` per target, `lasting` with concentration, `rounds` from the duration; Shield's ends at the start of the caster's next turn.
  - Healing: Cure Wounds aimed at an ally gives `{ id, heal: N }` (dice + mod, upcast added); `applyResolution` raises its HP (PC: character; monster: combatant) and Undo lowers it back.
  - False Life gives the caster temp HP `1d4+4` (+5 per slot above 1st) as `Outcome.temp`.
  - Review Focus 3: Bless at a 2nd-level slot accepts four targets and refuses five.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `aimPlan` returns `helps` for spells whose effect is `SPELL_EFFECTS`, `heal`, or temp HP; `pickableAt` for `helps` accepts any creature in range (no attack edge). The map pickers show allies ringed the same way; the turn panel's Haste `target` select keeps working (Haste moves onto `helps`, its `hasted` economy kept). Healing and temp HP go through `changeHp` inside `applyResolution`.
- [ ] **Step 4:** PASS (incl. the sync host path for a player's helpful cast).
- [ ] **Step 5:** Commit `Helpful spells: buffs and healing aimed at allies, as many as the slot allows`; push, watch deploy.

### Task 7: Summons join the fight

**Files:** Create `src/lib/combat/summons.ts`, Modify `src/lib/combat/aiming.ts`, `src/lib/combat/store.ts` (`applyResolution`, `endedSpells` caller), `src/lib/combat/aiming.ts` (`endedSpells`), `src/lib/map/store.ts`, `src/lib/types.ts` (`Combatant.summon?: { by: string; cast?: number; spell: string }`). Test `tests/combat/summons.test.ts`.

**Produces:**
- `scaleSummon(m: MonsterDef, o: { level: number; attack: number; dc: number; variant?: string }): MonsterDef` — evaluates `summonSpellLevel` and "your spell attack modifier" in the converted action text, AC `N + the level of the spell`, HP `N (+ variant options) + K for each spell level above L`, multiattack "half this spell's level (rounded down)".
- `summonOptions(s: SpellDef): { count: number; cr: number; type?: string }[] | { creature: string }` — TCE spirits name their stat block (`{@creature X|TCE}` survives the import as a reference: check the converted text in a synthetic fixture); conjures list "One beast of challenge rating 2 or lower / Two … 1 / Four … 1/2 / Eight … 1/4".

- [ ] **Step 1: Failing tests** (synthetic stat block with the 5etools markers, no book text): `scaleSummon` at level 4 gives AC 15, HP 40 (`30 + 5 for each spell level above 2nd`), attack `+7` with caster attack 7, damage `1d8 + 4 + 4`, two attacks. `summonOptions` reads the four conjure options. A summon cast adds combatants with `summon.by` the caster, sharing the caster's initiative (TCE) or rolled (conjure), and tokens beside the caster (one roster). Review Focus 4: the caster's concentration ending removes the summoned combatants and their tokens; a summon at 0 HP is removed with its token.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement; summoned creatures come from the campaign's monster index (imported books), never bundled. A spirit whose stat block isn't imported says so (`manual: 'Import its book to summon it.'`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `Summons: spirits and conjured creatures join the fight and the map, and leave with the spell`.

### Task 8: Choosing what to summon

**Files:** Create `src/ui/turn/SummonPicker.svelte`, Modify `src/ui/turn/TurnPanel.svelte`, `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte`, `src/lib/sync/protocol.ts` + `host.ts` (a player's summon pick). Test `tests/sync/*`, component-level test if the repo has one for TurnPanel.

- [ ] **Step 1: Failing tests:** a player's summon cast with a pick (`{ option: 1, monsterIds: [...] }`) is validated on the DM's device (count and CR within the option, type matches) and refused otherwise; the TCE variant (Air/Land/Water…) is sent as `variant`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** The picker lists the spell's options and the creatures that fit (from the index by CR and type); Find Familiar and Find Steed list their fixed forms; Animate Dead offers Skeleton or Zombie by count per slot.
- [ ] **Step 4:** PASS; check in the browser pane: a DM casts Summon Beast and Conjure Animals; tokens appear beside the caster; dropping concentration clears them.
- [ ] **Step 5:** Commit `Summon picker`; push, watch deploy.

### Task 9: Scoreboard to zero

**Files:** `src/lib/combat/spellRules.ts`, `src/lib/combat/spellText.ts`, `scripts/spell-audit.test.ts`.

- [ ] **Step 1:** Run the audit. For each `BROKEN` and `DISAGREE` line: fix the wording class in the reader (with a synthetic test) when more than one spell shares it, else add a mechanics-only `SPELL_RULES` entry with a one-line comment; utility spells that are only `none` stay `none`.
- [ ] **Step 1b:** Walk the `none` list: every spell that changes a number a fight uses (Heroism, Enlarge/Reduce, True Strike, Greater Invisibility, Protection from Evil and Good, Warding Bond, Beacon of Hope, Fly, Expeditious Retreat, Spider Climb, Death Ward, Sanctuary…) gets a `SPELL_EFFECTS` entry with a test, or a `manual` note saying what to do by hand; only pure utility stays `none`.
- [ ] **Step 2:** Re-run until `BROKEN 0` and `disagree 0` (or each remaining disagreement ruled in `SPELL_RULES` with a comment saying why the tag is wrong).
- [ ] **Step 3:** Full suite, svelte-check, browser check of five spells from different classes of wording (Thunderwave, Toll the Dead, Produce Flame, Bless, Summon Beast).
- [ ] **Step 4:** Commit `Every spell: audit at zero`; push, watch deploy; final whole-branch review (one reviewer, most capable model) over the plan's commits; one fix pass.
