// Pure (no Svelte/Vite/DOM): who may react to a trigger (Opportunity Attack, Counterspell, Shield / Uncanny Dodge / Parry, Hellish
// Rebuke) and the maths of the reaction. Callers build a Body per creature from the live fight; nothing here reads the fight.
import { richToPlain } from '../content/richtext.ts';
import { cellAt, cellCenter, cellDistance, tokenFeet, type Pt } from '../map/grid.ts';
import type { Ability, Combatant, Grid, Outcome, Size } from '../types.ts';
import { BLOCKING } from './economy.ts';
import type { TurnAction } from './turnActions.ts';

type Diagonal = '5-5-5' | '5-10-5';
/** `rebuke`: damage was taken (Hellish Rebuke and the name table's damaged window). */
export type ReactKind = 'opportunity' | 'counterspell' | 'hit' | 'rebuke' | 'declared' | 'miss' | 'after' | 'died' | 'saved' | 'enter' | 'cast';
/** `more`: a reaction from the name table (reactionTable.ts), `key` its name; `strike`: the player's device rolls an Opportunity Attack's aim for it
 *  (`spell`: War Caster's cantrip instead). */
export interface ReactOption { id: 'oa' | 'counterspell' | 'shield' | 'uncanny' | 'parry' | 'rebuke' | 'more'; label: string; slot?: number; bonus?: number; key?: string; strike?: true; spell?: string }
export interface Reactor { id: string /* combatant */; name: string; options: ReactOption[] }
/**
 * One creature as the rules see it: `conditions` are all of them (a PC's too), `slots` the free slot levels ascending, `reach` its melee
 * reach in feet. `side`: 'party' for a PC and a PC's summon (hostility only; `pc` is who plays it). `hidden`: not on the players' map.
 */
export interface Body { x: Combatant; pt: Pt & { size: Size }; conditions: readonly string[]; actions: TurnAction[]; features: readonly string[]; slots: number[]; reach: number; pc: boolean; side: 'party' | 'foes'; hidden: boolean; name: string;
  /** A PC's numbers for the name table: class levels by class name, uses left by resource name, its spell save DC, a shield worn. */
  stats?: { prof: number; mods: Record<Ability, number>; levels: Record<string, number>; left: Record<string, number>; dc?: number; shield?: boolean } }

const has = (b: Body, c: string) => b.conditions.some((n) => n.toLowerCase() === c);
/** The viewer sees the subject: the subject isn't Invisible, the viewer isn't Blinded, and a PC never sees what the players' map hides. */
export const sees = (viewer: Body, subject: Body) => !has(subject, 'invisible') && !has(viewer, 'blinded') && !(viewer.pc && subject.hidden);
export const canReact = (b: Body): boolean => !b.x.reactionUsed && b.x.hp !== 0 && !b.conditions.some((c) => BLOCKING.includes(c.toLowerCase()));
const reaction = (b: Body, name: string) => b.actions.some((a) => a.cost === 'reaction' && a.name.toLowerCase() === name);
const slotsFrom = (b: Body, min: number) => b.slots.filter((s) => s >= min);
const reactor = (b: Body, options: ReactOption[]): Reactor[] => (options.length ? [{ id: b.x.id, name: b.name, options }] : []);
const MELEE = /melee (?:or ranged )?weapon attack/i;

/** The action an Opportunity Attack uses: a PC's own (its melee weapon), a monster's first melee attack. */
export const oaAction = (b: Pick<Body, 'pc' | 'actions'>): TurnAction | undefined => (b.pc ? b.actions.find((z) => z.id === 'react:opportunity')
  : b.actions.find((z) => z.group === 'monster' && z.cost === 'action' && z.text && MELEE.test(richToPlain(z.text))));
/**
 * War Caster: instead of the Opportunity Attack, a spell with a casting time of 1 action that can target only the mover (an attack, a save
 * or darts; no area, not on itself) and reaches it at the reach's edge. A leveled one is cast with its lowest free slot.
 * ponytail: one button per spell, at that slot; upcasting it as a reaction would need a slot per button.
 */
const warCasts = (b: Body): ReactOption[] => (!b.pc || !b.features.includes('War Caster') ? [] : b.actions.flatMap((a): ReactOption[] => {
  const r = a.cast?.read, level = a.spell?.level;
  if (!r || level === undefined || a.cost !== 'action' || a.again || a.blocked || !(r.attack || r.save || r.auto || r.rays) || r.area || r.burst) return [];
  const feet = r.reach ?? (r.range === 'touch' ? 5 : typeof r.range === 'object' ? r.range.feet : 0); // range Self without a reach: itself
  const slot = level ? b.slots.find((s) => s >= level) : undefined;
  return feet < b.reach || (level && slot === undefined) ? [] : [{ id: 'oa', label: `War Caster (${a.name}${slot ? ` ${slot}` : ''})`, spell: a.name, ...(slot && { slot }) }];
}));
function oaOptions(b: Body): ReactOption[] {
  const a = oaAction(b);
  return a ? [{ id: 'oa', label: `Attack (${b.pc ? a.attack?.name ?? 'Attack' : a.name})` }, ...warCasts(b)] : [];
}

/**
 * Walks the straight line from the mover to `to`, cell by cell (the token keeps its offset in its cell). Stops at the first cell where
 * a hostile foe that can react and sees the mover is left behind out of its reach: `at` is the last cell inside that reach. Nothing
 * after a Disengage, but from a Sentinel. `enter` (reactionTable enterOptions): a foe's reactions to the mover coming within `feet` of it,
 * asked at the first cell inside (`at`, with `enter` set). The caller drops foes already asked before stepping on from `at`.
 */
export function leaveStep(g: Grid, diagonal: Diagonal, mover: Body, foes: Body[], to: Pt, disengaged: boolean,
  enter?: (f: Body) => { feet: number; option: ReactOption }[], asked: (f: Body, on: 'leave' | 'enter') => boolean = () => false,
  /** a wall gives the mover total cover from that foe there (map/walls.ts): it can't attack */ blocked: (f: Body, at: Pt) => boolean = () => false): { at: Pt; reactors: Reactor[]; enter?: true } | undefined {
  const from = mover.pt, c0 = cellAt(g, from), c1 = cellAt(g, to), p0 = cellCenter(g, c0), p1 = cellCenter(g, c1);
  const n = cellDistance(g, c0, c1, '5-5-5'), hostile = foes.filter((f) => f.side !== mover.side && canReact(f) && sees(f, mover));
  const sentinel = (f: Body) => !disengaged || f.features.includes('Sentinel');
  const eligible = hostile.filter((f) => sentinel(f) && !asked(f, 'leave') && oaOptions(f).length);
  const at = (i: number): Pt => { const p = cellCenter(g, cellAt(g, { x: p0.x + ((p1.x - p0.x) * i) / n, y: p0.y + ((p1.y - p0.y) * i) / n })); return { x: from.x + p.x - p0.x, y: from.y + p.y - p0.y }; };
  const within = (f: Body, p: Pt, feet: number) => tokenFeet(g, { ...mover.pt, ...p }, f.pt, diagonal) <= feet;
  // Polearm Master's is an Opportunity Attack: a Disengage stops it, unless Sentinel
  const entering = enter ? hostile.filter((f) => !asked(f, 'enter')).map((f) => ({ f, list: enter(f).filter((e) => e.option.key !== 'Polearm Master' || sentinel(f)) })).filter((e) => e.list.length) : [];
  for (let i = 1, prev: Pt = { x: from.x, y: from.y }; i <= n; prev = at(i), i++) {
    const cur = at(i), left = eligible.filter((f) => within(f, prev, f.reach) && !within(f, cur, f.reach) && !blocked(f, prev));
    if (left.length) return { at: prev, reactors: left.flatMap((f) => reactor(f, oaOptions(f))) };
    const came = entering.flatMap(({ f, list }) => reactor(f, blocked(f, cur) ? [] : list.filter((e) => !within(f, prev, e.feet) && within(f, cur, e.feet)).map((e) => e.option)));
    if (came.length) return { at: cur, reactors: came, enter: true };
  }
  return undefined;
}

/** Creatures within 60 ft that see the caster and can cast Counterspell: one option per free slot of 3rd level or higher. */
export function counterReactors(g: Grid, diagonal: Diagonal, caster: Body, others: Body[]): Reactor[] {
  return others.filter((o) => o.x.id !== caster.x.id && canReact(o) && sees(o, caster) && reaction(o, 'counterspell') && tokenFeet(g, o.pt, caster.pt, diagonal) <= 60)
    .flatMap((o) => reactor(o, slotsFrom(o, 3).map((slot): ReactOption => ({ id: 'counterspell', label: `Counterspell ${slot}`, slot }))));
}

/** Reactions to being hit by `attacker`: Shield, Uncanny Dodge (a PC that sees it), a monster's AC reaction (Parry, seeing it). */
export function hitReactors(target: Body, attacker: Body, o: { melee: boolean }): Reactor[] {
  if (!canReact(target)) return [];
  const out: ReactOption[] = [];
  if (reaction(target, 'shield') && slotsFrom(target, 1).length) out.push({ id: 'shield', label: 'Shield' });
  if (target.pc && target.features.includes('Uncanny Dodge') && sees(target, attacker)) out.push({ id: 'uncanny', label: 'Uncanny Dodge' });
  for (const a of target.actions) {
    const p = a.cost === 'reaction' && a.text ? acReaction({ name: a.name, text: richToPlain(a.text) }) : undefined;
    if (p && (o.melee || !p.melee) && sees(target, attacker)) out.push({ id: 'parry', label: `${a.name} (+${p.bonus} AC)`, bonus: p.bonus });
  }
  return reactor(target, out);
}

/** Hellish Rebuke: the victim of damage, still up, sees the source within 60 ft; one option per free slot. */
export function rebukeReactors(g: Grid, diagonal: Diagonal, victim: Body, source: Body): Reactor[] {
  if (!canReact(victim) || !sees(victim, source) || tokenFeet(g, victim.pt, source.pt, diagonal) > 60 || !reaction(victim, 'hellish rebuke')) return [];
  return reactor(victim, slotsFrom(victim, 1).map((slot): ReactOption => ({ id: 'rebuke', label: `Hellish Rebuke ${slot}`, slot })));
}

/** A spell of 3rd level or lower is countered; higher needs a slot at least its level, or an ability check of 10 + its level. */
export const countered = (spellLevel: number, slot: number, checkTotal?: number): boolean =>
  spellLevel <= 3 || slot >= spellLevel || (checkTotal !== undefined && checkTotal >= 10 + spellLevel);

/** A hit judged again against AC + `bonus` (Shield, Parry): a natural 20 still hits. A miss drops what only a hit brings; `missHalf`: the spell does half damage on a miss. */
export function rejudge(o: Outcome, bonus: number, missHalf?: boolean): Outcome {
  if (o.ac === undefined) return o;
  const ac = o.ac + bonus;
  if (!(o.hit && o.nat !== 20 && o.roll !== undefined && o.roll < ac)) return { ...o, ac };
  return { ...missOf(o, missHalf), ac };
}

/** The attack misses after all: it drops what only a hit brings (Illusory Self, Armor of Hexes). */
export function missOf(o: Outcome, missHalf?: boolean): Outcome {
  const { later, inflict, choose, leap, ...rest } = o;
  return { ...rest, hit: false, damage: missHalf ? Math.floor(o.damage / 2) : 0 };
}

/** Its attack roll lowered by `n` and judged again (Cutting Words, Bend Luck): a natural 20 still hits. */
export const lowered = (o: Outcome, n: number, missHalf?: boolean): Outcome => (o.roll === undefined ? o : rejudge({ ...o, roll: o.roll - n }, 0, missHalf));

/**
 * Disadvantage imposed once the attack is rolled (the reactor never saw it): a second d20, the lower kept, judged again. Already at
 * disadvantage: no change; at advantage: they cancel, its first die stands (a straight roll). A result without its natural die (an older
 * one) is left as it was. ponytail: a critical hit that drops to a plain hit keeps its doubled dice.
 */
export function disadvantaged(o: Outcome, d20: number, missHalf?: boolean): Outcome {
  if (o.two?.mode === 'dis') return o;
  if (o.two?.mode === 'adv') d20 = o.two.first;
  if (o.die === undefined || o.roll === undefined || o.ac === undefined || d20 >= o.die) return o;
  const { nat: _, ...rest } = o, roll = o.roll - o.die + d20, nat = d20 === 20 ? 20 as const : d20 === 1 ? 1 as const : undefined;
  const after: Outcome = { ...rest, roll, die: d20, ...(nat && { nat }) };
  return o.hit && !(nat === 20 || (nat !== 1 && roll >= o.ac)) ? missOf(after, missHalf) : after;
}

/** Uncanny Dodge: half the damage, rounded down (a later hit and Chaos Bolt picks too). */
export const halved = (o: Outcome): Outcome => ({ ...o, damage: Math.floor(o.damage / 2),
  ...(o.later !== undefined && { later: Math.floor(o.later / 2) }), ...(o.choose && { choose: o.choose.map((c) => ({ ...c, damage: Math.floor(c.damage / 2) })) }) });

/** A monster reaction trait that adds to its AC ("The knight adds 2 to its AC against one melee attack that would hit it"). */
export function acReaction(t: { name: string; text: string }): { bonus: number; melee: boolean } | undefined {
  const m = /adds? (\d+) to (?:its|his|her|their) AC/i.exec(t.text);
  return m ? { bonus: +m[1], melee: /\bmelee\b/i.test(t.text) } : undefined;
}
