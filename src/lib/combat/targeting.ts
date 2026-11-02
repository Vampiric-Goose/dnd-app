// Pure (no Svelte/Vite/DOM): what a targeted action can reach and what it does to a target, by the 2014 PHB: range (disadvantage
// beyond normal range, nothing beyond long range), ranged attacks in close combat, reach, Great Weapon Master and Sharpshooter's
// -5/+10, and damage resistance, immunity and vulnerability. The map and the DM's device use these; no rolls happen here.
import { richToPlain } from '../content/richtext.ts';
import { rollParts } from '../monsters/library.ts';
import type { CampaignSettings } from '../types.ts';
import type { TurnAction } from './turnActions.ts';
import { spellEdges, spellMods } from './spellEffects.ts';

/** The DM's Targeting setting: on unless turned off, so campaigns made before it exist are on too. */
export const targetingOn = (s: CampaignSettings): boolean => s.targeting !== false;

/** How far it reaches (ft): melee reach, a weapon's normal/long range (a thrown weapon has both), a spell's range, or Self. */
export type Reach = { melee?: number; normal?: number; long?: number; spell?: number } | 'self';
export type Disadvantage = 'long range' | 'hostile within 5 ft';
/** `adv` / `dis`: every reason for advantage or disadvantage on an attack (attackEdge plus range), for the aiming bar. */
export type Pickable = { ok: false } | { ok: true; disadvantage?: Disadvantage; adv?: string[]; dis?: string[]; autoCrit?: boolean };

export function reachOf(a: TurnAction): Reach | undefined {
  if (a.attack) {
    const w = a.attack, r = w.range;
    if (w.ranged) return r ? { normal: r[0], long: r[1] } : undefined;
    return { melee: w.properties.includes('reach') ? 10 : 5, ...(r && { normal: r[0], long: r[1] }) };
  }
  const range = a.cast?.read.range, far = a.cast?.read.reach;
  if (far !== undefined) return a.cast!.read.attack === 'melee' ? { melee: far } : { spell: far }; // a range-Self or Touch attack (Produce Flame)
  if (range) return range === 'self' ? 'self' : range === 'touch' ? { melee: 5 } : { spell: range.feet };
  if (a.group === 'monster' && a.text) {
    const t = richToPlain(a.text), reach = /reach (\d+) ft/i.exec(t), rng = /range (\d+)\/(\d+) ft/i.exec(t);
    if (rng) return { normal: +rng[1], long: +rng[2] };
    if (reach) return { melee: +reach[1] };
  }
  return undefined;
}

/**
 * Whether a creature `feet` away can be picked, and the disadvantage that comes with it. `ranged`: this attack is ranged (a thrown
 * weapon thrown, a spell attack at range). `foeWithin5`: a hostile creature that isn't incapacitated is within 5 ft of the attacker.
 */
export function canTarget(reach: Reach, feet: number, foeWithin5: boolean, ranged: boolean): Pickable {
  if (reach === 'self') return { ok: false };
  const close = ranged && foeWithin5 ? { disadvantage: 'hostile within 5 ft' as const } : {};
  if (reach.spell !== undefined) return feet <= reach.spell ? { ok: true, ...close } : { ok: false };
  if (!ranged && reach.melee !== undefined) return feet <= reach.melee ? { ok: true } : { ok: false };
  if (reach.normal === undefined || reach.long === undefined || feet > reach.long) return { ok: false };
  return feet > reach.normal ? { ok: true, disadvantage: 'long range' } : { ok: true, ...close };
}

/** Any advantage and any disadvantage cancel out (PHB p.173, however many of each); the roller's own pick counts as one of either. */
export function combineMode(r: { adv: readonly string[]; dis: readonly string[] }, pick?: 'adv' | 'dis'): 'adv' | 'dis' | undefined {
  const a = r.adv.length + (pick === 'adv' ? 1 : 0), d = r.dis.length + (pick === 'dis' ? 1 : 0);
  return a && d ? undefined : a ? 'adv' : d ? 'dis' : undefined;
}
/** The player's advantage pick against a forced disadvantage: one of each cancels out. */
export const finalMode = (player: 'adv' | 'dis' | undefined, forced?: Disadvantage): 'adv' | 'dis' | undefined => combineMode({ adv: [], dis: forced ? [forced] : [] }, player);

/** Both sides of an attack: their conditions, whether the attacker is within 5 ft, its exhaustion, the target's Dodge. */
export interface Sides { attacker: readonly string[]; target: readonly string[]; within5: boolean; exhaustion?: number; dodging?: boolean }
const hasCondition = (list: readonly string[], c: string) => list.some((x) => x.toLowerCase() === c);
/**
 * Advantage and disadvantage on an attack roll from the 2014 PHB: the conditions (Appendix A), exhaustion 3+, Dodge, and a prone target
 * (advantage within 5 ft, disadvantage beyond). `autoCrit`: a hit on a paralyzed or unconscious creature from within 5 ft is a critical.
 */
export function attackEdge(s: Sides): { adv: string[]; dis: string[]; autoCrit: boolean } {
  const adv: string[] = [], dis: string[] = [];
  for (const c of ['blinded', 'frightened', 'poisoned', 'prone', 'restrained']) if (hasCondition(s.attacker, c)) dis.push(`you are ${c}`);
  if ((s.exhaustion ?? 0) >= 3) dis.push(`exhaustion ${s.exhaustion}`);
  if (hasCondition(s.attacker, 'invisible')) adv.push('you are invisible');
  for (const c of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious']) if (hasCondition(s.target, c)) adv.push(`target is ${c}`);
  if (hasCondition(s.target, 'prone')) (s.within5 ? adv : dis).push(`target is prone (${s.within5 ? 'within' : 'beyond'} 5 ft)`);
  if (hasCondition(s.target, 'invisible')) dis.push('target is invisible');
  if (s.dodging) dis.push('target is dodging');
  // spells they hold (Faerie Fire, Blur, Foresight)
  for (const e of [...spellEdges(spellMods(s.attacker), 'attacksBy', 'you have'), ...spellEdges(spellMods(s.target), 'attacksAgainst', 'target has')]) (e.mode === 'adv' ? adv : dis).push(e.why);
  return { adv, dis, autoCrit: s.within5 && (hasCondition(s.target, 'paralyzed') || hasCondition(s.target, 'unconscious')) };
}

export interface Toggle { id: 'gwm' | 'ss'; name: string; toHit: -5; damage: 10 }
/** Great Weapon Master with a heavy melee weapon, Sharpshooter with a ranged weapon: -5 to hit, +10 damage, only with the feat. */
export function attackToggles(a: TurnAction, features: string[]): Toggle[] {
  const w = a.attack;
  if (!w) return [];
  const out: Toggle[] = [];
  if (!w.ranged && w.properties.includes('heavy') && features.includes('Great Weapon Master')) out.push({ id: 'gwm', name: 'Great Weapon Master', toHit: -5, damage: 10 });
  if (w.ranged && features.includes('Sharpshooter')) out.push({ id: 'ss', name: 'Sharpshooter', toHit: -5, damage: 10 });
  return out;
}

/** Display strings as a stat block prints them ("bludgeoning, piercing, and slashing from nonmagical attacks"), or a sheet's types. */
export interface Defenses { resist: string[]; immune: string[]; vulnerable: string[] }
const names = (list: string[], type: string, magical: boolean) =>
  list.some((s) => new RegExp(`\\b${type}\\b`, 'i').test(s) && (!/nonmagical/i.test(s) || !magical));

/** Damage after the target's defenses (PHB p.197: resistance halves, vulnerability doubles), unrounded, and why it changed. */
export function afterDefenses(amount: number, type: string, d: Defenses, magical: boolean): { amount: number; note?: string } {
  if (names(d.immune, type, magical)) return { amount: 0, note: `immune to ${type}` };
  let n = amount;
  const notes: string[] = [];
  if (names(d.resist, type, magical)) { n /= 2; notes.push(`resistant to ${type}`); } // exact: the total is rounded once (resolve.ts)
  if (names(d.vulnerable, type, magical)) { n *= 2; notes.push(`vulnerable to ${type}`); }
  return { amount: n, ...(notes.length && { note: notes.join(', ') }) };
}

/** A monster's weapon attack from its text: the to-hit bonus, each damage roll with its type, and whether it is ranged. */
export function monsterAttack(a: TurnAction): { toHit: number; dmg: { expr: string; type: string }[]; ranged: boolean } | undefined {
  if (!a.text) return undefined;
  const t = richToPlain(a.text), parts = rollParts(t);
  const hit = parts.find((p) => 'hit' in p && p.hit);
  if (!hit) return undefined;
  const dmg = parts.flatMap((p, i) => {
    if (!('expr' in p) || p.hit) return [];
    const type = /^\)?\s*([a-z]+) damage/i.exec(parts[i + 1]?.t ?? '');
    return type ? [{ expr: p.expr, type: type[1].toLowerCase() }] : [];
  });
  return { toHit: Number(hit.t.replace(/[−–]/g, '-')), dmg, ranged: /ranged (?:weapon|spell) attack/i.test(t) };
}
