// Pure (no Svelte/Vite/DOM): everything a creature can do on its turn, each with what it costs (turn panel spec). Ids are stable on
// every device, so a player's "use" names the action and the DM's device rebuilds the same list to check it.
import { spellList } from '../character/play.ts';
import { getKind } from '../character/choices.ts';
import { richToPlain } from '../content/richtext.ts';
import type { Attack, Character, Combat, Combatant, MonsterDef, RichText, Sheet, SpellDef } from '../types.ts';
import { abilityMod } from '../rules/constants.ts';
import { actionsLeft, BLOCKING, grantAction, spend, useProblem, type Cost } from './economy.ts';
import { addDash, standUp } from './movement.ts';
import { readSpell, readSpellcasting, type SpellRead } from './spellText.ts';
import { equip, HANDS, handsFor, handsHeld, unequip } from '../items/hands.ts';

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
  /** Ability checks it rolls instead of an attack (Grapple, Shove, escaping a grapple). */
  check?: { label: string; bonus: number }[];
  /** Only offered while it applies: grappled, prone, or standing. */
  when?: 'grappled' | 'prone' | 'standing';
  /** Picks it needs (Swap weapon: a carried weapon to draw); the pick goes as the use's target. */
  options?: { id: string; name: string }[];
  /** A spell's rolls: what its wording says (spellText), the caster's attack bonus and save DC, level and spellcasting modifier. */
  cast?: { read: SpellRead; attack?: number; dc?: number; charLevel: number; mod: number };
  /** Why it can't be used at all right now (casting in armor without proficiency). */
  blocked?: string;
  /** A monster's spell use it spends ('slot:3', 'day:<spell id>'). */
  spend?: string;
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
const p = (s: string): RichText => [{ p: s }];

/**
 * What every creature can do in combat (2014 basic rules, SRD 5.1 "Combat"): the standard actions; Grapple and Shove, each an Athletics
 * check in place of one attack of the Attack action; escaping a grapple (an action); dropping prone (free) and standing up (half the
 * speed); an Opportunity Attack and the readied action as reactions. `melee`: the weapon an Opportunity Attack uses.
 */
function basics(athletics: number, acrobatics: number, melee?: Attack): TurnAction[] {
  const out: TurnAction[] = STANDARD.map((name) => ({ id: `std:${id(name)}`, name, cost: 'action', group: 'standard', ...(name === 'Dash' && { grants: 'dash' as const }) }));
  const ath = { label: 'Athletics', bonus: athletics };
  out.push(
    { id: 'special:grapple', name: 'Grapple', cost: 'action', group: 'attack', check: [ath], text: p('In place of one attack: Athletics against the target\'s Athletics or Acrobatics. It must be no more than one size larger than you and within reach. On a win it is grappled.') },
    { id: 'special:shove', name: 'Shove', cost: 'action', group: 'attack', check: [ath], text: p('In place of one attack: Athletics against the target\'s Athletics or Acrobatics. On a win, knock it prone or push it 5 feet away.') },
    { id: 'std:escape', name: 'Escape a grapple', cost: 'action', group: 'standard', when: 'grappled', check: [ath, { label: 'Acrobatics', bonus: acrobatics }], text: p('Athletics or Acrobatics against the grappler\'s Athletics.') },
    { id: 'free:prone', name: 'Drop prone', cost: 'none', group: 'standard', when: 'standing' },
    { id: 'free:stand', name: 'Stand up', cost: 'none', group: 'standard', when: 'prone', text: p('Costs half your speed.') },
    { id: 'react:opportunity', name: 'Opportunity Attack', cost: 'reaction', group: 'attack', ...(melee && { attack: melee }), text: p('When a hostile creature you can see moves out of your reach: one melee attack against it.') },
    { id: 'react:readied', name: 'Readied action', cost: 'reaction', group: 'standard', text: p('The action you readied with Ready, when its trigger happens.') },
  );
  return out;
}
const id = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
const lightMelee = (a: Attack) => a.properties.includes('light') && !a.properties.includes('ammunition');

/** A character's actions: attacks (the first is the primary card), off-hand, standard actions, Cunning Action, castable spells, resources. */
export function pcActions(c: Character, sheet: Sheet, features: { name: string; text: RichText }[]): TurnAction[] {
  // identical weapons held (two handaxes) are listed once; two light ones still allow the off-hand attack
  const once = (l: Attack[]) => l.filter((a, i) => l.findIndex((b) => b.name === a.name && b.toHit === a.toHit && b.damage === a.damage) === i);
  const out: TurnAction[] = once(sheet.attacks).map((a) => ({ id: `attack:${a.entryId}`, name: a.name, cost: 'action', group: 'attack', attack: a }));
  const light = sheet.attacks.filter(lightMelee);
  if (light.length >= 2) for (const a of once(light)) out.push({ id: `offhand:${a.entryId}`, name: `Off-hand: ${a.name}`, cost: 'bonus', group: 'attack', attack: { ...a, damage: offhandDamage(a.damage) } });
  out.push(...basics(sheet.skills?.athletics?.bonus ?? 0, sheet.skills?.acrobatics?.bonus ?? 0, sheet.attacks.find((a) => !a.ranged)));
  // Drawing or stowing a weapon is one object interaction: the first each turn is free, another takes an Action (SRD 5.1). Hands as hands.ts.
  const inv = c.inventory ?? [], free = HANDS - handsHeld(inv);
  const carried = inv.filter((e) => e.item.weapon && !e.equipped), held = inv.filter((e) => e.item.weapon && e.equipped);
  const fits = carried.filter((e) => handsFor(e.item) <= free);
  if (carried.length) out.push({ id: 'free:draw', name: 'Draw a weapon', cost: 'none', group: 'standard', options: (fits.length ? fits : carried).map((e) => ({ id: e.id, name: e.item.name })),
    ...(!fits.length && { blocked: 'no free hand: stow a weapon first' }), text: p('One object interaction: the first each turn is free, another takes an Action. It needs a free hand (two for a two-handed weapon).') });
  if (held.length) out.push({ id: 'free:stow', name: 'Stow a weapon', cost: 'none', group: 'standard', options: held.map((e) => ({ id: e.id, name: e.item.name })),
    text: p('One object interaction: the first each turn is free, another takes an Action.') });
  const names = new Set(features.map((f) => f.name));
  if (names.has('Cunning Action')) for (const name of ['Dash', 'Disengage', 'Hide']) out.push({ id: `cunning:${id(name)}`, name: `Cunning Action: ${name}`, cost: 'bonus', group: 'feature', ...(name === 'Dash' && { grants: 'dash' as const }) });
  const seen = new Set<string>();
  // SRD 5.1: casting needs proficiency with the armor worn
  const armorProfs = new Set(sheet.proficiencies?.armor ?? []);
  const blocked = c.inventory?.some((e) => e.equipped && e.item.armor && !armorProfs.has(e.item.armor.category)) ? 'not proficient with your armor' : undefined;
  for (const sc of sheet.spellcasting) {
    const cast = { attack: sc.attack, dc: sc.dc, charLevel: sheet.totalLevel ?? c.build.levels.length, mod: sheet.mods?.[sc.ability] ?? abilityMod(sheet.scores?.[sc.ability] ?? 10) };
    const knownCaster = getKind((k) => c.embedded[k], sc.classId, 'class')?.spellcasting?.preparation === 'known';
    for (const { spell, prepared } of spellList(c, sc.classId)) {
      const cost = castingCost(spell.castingTime);
      if (!cost || seen.has(spell.id) || !(spell.level === 0 || prepared || knownCaster)) continue;
      seen.add(spell.id);
      out.push({ id: `spell:${spell.id}`, name: spell.name, cost, group: 'spell', text: spell.text, spell: { id: spell.id, level: spell.level, concentration: spell.concentration },
        cast: { ...cast, read: readSpell(spell) }, ...(blocked && { blocked }),
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
/**
 * A monster's actions: its stat block's, its Spellcasting trait's spells (`spell` finds a spell by its lower-case name; `used`: the
 * combatant's spellsUsed) and the basic ones.
 */
export function monsterActions(m: MonsterDef, o: { spell?: (name: string) => SpellDef | undefined; used?: Record<string, number> } = {}): TurnAction[] {
  const of = (list: MonsterDef['actions'], cost: Cost, key: string) => list.map((t, i): TurnAction => ({ id: `mon:${key}:${i}`, name: t.name, cost, group: 'monster', text: t.text }));
  const traits = m.traits.flatMap((t, i): TurnAction[] => { const cost = traitCost(richToPlain(t.text)); return cost === 'none' ? [] : [{ id: `mon:trait:${i}`, name: t.name, cost, group: 'monster', text: t.text }]; });
  const legendary = m.legendary.map((t, i): TurnAction => ({ id: `mon:legendary:${i}`, name: t.name, cost: 'none', group: 'monster', text: t.text,
    legendary: Number(/costs (\d) actions/i.exec(t.name)?.[1] ?? 1) }));
  const basic = basics(m.skills.athletics ?? abilityMod(m.scores.str), m.skills.acrobatics ?? abilityMod(m.scores.dex));
  const spells: TurnAction[] = [], seen = new Set<string>();
  for (const t of [...m.traits, ...m.actions]) {
    const book = o.spell && readSpellcasting(t);
    if (!book) continue;
    const ability = /spellcasting ability is (\w+)/i.exec(richToPlain(t.text))?.[1]?.slice(0, 3).toLowerCase() as keyof MonsterDef['scores'] | undefined;
    const base = { attack: book.attack, dc: book.dc, charLevel: book.level ?? 1, mod: ability && m.scores[ability] !== undefined ? abilityMod(m.scores[ability]) : 0 };
    for (const g of book.groups) for (const name of g.spells) {
      const s = o.spell!(name), cost = s && castingCost(s.castingTime);
      if (!s || !cost || seen.has(s.id)) continue;
      seen.add(s.id);
      const key = g.slots ? `slot:${g.slots.level}` : g.perDay ? `day:${s.id}` : undefined, max = g.slots?.count ?? g.perDay;
      spells.push({ id: `mon:spell:${s.id}`, name: s.name, cost, group: 'spell', text: s.text, spell: { id: s.id, level: s.level, concentration: s.concentration },
        cast: { ...base, read: readSpell(s) }, ...(key && max !== undefined && { spend: key, uses: { left: Math.max(0, max - (o.used?.[key] ?? 0)), max } }) });
    }
  }
  return [...of(m.actions, 'action', 'action'), ...of(m.bonusActions, 'bonus', 'bonus'), ...traits, ...of(m.reactions, 'reaction', 'reaction'), ...legendary, ...spells, ...basic];
}

/** Whether it applies now (Escape only while grappled, Stand up only while prone, Drop prone only while standing). */
export function visible(a: TurnAction, conditions: readonly string[]): boolean {
  const has = (n: string) => conditions.some((c) => c.toLowerCase() === n);
  return a.when === 'grappled' ? has('grappled') : a.when === 'prone' ? has('prone') : a.when === 'standing' ? !has('prone') : true;
}

/** Its cost now: a second object interaction in a turn takes an Action (SRD 5.1). */
const OBJECT = ['free:draw', 'free:stow'];
const costOf = (x: Combatant, a: TurnAction): Cost => (OBJECT.includes(a.id) && x.economy?.object ? 'action' : a.cost);

/** It changes the character record (paid for, or a swap or Prone) rather than only the fight. */
export const editsCharacter = (a: TurnAction, level?: number): boolean => level !== undefined || !!a.resource || ['free:draw', 'free:stow', 'free:prone', 'free:stand'].includes(a.id);

/** The character after the use's own effect: drawing `pick` (a carried weapon that fits the free hands), stowing it (a held one); Prone. */
export function characterEffect(c: Character, a: TurnAction, pick?: string): Character {
  const prone = (on: boolean) => ({ ...c, state: { ...c.state, conditions: [...c.state.conditions.filter((n) => n.toLowerCase() !== 'prone'), ...(on ? ['Prone'] : [])] } });
  if (a.id === 'free:prone') return prone(true);
  if (a.id === 'free:stand') return prone(false);
  const e = c.inventory.find((x) => x.id === pick && x.item.weapon);
  if (!e) return c;
  // one from a stack is drawn into its own row; a stowed one goes back on its stack (hands.ts)
  if (a.id === 'free:draw' && !e.equipped && handsHeld(c.inventory) + handsFor(e.item) <= HANDS) return { ...c, inventory: equip(c.inventory, e.id).inventory };
  if (a.id === 'free:stow' && e.equipped) return { ...c, inventory: unequip(c.inventory, e.id) };
  return c;
}

/** An attack that is part of the Attack action (Extra Attack counts it); undefined for anything else. */
export const attackOf = (a: TurnAction, perAction: number) => (a.group === 'attack' && a.cost === 'action' ? { perAction } : undefined);

const HASTE_OK = new Set(['std:dash', 'std:disengage', 'std:hide', 'std:use-an-object']);
/** It would take the Hasted creature's last Action, its extra one (ponytail: the Haste Action counts as the one taken last). */
function onHasteAction(x: Combatant, a: TurnAction, perAction: number): boolean {
  const e = x.economy;
  return !!e?.haste && costOf(x, a) === 'action' && actionsLeft(x) === 1 && !(attackOf(a, perAction) && e.attacks > 0 && e.attacks < perAction);
}

/** Why the creature can't use it now (its pip, a use left, legendary uses, the Hasted limits), or undefined. Slots are `payment`'s check. */
export function problemOf(x: Combatant, a: TurnAction, conditions: readonly string[], onTurn: boolean, perAction = 1): string | undefined {
  if (a.uses && a.uses.left < 1) return `no ${a.name} left`;
  if (!visible(a, conditions)) return 'not now';
  if (a.blocked) return a.blocked;
  // SRD 5.1: after a bonus-action spell, no other spell that turn but a cantrip with a casting time of 1 action
  if (a.spell && onTurn && x.economy?.bonusSpell && !(a.cost === 'action' && a.spell.level === 0)) return 'after a bonus-action spell, only a cantrip that takes an action';
  if (a.spell && onTurn && a.cost === 'bonus' && x.economy?.leveledSpell) return 'a spell other than an action cantrip was already cast this turn';
  if (a.id === 'react:readied' && !x.economy?.readied) return 'nothing readied';
  if (a.grants === 'action' && !onTurn) return 'not your turn';
  if (a.grants === 'action' && x.economy?.surged) return 'once a turn';
  if (a.id.startsWith('offhand:') && !x.economy?.light) return 'attack with a light melee weapon first';
  if (onHasteAction(x, a, perAction) && !(HASTE_OK.has(a.id) || OBJECT.includes(a.id) || a.id.startsWith('attack:') || (a.group === 'monster' && a.text && /weapon attack/i.test(richToPlain(a.text))))) {
    return 'Hasted: the extra Action is only one weapon attack, Dash, Disengage, Hide or Use an Object';
  }
  if (a.legendary === undefined) return useProblem(x, costOf(x, a), conditions, onTurn, attackOf(a, perAction));
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
  let y = spend(x, costOf(x, a), attackOf(a, haste ? 1 : perAction));
  const mark = (e: Partial<NonNullable<Combatant['economy']>>) => ({ ...y, economy: { used: 0, extra: 0, bonus: false, attacks: 0, ...y.economy, ...e } });
  if (haste && attackOf(a, perAction) && y.economy) y = mark({ attacks: perAction }); // one weapon attack only
  if (attackOf(a, perAction) && a.attack && lightMelee(a.attack)) y = mark({ light: true });
  if (OBJECT.includes(a.id)) y = mark({ object: true });
  if (a.id === 'std:ready') y = mark({ readied: true });
  if (a.spell && a.cost === 'bonus') y = mark({ bonusSpell: true });
  if (a.spell && !(a.cost === 'action' && a.spell.level === 0)) y = mark({ leveledSpell: true });
  if (a.spend) y = { ...y, spellsUsed: { ...y.spellsUsed, [a.spend]: (y.spellsUsed?.[a.spend] ?? 0) + 1 } };
  if (x.kind !== 'pc' && (a.id === 'free:prone' || a.id === 'free:stand')) { // a PC's conditions live on the character (characterEffect)
    y = { ...y, conditions: [...(y.conditions ?? []).filter((n) => n.toLowerCase() !== 'prone'), ...(a.id === 'free:prone' ? ['Prone'] : [])] };
  }
  if (a.grants === 'action') { y = grantAction(y); y = { ...y, economy: { ...y.economy!, surged: true } }; }
  if (a.spell?.concentration) y = { ...y, concentrating: true };
  if (a.legendary && y.legendary) y = { ...y, legendary: { ...y.legendary, used: y.legendary.used + a.legendary } };
  let cs = k.combatants.map((z) => (z.id === x.id ? y : z));
  if (a.spell?.concentration) cs = cs.map((z) => (z.hasted?.by === x.id ? { ...z, hasted: { ...z.hasted, ended: true as const } } : z));
  if (a.target === 'haste' && target !== undefined) cs = cs.map((z) => (z.id === target ? { ...z, hasted: { by: x.id, round: k.round } } : z));
  const next = { ...k, combatants: cs };
  if (a.id === 'free:stand') return standUp(next, x.id);
  return a.grants === 'dash' ? addDash(next, x.id) : next;
}

/** The character after paying: a slot of `level` (a Pact Magic one with `pact`) and one use of `resource`. */
export function spendOn(c: Character, level: number | undefined, resource: string | undefined, pact?: boolean): Character {
  const slotsUsed = [...c.state.slotsUsed];
  if (level !== undefined && !pact) { while (slotsUsed.length < level) slotsUsed.push(0); slotsUsed[level - 1] += 1; }
  return { ...c, state: { ...c.state, slotsUsed, ...(pact && level !== undefined && { pactSlotsUsed: c.state.pactSlotsUsed + 1 }),
    ...(resource && { resourcesUsed: { ...c.state.resourcesUsed, [resource]: (c.state.resourcesUsed[resource] ?? 0) + 1 } }) } };
}
