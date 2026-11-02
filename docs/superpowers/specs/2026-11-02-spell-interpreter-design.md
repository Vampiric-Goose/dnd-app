# Spell interpreter: books first, wording second — design

## Why

Nobody plays from the SRD alone: tables run on the PHB, Xanathar's, Tasha's and the DMG. The app bundles only the SRD, but it has to
support the books a user imports as strongly as the SRD itself. Today the interpreter guesses from English sentences
(`src/lib/combat/spellText.ts`). A survey of the user's own PHB + XGE + TCE files (2014) shows 129 of 173 damaging spells resolve. The
failures are not random: the importer throws away the machine-readable fields the books carry, and a few kinds of effect have no
model at all.

The user's rulings this rests on:
- Book content still never ships in the repo, and 2024 rules never enter.
- A book-agnostic one-off rule keyed by a spell's name (mechanics only, no book text, "for a spell that might not necessarily exist")
  is fine, morally and legally.

## Goals

1. **Keep the books' mechanics on import.** 5etools spell records carry the following fields:
   - `savingThrow` (198 of the 477 core spells)
   - `spellAttack` (35)
   - `damageInflict` (173)
   - `conditionInflict` (85)
   - `areaTags` (317)
   - `scalingLevelDice` (22)
   - a typed `range`: point, radius, cone, line, cube, sphere, hemisphere

   The converter keeps them on the spell as `SpellDef.mech`. Bumping `CONVERTER_5E` re-converts books already on a device from
   `db.raw5e`, so nobody re-imports. `embedStale` refreshes the characters' copies, and shared packs carry `mech` to players.
2. **Precedence: one-off rule > book mechanics > wording.** `readSpell` takes `mech` as the source of truth for the save, attack,
   damage types, conditions, the area around the caster, and cantrip dice. Wording fills what `mech` lacks, so SRD and homebrew work
   as now. A one-off rule overrides both.
3. **One-off rules,** in `src/lib/combat/spellRules.ts`: a table keyed by lower-case spell name. It holds mechanics only (no text) and
   applies only when a spell of that name is present. First entry: Chaos Bolt, where the type comes from a chosen d8 and matching
   d8s leap to a second target.
4. **Never silently wrong.** A spell the interpreter can't fully resolve says so where it is cast, for example "Hex: extra damage on
   weapon hits isn't automated; apply it by hand", instead of dealing nothing. Chaos Bolt dealing nothing without a word was the
   real bug.
5. **A local coverage scoreboard,** `scripts/spell-coverage.ts <path to the user's 5etools data>`. It reports how many spells resolve,
   in each failure group with names. The script holds no book data; it reads the user's files at run time, and its output stays out
   of git. It is re-run after each step, so progress is measured.

## Effect kinds (each its own step, in order of how many spells need it)

These are the groups the remaining failures fall into. Each lands as one step, with the scoreboard showing what it fixed.

1. **Condition on a failed save** (`conditionInflict` + save: Hold Person, Command, Blindness/Deafness). Applied when the save fails,
   with an end-of-turn repeat save when the spell has one. Undo removes it like any other change.
2. **Extra damage on weapon hits** (Hex, Hunter's Mark, Divine Favor, the smites, Booming Blade, Green-Flame Blade): a toggle on the
   attack, like Great Weapon Master. A one-shot (a smite) is used up on its first hit.
3. **Damage on entering or starting a turn in an area** (Moonbeam, Spirit Guardians, Cloud of Daggers): when a creature's turn
   starts inside a lasting area, the DM gets a "Roll for it" prompt in Results.
4. **Several attacks or targets** (Scorching Ray, Eldritch Blast, Magic Missile split between targets): pick a target per ray, dart
   or beam.

## Non-goals

- Monster actions with a save (breath weapons): a separate piece of work, which reuses this reader on monster text.
- Damage that isn't the point of the spell (Teleport, Wish, Dimension Door), and spells that grant someone else an action (Dragon's
  Breath): these stay manual, flagged as in goal 4.
- Book text in the repo. Rule entries are mechanics only, and test fixtures stay paraphrased.

## Left to the builder

- `mech`'s exact shape: keep it to what the reader uses.
- Whether a mechanics field and the wording disagree: `mech` wins, and the scoreboard lists the disagreements for a look.
- Wording for the "not automated" notes.

## Done when

- Goals 1–5 are in.
- The scoreboard shows every damaging core spell either resolving or flagged as manual with a reason. None deals nothing without a
  word.
- Effect kinds 1–4 land one at a time after that, each with its count on the scoreboard.
