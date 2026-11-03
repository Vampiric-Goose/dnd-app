// Pure (no Svelte/Vite/DOM): who may react to a trigger (Opportunity Attack, Counterspell, Shield / Uncanny Dodge / Parry, Hellish
// Rebuke) and the maths of the reaction. Callers build a Body per creature from the live fight; nothing here reads the fight.
import { richToPlain } from '../content/richtext.ts';
import { cellAt, cellCenter, cellDistance, tokenFeet, type Pt } from '../map/grid.ts';
import type { Combatant, Grid, Outcome, Size } from '../types.ts';
import { BLOCKING } from './economy.ts';
import type { TurnAction } from './turnActions.ts';

type Diagonal = '5-5-5' | '5-10-5';
export type ReactKind = 'opportunity' | 'counterspell' | 'hit' | 'rebuke';
export interface ReactOption { id: 'oa' | 'counterspell' | 'shield' | 'uncanny' | 'parry' | 'rebuke'; label: string; slot?: number; bonus?: number }
export interface Reactor { id: string /* combatant */; name: string; options: ReactOption[] }
/** One creature as the rules see it: `conditions` are all of them (a PC's too), `slots` the free slot levels ascending, `reach` its melee reach in feet. */
export interface Body { x: Combatant; pt: Pt & { size: Size }; conditions: readonly string[]; actions: TurnAction[]; features: readonly string[]; slots: number[]; reach: number; pc: boolean; name: string }

const has = (b: Body, c: string) => b.conditions.some((n) => n.toLowerCase() === c);
/** The viewer sees the subject: the subject isn't Invisible and the viewer isn't Blinded. */
const sees = (viewer: Body, subject: Body) => !has(subject, 'invisible') && !has(viewer, 'blinded');
export const canReact = (b: Body): boolean => !b.x.reactionUsed && b.x.hp !== 0 && !b.conditions.some((c) => BLOCKING.includes(c.toLowerCase()));
const reaction = (b: Body, name: string) => b.actions.some((a) => a.cost === 'reaction' && a.name.toLowerCase() === name);
const slotsFrom = (b: Body, min: number) => b.slots.filter((s) => s >= min);
const reactor = (b: Body, options: ReactOption[]): Reactor[] => (options.length ? [{ id: b.x.id, name: b.name, options }] : []);
const MELEE = /melee (?:or ranged )?weapon attack/i;

/** The Opportunity Attack a creature would make: a PC's own weapon, a monster's first melee attack. */
function oaOption(b: Body): ReactOption | undefined {
  if (b.pc) { const a = b.actions.find((z) => z.id === 'react:opportunity'); return a && { id: 'oa', label: `Attack (${a.attack?.name ?? 'Attack'})` }; }
  const a = b.actions.find((z) => z.group === 'monster' && z.cost === 'action' && z.text && MELEE.test(richToPlain(z.text)));
  return a && { id: 'oa', label: `Attack (${a.name})` };
}

/**
 * Walks the straight line from the mover to `to`, cell by cell (the token keeps its offset in its cell). Stops at the first cell where
 * a hostile foe that can react and sees the mover is left behind out of its reach: `at` is the last cell inside that reach. Nothing
 * after a Disengage. The caller drops foes already asked before stepping on from `at` (else the same foe is returned again).
 */
export function leaveStep(g: Grid, diagonal: Diagonal, mover: Body, foes: Body[], to: Pt, disengaged: boolean): { at: Pt; reactors: Reactor[] } | undefined {
  if (disengaged) return undefined;
  const from = mover.pt, c0 = cellAt(g, from), c1 = cellAt(g, to), p0 = cellCenter(g, c0), p1 = cellCenter(g, c1);
  const n = cellDistance(g, c0, c1, '5-5-5'), eligible = foes.filter((f) => f.pc !== mover.pc && canReact(f) && sees(f, mover) && oaOption(f));
  const at = (i: number): Pt => { const p = cellCenter(g, cellAt(g, { x: p0.x + ((p1.x - p0.x) * i) / n, y: p0.y + ((p1.y - p0.y) * i) / n })); return { x: from.x + p.x - p0.x, y: from.y + p.y - p0.y }; };
  const inReach = (f: Body, p: Pt) => tokenFeet(g, { ...mover.pt, ...p }, f.pt, diagonal) <= f.reach;
  for (let i = 1, prev: Pt = { x: from.x, y: from.y }; i <= n; prev = at(i), i++) {
    const cur = at(i), left = eligible.filter((f) => inReach(f, prev) && !inReach(f, cur));
    if (left.length) return { at: prev, reactors: left.flatMap((f) => reactor(f, [oaOption(f)!])) };
  }
  return undefined;
}

/** Creatures within 60 ft that can cast Counterspell: one option per free slot of 3rd level or higher. */
export function counterReactors(g: Grid, diagonal: Diagonal, caster: Body, others: Body[]): Reactor[] {
  return others.filter((o) => o.x.id !== caster.x.id && canReact(o) && reaction(o, 'counterspell') && tokenFeet(g, o.pt, caster.pt, diagonal) <= 60)
    .flatMap((o) => reactor(o, slotsFrom(o, 3).map((slot): ReactOption => ({ id: 'counterspell', label: `Counterspell ${slot}`, slot }))));
}

/** Reactions to being hit by `attacker`: Shield, Uncanny Dodge (a PC that sees it), a monster's AC reaction (Parry). */
export function hitReactors(target: Body, attacker: Body, o: { melee: boolean }): Reactor[] {
  if (!canReact(target)) return [];
  const out: ReactOption[] = [];
  if (reaction(target, 'shield') && slotsFrom(target, 1).length) out.push({ id: 'shield', label: 'Shield' });
  if (target.pc && target.features.includes('Uncanny Dodge') && sees(target, attacker)) out.push({ id: 'uncanny', label: 'Uncanny Dodge' });
  for (const a of target.actions) {
    const p = a.cost === 'reaction' && a.text ? acReaction({ name: a.name, text: richToPlain(a.text) }) : undefined;
    if (p && (o.melee || !p.melee)) out.push({ id: 'parry', label: `${a.name} (+${p.bonus} AC)`, bonus: p.bonus });
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
  const { later, inflict, choose, leap, ...rest } = o;
  return { ...rest, hit: false, damage: missHalf ? Math.floor(o.damage / 2) : 0, ac };
}

/** Uncanny Dodge: half the damage, rounded down (a later hit and Chaos Bolt picks too). */
export const halved = (o: Outcome): Outcome => ({ ...o, damage: Math.floor(o.damage / 2),
  ...(o.later !== undefined && { later: Math.floor(o.later / 2) }), ...(o.choose && { choose: o.choose.map((c) => ({ ...c, damage: Math.floor(c.damage / 2) })) }) });

/** A monster reaction trait that adds to its AC ("The knight adds 2 to its AC against one melee attack that would hit it"). */
export function acReaction(t: { name: string; text: string }): { bonus: number; melee: boolean } | undefined {
  const m = /adds? (\d+) to (?:its|his|her|their) AC/i.exec(t.text);
  return m ? { bonus: +m[1], melee: /\bmelee\b/i.test(t.text) } : undefined;
}
