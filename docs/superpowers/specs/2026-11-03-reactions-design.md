# Reactions: a stack of pop-ups

**Why:** Opportunity Attacks, Counterspell, Hellish Rebuke, and what answers a hit (Shield, Uncanny Dodge, a monster's Parry) exist only as buttons nobody remembers to press. The app should notice the moment, ask whoever controls a creature that can react, and settle it, without nagging and without stalling the table.

## Goals
- The app spots each trigger, pauses what triggered it, asks, resolves, then carries on.
- Reactions can answer reactions (a stack): Shield against the Opportunity Attack, Counterspell against a Counterspell. The newest resolves first.
- Only creatures that can actually react are asked. Nobody else sees anything.
- Nothing waits unless a reaction is actually available (the user's ruling, 11-03). With no eligible reactor there is no pause, no card, no "waiting" line and no delay: the move, cast or hit goes straight through.

## Non-goals
- Readied actions, War Caster (casting a spell as an Opportunity Attack), Polearm Master and Mobile: these stay by hand.
- Legendary actions and lair actions.
- Forced movement, teleporting and the DM repositioning tokens never provoke.

## Anti-goals (a failure even if it works)
- A pop-up that covers the map, or one that appears when the creature has no real option.
- A fight that hangs because someone walked away from their phone.
- Players learning hidden information: monster AC, saves, ids, or the name of a spell a monster is casting.

## Triggers

All triggers need a running fight (round 1 or later) and targeting switched on.

**Leaving reach → Opportunity Attack**
- Only the moves of the creature whose turn it is count.
- The reactor is hostile (a PC's foes are monsters, and the other way round), within its reach before the step and not after it.
- The reactor must see the mover: the mover isn't Invisible and the reactor isn't Blinded.
- No trigger if the mover took Disengage this turn (Disengage and Cunning Action: Disengage now set `economy.disengaging`, the same way Dodge sets `dodging`).
- The move is its straight line, sampled the way `noteEntries` samples it. It stops at the last point inside the reach.
- After the stack empties, the move carries on to its destination, unless any of these happened:
  - the mover dropped to 0 HP;
  - the mover became incapacitated or grappled;
  - its speed became 0. Sentinel: a hit from a reactor with the Sentinel feat sets the speed to 0 for the turn.
- Further down the line it can trigger again, from other reactors.

**Casting a spell → Counterspell**
- Any spell use, targeted or not: the turn panel's spells, monsters' spells, and a reaction spell such as a Counterspell or Hellish Rebuke.
- The reactor is within 60 ft of the caster, and has Counterspell prepared (PC) or in its spell list (monster), with a 3rd-level or higher slot free.
- It may be any creature, not only a hostile one.
- The spell's effects wait: its result, its buff, its summons. Its slot and action are paid when the cast starts, so a countered spell still spends them.

**An attack hits → Shield, Uncanny Dodge, a monster's AC reaction**
- Only the creature that was hit is asked, before its damage lands.
- **Shield:** puts the Shield condition (+5 AC) on it until the start of its next turn. The hit is judged again against the new AC; a natural 20 still hits. Magic Missile is a hit that Shield stops completely.
- **Uncanny Dodge:** a PC with the feature, who sees the attacker, halves the attack's damage.
- **A monster's AC reaction:** a reaction whose text says it "adds N to its AC" (Parry) does the same as Shield, with +N against that one attack. A melee-only one applies only to melee attacks.

**Damage taken → Hellish Rebuke**
- After the damage has landed. The reactor is still conscious, and the creature that dealt the damage is within 60 ft and seen.
- It casts Hellish Rebuke at that creature through the normal spell pipeline, so it can itself be counterspelled.

## Settling Counterspell
- A spell of 3rd level or lower is countered outright, and so is any spell whose level is no higher than the counterspell's slot.
- Otherwise the counterspeller makes a spellcasting ability check against 10 + the spell's level. Its d20 always comes with the answer and is used only when needed.
- The players' pop-up says "Mage casts a spell", with no name and no level. The DM sees both.

## The pop-up
- It's a small card docked at the bottom edge, not a modal, and the map stays usable.
- **One card per moment for each person.** It lists every creature they control that may react, each with its buttons, plus **Pass**.
  - The DM's card holds all the eligible monsters, and any PC whose player isn't connected.
  - A player's card holds only their own characters.
- **Buttons:**
  - Opportunity Attack: "Attack (Longsword)". It's the PC's melee weapon, or the monster's first melee attack.
  - Counterspell and Hellish Rebuke: one button per slot level the creature can pay.
  - Shield and Uncanny Dodge: one button each.
  - The text shows the trigger in one line, such as "Goblin leaves your reach" or "Orc hits you (17)". The roll total helps a player decide on Shield.
- **Auto-pass:** a thin bar counts down 10 seconds, and then the card passes by itself.
- **Waiting:** the person whose action is paused sees "Waiting on reactions…" with the names being asked. The DM can pass for anyone.
- **Who rolls:** the reactor's own device rolls its dice (attack, damage, the Counterspell check) and sends them with the answer. The DM's device checks them as it checks every player use (`#use` / `workOut`). Monsters roll on the DM's device.

## Spending and validation
- An answer spends the reaction pip (`applyUse` with cost `'reaction'`) and the slot, exactly as the turn panel would.
- A refused answer counts as a pass, and the player is told why.
- **The DM's device is the only judge.** It works out who is eligible, keeps the stack, runs the timers, and checks every answer, as `host.ts` already does:
  - the character is the player's own;
  - it's one of the creatures that card offered;
  - the slot can be paid;
  - the dice fit.

## Where it lives (the parts decided)
- **Pure rules in `src/lib/combat/reactions.ts`:**
  - eligibility for each trigger;
  - the reach-leave point along a move;
  - settling a Counterspell;
  - judging a hit again with extra AC;
  - halving.
- **The stack, on the DM's device:** an in-memory module. `ask(trigger)` returns a promise of the answers, and nested asks are the stack.
  - It isn't stored in the combat record. A reload mid-ask means every open card has passed.
  - The players' cards travel as a new host message carrying only that player's prompts. Answers come back as a new guest message, `react`, which goes through `parseGuestMessage`.
- **Hooks:** the DM's and the host's move paths and use paths `await` the ask before they move on or apply anything.
- **A campaign setting, "Ask about reactions":** on by default. Off means no cards at all, and the reactions stay as turn-panel buttons.

## Left to the builder
- Component names, the card's exact styling (it follows the app's existing pop-ups, such as the save prompt), and file splits.
- How a paused move is drawn: the token waits at the reach edge.
