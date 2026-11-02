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
/** `dtype`: the damage type picked, for a spell whose type is chosen. `targets`: one per ray or dart (repeats allowed), in place of `target`. */
export interface Aim { target?: string; targets?: string[]; point?: { x: number; y: number }; rolled: { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[][] }; toggles: ('gwm' | 'ss')[]; dtype?: string }
/** To the acting player only: hit or miss (`hits`: each ray's), a spell's save DC, the names of the visible creatures its area caught; `leap`: the result it may leap from. */
export interface UseOutcome { action: string; hit?: boolean; hits?: boolean[]; dc?: number; caught?: string[]; leap?: string }
/** A use worked out, waiting for its payment to go through. */
export interface Aimed { resolution: Omit<Resolution, 'applied'>; outcome: UseOutcome }

export interface AimArea { shape: Shape; feet: number; width?: number; on: 'creature' | 'point' | 'self'; range?: number }
/** `attack`: it rolls a d20 against AC. `dice`: its damage, in roll order (`on`: the part of a spell that deals it). */
/** `ignore`: disadvantages a feat removes (Sharpshooter: long range; Crossbow Expert: a hostile within 5 ft). */
/** `choices`: the damage types to pick from for dice whose type is chosen (their `type` stays '' until one is picked). */
/** `mark`: a rider spell aimed at the creature it marks (no dice). A die's `vs`: it hurts only that creature (a marked rider). */
export interface AimPlan { reach: Reach; line: boolean; attack: boolean; toHit?: number; area?: AimArea; dice: { expr: string; type: string; on?: 'hit' | 'save'; vs?: string }[]; read?: SpellRead;
  ignore?: { long?: true; close?: true }; choices?: string[]; mark?: true; /** rays, beams or darts: a target each */ count?: number; /** damage over time, kept for the turns to come */ linger?: { dice: { expr: string; type: string }[]; read: SpellRead } }

/**
 * The spell areas to draw on a scene, for everyone: an instant one until its caster's next turn, a concentration one while its caster
 * keeps concentrating. Undo drops the result, and its area with it.
 */
/** A lasting result's spell is still up: its caster concentrates on that very casting (older results: on a spell of that name). */
export function castLive(k: Combat, r: Resolution): boolean {
  const c = k.combatants.find((x) => x.id === r.actor);
  return !!c?.concentrating && (c.concentratingOn === undefined || c.concentratingOn === r.action) && (r.cast === undefined || c.concentrationCount === r.cast);
}

export function areasOn(k: Combat | undefined, sceneId: string): Area[] {
  return liveAreas(k, sceneId).map((r) => r.area!);
}

/** The results whose area is still up on that scene (areasOn). */
function liveAreas(k: Combat | undefined, sceneId: string): Resolution[] {
  if (!k) return [];
  const order = k.combatants.map((x) => x.id), now = order.indexOf(k.turn ?? '');
  return (k.resolutions ?? []).filter((r) => {
    if (!r.area || r.sceneId !== sceneId) return false;
    return r.lasting ? castLive(k, r)
      : r.round === k.round || (r.round === k.round - 1 && now < order.indexOf(r.actor));
  });
}

/** The damage-over-time areas (Moonbeam, Cloudkill) that creature `id`'s token stands in: what hurts it as its turn starts. */
export function startsIn(k: Combat, s: Scene, id: string): Resolution[] {
  const t = s.tokens.find((x) => combatantForToken(k, x)?.id === id);
  if (!t) return [];
  return liveAreas(k, s.id).filter((r) => r.linger && tokensInTemplate(r.area!, s.grid, s.tokens).includes(t.id));
}

/**
 * A write's concentration spells that ended (the caster stopped concentrating, left the fight, or started another one) and the conditions
 * they leave behind: `combat` has them gone from its monsters, `drop` lists every one (a PC's are on its character, for the caller).
 */
export function endedSpells(prev: Combat | undefined, next: Combat): { combat: Combat; drop: { id: string; condition: string }[] } {
  const ended = (prev?.combatants ?? []).filter((x) => x.concentrating && x.concentratingOn).filter((x) => {
    const y = next.combatants.find((z) => z.id === x.id);
    return !y?.concentrating || y.concentratingOn !== x.concentratingOn || y.concentrationCount !== x.concentrationCount;
  });
  const drop = (next.resolutions ?? []).filter((r) => r.lasting && ended.some((x) => x.id === r.actor && x.concentratingOn === r.action && (r.cast === undefined || r.cast === x.concentrationCount)))
    .flatMap((r) => r.inflicted ?? []);
  const unrid = new Set(ended.filter((x) => next.combatants.find((y) => y.id === x.id)?.rider?.spell === x.concentratingOn).map((x) => x.id)); // its rider ends too
  if (!drop.length && !unrid.size) return { combat: next, drop };
  return { drop, combat: { ...next, combatants: next.combatants.map((v) => {
    const y = unrid.has(v.id) ? (({ rider: _r, ...rest }) => rest)(v) : v;
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
export function aimPlan(a: TurnAction, o: { level?: number; toggles?: Toggle[]; features?: string[]; dtype?: string; rider?: Pick<NonNullable<Combatant['rider']>, 'dice' | 'type' | 'target' | 'anyAttack'> } = {}): AimPlan | undefined {
  const rider = (weapon: string | undefined) => (o.rider ? [{ expr: o.rider.dice, type: o.rider.type || weapon || '', ...(o.rider.target && { vs: o.rider.target }) }] : []);
  const reach = reachOf(a);
  if (!reach) return undefined;
  const has = (f: string) => !!o.features?.includes(f);
  if (a.attack) {
    const w = a.attack, t = o.toggles ?? [], ranged = !!w.ranged || !!w.range;
    const ignore = { ...(w.ranged && has('Sharpshooter') && { long: true as const }), ...(ranged && has('Crossbow Expert') && { close: true as const }) };
    return { reach, line: !!w.ranged, attack: true, toHit: w.toHit + t.reduce((n, x) => n + x.toHit, 0),
      dice: [{ expr: w.damage, type: w.damageType }, ...t.map((x) => ({ expr: String(x.damage), type: w.damageType })), ...rider(w.damageType)], ...(Object.keys(ignore).length && { ignore }) };
  }
  const ma = a.group === 'monster' ? monsterAttack(a) : undefined;
  if (ma) return { reach, line: ma.ranged, attack: true, toHit: ma.toHit, dice: [...ma.dmg, ...rider(ma.dmg[0]?.type)] };
  const read = a.cast?.read;
  if (read?.rider && a.spell) return read.rider.marked ? { reach, line: false, attack: false, dice: [], read, mark: true } : undefined; // Hex marks a creature; the rest are cast
  if (!read || !a.spell || !(read.attack || read.save || read.area || read.burst || read.auto)) return undefined;
  if (!read.save && !read.damage.length && !read.area && !read.burst && !read.conditions?.length) return undefined; // a save-only spell (Suggestion) still rolls the monster's save
  const picked = o.dtype && read.choices?.includes(o.dtype) ? o.dtype : '';
  const dice = diceAt(read, { slot: o.level ?? a.spell.level, level: a.spell.level, charLevel: a.cast!.charLevel, mod: a.cast!.mod }).damage
    .map((d, i) => { const [expr, ...type] = d.split(' '); return { expr, type: type.join(' ') || picked, ...(read.damage[i]?.on && { on: read.damage[i].on }) }; });
  const area: AimArea | undefined = read.burst ? { shape: 'sphere', feet: read.burst, on: 'creature' }
    : read.area ? { shape: read.area.shape, feet: read.area.feet, ...(read.area.width && { width: read.area.width }), on: read.area.self ? 'self' : 'point',
      ...(reach !== 'self' && reach.spell !== undefined && { range: reach.spell }) } : undefined;
  if (read.lingering) return { reach, line: false, attack: false, ...(area && { area }), dice: [], read: { ...read, attack: undefined, save: undefined, damage: [] }, // placed and listed now
    ...(dice.length && { linger: { dice: dice.map(({ expr, type }) => ({ expr, type })), read } }) }; // rolled as a creature starts its turn there
  if (read.attack && o.rider?.anyAttack) dice.push({ expr: o.rider.dice, type: o.rider.type || dice[0]?.type || '', on: 'hit', ...(o.rider.target && { vs: o.rider.target }) }); // Hex on a spell attack
  const ignore = read.attack === 'ranged' && has('Crossbow Expert') ? { close: true as const } : undefined;
  const slot = o.level ?? a.spell.level, lvl = a.cast!.charLevel ?? 1, up = (above?: number) => (above !== undefined && slot > above ? slot - above : 0);
  const count = read.rays ? (read.rays.byLevel ? (lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1) : read.rays.count + up(read.rays.above)) : read.auto ? read.auto.count + up(read.auto.above) : 1;
  return { reach, line: read.attack === 'ranged', attack: !!read.attack, ...(a.cast!.attack !== undefined && { toHit: a.cast!.attack }), ...(area && { area }), dice, read, ...(ignore && { ignore }),
    ...(read.choices && { choices: read.choices }), ...(count > 1 && { count }) };
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
  /** A leap (Chaos Bolt): from that creature, never at one already hit this casting; no payment. */
  leapFrom?: { from: string; exclude: string[] };
  /** One ray of several (internal). */
  ray?: true;
}

/** An aim checked on the scene and worked out, or why not. */
export async function workOut(i: WorkIn): Promise<Aimed | string> {
  const { a, aim, combat: k, scene: s, actor } = i;
  let plan = aimPlan(a, { level: i.level, features: i.features, toggles: attackToggles(a, i.features).filter((t) => aim.toggles.includes(t.id)), dtype: aim.dtype, rider: actor.rider });
  if (!plan) return 'that cannot be aimed';
  if (plan.dice.some((d) => !d.type) && plan.choices && !plan.read?.typeFromDie) return 'pick a damage type';
  if (plan.count && !i.ray) { // rays, beams or darts: one aim each (two d20s and the dice each), worked out one by one
    const ts = aim.targets ?? [], n = plan.dice.length;
    if (ts.length !== plan.count) return 'pick a target';
    if (plan.attack && aim.rolled.d20?.length !== 2 * ts.length) return 'bad d20';
    if (aim.rolled.dmg.length !== n * ts.length) return 'bad damage dice';
    const per: Aimed[] = [];
    for (const [r, target] of ts.entries()) {
      const rolled = { ...(aim.rolled.d20 && { d20: aim.rolled.d20.slice(2 * r, 2 * r + 2) }), ...(aim.rolled.mode && { mode: aim.rolled.mode }), dmg: aim.rolled.dmg.slice(r * n, (r + 1) * n) };
      const one = await workOut({ ...i, ray: true, aim: { ...aim, targets: undefined, target, rolled } });
      if (typeof one === 'string') return one;
      per.push(one);
    }
    return { resolution: { ...per[0].resolution, outcomes: per.flatMap((p) => p.resolution.outcomes) },
      outcome: { ...per[0].outcome, hit: per.some((p) => !!p.outcome.hit), hits: per.map((p) => !!p.outcome.hit) } };
  }
  if (i.leapFrom) plan = { ...plan, reach: { spell: plan.read?.leap ?? 0 } }; // the leap's range counts from the creature it leaps from
  const tokenOf = (id: string) => s.tokens.find((t) => combatantForToken(k, t)?.id === id);
  const me = tokenOf(i.leapFrom?.from ?? actor.id);
  if (!me) return 'not on the map';
  const target = aim.target === undefined ? undefined : i.findTarget(aim.target), tt = target && tokenOf(target.id);
  if (aim.target !== undefined && !tt) return 'pick a target';
  if (i.leapFrom && target && i.leapFrom.exclude.includes(target.id)) return 'pick another creature';
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
  const base = { id: i.id, actor: actor.id, action: a.name, at: i.now, round: k.round, ...(i.level !== undefined && plan.read?.leap && { slot: i.level }),
    ...(a.spell?.concentration && !i.leapFrom && { cast: (actor.concentrationCount ?? 0) + 1 }) }; // worked out before it is paid for
  if (!plan.read) { // a weapon or a monster's attack
    const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit })), rolled);
    if (bad) return bad;
    const o = resolveAttack(await i.info(target!), plan.toHit ?? 0, plan.dice, rolled, i.magical, autoCrit);
    return { resolution: { ...base, outcomes: [withWhy(o)], ...(o.hit && actor.rider?.once && { spent: true as const }) }, outcome: { action: a.name, hit: !!o.hit } };
  }
  const read = plan.read, area = plan.area;
  if (plan.mark && read.rider) { // Hex: the mark, and a condition named after the spell on it
    if (!target) return 'pick a target';
    const rider = { spell: a.name, dice: read.rider.dice, type: read.rider.type, target: target.id, ...(read.rider.anyAttack && { anyAttack: true as const }) };
    return { resolution: { ...base, outcomes: [{ id: target.id, damage: 0, inflict: [a.name] }], mark: target.id, rider, ...(a.spell?.concentration && { lasting: true as const }) }, outcome: { action: a.name } };
  }
  const point = area?.on === 'creature' ? (tt && { x: tt.x, y: tt.y }) : aim.point ?? (tt && { x: tt.x, y: tt.y });
  if (area && area.on !== 'self' && (!point || (area.range !== undefined && feetBetween(s.grid, me, point, i.diagonal) > area.range))) return area.on === 'creature' ? 'pick a target' : 'out of range';
  if (!area && !target) return 'pick a target';
  const origin = area?.on === 'self' ? { x: me.x, y: me.y } : point!;
  const placed: Area | undefined = area && { shape: area.shape, origin: { x: origin.x, y: origin.y }, aim: aim.point ?? { x: origin.x, y: origin.y }, feet: area.feet, ...(area.width && { width: area.width }) };
  const caught = placed ? tokensInTemplate(placed, s.grid, s.tokens)
    .map((id) => combatantForToken(k, s.tokens.find((t) => t.id === id)!)).filter((z): z is Combatant => !!z && !(area?.on === 'self' && z.id === actor.id)) : [];
  const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit: crit && d.on !== 'save' })), rolled);
  if (bad) return bad;
  const outcomes = resolveSpell(read, plan.dice, a.cast!.dc, plan.toHit, target && await i.info(target), await Promise.all(caught.map(i.info)), rolled, i.rng, autoCrit, actor.kind === 'pc');
  const hit = outcomes.find((o) => o.part === 'hit')?.hit;
  // a lasting spell's effect also leaves a condition named after the spell (the user's standard: Hold Monster, Hex, Haste)
  const lasts = !!(a.spell?.concentration || read.rounds);
  const named = (o: Outcome): Outcome => (!lasts ? o : o.inflict ? { ...o, inflict: [...o.inflict, a.name] } : o.inflicts ? { ...o, inflicts: [...o.inflicts, a.name] } : o);
  // a slowing hit (Ray of Frost): a condition named after the spell that carries the cut, to the start of the caster's next turn
  const slowed = (o: Outcome): Outcome => (read.slow && o.part === 'hit' && o.hit ? { ...o, inflict: [...(o.inflict ?? []), `${a.name} (speed −${read.slow.feet} ft)`] } : o);
  const rounds = read.rounds ?? (read.slow ? 1 : undefined);
  return {
    resolution: { ...base, outcomes: outcomes.map(withWhy).map(named).map(slowed), ...(placed && { caught: caught.map((z) => z.id), area: placed, sceneId: s.id, round: k.round }),
      ...(plan.linger && { linger: { ...plan.linger, ...(plan.linger.read.save && a.cast!.dc !== undefined && { dc: a.cast!.dc }) } }),
      ...(read.leap && target && { chain: [...(i.leapFrom?.exclude ?? []), target.id] }),
      ...(a.spell?.concentration ? { lasting: true as const } : rounds && { rounds }), ...(read.repeat && { repeat: true as const }), ...(read.save && { dc: a.cast!.dc, ability: read.save.toLowerCase() as Ability, onSave: read.onSave }) },
    outcome: { action: a.name, ...(hit !== undefined && { hit }), ...(read.save && a.cast!.dc !== undefined && { dc: a.cast!.dc }),
      ...(area && { caught: caught.filter((z) => !z.hidden && (i.seen?.(z) ?? true)).map(i.nameOf) }), ...(outcomes.some((o) => o.leap) && { leap: i.id }) },
  };
}
