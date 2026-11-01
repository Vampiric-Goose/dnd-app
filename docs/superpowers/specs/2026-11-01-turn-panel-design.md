# Turn panel: combat on the map

The user wants combat and the map joined before the full action economy: "a simpler initiative panel with less stuff in the mostly
empty right panel of the map", "coupled with a player's character", "so that they can end their own turns and perform actions".
In a fight, a player should be able to run their whole turn from the map, and the DM should be able to run whoever is acting.

Builds on: `2026-11-01-map-combat-integration-design.md` (movement, Dash, saved encounters, arrows), stage 4 (initiative) and
stage 5 (map). Look and feel: the Abyssal design (`src/ui/kit`). 2014 rules only.

## What the user decided
- **Panel contents during a fight** (player's map panel):
  - a turn strip: the creature before you, you, the creature after you, with initiative numbers and the round;
  - HP with a bar and temp HP;
  - conditions as chips, each saying what it does right now ("Grappled: speed 0", "Poisoned: disadvantage on attacks and ability
    checks", "Prone: crawling costs double");
  - movement left and Dash;
  - three pips: Action, Bonus action, Reaction;
  - one big card for the equipped weapon's attack (to-hit and damage roll buttons);
  - End turn (only on your turn).
- **Expanding the attack card opens a small pop-up window** (not an inline list) with everything you can do:
  - other attacks;
  - spells you can cast, with their slot levels;
  - class resources with uses left;
  - the standard actions: Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object.
- **Pips** light up when used and reset when your turn starts (Reaction too).
- **Blocked actions:** conditions that block actions are enforced, not just shown. Incapacitated, Stunned, Paralyzed, Petrified and
  Unconscious grey out all three pips and the actions that need them.
- **Using something marks the matching pip and spends what it costs:** an attack uses the Action, a bonus-action spell the Bonus
  action, a spell its slot, a resource a use. Rolls go to the dice log as today.
- **Dash is an action** in most cases: it spends the Action. With a feature that allows it as a bonus action (a Rogue's Cunning
  Action), the player may Dash as a bonus action instead. This replaces the free Dash button from the movement work; the DM's extra
  Dashes (up to 3 a turn) stay.
- **End turn** passes the turn on the DM's device, exactly as the DM pressing Next (same expiry of conditions).
- **DM:** the map's right panel gets the same compact view for whichever creature is acting:
  - the turn strip, its HP, its pips;
  - its actions: a PC's as above; a monster's from its stat block, with legendary actions and reactions;
  - Next.
  The full tracker stays on the Combat page for setup and bulk edits.

## Goals
- A player can play a whole combat turn from the map panel without opening the sheet or the Combat page.
- The DM can run any creature's turn from the map panel.
- Outside a fight the panels stay as they are today.

## Non-goals
- Not yet:
  - attack resolution against a target's AC, automatic damage, saving throws for spells, or reaction triggers (opportunity
    attacks);
  - linking an arrow to an attack (the declared-action record from the arrows work is where that goes later).
- No new rules content. No change to how the character sheet computes attacks, spells or resources.

## Anti-goals
- A cluttered panel: the always-visible part stays the list above. Everything else is in the pop-up (three tiers of controls).
- A player able to spend another character's actions, act on someone else's turn (except Reaction), or end someone else's turn.
- Hidden monsters leaking through the turn strip, the DM's panel being visible to players, or a monster's stats reaching players.

## How it behaves

### Turn state
- Each combatant's pips (Action, Bonus action, Reaction) live on its combatant in the live fight. Today's `reactionUsed` stays the
  Reaction pip.
- Pips reset where that combatant's own turn starts. Use the same turn-start reset (and `done` guard) as reactions, legendary
  actions and movement today: Next → Previous → Next never resets twice.
- Off its turn a creature can use only its Reaction.
- **The Attack action:** with Extra Attack (2 at Fighter 5, 3 at 11, 4 at 20; other classes' Extra Attack as their features say),
  the first attack spends the Action and the rest of that Action's attacks stay available ("Attack 1 of 2"). They're gone once the
  turn ends or the Action is spent on anything else.
- **Costs** come from the data:
  - spells: their casting time ("1 action", "1 bonus action", "1 reaction"; longer times need no pip and say so);
  - standard actions: Action; with Cunning Action, Dash, Disengage and Hide may use the Bonus action instead (the player picks);
  - resources: the cost is read from the text of the feature that grants the resource ("as a bonus action" → Bonus action, "as an
    action" → Action, "reaction" → Reaction, else no pip);
  - monster actions: Action; legendary actions use the existing legendary uses; a stat block's Reactions use the Reaction.
- The DM can tap any pip to set or clear it, which fixes mistakes. A player can clear a pip they set by mistake only on their own
  turn, and only when the use spent nothing (a slot or resource spent stays spent; refund it on the sheet).

### Player flow
- It's your turn:
  - the strip shows you as current, and the pips are fresh;
  - tap the attack card's to-hit and damage buttons to roll (the Action pip lights);
  - open the pop-up for anything else; drag your token (movement as today);
  - tap End turn, and the strip moves on for everyone.
- Not your turn: the panel shows your character with the Reaction usable and End turn hidden.
- A player with several characters in the fight: the panel shows the one acting, or else the next of theirs to act, with a small
  switcher.

### DM flow
- The panel follows the acting creature. Tapping another creature in the strip or on the map shows that one instead, without
  changing the turn.
- Next is in the panel. The Combat page keeps Prev, setup and the rest.

### Sync and safety
- Players change combat state only through messages the DM's device checks:
  - "use" (pip and what was used): own character; Action or Bonus action only on that character's turn (the turn players see),
    Reaction any time; refused when a blocking condition applies or the pip is spent;
  - "end turn": own character, on its turn.
- Spending slots and resources is an edit to the player's own character, which already syncs today.
- The players' tracker gains, for their own characters only, the pips and the Attack-action count. A monster's pips and actions
  never reach players. The turn strip uses the players' tracker view, so hidden creatures stay hidden.

## Calls made after the builder check (mine, not the user's)
1. **Extra Actions:** the Action pip is a count, not a yes/no.
   - A turn starts with 1 Action.
   - Using Action Surge (by name) adds one for that turn.
   - The DM can add one for any creature (Haste and similar).
2. **Resource costs:** the sheet's resource list gains an optional `cost` ('action' | 'bonus' | 'reaction'), read from the text of the
   feature that grants the resource. No other change to how the sheet computes resources.
3. **One atomic "use":** the DM's device does the whole use.
   - It checks the use, marks the pip, and spends the slot or resource on the player's character. The DM's device holds every
     player's character, and the edit syncs back as character edits do today.
   - A refused use spends nothing. It comes back as a short `useRefused` message with a reason, shown as a toast, and the player's
     view snaps back.
4. **Monsters:** Multiattack is one action entry; its attacks roll from the stat block's buttons, and it spends one Action. In a
   grouped run each creature keeps its own pips. The DM's panel shows the run's first creature, with a switcher among the group.
5. **The big attack card:**
   - It's the first equipped weapon's attack, or Unarmed Strike with none equipped.
   - Other attacks are in the pop-up.
   - With two light melee weapons equipped, the pop-up offers an off-hand attack for the Bonus action after the Attack action (2014
     two-weapon fighting).
6. **Spells:**
   - Casting asks for the slot level among the free slots at or above the spell's level; cantrips use none.
   - Casting a concentration spell sets concentration, asking first to drop the current one.
   - Rituals aren't offered in combat (they take 10 minutes).
7. **Dash** becomes a "use" (the standard action, or the bonus action with Cunning Action) that also adds the Dash to movement. The
   old `dash` message is removed. The DM's turn-bar Dash (up to 3 a turn) stays.

## Constraints
- Svelte 5, existing code and kit; no new dependencies; first load ≤ 150 KB gzipped (now about 61.5 KB). The panel and pop-up load
  lazily with the map.
- Logic is pure and in `src/lib` with Vitest tests: costs, blocking conditions, Extra Attack counting, pip reset, host checks for
  "use" and "end turn".
- The pop-up is keyboard-reachable, closes with Escape, and is a sheet-style window on phones; 44 px targets; no horizontal scroll
  at 375 px.
- Work the user asked to be cheap: implement directly where possible, no review chains for small pieces.

## Left to the builder
Exact layout and spacing; the pop-up's grouping and order; the condition text wording (short, 2014 rules); how the player switches
between several characters; the resource-cost parser's exact patterns (with the fallback "no pip").
