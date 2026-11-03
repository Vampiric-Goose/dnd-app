# Every reaction: shapes, a name table, and a reminder card

**Why:** The user asked that every reaction in the SRD, PHB, XGE and TCE work: the spells, class and subclass features, feats and fighting styles.

Six reactions are automated today:
- Opportunity Attack
- Counterspell
- Shield
- Hellish Rebuke
- Uncanny Dodge
- a monster's "+N AC" Parry

About 70 more fire at moments the app already sees, or nearly sees.

## Goals
- Every listed reaction is offered at its moment, to whoever controls a creature that can actually use it, on the existing card. The binding rules stay:
  - nothing waits unless a reaction is available;
  - only the eligible are asked;
  - players never learn hidden information;
  - the card passes by itself after 10 s.
- Its cost is paid: the Reaction, plus a slot, superiority die, Bardic Inspiration, Channel Divinity, ki point, sorcery point, psi die or a use per rest, exactly as the turn panel pays it.
- Its effect is worked out where it fits one of a few shapes. Where it doesn't, the card still asks at the right moment and pays the cost, and the DM settles the rest by hand. This is the "reminder" shape, like the spell interpreter's manual notes.

## Non-goals
- Mechanics are keyed by name only: no book text is bundled (the standing rule).
- Altitude: there is no height on the map, so Feather Fall and Slow Fall are reminders.
- Recognising a readied action's free-text trigger. "Readied action" stays a button the creature presses off-turn, as today.

## Windows (when the app asks)
Each window is a point in the existing pipeline.

1. **Attack declared, before its result is known.**
   - The target, and allies of the target within the feature's range, are asked.
   - The card says "Orc attacks Wren" with no roll shown.
   - Disadvantage imposed here rolls a second d20 on the DM's device and keeps the lower. This is the same odds as declaring it beforehand, since the reactor hasn't seen the roll.
   - This is a new ask placed before `land`'s hit ask.
2. **Hit or miss known, before damage.** This extends today's hit window:
   - on a hit: Shield-likes, damage cutters and resistances;
   - on a miss: Riposte, Giant Killer, Stand Against the Tide.
3. **Damage dealt.** This extends today's Hellish Rebuke window: damage back, and Wrath of the Storm.
4. **Movement:**
   - leaving reach (today's Opportunity Attack, plus Sentinel ignoring Disengage);
   - entering reach (Polearm Master, Brace);
   - a creature ending its turn within 5 ft (Skirmisher).
   - Movement goes through the same step-by-step walk.
5. **A spell being cast:** today's Counterspell window. It adds Magic-User's Nemesis and Mage Slayer (attack the caster within 5 ft).
6. **A creature dying, or a save:** Soul Cage, Tokens of the Departed, Beguiling Twist, Spell Thief and Arcane Deflection's save part are reminders.

## Effect shapes (what the app works out)
| Shape | Examples |
|---|---|
| AC bonus vs this attack (judged again) | Defensive Duelist (+proficiency), Arcane Deflection (+2), Warding Maneuver (+1d8), Glorious Defense (+Cha) |
| Disadvantage on this attack | Protection, Warding Flare, Shadowy Dodge, Entropic Ward, Steel Defender's Deflect Attack, Watchers' Vigilant Rebuke's sibling features |
| Cut this damage by dice + modifier | Interception, Parry (Battle Master), Deflect Missiles, Guardian Coil, Song of Defense (5 × slot), Protective Field, Spirit Shield |
| Resistance to this damage | Absorb Elements (plus its 1d6-per-slot rider on the next melee hit), Spectral Defense, Swarming Dispersal, Dampen Elements |
| Damage back (with a save where the feature has one) | Wrath of the Storm, Storm's Fury, Rebuke the Violent, Halo of Spores, Repulsion Shield, Rebuke of the Talisman |
| A weapon attack now (the attacker, caster, mover…) | Sentinel's other two parts, Mage Slayer, Polearm Master, Riposte (with the die on damage), Brace, Giant Killer, Retaliation, Opportunist, Slayer's Counter, Glorious Defense's attack |
| A spell as the Opportunity Attack | War Caster: one-target spells with a casting time of 1 action |
| Change that roll | Cutting Words (−Bardic die to the attack or damage roll), Bend Luck (±1d4), Restore Balance (no advantage or disadvantage) |
| A save or the spell fails | Magic-User's Nemesis (Wis save vs the ranger's DC) |
| Reminder (ask, pay, the DM settles) | Feather Fall, Slow Fall, Soul Cage, Misty Escape, Fade Away, Illusory Self, Instinctive Charm, Misdirection, Redirect Attack, Stand Against the Tide's redirect, Skirmisher's move, Mobile Flourish, Beguiling Twist, Spell Thief, Projected Ward, Aura of the Guardian, Protective Bond, Bountiful Luck, Second Chance, Orcish Fury, Shield Master, every case the table doesn't cover |

## The name table
- One entry per reaction, keyed by its feature, feat, spell or fighting-style name, like `SPELL_RULES`. Each entry gives:
  - its window and range;
  - who may react: self, an ally of the target, the target of a Slayer's Prey;
  - its conditions: melee only, finesse weapon, sees the attacker, the attacker Large or larger;
  - its cost: the Reaction, plus a resource name or a slot;
  - its shape;
  - the dice and modifier, taken from the sheet: proficiency, Dex, Int, Cha, class level, slot level.
- **Die sizes come from class levels:**
  - superiority die d8, d10 at 10th, d12 at 18th;
  - Bardic Inspiration d6, d8 at 5th, d10 at 10th, d12 at 15th;
  - psi die by the Psi Warrior table.
- **Monsters** keep today's "adds N to its AC" Parry. Their other reaction traits become reminders on the hit window. The DM is asked only when the monster is the one hit, so it's never noisy for players.

## Cards and cost
- The existing card gets the new options. Labels say what the option does, such as "Protection (disadvantage)" or "Parry (−1d8+3)".
- Paying a resource uses the same `payment` and `spendOn` path as the turn panel. A resource that's all spent means the option isn't offered.
- A reminder option says "Used: settle by hand", spends the cost, and puts a note on the DM's Results list.

## Left to the builder
- How the table is laid out in files.
- Exact label wording.
- The order of options on a card.
