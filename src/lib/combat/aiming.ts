// Pure (no Svelte/Vite/DOM): a targeted use from aim to result, shared by the DM's map (its own monsters and characters) and the host (a
// player's use). aimPlan says what an action needs (reach, a line, an area, its dice); workOut checks an aim against the shown scene and
// works it out with resolve.ts. The target must be in reach or range (PHB range, close-combat disadvantage), the dice must fit, and an
// area catches every token in it, hidden ones too; the acting player hears only hit or miss, a spell's DC and the visible names caught.
import { feetBetween, type Pt } from '../map/grid.ts';
import { tokensInTemplate, type Shape } from '../map/templates.ts';
import type { Ability, Combat, Combatant, Grid, Resolution, Scene } from '../types.ts';
import { combatantForToken } from './movement.ts';
import { checkFaces, keptD20, resolveAttack, resolveSpell, type TargetInfo } from './resolve.ts';
import { diceAt, type SpellRead } from './spellText.ts';
import { attackToggles, canTarget, finalMode, monsterAttack, reachOf, type Pickable, type Reach, type Toggle } from './targeting.ts';
import type { TurnAction } from './turnActions.ts';

/** What a use aims at (a creature's id, or a map point for an area) and the roller's own raw dice (resolve.ts Rolled). */
export interface Aim { target?: string; point?: { x: number; y: number }; rolled: { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[][] }; toggles: ('gwm' | 'ss')[] }
/** To the acting player only: hit or miss, a spell's save DC, the names of the visible creatures its area caught. */
export interface UseOutcome { action: string; hit?: boolean; dc?: number; caught?: string[] }
/** A use worked out, waiting for its payment to go through. */
export interface Aimed { resolution: Omit<Resolution, 'applied'>; outcome: UseOutcome }

export interface AimArea { shape: Shape; feet: number; width?: number; on: 'creature' | 'point' | 'self'; range?: number }
/** `attack`: it rolls a d20 against AC. `dice`: its damage, in roll order (`on`: the part of a spell that deals it). */
export interface AimPlan { reach: Reach; line: boolean; attack: boolean; toHit?: number; area?: AimArea; dice: { expr: string; type: string; on?: 'hit' | 'save' }[]; read?: SpellRead }

/** What an action needs to be aimed, or undefined when it can't be (no reach, or a spell with no attack, save or area). */
export function aimPlan(a: TurnAction, o: { level?: number; toggles?: Toggle[] } = {}): AimPlan | undefined {
  const reach = reachOf(a);
  if (!reach) return undefined;
  if (a.attack) {
    const w = a.attack, t = o.toggles ?? [];
    return { reach, line: !!w.ranged, attack: true, toHit: w.toHit + t.reduce((n, x) => n + x.toHit, 0),
      dice: [{ expr: w.damage, type: w.damageType }, ...t.map((x) => ({ expr: String(x.damage), type: w.damageType }))] };
  }
  const ma = a.group === 'monster' ? monsterAttack(a) : undefined;
  if (ma) return { reach, line: ma.ranged, attack: true, toHit: ma.toHit, dice: ma.dmg };
  const read = a.cast?.read;
  if (!read || !a.spell || !(read.attack || read.save || read.area || read.burst)) return undefined;
  const dice = diceAt(read, { slot: o.level ?? a.spell.level, level: a.spell.level, charLevel: a.cast!.charLevel, mod: a.cast!.mod }).damage
    .map((d, i) => { const [expr, ...type] = d.split(' '); return { expr, type: type.join(' '), ...(read.damage[i]?.on && { on: read.damage[i].on }) }; });
  const area: AimArea | undefined = read.burst ? { shape: 'sphere', feet: read.burst, on: 'creature' }
    : read.area ? { shape: read.area.shape, feet: read.area.feet, ...(read.area.width && { width: read.area.width }), on: read.area.self ? 'self' : 'point',
      ...(reach !== 'self' && reach.spell !== undefined && { range: reach.spell }) } : undefined;
  return { reach, line: read.attack === 'ranged', attack: !!read.attack, ...(a.cast!.attack !== undefined && { toHit: a.cast!.attack }), ...(area && { area }), dice, read };
}

/** Whether a creature at `t` can be picked from `me`, and with what disadvantage. A melee weapon past its reach is thrown (ranged). */
export function pickableAt(plan: AimPlan, g: Grid, diagonal: '5-5-5' | '5-10-5', me: Pt, foeWithin5: boolean, t: Pt): Pickable {
  const feet = feetBetween(g, me, t, diagonal);
  const thrown = plan.reach !== 'self' && plan.reach.melee !== undefined && plan.reach.normal !== undefined && feet > plan.reach.melee;
  return canTarget(plan.reach, feet, foeWithin5, plan.line || thrown);
}

const OUT = /incapacitated|paralyzed|petrified|stunned|unconscious/i;
/** A hostile creature (a PC's foes are monsters; a monster's, PCs) that isn't incapacitated within 5 ft of the actor's token. */
export function foeWithin5(k: Combat, s: Scene, actor: Combatant, diagonal: '5-5-5' | '5-10-5', conditionsOf: (z: Combatant) => readonly string[] = (z) => z.conditions ?? []): boolean {
  const tokenOf = (id: string) => s.tokens.find((t) => combatantForToken(k, t)?.id === id), me = tokenOf(actor.id);
  return !!me && k.combatants.some((z) => z.id !== actor.id && !z.hidden && (actor.kind === 'pc' ? z.kind === 'monster' : z.kind === 'pc')
    && !conditionsOf(z).some((c) => OUT.test(c)) && (() => { const t = tokenOf(z.id); return !!t && feetBetween(s.grid, me, t, diagonal) <= 5; })());
}

export interface WorkIn {
  a: TurnAction; level?: number; features: string[]; actor: Combatant; combat: Combat; scene: Scene; diagonal: '5-5-5' | '5-10-5'; aim: Aim;
  /** The target the aim names, if the roller may pick it (a player: visible ones only). */
  findTarget: (id: string) => Combatant | undefined;
  info: (z: Combatant) => TargetInfo | Promise<TargetInfo>;
  nameOf: (z: Combatant) => string;
  conditionsOf?: (z: Combatant) => readonly string[];
  /** A weapon attack's weapon is magical (it beats "nonmagical" resistance). */
  magical: boolean; id: string; now: number; rng: () => number;
}

/** An aim checked on the scene and worked out, or why not. */
export async function workOut(i: WorkIn): Promise<Aimed | string> {
  const { a, aim, combat: k, scene: s, actor } = i;
  const plan = aimPlan(a, { level: i.level, toggles: attackToggles(a, i.features).filter((t) => aim.toggles.includes(t.id)) });
  if (!plan) return 'that cannot be aimed';
  const tokenOf = (id: string) => s.tokens.find((t) => combatantForToken(k, t)?.id === id);
  const me = tokenOf(actor.id);
  if (!me) return 'not on the map';
  const target = aim.target === undefined ? undefined : i.findTarget(aim.target), tt = target && tokenOf(target.id);
  if (aim.target !== undefined && !tt) return 'pick a target';
  const foe = foeWithin5(k, s, actor, i.diagonal, i.conditionsOf);
  const pick = tt ? pickableAt(plan, s.grid, i.diagonal, me, foe, tt) : undefined;
  if (pick && !pick.ok) return 'out of range';
  if (plan.attack && !tt) return 'pick a target';
  const rolled = { ...aim.rolled, mode: plan.attack ? finalMode(aim.rolled.mode, pick?.ok ? pick.disadvantage : undefined) : aim.rolled.mode };
  if (plan.attack && (!rolled.d20?.length || (rolled.mode && rolled.d20.length < 2))) return 'bad d20';
  const crit = plan.attack && keptD20(rolled) === 20;
  const base = { id: i.id, actor: actor.id, action: a.name, at: i.now };
  if (!plan.read) { // a weapon or a monster's attack
    const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit })), rolled);
    if (bad) return bad;
    const o = resolveAttack(await i.info(target!), plan.toHit ?? 0, plan.dice, rolled, i.magical);
    return { resolution: { ...base, outcomes: [o] }, outcome: { action: a.name, hit: !!o.hit } };
  }
  const read = plan.read, area = plan.area;
  const point = area?.on === 'creature' ? (tt && { x: tt.x, y: tt.y }) : aim.point ?? (tt && { x: tt.x, y: tt.y });
  if (area && area.on !== 'self' && (!point || (area.range !== undefined && feetBetween(s.grid, me, point, i.diagonal) > area.range))) return area.on === 'creature' ? 'pick a target' : 'out of range';
  if (!area && !target) return 'pick a target';
  const origin = area?.on === 'self' ? { x: me.x, y: me.y } : point!;
  const caught = area ? tokensInTemplate({ shape: area.shape, origin, aim: aim.point ?? origin, feet: area.feet, ...(area.width && { width: area.width }) }, s.grid, s.tokens)
    .map((id) => combatantForToken(k, s.tokens.find((t) => t.id === id)!)).filter((z): z is Combatant => !!z && !(area.on === 'self' && z.id === actor.id)) : [];
  const bad = checkFaces(plan.dice.map((d) => ({ expr: d.expr, crit: crit && d.on !== 'save' })), rolled);
  if (bad) return bad;
  const outcomes = resolveSpell(read, plan.dice, a.cast!.dc, plan.toHit, target && await i.info(target), await Promise.all(caught.map(i.info)), rolled, i.rng);
  const hit = outcomes.find((o) => o.part === 'hit')?.hit;
  return {
    resolution: { ...base, outcomes, ...(area && { caught: caught.map((z) => z.id) }), ...(read.save && { dc: a.cast!.dc, ability: read.save.toLowerCase() as Ability, onSave: read.onSave }) },
    outcome: { action: a.name, ...(hit !== undefined && { hit }), ...(read.save && a.cast!.dc !== undefined && { dc: a.cast!.dc }),
      ...(area && { caught: caught.filter((z) => !z.hidden).map(i.nameOf) }) },
  };
}
