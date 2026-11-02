# Spell Interpreter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imported books' spells resolve as reliably as SRD ones. What can't be automated says so, and coverage is measured against the user's books.

**Architecture:**
- The 5etools converter keeps each spell's machine-readable fields as `SpellDef.mech`.
- `readSpell` takes, in order of trust, a name-keyed one-off rule, then `mech`, then the wording. It returns a `SpellRead` that now also
  carries conditions, extra damage on weapon hits, damage over time, multiple rays, and a `manual` note.
- The existing targeting pipeline (`aimPlan` → `workOut` → `resolveSpell` → `applyResolution`, Undo by snapshots) gains the four
  effect kinds, one task each.

**Tech Stack:** Svelte 5, TypeScript, Vitest, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-11-02-spell-interpreter-design.md`

## Global Constraints

- No book text in the repo. Rule entries are mechanics only. Test fixtures are paraphrased (see `fix()` in `tests/combat/spellcasting.test.ts`).
- 2014 rules only; the importer's source whitelist stays as it is.
- The user's books are read only at run time, from the path the user gives. Never copy `C:\Users\bestj\dnd-app-testdata` into the repo.
- Players never learn a monster's AC, saves, condition immunities, or creatures their map doesn't show. Save DCs reach only the caster.
- Every change a result makes is undone by Undo (snapshot `before` and `after`, `src/lib/combat/store.ts`).
- Precedence: a one-off rule beats `mech`, and `mech` beats the wording.

## Review Focus

1. Packs imported before the converter bump, and characters with stale copies of spells (no `mech`) → the reader falls back to the
   wording exactly as before. Pinned in Task 2.
2. A spell whose `savingThrow` lists two saves → the save the wording names, else the first. Pinned in Task 2.
3. A PC fails a save against a condition spell, then the DM presses Undo → the condition and the HP both come back. Pinned in Task 5.
4. The caster loses concentration (damage, incapacitated, the DM's toggle, or a new concentration spell) → the spell's conditions,
   extra damage and area end, for monsters and PCs alike. Pinned in Task 5.
5. The player's device and the host plan different dice (extra damage, ray count) → the host refuses ("bad damage dice") and never
   resolves wrongly. Pinned in Tasks 7 and 9.

---

### Task 1: Book mechanics kept on import

**Files:**
- Modify: `src/lib/types.ts` (`SpellDef`, `EntityPatch`), `src/lib/import/fivetools/spells.ts`, `src/lib/import/fivetools/index.ts:295`, `src/lib/content/index.ts:28`, `src/lib/import/version.ts` (`CONVERTER_5E = 4`)
- Test: `tests/import/fivetools.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SpellMech {
    save?: Ability[];
    attack?: 'melee' | 'ranged';
    types?: string[];
    conditions?: string[];
    scaling?: Record<number, string>;
    area?: { shape: Shape; feet: number };
  }
  ```
  - On `SpellDef.mech?: SpellMech` and `EntityPatch.mech?: SpellMech`.
  - `conditions`: capitalised as the app names them, e.g. `'Paralyzed'`.
  - `scaling`: from `scalingLevelDice`, character level to dice; when that field is an array, its first entry.
  - `area`: from a `range` whose type is `radius | sphere | cone | line | cube | hemisphere`. Radius and hemisphere become a sphere.
  - `mech` is omitted when the record has none of these fields.

- [ ] **Step 1: Write the failing tests**
  - `test('spells keep their book mechanics', …)`: a TST spell record with `savingThrow: ['wisdom']`, `spellAttack: ['R']`,
    `damageInflict: ['fire','cold']`, `conditionInflict: ['paralyzed']`, `scalingLevelDice: { label: 'x', scaling: { 1: '1d6', 5: '2d6' } }`
    and `range: { type: 'radius', distance: { type: 'feet', amount: 10 } }`. Expect:
    ```ts
    mech: { save: ['wis'], attack: 'ranged', types: ['fire','cold'], conditions: ['Paralyzed'],
            scaling: { 1: '1d6', 5: '2d6' }, area: { shape: 'sphere', feet: 10 } }
    ```
  - Same test: a record without these fields has no `mech` key.
  - `test('an SRD-overlap patch carries the mechanics onto the SRD spell', …)`: a PHB `srd: true` record, for example "Fireball" with
    `savingThrow: ['dexterity']`, produces a patch with `mech.save = ['dex']`. The content index built from SRD plus that pack gives
    the SRD Fireball that `mech`.
- [ ] **Step 2: Run** `npx vitest run tests/import/fivetools.test.ts`. Expected: the two new tests FAIL (no `mech`).
- [ ] **Step 3: Implement** `mechOf(r: Raw): SpellMech | undefined` in `spells.ts` and set it in `spell()`. Add
  `...(def.kind === 'spell' && def.mech && { mech: def.mech })` to the patch at `index.ts:295`, and
  `if (patch.mech) copy.mech = patch.mech` in `content/index.ts`. Bump `CONVERTER_5E` to 4, so `upgradeImports` re-converts stored
  books.
- [ ] **Step 4: Run** `npx vitest run tests/import`. Expected: PASS. `tests/import/upgrade.test.ts` still passes.
- [ ] **Step 5: Commit** "Import keeps spells' book mechanics"

### Task 2: The reader trusts rules, then mechanics, then wording (Chaos Bolt's d8 picks the type)

**Files:**
- Create: `src/lib/combat/spellRules.ts`
- Modify: `src/lib/combat/spellText.ts` (`readSpell`, `diceAt`, `SpellRead`), `src/lib/combat/resolve.ts` (`resolveSpell`), `src/lib/combat/aiming.ts` (the `'pick a damage type'` check), `src/ui/turn/TurnPanel.svelte` (no type picker when `typeFromDie`)
- Test: `tests/combat/spellcasting.test.ts`, `tests/combat/aiming.test.ts`

**Interfaces:**
- Consumes: `SpellMech` (Task 1).
- Produces:
  - `readSpell(s: Pick<SpellDef, 'text' | 'level' | 'range'> & { name?: string; mech?: SpellMech; higherLevels?: RichText }): SpellRead`
  - New `SpellRead` fields:
    - `conditions?: string[]`: from `mech`, else the wording `/(?:be|is|becomes?) (blinded|charmed|deafened|frightened|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)/gi`, capitalised.
    - `scaling?: Record<number, string>`
    - `typeFromDie?: { sides: number; types: string[] }`
    - `manual?: string`
  - `spellRules.ts`: `export const SPELL_RULES: Record<string, Partial<SpellRead>>`, keyed by lower-case name. First entry:
    `'chaos bolt': { typeFromDie: { sides: 8, types: ['acid','cold','fire','force','lightning','poison','psychic','thunder'] } }`
  - `Outcome.note` gains `"<type> (d8 <face>)"`.

**Precedence:**
- `mech.save`: the first save the wording also names, else `mech.save[0]`.
- `mech.attack` replaces the wording's attack.
- `mech.types`:
  - One type → fills any `''` damage type.
  - Several types and a `''` damage → `choices = mech.types`.
- `mech.area`: used only when the wording found no area or burst. `self: true`.
- `mech.scaling`: `diceAt` uses the highest key ≤ `charLevel` for `damage[0]`, in place of the 5/11/17 tier rule.
- `SPELL_RULES[name]`: shallow-merged last.

- [ ] **Step 1: Write the failing tests** (spellcasting.test.ts, paraphrased fixtures via `fix()`)
  - `test('mechanics fill what the wording lacks; the rule table wins over both', …)`:
    - A fixture with the wording "takes 2d8 damage" and `mech: { attack: 'ranged', types: ['fire'] }` → `damage: [{ dice: '2d8', type: 'fire' }]`, `attack: 'ranged'`.
    - A fixture with no area wording and `mech.area: { shape: 'sphere', feet: 10 }` → `area: { shape: 'sphere', feet: 10, self: true }`.
    - `readSpell({ ...fix(…'takes 2d8 + 1d6 damage'…), name: 'Chaos Bolt' }).typeFromDie.sides === 8`.
  - `test('two listed saves: the one the wording names', …)`: `mech.save: ['dex','str']` with the wording "Strength saving throw" → `save: 'Str'`.
  - `test('without mech the reading is unchanged', …)`: the existing suite already covers this. Add `expect(readSpell(spell('Fireball'))).toEqual(readSpell({ ...spell('Fireball'), mech: undefined }))`.
  - `test('scaling dice from the book table', …)`: `mech.scaling: { 1: '1d6', 5: '2d6', 11: '3d6', 17: '4d6' }` → `diceAt(r, { level: 0, charLevel: 11 }).damage[0]` starts with `'3d6'`.
  - `test('conditions read from the wording', …)`: "…a Wisdom saving throw or be paralyzed…" → `conditions: ['Paralyzed']`.
  - In aiming.test.ts, `test('Chaos Bolt: the d8 that hurts more picks the type', …)`:
    - A plan for a `typeFromDie` spell needs no `dtype`.
    - d8 faces `[3, 2]` (fire, cold) against a fire-resistant target → the type is cold, with the note `'cold (d8 2)'`.
- [ ] **Step 2: Run** `npx vitest run tests/combat`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the precedence above in `readSpell`. In `resolveSpell`/`hurt`, a `''` type with `typeFromDie` tries the type
  of each of the first two faces of that die and keeps the one dealing more after defenses (a tie keeps the first).
  `workOut` skips `'pick a damage type'` when `typeFromDie` is set. TurnPanel shows no type picker for it.
  `// ponytail: the caster's pick of d8 is made for them (the better one against this target)`.
- [ ] **Step 4: Run** `npx vitest run tests/combat`. Expected: PASS.
- [ ] **Step 5: Commit** "Reader: rule table, then book mechanics, then wording; Chaos Bolt's d8 picks the type"

### Task 3: Local coverage scoreboard

**Files:**
- Create: `scripts/spell-coverage.test.ts`

**Interfaces:**
- Consumes: `spell()` from `src/lib/import/fivetools/spells.ts`, `readSpell`.
- Produces: a console report over `spells-phb.json`, `spells-xge.json` and `spells-tce.json` in `process.env.SPELLS_5E`, covering records
  with `damageInflict` or `conditionInflict`:
  - `resolves` (count only).
  - `manual` (names and reasons).
  - `silent` (names): it neither resolves nor has a `manual` note.
  - A spell **resolves** when `aimPlan` would take it and it has damage it can deliver (attack, save, `auto`, `linger`, `rider` or
    `rays`), or `conditions` plus a save.

- [ ] **Step 1: Write it** with `test.skipIf(!process.env.SPELLS_5E)`, so CI and normal runs skip it.
- [ ] **Step 2: Run** `SPELLS_5E=C:/Users/bestj/dnd-app-testdata/5etools/data/spells npx vitest run scripts/spell-coverage.test.ts --silent=false`.
  Expected: it prints counts, with `silent` above 0, the baseline for Task 4. Write the baseline in the ledger.
- [ ] **Step 3: Run** `npx vitest run scripts/spell-coverage.test.ts` without the variable. Expected: 1 skipped.
- [ ] **Step 4: Commit** "Local spell coverage scoreboard (reads the user's own files at run time)"

### Task 4: Never silently wrong

**Files:**
- Modify: `src/lib/combat/spellText.ts` (sets `manual`), `src/lib/combat/aiming.ts` (`aimPlan`), `src/ui/turn/TurnPanel.svelte` (shows the note)
- Test: `tests/combat/spellcasting.test.ts`, `tests/combat/aiming.test.ts`

**Interfaces:**
- Produces: `SpellRead.manual?: string`. It is set when the spell deals damage (`mech.types` or a dice match) or inflicts conditions,
  and nothing here delivers it. The notes, exactly:
  - `'Its damage isn’t automated: apply it by hand.'`
  - `'Extra damage on weapon hits isn’t automated: apply it by hand.'`: wording `/extra \d+d\d+[^.]*damage[^.]*(?:hit|weapon)/i`.
    Removed in Task 7.
  - `'Damage over time isn’t automated: apply it by hand.'`: for `lingering`. Changed in Task 8.
  - A rule's own `manual` wins.

  `aimPlan` returns undefined for a spell with no damage, no area, no burst and no conditions (Light loses its pointless Target).

- [ ] **Step 1: Write the failing tests**
  - `test('what can’t be automated says so', …)`: fixtures for an extra-damage-on-hits spell, a lingering spell, and a `mech.types`
    spell with no dice wording; each has its note.
  - In aiming.test.ts: `aimPlan(spell({ save: 'Dex' }))` is undefined, and `aimPlan(spell({ save: 'Wis', conditions: ['Paralyzed'] }))` is defined.
- [ ] **Step 2: Run** `npx vitest run tests/combat`. Expected: FAIL.
- [ ] **Step 3: Implement.** TurnPanel shows `a.cast.read.manual` as a muted line under the spell's name, for the DM and players alike.
- [ ] **Step 4: Run** the scoreboard (Task 3, Step 2). Expected: `silent` is 0. For any spell still silent, widen a `manual`
  condition (never special-case a name outside `SPELL_RULES`) until it reaches 0. Then run `npx vitest run` (the whole suite) and
  `npx svelte-check --threshold error`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** "Spells that aren't automated say so"

### Task 5: Conditions on a failed save, ending with concentration

**Files:**
- Modify: `src/lib/types.ts` (`Outcome.inflict?: string[]`, `Outcome.inflicts?: string[]` on a pending save, `Resolution.inflicted?: { id: string; condition: string }[]`, `Combatant.concentratingOn?: string`), `src/lib/combat/resolve.ts` (`TargetInfo.conditionImmune: string[]`, `targetOf`, `resolveSpell`), `src/lib/combat/store.ts` (`applyResolution`, `settleSave`, `update`), `src/lib/combat/turnActions.ts:276`, `src/lib/combat/aiming.ts` (`areasOn`), `src/ui/map/DmMap.svelte` (Results line)
- Test: `tests/combat/resolve.test.ts`, `tests/combat/resolveStore.test.ts`, `tests/sync/areas.test.ts`

**Interfaces:**
- Consumes: `SpellRead.conditions` (Task 2).
- Produces:
  - `resolveSpell` puts `inflict: read.conditions` (minus the target's `conditionImmune`) on a failed save, and `inflicts` on a PC's
    pending save.
  - `applyResolution` applies each `inflict` with `setCondition`'s logic and records `inflicted`. `settleSave` does the same on a
    failure.
  - `applyUse` sets `concentratingOn: a.name` for a concentration spell.
  - `update()` in store.ts: after the write, any caster whose `concentratingOn` changed, or whose `concentrating` went false, loses the
    `inflicted` conditions of its `lasting` resolutions for the spell it left. Monsters lose them in the combat record; PCs through
    `editCharacter`.
  - `areasOn` shows a lasting area while `concentratingOn === r.action` (old records without `concentratingOn`: while `concentrating`).
  - A non-concentration spell's conditions get a `Duration` of `{ rounds, at: 'start', of: caster }`, where `SpellRead.rounds` is read
    from `SpellDef.duration`: "N minute(s)" → N×10, "N round(s)" → N, otherwise none.

- [ ] **Step 1: Write the failing tests**
  - resolve.test.ts: a failed Wisdom save against `conditions: ['Paralyzed']` → `inflict: ['Paralyzed']`. A target with
    `conditionImmune: ['paralyzed']` gets none. A success gets none.
  - resolveStore.test.ts:
    - `test('a failed save leaves the condition; Undo takes it and the HP back', …)` (Review Focus 3): a monster, and a PC through `settleSave`.
    - `test('losing concentration ends the spell’s conditions', …)` (Review Focus 4): damage that breaks concentration, the
      `concentrating: false` patch, and a new concentration cast (`concentratingOn` changes). Each removes the condition from the
      monster and from the PC's character.
  - areas.test.ts: a new concentration spell hides the old spell's lasting area.
- [ ] **Step 2: Run** `npx vitest run tests/combat tests/sync`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as above. The DM's Results line lists the conditions applied, e.g. "Goblin 1: paralyzed".
- [ ] **Step 4: Run** `npx vitest run` and `npx svelte-check --threshold error`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** "Spells inflict conditions on a failed save; they end with concentration"

### Task 6: Repeat saves at the end of a turn

**Files:**
- Modify: `src/lib/combat/spellText.ts` (`SpellRead.repeat?: true`, from wording `/at the end of each of its turns[^.]*saving throw/i`), `src/lib/types.ts` (`Resolution.repeat?: true`; `Outcome.ends?: string[]`), `src/lib/combat/store.ts` (`turn`), `src/lib/combat/aiming.ts` (`workOut` copies `repeat`)
- Test: `tests/combat/resolveStore.test.ts`, `tests/sync/targeting.test.ts`

**Interfaces:**
- Consumes: `Resolution.inflicted` (Task 5).
- Produces: when `turn(cid, 'next')` ends the turn of a creature still carrying a condition from a `repeat` resolution, a new
  resolution `"<spell> (repeat save)"` (actor: the caster; same `dc` and `ability`; no damage) joins the Results:
  - **Monster:** it rolls at once (`Math.random`). A success removes the condition and sets `ends: [condition]` on the outcome.
  - **PC:** a pending outcome, `inflicts: []` and `ends: [condition]`. It reaches the player's save pop-up as any pending save does.
    `settleSave` removes the condition on a success.

- [ ] **Step 1: Write the failing tests**
  - `test('a held monster saves again at the end of its turn', …)`: `vi.spyOn(Math, 'random')` fixes the d20. A success removes
    Paralyzed; a failure keeps it.
  - sync: `test('a held PC gets a pop-up to save again at the end of its turn', …)`: `TrackerView.saves` lists it, and `settleSave`
    with a success removes the condition.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`. Expected: PASS.
- [ ] **Step 5: Commit** "Repeat saves at the end of each turn"

### Task 7: Extra damage on weapon hits (Hex, Hunter's Mark, Divine Favor, smites)

**Files:**
- Modify:
  - `src/lib/combat/spellText.ts`: `SpellRead.rider?: { dice: string; type: string; once?: true; marked?: true }`, from wording:
    - the next hit: `/next time you hit[^.]*extra (\d+d\d+) (TYPE )?damage/i` → `once`
    - every weapon hit: `/weapon attacks deal an extra (\d+d\d+) (TYPE )?damage/i`
    - the marked target: `/extra (\d+d\d+) (TYPE )?damage to the target whenever you hit it/i` → `marked`
    - type `''` = the weapon's type
  - `src/lib/types.ts`: `Combatant.rider?: { spell: string; dice: string; type: string; once?: true; target?: string }`; `Resolution.mark?: string`
  - `src/lib/combat/turnActions.ts`: `applyUse` sets `rider` for a non-`marked` rider spell
  - `src/lib/combat/aiming.ts`:
    - `aimPlan`, with an `o.rider` option, adds `{ expr, type, vs? }` for weapon attacks.
    - A `marked` rider spell is aimed at a creature with no dice, giving `mark`.
  - `src/lib/combat/resolve.ts`: `resolveAttack` skips dice whose `vs` isn't the target
  - `src/lib/combat/store.ts`:
    - `applyResolution` sets the actor's `rider.target` from `mark`, and clears a `once` rider after a hit.
    - `update()` clears `rider` when its spell's concentration ends (with Task 5's hook).
  - `src/lib/sync/project.ts`: `TurnEcon.rider`, for the player's own turn
  - `src/lib/sync/host.ts`: `#aim` passes the actor's rider
  - `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte`: pass `rider` to `aimPlan`
- Test: `tests/combat/spellcasting.test.ts`, `tests/combat/aiming.test.ts`, `tests/sync/targeting.test.ts`

**Interfaces:**
- Consumes: Task 5's `update()` concentration hook and `concentratingOn`.
- Produces:
  - `aimPlan(a, { …, rider?: Combatant['rider'] })`.
  - The plan's dice gain `vs?: string`.
  - Task 4's rider note is removed for spells with `rider`.

- [ ] **Step 1: Write the failing tests**
  - Reader: three paraphrased fixtures → `rider` with `once`, plain, and `marked`.
  - aiming:
    - A sword with a Divine Favor–style rider → dice `['1d8+3', '1d4']`, with the rider's type.
    - Hex marked on `g` → the extra dice deal damage against `g` and 0 against another creature.
    - A crit doubles them.
  - store: a `once` rider is cleared after a hit and kept after a miss.
  - sync (Review Focus 5): a player whose device omits the rider dice → the host answers `'bad damage dice'`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npx svelte-check --threshold error` and the scoreboard. Expected: PASS, 0 errors, and the
  rider spells move from `manual` to `resolves`.
- [ ] **Step 5: Commit** "Spells that add damage to weapon hits"

### Task 8: Damage at the start of a turn in a lasting area

**Files:**
- Modify:
  - `src/lib/combat/aiming.ts`: a lingering plan keeps its dice as `linger`. `workOut` stores
    `Resolution.linger?: { dice: { expr: string; type: string }[]; read: SpellRead }`.
  - `src/lib/types.ts`
  - `src/lib/combat/resolve.ts`: `resolveSpell` with a lingering read and no save → the damage lands, as `auto` does.
  - `src/lib/combat/spellText.ts`: the lingering note becomes `'Entering the area isn’t automated, only starting a turn in it.'` when
    the wording also says "enters".
  - `src/ui/map/DmMap.svelte`: a "Starts its turn in <spell> — Roll" line in Results for the creature whose turn it is. Pressing Roll:
    the DM's device rolls, then `resolveSpell` with `caught: [that creature]`, then `applyResolution` as
    `"<spell> (start of turn)"` (actor: the caster).
- Test: `tests/combat/aiming.test.ts`, `tests/sync/areas.test.ts`

**Interfaces:**
- Consumes: `areasOn`, `tokensInTemplate`, `concentratingOn` (Task 5).
- Produces:
  - `export function startsIn(k: Combat, s: Scene, id: string): Resolution[]`: in aiming.ts, the lasting results whose area holds that
    creature's token.
  - A PC caught this way gets the save pop-up through the existing pending save.

- [ ] **Step 1: Write the failing tests**
  - `startsIn`: a token inside a lasting sphere → `[r]`; outside, or once the caster stops concentrating → `[]`.
  - resolveSpell, a lingering read with no save → damage lands. With a save → the usual save outcome.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `svelte-check` and the scoreboard. Expected: PASS. Then in the browser: cast a lasting area on
  a goblin, press Next turn until the goblin's turn starts, and press Roll; the save and damage land.
- [ ] **Step 5: Commit** "Damage at the start of a turn in a lasting area"

### Task 9: Several rays, beams or darts, and Chaos Bolt's leap

**Files:**
- Modify:
  - `src/lib/combat/spellText.ts`: `SpellRead.rays?: { count: number; perSlot?: { above: number } ; byLevel?: true }`, from wording:
    - Scorching Ray: `/(two|three|four|\d+) rays/` with "for each ray".
    - Eldritch Blast: `/two beams at 5th level/` → byLevel 1/2/3/4 at 1/5/11/17.
    - Darts: `auto.count` becomes rays, one 1d4+1 per dart. Drop `timesDice` from `diceAt`, and change the existing darts tests
      (f9f3527, in spellcasting.test.ts and aiming.test.ts) to three targets.
  - `src/lib/combat/spellRules.ts`: Chaos Bolt `leap: 30`.
  - `src/lib/combat/aiming.ts`:
    - `Aim.targets?: string[]`: one per ray, repeats allowed.
    - `workOut` resolves ray by ray. `rolled.d20` holds 2 faces per ray; `rolled.dmg` holds the plan's dice once per ray.
  - `src/lib/sync/protocol.ts`: `cleanAim` takes `targets`, at most 12 strings of ≤100 characters each.
  - `src/ui/map/aimRoll.ts`: `rollAim` rolls per ray.
  - `src/ui/map/MapCanvas.svelte`: aim with `count` collects that many clicks, with a strip "Ray 2 of 3: Goblin 1" and an "Undo pick"
    button.
  - `src/ui/map/DmMap.svelte`, `src/ui/map/PlayerMap.svelte`.
  - Leap: an outcome with `leap: true` (the two d8s matched) offers "Leap" to the caster: a new aim at a creature within 30 ft of the
    first target, other than the first target, with no cost (`use.leapOf: resolutionId`). The host accepts it once per resolution and
    only from its actor.
- Test: `tests/combat/spellcasting.test.ts`, `tests/combat/aiming.test.ts`, `tests/sync/targeting.test.ts`, `tests/aimRoll.test.ts`

**Interfaces:**
- Consumes: all of the above.
- Produces: `AimPlan.count?: number`: the rays at this slot or character level.

- [ ] **Step 1: Write the failing tests**
  - Reader: a three-ray fixture → `rays.count 3`; at slot 3 the count is 4. A beam fixture at character level 11 → 3.
  - aiming:
    - Two rays at `g`, one at `pc:thorin` → three outcomes, each with its own d20.
    - Darts split two and one → the damage goes to each target.
  - sync (Review Focus 5):
    - The wrong number of `targets` or d20s → refused.
    - A leap from someone other than the actor, or a second leap → refused.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `svelte-check` and the scoreboard. Then in the browser: Magic Missile split between two goblins;
  then Scorching Ray (or a fixture homebrew spell) with three picks.
- [ ] **Step 5: Commit** "Several rays, beams and darts; Chaos Bolt leaps"

---

**After the last task:** run the final whole-branch review (executing-plans), then push by hash. Report the scoreboard counts from
before and after.
