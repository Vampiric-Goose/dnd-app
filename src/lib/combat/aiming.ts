// Pure (no Svelte/Vite/DOM): a targeted use from aim to result, shared by the DM's map (its own monsters and characters) and the host (a
// player's use). aimPlan says what an action needs (reach, a line, an area, its dice); workOut checks an aim against the shown scene and
// works it out with resolve.ts. The target must be in reach or range (PHB range, close-combat disadvantage), the dice must fit, and an
// area catches every token in it, hidden ones too; the acting player hears only hit or miss, a spell's DC and the visible names caught.
import { feetBetween, tokenFeet, type Pt } from '../map/grid.ts';
import { tokensInTemplate, type Shape } from '../map/templates.ts';
import { cover as coverOf, lineBlocked, type Cover } from '../map/walls.ts';
import type { Ability, Area, Character, Combat, Combatant, Grid, Resolution, Scene, Size, Snap, Token } from '../types.ts';
import { combatantForToken } from './movement.ts';
import { checkFaces, keptD20, resolveAttack, resolveSpell, totalOf, type Outcome, type TargetInfo } from './resolve.ts';
import { SPELL_EFFECTS } from '../rules/constants.ts';
import { diceAt, type SpellRead } from './spellText.ts';
import { rollSpellDice, spellMods } from './spellEffects.ts';
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
export interface AimPlan { reach: Reach; line: boolean; attack: boolean; toHit?: number; area?: AimArea; dice: { expr: string; type: string; on?: 'hit' | 'save'; vs?: string; part?: 'alt' | 'later' }[]; read?: SpellRead;
  ignore?: { long?: true; close?: true }; choices?: string[]; mark?: true; /** rays, beams or darts: a target each */ count?: number; /** `count` is a most, each creature once (Bane) */ upTo?: true; /** a helpful spell: up to `max` creatures, the caster included */ helps?: { max: number }; /** damage over time, kept for the turns to come */ linger?: { dice: { expr: string; type: string }[]; read: SpellRead } }

/** A melee weapon attack (Parry applies to it): an attack whose reach has a melee part. */
export const meleeAttack = (p?: AimPlan): boolean => !!p?.attack && p.reach !== 'self' && p.reach.melee !== undefined;

/**
 * The spell areas to draw on a scene, for everyone: an instant one until its caster's next turn, a concentration one while its caster
 * keeps concentrating. Undo drops the result, and its area with it.
 */
/** A lasting result's spell is still up: its caster concentrates on that very casting (older results: on a spell of that name). */
export function castLive(k: Combat, r: Resolution): boolean {
  const c = k.combatants.find((x) => x.id === r.actor);
  return !!c?.concentrating && (c.concentratingOn === undefined || c.concentratingOn === r.action) && (r.cast === undefined || c.concentrationCount === r.cast);
}

/** A lasting area as it stands now: one that goes with its caster (Spirit Guardians) is centered on the caster's token on that scene. */
export function areaNow(k: Combat, r: Resolution, s?: Scene): Area {
  const a = r.area!, t = r.follows && s ? s.tokens.find((x) => combatantForToken(k, x)?.id === r.actor) : undefined;
  if (!t) return a;
  const dx = t.x - a.origin.x, dy = t.y - a.origin.y;
  return { ...a, origin: { x: t.x, y: t.y }, aim: { x: a.aim.x + dx, y: a.aim.y + dy } };
}

/** The areas up on a scene (its id, or the scene itself so areas that go with their caster are where the caster stands). */
export function areasOn(k: Combat | undefined, s: Scene | string): Area[] {
  return k ? liveAreas(k, typeof s === 'string' ? s : s.id).map((r) => areaNow(k, r, typeof s === 'string' ? undefined : s)) : [];
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

const tokenOfCombatant = (k: Combat, s: Scene, id: string) => s.tokens.find((x) => combatantForToken(k, x)?.id === id);
const inArea = (k: Combat, s: Scene, r: Resolution, t: Token, at: Pt = t) => tokensInTemplate(areaNow(k, r, s), s.grid, [{ ...t, x: at.x, y: at.y }]).length > 0;

/** The lasting areas that act as a turn starts there (Moonbeam) which creature `id`'s turn began in: where it stood then, once it has moved. */
export function startsIn(k: Combat, s: Scene, id: string): Resolution[] {
  const t = tokenOfCombatant(k, s, id), from = k.movement?.[id]?.from;
  return t ? liveAreas(k, s.id).filter((r) => r.linger && !r.linger.read.noStart && inArea(k, s, r, t, from ?? t)) : [];
}

/** The lasting areas that act as a turn ends there (Incendiary Cloud) which creature `id`'s token stands in now. */
export function endsIn(k: Combat, s: Scene, id: string): Resolution[] {
  const t = tokenOfCombatant(k, s, id);
  return t ? liveAreas(k, s.id).filter((r) => r.linger?.read.ends && inArea(k, s, r, t)) : [];
}

/**
 * Moved tokens' creatures that entered a lasting area which acts on entering (Cloudkill): the move's path crosses it from outside it. Noted
 * once per creature, area and turn ("the first time on a turn"), on anyone's turn (pushed in). ponytail: the path is the move's straight line,
 * sampled every half cell; an area moving onto a creature isn't its entering (2014: the creature enters).
 */
export function noteEntries(k: Combat, s: Scene, moves: { t: Token; from: Pt }[]): Combat {
  const areas = liveAreas(k, s.id).filter((r) => r.linger?.read.enters), turn = k.turn ?? '';
  const kept = (k.entered ?? []).filter((e) => e.round >= k.round - 1), add: NonNullable<Combat['entered']> = [];
  for (const { t, from } of moves) {
    const x = combatantForToken(k, t), pts = [from, ...(t.trail ?? [t])]; // a walked token: along its trail
    const enters = (r: Resolution, a: Pt, b: Pt) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (s.grid.size / 2)));
      for (let i = 1; i <= n; i++) if (inArea(k, s, r, t, { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })) return true;
      return false; };
    if (x) for (const r of areas) {
      if (inArea(k, s, r, t, from) || [...kept, ...add].some((e) => e.rid === r.id && e.id === x.id && e.round === k.round && e.turn === turn)) continue;
      if (pts.some((b, j) => j > 0 && enters(r, pts[j - 1], b))) add.push({ rid: r.id, id: x.id, round: k.round, turn });
    }
  }
  return add.length || kept.length !== (k.entered ?? []).length ? { ...k, entered: [...kept, ...add] } : k;
}

/** The lasting areas on a scene their caster moves (Moonbeam, Flaming Sphere): up to `move` feet a time, by the DM (moveArea). */
export const movableAreas = (k: Combat | undefined, sceneId: string): Resolution[] => liveAreas(k, sceneId).filter((r) => r.linger?.read.move);

/** That result's area put with its center at `to` (it keeps its shape). */
export function moveArea(k: Combat, rid: string, to: Pt): Combat {
  return { ...k, resolutions: (k.resolutions ?? []).map((r) => (r.id !== rid || !r.area ? r
    : { ...r, area: { ...r.area, origin: { x: to.x, y: to.y }, aim: { x: r.area.aim.x + to.x - r.area.origin.x, y: r.area.aim.y + to.y - r.area.origin.y } } })) };
}

/**
 * As its caster's turn starts, a drifting area (Cloudkill, Incendiary Cloud) moves `drift` feet straight away from the caster, in whole cells
 * along the grid (diagonally when it lies that way), once a round. ponytail: Incendiary Cloud's "direction you choose" is straight away.
 */
export function driftAreas(k: Combat, s: Scene): Combat {
  const me = k.turn ? tokenOfCombatant(k, s, k.turn) : undefined;
  if (!me) return k;
  let moved = false;
  const rs = (k.resolutions ?? []).map((r) => {
    const d = r.linger?.read.drift;
    if (!d || r.actor !== k.turn || r.drifted === k.round || !liveAreas(k, s.id).includes(r)) return r;
    const a = r.area!, dx = a.origin.x - me.x, dy = a.origin.y - me.y, len = Math.hypot(dx, dy);
    const steps = Math.round(d.feet / s.grid.feet), ux = len ? Math.round(dx / len) : 1, uy = len ? Math.round(dy / len) : 0;
    const to = { x: Math.min(s.width, Math.max(0, a.origin.x + ux * steps * s.grid.size)), y: Math.min(s.height, Math.max(0, a.origin.y + uy * steps * s.grid.size)) };
    moved = true;
    return { ...moveArea({ ...k, resolutions: [r] }, r.id, to).resolutions![0], drifted: k.round };
  });
  return moved ? { ...k, resolutions: rs } : k;
}

/** A heal of all its target's hit points (Power Word Heal): applying it stops at the target's maximum. */
export const ALL_HP = 1_000_000;

export type AreaKind = 'start' | 'enter' | 'end';
/** The result name of an area's roll: as a turn starts there, on entering it, as a turn ends there. */
export const areaRollName = (r: Pick<Resolution, 'action'>, kind: AreaKind): string => `${r.action} (${kind === 'enter' ? 'entering' : kind === 'end' ? 'end of turn' : 'start of turn'})`;

/**
 * The area rolls owed on this turn (Cloudkill, Incendiary Cloud), each once a turn and apart: the creature whose turn it is starting it or
 * ending it in an area, and any creature that entered one this turn. Last round's rolls don't count.
 */
export function areaRolls(k: Combat, s: Scene): { r: Resolution; kind: AreaKind; id: string }[] {
  const id = k.turn, live = liveAreas(k, s.id);
  const done = (r: Resolution, kind: AreaKind, who: string) => (k.resolutions ?? []).some((y) => y.action === areaRollName(r, kind) && y.round === k.round
    && y.outcomes[0]?.id === who && (kind !== 'enter' || (y.turn ?? id) === id));
  const owed = [...(id ? [...startsIn(k, s, id).map((r) => ({ r, kind: 'start' as const, id })), ...endsIn(k, s, id).map((r) => ({ r, kind: 'end' as const, id }))] : []),
    ...(k.entered ?? []).filter((e) => e.round === k.round && e.turn === id).flatMap((e) => { const r = live.find((y) => y.id === e.rid); return r ? [{ r, kind: 'enter' as const, id: e.id }] : []; })];
  return owed.filter((x) => !done(x.r, x.kind, x.id));
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

/** Cover on the target's numbers: + to its AC and Dex save. */
const behind = (t: TargetInfo, c: Cover): TargetInfo => (typeof c === 'number' && c ? { ...t, ac: t.ac + c, save: { ...t.save, dex: t.save.dex + c } } : t);
/** Its cover noted on the result (`cover`: what a PC's Dex save still to come adds). */
const covered = (o: Outcome, c: Cover): Outcome => (typeof c === 'number' && c ? { ...o, cover: c, note: [o.note, c === 5 ? 'three-quarters cover' : 'half cover'].filter(Boolean).join(', ') } : o);

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
  // a helpful spell (a buff in SPELL_EFFECTS, healing, temp HP): on up to `max` creatures in reach, the caster too; range Self is the caster.
  // Haste keeps its own target (turnActions.ts `target`).
  if (read && a.spell && !a.target && !read.attack && !read.save && (SPELL_EFFECTS[a.name] || read.heal || read.temp)) {
    const slot = o.level ?? a.at ?? a.spell.level, up = Math.max(0, slot - a.spell.level);
    const heal = diceAt(read, { slot, level: a.spell.level, charLevel: a.cast!.charLevel, mod: a.cast!.mod }).heal;
    const temp = read.temp && (read.temp.perSlot && up ? `${read.temp.dice}+${read.temp.perSlot * up}` : read.temp.dice);
    const max = reach === 'self' ? 1 : read.targets ? read.targets.count + (read.targets.above !== undefined ? Math.max(0, slot - read.targets.above) : 0) : 1;
    const all = read.heal?.dice === 'all'; // Power Word Heal: nothing to roll
    return { reach, line: false, attack: false, read, helps: { max }, dice: heal && !all ? [{ expr: heal, type: 'healing' }] : temp ? [{ expr: temp, type: 'temp' }] : [] };
  }
  if (!read || !a.spell || !(read.attack || read.save || read.area || read.burst || read.auto)) return undefined;
  if (!read.save && !read.damage.length && !read.area && !read.burst && !read.conditions?.length) return undefined; // a save-only spell (Suggestion) still rolls the monster's save
  const picked = o.dtype && read.choices?.includes(o.dtype) ? o.dtype : '';
  const dice = diceAt(read, { slot: o.level ?? a.at ?? a.spell.level, level: a.spell.level, charLevel: a.cast!.charLevel, mod: a.cast!.mod }).damage
    .map((d, i) => { const [expr, ...type] = d.split(' '); return { expr, type: type.join(' ') || picked, ...(read.damage[i]?.on && { on: read.damage[i].on }), ...(read.damage[i]?.part && { part: read.damage[i].part }) }; });
  const area: AimArea | undefined = read.burst ? { shape: 'sphere', feet: read.burst, on: 'creature' }
    : read.area ? { shape: read.area.shape, feet: read.area.feet, ...(read.area.width && { width: read.area.width }), on: read.area.self ? 'self' : 'point',
      ...(reach !== 'self' && reach.spell !== undefined && { range: reach.spell }) } : undefined;
  // placed and listed now (rolled now too on those in it, when it acts "as it appears"), then rolled as it acts (areaRolls): its damage, or
  // its save alone (Grease, Stinking Cloud)
  if (read.lingering) return { reach, line: false, attack: false, ...(area && { area }), dice: read.appears ? dice : [],
    read: read.appears ? read : { ...read, attack: undefined, save: undefined, damage: [], conditions: undefined },
    ...(read.choices && { choices: read.choices }), // a chosen type (Spirit Guardians) is picked now and kept
    ...((dice.length || read.save || read.conditions?.length) && { linger: { dice: dice.map(({ expr, type }) => ({ expr, type })), read } }) };
  if (read.attack && o.rider?.anyAttack) dice.push({ expr: o.rider.dice, type: o.rider.type || dice[0]?.type || '', on: 'hit', ...(o.rider.target && { vs: o.rider.target }) }); // Hex on a spell attack
  const ignore = read.attack === 'ranged' && has('Crossbow Expert') ? { close: true as const } : undefined;
  const slot = o.level ?? a.at ?? a.spell.level, lvl = a.cast!.charLevel ?? 1, up = (above?: number) => (above !== undefined && slot > above ? slot - above : 0);
  const count = read.rays ? (read.rays.byLevel ? (lvl >= 17 ? 4 : lvl >= 11 ? 3 : lvl >= 5 ? 2 : 1) : read.rays.count + up(read.rays.above)) : read.auto ? read.auto.count + up(read.auto.above)
    : read.targets && read.save && !area ? read.targets.count + up(read.targets.above) : 1; // Bane, Hold Person: up to that many, each once
  return { reach, line: read.attack === 'ranged', attack: !!read.attack, ...(a.cast!.attack !== undefined && { toHit: a.cast!.attack }), ...(area && { area }), dice, read, ...(ignore && { ignore }),
    ...(read.choices && { choices: read.choices }), ...(count > 1 && { count, ...(!read.rays && !read.auto && { upTo: true as const }) }) };
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
  /** House rule (settings.critAll): a critical hit's damage dice come once and its total is doubled. */ critAll?: boolean;
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
  if ([...plan.dice, ...(plan.linger?.dice ?? [])].some((d) => !d.type) && plan.choices && !plan.read?.typeFromDie) return 'pick a damage type';
  if (plan.count && !i.ray) { // rays, beams or darts: one aim each (two d20s and the dice each), worked out one by one
    const ts = aim.targets ?? [], n = plan.dice.length;
    if (plan.upTo ? !ts.length : ts.length !== plan.count) return 'pick a target';
    if (plan.upTo && ts.length > plan.count) return 'too many targets';
    if (plan.upTo && new Set(ts).size !== ts.length) return 'pick each creature once';
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
  if (plan.helps) { // each creature picked once, in reach (the caster included); its dice once per creature
    const ids = aim.targets?.length ? aim.targets : aim.target !== undefined ? [aim.target] : plan.reach === 'self' ? [actor.id] : [];
    if (!ids.length) return 'pick a target';
    if (ids.length > plan.helps.max) return 'too many targets';
    if (new Set(ids).size !== ids.length) return 'pick each creature once';
    for (const id of ids) {
      const z = i.findTarget(id), t = z && tokenOf(z.id);
      if (!z || !t) return 'pick a target';
      if (plan.reach === 'self' ? z.id !== actor.id : !canTarget(plan.reach, tokenFeet(s.grid, me, t, i.diagonal), false, false).ok) return 'out of range';
    }
    const n = plan.dice.length;
    if (aim.rolled.dmg.length !== n * ids.length || plan.dice.some((d, j) => ids.some((_, r) => totalOf(d.expr, aim.rolled.dmg[r * n + j], false) === undefined))) return 'bad damage dice';
    const amount = (r: number) => (n ? totalOf(plan.dice[0].expr, aim.rolled.dmg[r * n], false)! : 0), kind = plan.dice[0]?.type;
    const outcomes: Outcome[] = ids.map((id, r) => ({ id, damage: 0, ...(SPELL_EFFECTS[a.name] && { inflict: [a.name] }), ...(kind === 'healing' && { heal: amount(r) }), ...(kind === 'temp' && { temp: amount(r) }),
      ...(plan.read?.heal?.dice === 'all' && { heal: ALL_HP }) }));
    return { resolution: { id: i.id, actor: actor.id, action: a.name, at: i.now, round: k.round, outcomes, ...(a.spell?.concentration ? { cast: (actor.concentrationCount ?? 0) + 1, lasting: true as const } : plan.read?.rounds && { rounds: plan.read.rounds }) },
      outcome: { action: a.name } };
  }
  const target = aim.target === undefined ? undefined : i.findTarget(aim.target), tt = target && tokenOf(target.id);
  if (aim.target !== undefined && !tt) return 'pick a target';
  if (i.leapFrom && target && i.leapFrom.exclude.includes(target.id)) return 'pick another creature';
  const foe = foeWithin5(k, s, actor, i.diagonal, i.conditionsOf);
  const cond = (z: Combatant) => i.conditionsOf?.(z) ?? z.conditions ?? [];
  const pick = tt && target ? judge(plan, s.grid, i.diagonal, me, foe, tt, { attacker: cond(actor), target: cond(target), exhaustion: i.exhaustionOf?.(actor), dodging: !!target.economy?.dodging }) : undefined;
  if (pick && !pick.ok) return 'out of range';
  // cover (map/walls.ts): total refuses the target; half and three-quarters add to its AC and Dex save. Sharpshooter (a ranged weapon) and
  // Spell Sniper (a spell attack) shoot past both; Sacred Flame gives none.
  const others = (...ids: string[]) => s.tokens.filter((t) => !ids.includes(t.id) && combatantForToken(k, t));
  let cv: Cover = tt && target && target.id !== actor.id && a.name !== 'Sacred Flame' ? coverOf(s.grid, s.walls, me, tt, others(me.id, tt.id)) : 0;
  if (cv === 'total') return 'total cover';
  if (cv && plan.attack && ((!a.spell && plan.line && i.features.includes('Sharpshooter')) || (a.spell && i.features.includes('Spell Sniper')))) cv = 0;
  if (plan.attack && !tt) return 'pick a target';
  const edge = pick?.ok ? { adv: pick.adv ?? [], dis: pick.dis ?? [] } : { adv: [], dis: [] };
  const rolled = { ...aim.rolled, mode: plan.attack ? combineMode(edge, aim.rolled.mode) : aim.rolled.mode };
  if (plan.attack && (!rolled.d20?.length || (rolled.mode && rolled.d20.length < 2))) return 'bad d20';
  const autoCrit = !!(pick?.ok && pick.autoCrit);
  const why = rolled.mode ? `${rolled.mode === 'adv' ? 'advantage' : 'disadvantage'}: ${(rolled.mode === 'adv' ? edge.adv : edge.dis).join(', ') || 'chosen'}` : undefined;
  // the attacker's spells add dice to its attack roll (Bless, Bane), rolled on this device and noted with the result
  const blessed = plan.attack ? rollSpellDice(spellMods(cond(actor)), 'attack', i.rng) : { total: 0 };
  const toHit = plan.toHit === undefined ? undefined : plan.toHit + blessed.total;
  const withWhy = (o: Outcome): Outcome => {
    const e = why && o.roll !== undefined ? { ...o, edge: why } : o;
    return blessed.note && o.roll !== undefined ? { ...e, note: [e.note, blessed.note].filter(Boolean).join(', ') } : e;
  };
  const crit = plan.attack && (keptD20(rolled) === 20 || autoCrit) && !i.critAll; // a critical's dice come doubled (under the house rule, once: its total is doubled)
  const base = { id: i.id, actor: actor.id, action: a.name, at: i.now, round: k.round, ...(i.level !== undefined && plan.read?.leap && { slot: i.level }),
    ...(a.spell?.concentration && !i.leapFrom && { cast: (actor.concentrationCount ?? 0) + 1 }) }; // worked out before it is paid for
  if (!plan.read) { // a weapon or a monster's attack
    const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit })), rolled);
    if (bad) return bad;
    const o = covered(withWhy(resolveAttack(behind(await i.info(target!), cv), toHit ?? 0, plan.dice, rolled, i.magical, autoCrit, i.critAll)), cv);
    return { resolution: { ...base, outcomes: [o], ...(o.hit && actor.rider?.once && { spent: true as const }) }, outcome: { action: a.name, hit: !!o.hit } };
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
  // an area reaches only what a clear line from its point of origin reaches (a wall stops it); each caught creature's cover is measured from there
  const inLine = (id: string) => { const t = s.tokens.find((x) => x.id === id)!; return !lineBlocked(s.walls ?? [], origin, t) ? t : undefined; };
  const caughtTokens = placed ? tokensInTemplate(placed, s.grid, s.tokens).map(inLine).filter((t): t is Token => !!t) : [];
  const caught = caughtTokens.map((t) => combatantForToken(k, t)).filter((z): z is Combatant => !!z && !(area?.on === 'self' && z.id === actor.id));
  const areaCover = new Map(placed ? caughtTokens.map((t) => { const c = coverOf(s.grid, s.walls, origin, t, others(t.id)); return [combatantForToken(k, t)?.id, c === 'total' ? 0 : c] as const; }) : []);
  const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit: crit && d.on !== 'save' })), rolled);
  if (bad) return bad;
  const outcomes = resolveSpell(read, plan.dice, a.cast!.dc, toHit, target && behind(await i.info(target), cv), await Promise.all(caught.map(async (z) => behind(await i.info(z), areaCover.get(z.id) ?? 0))), rolled, i.rng, autoCrit, actor.kind === 'pc', i.critAll)
    .map((o) => covered(o, o.part === 'hit' || !placed ? cv : areaCover.get(o.id) ?? 0));
  // a draining spell (Vampiric Touch) heals its caster half the necrotic damage it deals. ponytail: a save its target rolls later (a PC's) drains nothing
  const drained = read.drain ? Math.floor(outcomes.reduce((t, o) => t + (o.damage ?? 0), 0) / 2) : 0;
  if (drained > 0) outcomes.push({ id: actor.id, damage: 0, heal: drained });
  const hit = outcomes.find((o) => o.part === 'hit')?.hit;
  // a lasting spell's effect also leaves a condition named after the spell (the user's standard: Hold Monster, Hex, Haste)
  const lasts = !!(a.spell?.concentration || read.rounds);
  const named = (o: Outcome): Outcome => (!lasts ? o : o.inflict ? { ...o, inflict: [...o.inflict, a.name] } : o.inflicts ? { ...o, inflicts: [...o.inflicts, a.name] } : o);
  // a slowing hit (Ray of Frost): a condition named after the spell that carries the cut, to the start of the caster's next turn
  const slowed = (o: Outcome): Outcome => (read.slow && o.part === 'hit' && o.hit ? { ...o, inflict: [...(o.inflict ?? []), `${a.name} (speed −${read.slow.feet} ft)`] } : o);
  const rounds = read.rounds ?? (read.slow ? 1 : undefined);
  return {
    resolution: { ...base, outcomes: outcomes.map(withWhy).map(named).map(slowed), ...(placed && { caught: caught.map((z) => z.id), area: placed, sceneId: s.id, round: k.round }),
      ...(plan.linger && { linger: { ...plan.linger, ...((plan.linger.read.save || plan.linger.read.atEnd?.save) && a.cast!.dc !== undefined && { dc: a.cast!.dc }) } }),
      ...(plan.linger && area?.on === 'self' && { follows: true as const }), // an area around its caster goes with it (Spirit Guardians)
      ...(read.leap && target && { chain: [...(i.leapFrom?.exclude ?? []), target.id] }),
      ...(a.spell?.concentration ? { lasting: true as const } : rounds && { rounds }), ...(read.repeat && { repeat: true as const }), ...(read.save && { dc: a.cast!.dc, ability: read.save.toLowerCase() as Ability, onSave: read.onSave }) },
    outcome: { action: a.name, ...(hit !== undefined && { hit }), ...(read.save && a.cast!.dc !== undefined && { dc: a.cast!.dc }),
      ...(area && { caught: caught.filter((z) => !z.hidden && (i.seen?.(z) ?? true)).map(i.nameOf) }), ...(outcomes.some((o) => o.leap) && { leap: i.id }) },
  };
}
