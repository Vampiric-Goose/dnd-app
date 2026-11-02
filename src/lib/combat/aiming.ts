// Pure (no Svelte/Vite/DOM): a targeted use from aim to result, shared by the DM's map (its own monsters and characters) and the host (a
// player's use). aimPlan says what an action needs (reach, a line, an area, its dice); workOut checks an aim against the shown scene and
// works it out with resolve.ts. The target must be in reach or range (PHB range, close-combat disadvantage), the dice must fit, and an
// area catches every token in it, hidden ones too; the acting player hears only hit or miss, a spell's DC and the visible names caught.
import { feetBetween, tokenFeet, type Pt } from '../map/grid.ts';
import { tokensInTemplate, type Shape } from '../map/templates.ts';
import type { Ability, Area, Character, Combat, Combatant, Grid, Resolution, Scene, Size, Snap } from '../types.ts';
import { combatantForToken } from './movement.ts';
import { checkFaces, keptD20, resolveAttack, resolveSpell, type Outcome, type TargetInfo } from './resolve.ts';
import { diceAt, type SpellRead } from './spellText.ts';
import { attackEdge, attackToggles, canTarget, combineMode, monsterAttack, reachOf, type Pickable, type Reach, type Sides, type Toggle } from './targeting.ts';
import type { TurnAction } from './turnActions.ts';

/** What a use aims at (a creature's id, or a map point for an area) and the roller's own raw dice (resolve.ts Rolled). */
/** `dtype`: the damage type picked, for a spell whose type is chosen. */
export interface Aim { target?: string; point?: { x: number; y: number }; rolled: { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[][] }; toggles: ('gwm' | 'ss')[]; dtype?: string }
/** To the acting player only: hit or miss, a spell's save DC, the names of the visible creatures its area caught. */
export interface UseOutcome { action: string; hit?: boolean; dc?: number; caught?: string[] }
/** A use worked out, waiting for its payment to go through. */
export interface Aimed { resolution: Omit<Resolution, 'applied'>; outcome: UseOutcome }

export interface AimArea { shape: Shape; feet: number; width?: number; on: 'creature' | 'point' | 'self'; range?: number }
/** `attack`: it rolls a d20 against AC. `dice`: its damage, in roll order (`on`: the part of a spell that deals it). */
/** `ignore`: disadvantages a feat removes (Sharpshooter: long range; Crossbow Expert: a hostile within 5 ft). */
/** `choices`: the damage types to pick from for dice whose type is chosen (their `type` stays '' until one is picked). */
export interface AimPlan { reach: Reach; line: boolean; attack: boolean; toHit?: number; area?: AimArea; dice: { expr: string; type: string; on?: 'hit' | 'save' }[]; read?: SpellRead;
  ignore?: { long?: true; close?: true }; choices?: string[] }

/**
 * The spell areas to draw on a scene, for everyone: an instant one until its caster's next turn, a concentration one while its caster
 * keeps concentrating. Undo drops the result, and its area with it.
 */
export function areasOn(k: Combat | undefined, sceneId: string): Area[] {
  if (!k) return [];
  const order = k.combatants.map((x) => x.id), now = order.indexOf(k.turn ?? '');
  return (k.resolutions ?? []).flatMap((r) => {
    if (!r.area || r.sceneId !== sceneId) return [];
    const caster = k.combatants.find((x) => x.id === r.actor);
    const on = r.lasting ? !!caster?.concentrating && (caster.concentratingOn === undefined || caster.concentratingOn === r.action)
      : r.round === k.round || (r.round === k.round - 1 && now < order.indexOf(r.actor));
    return on ? [r.area] : [];
  });
}

/**
 * A write's concentration spells that ended (the caster stopped concentrating, left the fight, or started another one) and the conditions
 * they leave behind: `combat` has them gone from its monsters, `drop` lists every one (a PC's are on its character, for the caller).
 */
export function endedSpells(prev: Combat | undefined, next: Combat): { combat: Combat; drop: { id: string; condition: string }[] } {
  const ended = (prev?.combatants ?? []).filter((x) => x.concentrating && x.concentratingOn).filter((x) => {
    const y = next.combatants.find((z) => z.id === x.id);
    return !y?.concentrating || y.concentratingOn !== x.concentratingOn;
  });
  const drop = (next.resolutions ?? []).filter((r) => r.lasting && ended.some((x) => x.id === r.actor && x.concentratingOn === r.action)).flatMap((r) => r.inflicted ?? []);
  if (!drop.length) return { combat: next, drop };
  return { drop, combat: { ...next, combatants: next.combatants.map((y) => {
    const gone = drop.filter((d) => d.id === y.id).map((d) => d.condition);
    if (!gone.length || y.kind === 'pc') return y;
    return { ...y, conditions: (y.conditions ?? []).filter((n) => !gone.includes(n)), durations: Object.fromEntries(Object.entries(y.durations ?? {}).filter(([n]) => !gone.includes(n))) };
  }) } };
}

/** The creatures a result touches: its actor (who paid), everyone it rolled for, and everyone its area caught. */
export const touched = (r: Pick<Resolution, 'actor' | 'outcomes' | 'caught'>): string[] => [...new Set([r.actor, ...r.outcomes.map((o) => o.id), ...(r.caught ?? [])])];

/** Those combatants as they are, and their characters' state (a PC's HP, slots and resources live there): what Undo restores. */
export function snapOf(k: Combat, chars: Character[], ids: string[]): Snap {
  const combatants: Snap['combatants'] = {}, states: Snap['states'] = {};
  for (const x of k.combatants) {
    if (!ids.includes(x.id)) continue;
    combatants[x.id] = structuredClone(x);
    const ch = x.characterId ? chars.find((c) => c.id === x.characterId) : undefined;
    if (ch) states[ch.id] = structuredClone(ch.state);
  }
  return { combatants, states };
}

/** What an action needs to be aimed, or undefined when it can't be (no reach, or a spell with no attack, save or area). */
export function aimPlan(a: TurnAction, o: { level?: number; toggles?: Toggle[]; features?: string[]; dtype?: string } = {}): AimPlan | undefined {
  const reach = reachOf(a);
  if (!reach) return undefined;
  const has = (f: string) => !!o.features?.includes(f);
  if (a.attack) {
    const w = a.attack, t = o.toggles ?? [], ranged = !!w.ranged || !!w.range;
    const ignore = { ...(w.ranged && has('Sharpshooter') && { long: true as const }), ...(ranged && has('Crossbow Expert') && { close: true as const }) };
    return { reach, line: !!w.ranged, attack: true, toHit: w.toHit + t.reduce((n, x) => n + x.toHit, 0),
      dice: [{ expr: w.damage, type: w.damageType }, ...t.map((x) => ({ expr: String(x.damage), type: w.damageType }))], ...(Object.keys(ignore).length && { ignore }) };
  }
  const ma = a.group === 'monster' ? monsterAttack(a) : undefined;
  if (ma) return { reach, line: ma.ranged, attack: true, toHit: ma.toHit, dice: ma.dmg };
  const read = a.cast?.read;
  if (!read || !a.spell || !(read.attack || read.save || read.area || read.burst || read.auto)) return undefined;
  if (!read.damage.length && !read.area && !read.burst && !read.conditions?.length) return undefined; // a save that does nothing here (Light)
  const picked = o.dtype && read.choices?.includes(o.dtype) ? o.dtype : '';
  const dice = diceAt(read, { slot: o.level ?? a.spell.level, level: a.spell.level, charLevel: a.cast!.charLevel, mod: a.cast!.mod }).damage
    .map((d, i) => { const [expr, ...type] = d.split(' '); return { expr, type: type.join(' ') || picked, ...(read.damage[i]?.on && { on: read.damage[i].on }) }; });
  const area: AimArea | undefined = read.burst ? { shape: 'sphere', feet: read.burst, on: 'creature' }
    : read.area ? { shape: read.area.shape, feet: read.area.feet, ...(read.area.width && { width: read.area.width }), on: read.area.self ? 'self' : 'point',
      ...(reach !== 'self' && reach.spell !== undefined && { range: reach.spell }) } : undefined;
  if (read.lingering) return { reach, line: false, attack: false, ...(area && { area }), dice: [], read: { ...read, attack: undefined, save: undefined, damage: [] } }; // placed and listed only
  const ignore = read.attack === 'ranged' && has('Crossbow Expert') ? { close: true as const } : undefined;
  return { reach, line: read.attack === 'ranged', attack: !!read.attack, ...(a.cast!.attack !== undefined && { toHit: a.cast!.attack }), ...(area && { area }), dice, read, ...(ignore && { ignore }),
    ...(read.choices && { choices: read.choices }) };
}

/** Whether a creature at `t` can be picked from `me`, and with what disadvantage. A melee weapon past its reach is thrown (ranged). */
export function pickableAt(plan: AimPlan, g: Grid, diagonal: '5-5-5' | '5-10-5', me: Pt & { size: Size }, foeWithin5: boolean, t: Pt & { size: Size }): Pickable {
  const feet = tokenFeet(g, me, t, diagonal);
  const thrown = plan.reach !== 'self' && plan.reach.melee !== undefined && plan.reach.normal !== undefined && feet > plan.reach.melee;
  const p = canTarget(plan.reach, feet, foeWithin5 && !plan.ignore?.close, plan.line || thrown);
  return p.ok && p.disadvantage === 'long range' && plan.ignore?.long ? { ok: true } : p;
}

/**
 * Whether a creature can be picked, with every reason for advantage or disadvantage on the attack (attackEdge, range, close combat) and
 * whether a hit is a critical by itself. A spell without an attack roll gets none.
 */
export function judge(plan: AimPlan, g: Grid, diagonal: '5-5-5' | '5-10-5', me: Pt & { size: Size }, foeWithin5: boolean, t: Pt & { size: Size },
  sides: Omit<Sides, 'within5'>): Pickable {
  const p = pickableAt(plan, g, diagonal, me, foeWithin5, t);
  if (!p.ok || !plan.attack) return p;
  const e = attackEdge({ ...sides, within5: tokenFeet(g, me, t, diagonal) <= 5 });
  return { ...p, adv: e.adv, dis: [...e.dis, ...(p.disadvantage ? [p.disadvantage] : [])], autoCrit: e.autoCrit };
}

const OUT = /incapacitated|paralyzed|petrified|stunned|unconscious/i;
/** A hostile creature (a PC's foes are monsters; a monster's, PCs) that isn't incapacitated within 5 ft of the actor's token. */
export function foeWithin5(k: Combat, s: Scene, actor: Combatant, diagonal: '5-5-5' | '5-10-5', conditionsOf: (z: Combatant) => readonly string[] = (z) => z.conditions ?? []): boolean {
  const tokenOf = (id: string) => s.tokens.find((t) => combatantForToken(k, t)?.id === id), me = tokenOf(actor.id);
  return !!me && k.combatants.some((z) => z.id !== actor.id && !z.hidden && (actor.kind === 'pc' ? z.kind === 'monster' : z.kind === 'pc')
    && !conditionsOf(z).some((c) => OUT.test(c)) && (() => { const t = tokenOf(z.id); return !!t && tokenFeet(s.grid, me, t, diagonal) <= 5; })());
}

export interface WorkIn {
  a: TurnAction; level?: number; features: string[]; actor: Combatant; combat: Combat; scene: Scene; diagonal: '5-5-5' | '5-10-5'; aim: Aim;
  /** The target the aim names, if the roller may pick it (a player: visible ones only). */
  findTarget: (id: string) => Combatant | undefined;
  info: (z: Combatant) => TargetInfo | Promise<TargetInfo>;
  nameOf: (z: Combatant) => string;
  conditionsOf?: (z: Combatant) => readonly string[];
  /** A PC's exhaustion level (its character's). */
  exhaustionOf?: (z: Combatant) => number;
  /** Whether the roller sees it (a player: its token is on their map, not hidden or fogged); unseen ones are caught but never named. */
  seen?: (z: Combatant) => boolean;
  /** A weapon attack's weapon is magical (it beats "nonmagical" resistance). */
  magical: boolean; id: string; now: number; rng: () => number;
}

/** An aim checked on the scene and worked out, or why not. */
export async function workOut(i: WorkIn): Promise<Aimed | string> {
  const { a, aim, combat: k, scene: s, actor } = i;
  const plan = aimPlan(a, { level: i.level, features: i.features, toggles: attackToggles(a, i.features).filter((t) => aim.toggles.includes(t.id)), dtype: aim.dtype });
  if (!plan) return 'that cannot be aimed';
  if (plan.dice.some((d) => !d.type) && plan.choices && !plan.read?.typeFromDie) return 'pick a damage type';
  const tokenOf = (id: string) => s.tokens.find((t) => combatantForToken(k, t)?.id === id);
  const me = tokenOf(actor.id);
  if (!me) return 'not on the map';
  const target = aim.target === undefined ? undefined : i.findTarget(aim.target), tt = target && tokenOf(target.id);
  if (aim.target !== undefined && !tt) return 'pick a target';
  const foe = foeWithin5(k, s, actor, i.diagonal, i.conditionsOf);
  const cond = (z: Combatant) => i.conditionsOf?.(z) ?? z.conditions ?? [];
  const pick = tt && target ? judge(plan, s.grid, i.diagonal, me, foe, tt, { attacker: cond(actor), target: cond(target), exhaustion: i.exhaustionOf?.(actor), dodging: !!target.economy?.dodging }) : undefined;
  if (pick && !pick.ok) return 'out of range';
  if (plan.attack && !tt) return 'pick a target';
  const edge = pick?.ok ? { adv: pick.adv ?? [], dis: pick.dis ?? [] } : { adv: [], dis: [] };
  const rolled = { ...aim.rolled, mode: plan.attack ? combineMode(edge, aim.rolled.mode) : aim.rolled.mode };
  if (plan.attack && (!rolled.d20?.length || (rolled.mode && rolled.d20.length < 2))) return 'bad d20';
  const autoCrit = !!(pick?.ok && pick.autoCrit);
  const why = rolled.mode ? `${rolled.mode === 'adv' ? 'advantage' : 'disadvantage'}: ${(rolled.mode === 'adv' ? edge.adv : edge.dis).join(', ') || 'chosen'}` : undefined;
  const withWhy = (o: Outcome): Outcome => (why && o.roll !== undefined ? { ...o, edge: why } : o);
  const crit = plan.attack && (keptD20(rolled) === 20 || autoCrit); // a critical's dice come doubled
  const base = { id: i.id, actor: actor.id, action: a.name, at: i.now };
  if (!plan.read) { // a weapon or a monster's attack
    const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit })), rolled);
    if (bad) return bad;
    const o = resolveAttack(await i.info(target!), plan.toHit ?? 0, plan.dice, rolled, i.magical, autoCrit);
    return { resolution: { ...base, outcomes: [withWhy(o)] }, outcome: { action: a.name, hit: !!o.hit } };
  }
  const read = plan.read, area = plan.area;
  const point = area?.on === 'creature' ? (tt && { x: tt.x, y: tt.y }) : aim.point ?? (tt && { x: tt.x, y: tt.y });
  if (area && area.on !== 'self' && (!point || (area.range !== undefined && feetBetween(s.grid, me, point, i.diagonal) > area.range))) return area.on === 'creature' ? 'pick a target' : 'out of range';
  if (!area && !target) return 'pick a target';
  const origin = area?.on === 'self' ? { x: me.x, y: me.y } : point!;
  const placed: Area | undefined = area && { shape: area.shape, origin: { x: origin.x, y: origin.y }, aim: aim.point ?? { x: origin.x, y: origin.y }, feet: area.feet, ...(area.width && { width: area.width }) };
  const caught = placed ? tokensInTemplate(placed, s.grid, s.tokens)
    .map((id) => combatantForToken(k, s.tokens.find((t) => t.id === id)!)).filter((z): z is Combatant => !!z && !(area?.on === 'self' && z.id === actor.id)) : [];
  const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit: crit && d.on !== 'save' })), rolled);
  if (bad) return bad;
  const outcomes = resolveSpell(read, plan.dice, a.cast!.dc, plan.toHit, target && await i.info(target), await Promise.all(caught.map(i.info)), rolled, i.rng, autoCrit);
  const hit = outcomes.find((o) => o.part === 'hit')?.hit;
  // a lasting spell's effect also leaves a condition named after the spell (the user's standard: Hold Monster, Hex, Haste)
  const lasts = !!(a.spell?.concentration || read.rounds);
  const named = (o: Outcome): Outcome => (!lasts ? o : o.inflict ? { ...o, inflict: [...o.inflict, a.name] } : o.inflicts ? { ...o, inflicts: [...o.inflicts, a.name] } : o);
  return {
    resolution: { ...base, outcomes: outcomes.map(withWhy).map(named), ...(placed && { caught: caught.map((z) => z.id), area: placed, sceneId: s.id, round: k.round }),
      ...(a.spell?.concentration ? { lasting: true as const } : read.rounds && { rounds: read.rounds }), ...(read.repeat && { repeat: true as const }), ...(read.save && { dc: a.cast!.dc, ability: read.save.toLowerCase() as Ability, onSave: read.onSave }) },
    outcome: { action: a.name, ...(hit !== undefined && { hit }), ...(read.save && a.cast!.dc !== undefined && { dc: a.cast!.dc }),
      ...(area && { caught: caught.filter((z) => !z.hidden && (i.seen?.(z) ?? true)).map(i.nameOf) }) },
  };
}
