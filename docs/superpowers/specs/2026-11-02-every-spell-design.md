# Every spell works: design

## Intent

The user: "Make sure every single spell from the SRD, PHB, XGE, and TCE is fully functional." Scope chosen: **the combat tier plus summons**.
A spell is fully functional when casting it in the app does what the book says to the numbers a fight uses, with no hand work, or, for a
spell with no such numbers, when it casts, spends its slot and tracks its concentration and duration.

Today (local audit, `scripts/spell-audit.test.ts`, 796 spell records): 356 pass a structural check, 62 are broken outright, 313 automate
nothing. A structural pass is not correct: Thunderwave passes but gives no damage on a save.

## Constraints (standing rulings)

- 2014 rules only; nothing from 2024 enters.
- Ship only SRD content. Book spells are read from the user's own import; name-keyed one-off rules may exist for any spell, mechanics only,
  no book text (11-02 ruling).
- Never silently wrong: what isn't automated says so where it is cast (`SpellRead.manual`).
- Players never learn monster AC, saves, immunities or combatant ids.
- One roster: the fight and the map hold the same creatures (summons included).
- A spell that lasts leaves a condition named after itself on what it affects (Haste, Hex, Hold Monster…).

## Goals

1. **Reads are right.** Every spell's attack, save, half-on-save, damage parts, area, range, upcast and cantrip scaling match the book.
   The book's own tags (`SpellMech`) are the oracle where they speak; the wording settles the rest; a one-off rule settles what neither can.
   Known misreads to cover, each a class of wording, not one spell:
   - half damage on a save in any phrasing ("takes half as much damage and isn't pushed", "half damage, but…");
   - a save counted only when the target must make it (Haste's "advantage on Dexterity saving throws" and Light's object clause are not saves);
   - range Self with an attack: melee spell attacks reach 5 ft, a thrown one its stated distance (Produce Flame), the blade cantrips are a
     weapon attack plus their rider;
   - several damage parts that are alternatives or come later, not a sum: one or the other (Toll the Dead by the target's HP, Spirit
     Guardians by the caster's choice), delayed (Acid Arrow at the end of the target's next turn, half on a miss), splash to others (Lightning
     Arrow, Ice Knife), per-turn (Hunger of Hadar's two);
   - upcasts in every phrasing ("increases by 1d8, for each", "1d6 extra damage … for each slot level");
   - areas the wording names by distance or choice (Word of Radiance's creatures of your choice within 5 ft) and single targets that only
     look like areas (Lightning Lure);
   - conditions behind a save that the wording words differently (Grease, Sleet Storm, Color Spray and Sleep by HP pool).
2. **Buffs and debuffs change the numbers.** A spell's named condition carries its effects while it is on a creature, PC or monster:
   AC (Shield +5 to the start of the caster's next turn, Shield of Faith +2, Haste +2, Mage Armor and Barkskin as base AC), bonus dice on
   attacks and saves (Bless +1d4, Bane −1d4, Guidance/Resistance on a check or save), advantage or disadvantage on attacks by or against it
   (Faerie Fire, Blur, Greater Invisibility), resistances and immunities (Stoneskin, Protection from Energy, Blade Ward), hit points (False
   Life and Heroism temp HP, Aid's max HP), speed (Longstrider, Expeditious Retreat, Haste), and saves with advantage (Haste on Dex).
   Targeting and resolution read them (resolve.ts, targeting.ts, the sheet), so every roll that should feel them does.
3. **Helpful spells land on allies.** Buffs and healing pick their targets among allies (the caster included), as many as the spell and slot
   allow (Bless: three, one more per slot level); healing rolls and heals its targets.
4. **Summons join the fight.** A summon or conjuration puts its creature(s) into the fight and on the map near the caster, by one roster:
   TCE's spirits use their TCE stat block with the spell-level scaling the spell gives (AC, HP, attacks, multiattack count); PHB/XGE conjures
   (Conjure Animals, Woodland Beings, Minor Elementals, Find Familiar, Find Steed, Animate Dead…) let the caster pick creatures within the
   spell's CR and count options. Initiative as the spell says (a spirit shares the caster's and goes right after; a conjured group rolls).
   They leave when concentration or the duration ends, or at 0 HP.
5. **Utility spells count as done** when they cast, spend their slot, track concentration and duration, and show their text. No new
   automation for Teleport, Detect Magic, Tongues and the like.
6. **Proof.** The audit becomes the scoreboard: 0 broken, and every spell's read compared with its book tags (damage types, save ability,
   conditions, area shape and size, attack kind); each disagreement either fixed or ruled in the rule table with why.

## Non-goals

- 2024 spells, homebrew spell authoring, spell text in the bundle.
- Rules beyond the spell: no lighting, vision, cover, terrain, falling or object HP.
- Mirror Image's duplicates, Blink's plane-shifting, Counterspell's interrupt and the like stay manual with a note (goal 5 still holds).

## Anti-goals

- A spell that used to resolve and now resolves wrong.
- Effects that stick after their spell ends (concentration, duration, long rest).
- Monster stats leaking to players through a buff or summon.

## Decided by the builder (Claude's calls, to check)

- Spell effects live in one table keyed by spell name (extending `SPELL_EFFECTS`, which already holds Mage Armor), applied wherever the
  named condition is: on the character for a PC, on the combatant for a monster.
- Buff durations reuse the condition durations and concentration links that already end spell conditions; a long rest ends any lasting
  8 hours or less.
- Summon stat scaling is a small per-spirit rule (mechanics only) read off the imported stat block, not bundled.
- Work goes in this order, each shippable alone: reads (1), effects engine and ally targeting (2–3), summons (4), scoreboard to zero (6).
