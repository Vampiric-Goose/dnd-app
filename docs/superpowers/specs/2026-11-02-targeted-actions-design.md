# Targeted actions: design

Status: approved 2026-11-02. Builds on the turn panel (2026-11-01-turn-panel-design.md) and map–combat integration.

## Intent

At the table, an attack or a damaging spell should run from the map and the turn panel without anyone doing arithmetic.
The player picks the attack, picks the target on the map, rolls, and the app works out hit or miss and takes the HP off.
An area spell shows its area on the map and works out who is inside.

The user's two examples are the acceptance test:
- **Fighter:** three goblins. The fighter picks his Greatsword, turns on Great Weapon Master, clicks the nearest goblin, and rolls to hit. On a hit he rolls damage, and the goblin loses that much HP.
- **Wizard:** Ice Knife at a goblin. A line runs from the wizard to the goblin. The spell attack hits or misses, and the knife's damage lands on a hit. Hit or miss, the 5-ft burst around the goblin explodes. The app finds every creature inside, rolls their Dex saves, and applies the cold damage.
- **Sleep:** a pure area. It is placed on an empty point, and whoever is inside is listed. It needs no target creature.

## Goals

1. **Target picking on the map:** for an attack, a spell attack, or a single-target save spell.
   - Only creatures in reach or range can be picked, and those squares are highlighted.
   - For a ranged attack, a line runs from the attacker to the target. It is required for ranged spell attacks and is used for every ranged attack.
2. **Areas:** spheres, cubes, cones, lines and cylinders.
   - An area can be placed on a creature (Ice Knife's burst) or on any point within range (Sleep, Fireball).
   - A self-origin area starts from the caster (cone, line).
   - Everyone inside the area is listed live while it is aimed.
3. **Attack options**, as toggles on the attack before rolling:
   - Great Weapon Master (−5 to hit / +10 damage, heavy melee weapon) and Sharpshooter (the same, ranged weapon), only when the character has the feat.
   - Advantage and disadvantage.
4. **Resolution:**
   - The attack roll is compared with the target's AC. A natural 20 always hits and doubles the damage dice; a natural 1 always misses.
   - Damage is rolled on a hit and applied to HP.
   - Saves are rolled for each creature in the area against the spell's DC. Full damage on a fail; on a success, half or none, as the spell's text says.
5. **Visibility:**

   | | DM | Player who acts | Other players |
   |---|---|---|---|
   | Target's AC | yes | no | no |
   | Their own roll (die + bonus = total) | yes | yes | as today's roll sharing |
   | Hit / miss | yes | yes | as today |
   | Their damage roll | yes | on a hit only | on a hit, as today's roll sharing |
   | Hidden creatures caught in their area | yes | no | no |
   | Spell save DC | yes | yes, if they cast it | no |
   | Monsters' save rolls and pass/fail | yes | no | no |
   | Who is in their area | yes | the ones they can see on the map | no |

6. **A campaign setting, "Targeting":** on by default; only the DM can change it. When it is off, the turn panel behaves exactly as it does today: roll buttons, no targets, no automatic HP.
7. **Both sides of the screen:** players use it for their characters (their device sends the use, and the DM's device applies it, as `use` does today). The DM uses the same flow for monsters, with PCs and monsters as targets.

## Non-goals (this version)

- Spell effects other than damage: conditions (Sleep's Unconscious, Hold Person), Sleep's hit point pool, buffs and debuffs. These come later, as the user said. An area is still placed and its creatures listed; the app applies nothing beyond damage.
- Healing on a target, multi-target spells (Magic Missile darts, Scorching Ray rays), and cover or line of sight through walls.
- Reactions interrupting a hit (Shield).
- Grapple and Shove contests.

## Anti-goals

- **No leaks:** a player must never see a monster's AC, its save bonus or roll, or its HP numbers, beyond what `showMonsterHealth` already allows. This holds in the UI and in every message the host sends. The existing leak tests set the bar.
- **No silent automation the DM can't take back:** every applied result can be undone by the DM.
- **No 2024 rules, and no book text in the repo:** only what readSpell already reads from imported spell text.
- **No scope creep:** only what is listed above.

## Constraints and existing pieces to build on

- **Turn panel:** `src/ui/turn/TurnPanel.svelte` (lists, spell dice, slot pick, area template button).
- **Actions:** `src/lib/combat/turnActions.ts` (`TurnAction`, `attackOf`, `problemOf`, `applyUse`, `payment`).
- **Spell text:** `src/lib/combat/spellText.ts` (`readSpell`: attack, save, damage, perSlot, scaling, area).
- **Map:** `src/ui/map/MapCanvas.svelte`: Template tool, `preset`, reachable-squares tint.
- **Movement:** `src/lib/combat/movement.ts`: grid distance and diagonal rule.
- **Sync:** a player's `use` goes through `src/lib/sync/host.ts #use`, which checks and then applies on the DM's device. A target id already travels with `use` (Haste, Swap weapon).
- **Defenses:**
  - Monster: `Combatant.ac`, and on its statblock `saves`, ability scores, `resist`, `immune`, `vulnerable`.
  - PC: `Sheet.ac`, `saves`, `resistances`, `immunities`, `vulnerabilities`.
- **Tests:** Vitest for all rules logic, plus a browser check of the two examples.

## Decided by the user

- AC visible to the DM only; players see their own roll.
- Players see the DC of a spell they cast; they never see save results.
- Ranged spell attacks draw a line to the target.
- Pure areas without a target creature must work (Sleep).
- The whole mechanism is a DM setting, on by default.
- Non-damage spell effects are deferred.
- **PC saves:** a PC caught in an area rolls their own save through an in-app pop-up, like the initiative prompt (no browser dialogs). The DM can roll it for a player who is away. The area's damage to that PC waits for the save; everyone else's applies at once.

## My calls (the user can overrule)

- **Who rolls, and in what order:**
  - The acting player rolls their attack die and their damage dice together on their device and sends the raw die faces with the use, in one message.
  - The DM's device adds its own bonuses to work out the totals, and checks each die is in range (d20 within 1–20, each damage die within its sides).
  - Damage is applied only on a hit. A natural 20 doubles the dice, and the player's device knows that when it rolls.
  - The player never sees damage on a miss (user). Their device holds the damage roll unshown until the DM's device answers: on a hit it shows and shares it; on a miss it is dropped. One message out, one outcome back, with no pending state on the host.
  - The cost (action, slot, pip) is paid when the roll is sent, as `use` does today. Aiming can be cancelled freely before rolling.
- **Monsters:**
  - The DM's monsters use the same flow for weapon attacks: to-hit and damage come from the existing `rollParts` parse of their action text, and reach or range from "reach 5 ft" or "range 80/320 ft".
  - Spells use readSpell.
  - Other text areas (breath weapons, auras) come later; they keep today's roll buttons.
  - The DM's device rolls for monsters.
- **0 HP:** damage goes through the existing `applyDamage` (temp HP first, PC dying flow, monster down as today). Undo restores HP, temp HP and the dying state.
- **Who is in an area:** a creature counts as inside when any square it occupies is covered (size from its token footprint). Elevation is ignored.
- **The caster's list:** the caster sees the names of the creatures in their area that they can see on the map.
- **Hidden creatures (user):** a hidden creature can't be picked as a target (`#use` already rejects hidden targets). An area still catches it when it happens to be inside: it saves and takes damage like anyone else. Only the DM sees that; the caster's list and outcome leave it out.
- **The setting:** "Targeting" is on for existing campaigns too, through the default settings merge.
- **Resistances:** resistance, immunity and vulnerability are applied to damage automatically, and the DM's log shows it ("halved: resistant to cold").
- **Undo:** the DM's log keeps each resolution with an Undo that restores the HP it changed.
- **Range, as the PHB has it (user):**
  - A weapon with a range property (normal/long; ranged and thrown weapons): beyond normal range, the attack has disadvantage; beyond long range, it can't be made, so the target can't be picked.
  - Ranged attacks in close combat: a ranged attack roll has disadvantage while a hostile creature that can see the attacker, and isn't incapacitated, is within 5 ft of it. The app can't know what sees whom, so it counts any hostile creature within 5 ft that isn't incapacitated, and the DM can clear the disadvantage.
  - Spells have one range and no long range: beyond it, nothing can be picked. Ranged spell attacks follow the close-combat rule too.
  - Melee reach is 5 ft, or 10 ft with the reach property.
- **The aiming line:** it shows on the acting player's and the DM's screens while aiming, and for a few seconds after.


## Left to the builder

- **Data shape:** what a resolution and its log entry look like, and the message shapes (extending `use`, results to the DM, an outcome back to the player).
- **Aiming mode:** how it is entered and left on touch and on desktop.
- **Damage type and save outcome:** where they are parsed from the spell text (extending readSpell).
