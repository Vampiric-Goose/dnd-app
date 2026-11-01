// Pure (no Svelte/Vite/DOM): everything a creature can do on its turn, each with what it costs (turn panel spec). Ids are stable on
// every device, so a player's "use" names the action and the DM's device rebuilds the same list to check it.
import { spellList } from '../character/play.ts';
import { getKind } from '../character/choices.ts';
import { richToPlain } from '../content/richtext.ts';
import type { Attack, Character, Combat, Combatant, MonsterDef, RichText, Sheet } from '../types.ts';
import { actionsLeft, BLOCKING, grantAction, spend, useProblem, type Cost } from './economy.ts';
import { addDash } from './movement.ts';

export interface TurnAction {
  id: string; name: string; cost: Cost;
  group: 'attack' | 'standard' | 'spell' | 'resource' | 'feature' | 'monster';
  text?: RichText; attack?: Attack;
  spell?: { id: string; level: number; concentration: boolean };
  resource?: string; uses?: { left: number; max: number };
  /** What using it gives beyond the pip: another Action (Action Surge) or a Dash's movement. */
  grants?: 'action' | 'dash';
  /** A legendary action: the legendary uses it costs (taken at the end of another creature's turn). */
  legendary?: number;
  /** Casting it needs a target, which gets this condition (Haste: its text grants "an additional action on each of its turns"). */
  target?: 'haste';
}

/** The cost a feature's text states: "as a bonus action" / "use a bonus action", "as an action" / "use your action", a reaction; else none. */
export function costOfText(text: string): Cost {
  const t = text.toLowerCase();
  if (/bonus action/.test(t)) return 'bonus';
  if (/\breaction\b/.test(t)) return 'reaction';
  if (/\bas an action\b|\buse (?:your|an) action\b|\btake an action\b/.test(t)) return 'action';
  return 'none';
}

/** A monster trait's cost, only when the trait says it is taken as one ("as a bonus action", "uses its reaction"): a trait that merely
 * mentions reactions (a Marilith's Reactive) is no action. */
export function traitCost(text: string): Cost {
  const t = text.toLowerCase();
  if (/\bas a bonus action\b/.test(t)) return 'bonus';
  if (/\b(?:as a|uses? its|use its) reaction\b/.test(t)) return 'reaction';
  if (/\bas an action\b/.test(t)) return 'action';
  return 'none';
}

/** A spell's casting time as a cost; anything longer than an action (a minute, an hour) is not offered in a turn. */
export function castingCost(castingTime: string): Cost | undefined {
  const t = castingTime.toLowerCase().trim();
  return /^1 bonus action/.test(t) ? 'bonus' : /^1 reaction/.test(t) ? 'reaction' : /^1 action/.test(t) ? 'action' : undefined;
}

/** Attacks one Attack action allows: 1, or Extra Attack's 2, "(2)" 3, "(3)" 4. */
export function attacksPerAction(features: { name: string }[]): number {
  let n = 1;
  for (const f of features) {
    const m = /^Extra Attack(?: \((\d)\))?$/.exec(f.name.trim());
    if (m) n = Math.max(n, 1 + (m[1] ? Number(m[1]) : 1));
  }
  return n;
}

/** Two-weapon fighting: no positive ability modifier on the off-hand's damage (PHB p.195). */
export const offhandDamage = (damage: string): string => damage.replace(/\+\d+$/, '');

const STANDARD = ['Dash', 'Disengage', 'Dodge', 'Help', 'Hide', 'Ready', 'Search', 'Use an Object'];
const id = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
const lightMelee = (a: Attack) => a.properties.includes('light') && !a.properties.includes('ammunition');

/** A character's actions: attacks (the first is the primary card), off-hand, standard actions, Cunning Action, castable spells, resources. */
export function pcActions(c: Character, sheet: Sheet, features: { name: string; text: RichText }[]): TurnAction[] {
  const out: TurnAction[] = sheet.attacks.map((a) => ({ id: `attack:${a.entryId}`, name: a.name, cost: 'action', group: 'attack', attack: a }));
  const light = sheet.attacks.filter(lightMelee);
  if (light.length >= 2) for (const a of light) out.push({ id: `offhand:${a.entryId}`, name: `Off-hand: ${a.name}`, cost: 'bonus', group: 'attack', attack: { ...a, damage: offhandDamage(a.damage) } });
  for (const name of STANDARD) out.push({ id: `std:${id(name)}`, name, cost: 'action', group: 'standard', ...(name === 'Dash' && { grants: 'dash' as const }) });
  const names = new Set(features.map((f) => f.name));
  if (names.has('Cunning Action')) for (const name of ['Dash', 'Disengage', 'Hide']) out.push({ id: `cunning:${id(name)}`, name: `Cunning Action: ${name}`, cost: 'bonus', group: 'feature', ...(name === 'Dash' && { grants: 'dash' as const }) });
  const seen = new Set<string>();
  for (const sc of sheet.spellcasting) {
    const knownCaster = getKind((k) => c.embedded[k], sc.classId, 'class')?.spellcasting?.preparation === 'known';
    for (const { spell, prepared } of spellList(c, sc.classId)) {
      const cost = castingCost(spell.castingTime);
      if (!cost || seen.has(spell.id) || !(spell.level === 0 || prepared || knownCaster)) continue;
      seen.add(spell.id);
      out.push({ id: `spell:${spell.id}`, name: spell.name, cost, group: 'spell', text: spell.text, spell: { id: spell.id, level: spell.level, concentration: spell.concentration },
        ...(/\badditional action on each of its turns\b/i.test(richToPlain(spell.text)) && { target: 'haste' as const }) });
    }
  }
  for (const r of sheet.resources) {
    const f = features.find((x) => x.name === r.name || x.name.startsWith(`${r.name} (`)), surge = r.name === 'Action Surge'; // SRD: "Action Surge (1 use)"
    out.push({
      id: `res:${r.name}`, name: r.name, cost: surge ? 'none' : f ? costOfText(richToPlain(f.text)) : 'none', group: 'resource', resource: r.name,
      uses: { left: Math.max(0, r.max - (c.state.resourcesUsed[r.name] ?? 0)), max: r.max }, ...(f && { text: f.text }), ...(surge && { grants: 'action' as const }),
    });
  }
  return out;
}

export const primaryAction = (list: TurnAction[]): TurnAction | undefined => list.find((a) => a.group === 'attack');

/** A monster's actions from its stat block: actions, bonus actions, reactions, and traits that say they take one (Nimble Escape). */
export function monsterActions(m: MonsterDef): TurnAction[] {
  const of = (list: MonsterDef['actions'], cost: Cost, key: string) => list.map((t, i): TurnAction => ({ id: `mon:${key}:${i}`, name: t.name, cost, group: 'monster', text: t.text }));
  const traits = m.traits.flatMap((t, i): TurnAction[] => { const cost = traitCost(richToPlain(t.text)); return cost === 'none' ? [] : [{ id: `mon:trait:${i}`, name: t.name, cost, group: 'monster', text: t.text }]; });
  const legendary = m.legendary.map((t, i): TurnAction => ({ id: `mon:legendary:${i}`, name: t.name, cost: 'none', group: 'monster', text: t.text,
    legendary: Number(/costs (\d) actions/i.exec(t.name)?.[1] ?? 1) }));
  return [...of(m.actions, 'action', 'action'), ...of(m.bonusActions, 'bonus', 'bonus'), ...traits, ...of(m.reactions, 'reaction', 'reaction'), ...legendary];
}

/** An attack that is part of the Attack action (Extra Attack counts it); undefined for anything else. */
export const attackOf = (a: TurnAction, perAction: number) => (a.group === 'attack' && a.cost === 'action' ? { perAction } : undefined);

const HASTE_OK = new Set(['std:dash', 'std:disengage', 'std:hide', 'std:use-an-object']);
/** It would take the Hasted creature's last Action, its extra one (ponytail: the Haste Action counts as the one taken last). */
function onHasteAction(x: Combatant, a: TurnAction, perAction: number): boolean {
  const e = x.economy;
  return !!e?.haste && a.cost === 'action' && actionsLeft(x) === 1 && !(attackOf(a, perAction) && e.attacks > 0 && e.attacks < perAction);
}

/** Why the creature can't use it now (its pip, a use left, legendary uses, the Hasted limits), or undefined. Slots are `payment`'s check. */
export function problemOf(x: Combatant, a: TurnAction, conditions: readonly string[], onTurn: boolean, perAction = 1): string | undefined {
  if (a.uses && a.uses.left < 1) return `no ${a.name} left`;
  if (a.grants === 'action' && !onTurn) return 'not your turn';
  if (a.grants === 'action' && x.economy?.surged) return 'once a turn';
  if (a.id.startsWith('offhand:') && !x.economy?.light) return 'attack with a light melee weapon first';
  if (onHasteAction(x, a, perAction) && !(HASTE_OK.has(a.id) || a.id.startsWith('attack:') || (a.group === 'monster' && a.text && /weapon attack/i.test(richToPlain(a.text))))) {
    return 'Hasted: the extra Action is only one weapon attack, Dash, Disengage, Hide or Use an Object';
  }
  if (a.legendary === undefined) return useProblem(x, a.cost, conditions, onTurn, attackOf(a, perAction));
  if (onTurn) return "only at the end of another creature's turn";
  const block = conditions.find((c) => BLOCKING.includes(c.toLowerCase()));
  if (block) return block;
  return !x.legendary || x.legendary.max - x.legendary.used < a.legendary ? 'no legendary actions left' : undefined;
}

const pactLeft = (sheet: Sheet, c: Character) => (sheet.pact ? sheet.pact.slots - c.state.pactSlotsUsed : 0);

/** Spell slots left per level (index 0 = 1st), Pact Magic slots counted at their level. */
export function slotsLeft(sheet: Sheet, c: Character): number[] {
  const out = sheet.slots.map((n, i) => n - (c.state.slotsUsed[i] ?? 0));
  if (sheet.pact && pactLeft(sheet, c) > 0) { while (out.length < sheet.pact.level) out.push(0); out[sheet.pact.level - 1] += pactLeft(sheet, c); }
  return out;
}

/**
 * A levelled spell's slot level (the chosen one, else the lowest free one at or above its own) and why it can't be paid, if so; `pact`
 * when a Pact Magic slot pays (a regular slot of that level goes first). Cantrips and the rest: no level.
 */
export function payment(a: TurnAction, sheet: Sheet, c: Character, slot?: number): { level?: number; pact?: true; problem?: string } {
  if (!a.spell || a.spell.level < 1) return {};
  const left = slotsLeft(sheet, c), min = a.spell.level;
  const level = slot ?? (left.findIndex((n, i) => n > 0 && i + 1 >= min) + 1 || min);
  if (level < min || (left[level - 1] ?? 0) < 1) return { level, problem: `no level ${level} slot left` };
  return (sheet.slots[level - 1] ?? 0) - (c.state.slotsUsed[level - 1] ?? 0) > 0 ? { level } : { level, pact: true };
}

/**
 * The fight after the use (check problemOf first): its pip, an extra Action, concentration, a Dash's movement, legendary uses; a new
 * concentration spell ends the caster's Haste; Haste makes `target` (a combatant id) Hasted.
 */
export function applyUse(k: Combat, x: Combatant, a: TurnAction, perAction = 1, target?: string): Combat {
  const haste = onHasteAction(x, a, perAction);
  let y = spend(x, a.cost, attackOf(a, haste ? 1 : perAction));
  if (haste && attackOf(a, perAction) && y.economy) y = { ...y, economy: { ...y.economy, attacks: perAction } }; // one weapon attack only
  if (attackOf(a, perAction) && lightMelee(a.attack!) && y.economy) y = { ...y, economy: { ...y.economy, light: true } };
  if (a.grants === 'action') { y = grantAction(y); y = { ...y, economy: { ...y.economy!, surged: true } }; }
  if (a.spell?.concentration) y = { ...y, concentrating: true };
  if (a.legendary && y.legendary) y = { ...y, legendary: { ...y.legendary, used: y.legendary.used + a.legendary } };
  let cs = k.combatants.map((z) => (z.id === x.id ? y : z));
  if (a.spell?.concentration) cs = cs.map((z) => (z.hasted?.by === x.id ? { ...z, hasted: { ...z.hasted, ended: true as const } } : z));
  if (a.target === 'haste' && target !== undefined) cs = cs.map((z) => (z.id === target ? { ...z, hasted: { by: x.id, round: k.round } } : z));
  const next = { ...k, combatants: cs };
  return a.grants === 'dash' ? addDash(next, x.id) : next;
}

/** The character after paying: a slot of `level` (a Pact Magic one with `pact`) and one use of `resource`. */
export function spendOn(c: Character, level: number | undefined, resource: string | undefined, pact?: boolean): Character {
  const slotsUsed = [...c.state.slotsUsed];
  if (level !== undefined && !pact) { while (slotsUsed.length < level) slotsUsed.push(0); slotsUsed[level - 1] += 1; }
  return { ...c, state: { ...c.state, slotsUsed, ...(pact && level !== undefined && { pactSlotsUsed: c.state.pactSlotsUsed + 1 }),
    ...(resource && { resourcesUsed: { ...c.state.resourcesUsed, [resource]: (c.state.resourcesUsed[resource] ?? 0) + 1 } }) } };
}
