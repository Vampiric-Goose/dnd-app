// The DM device's reaction flow: a move or a cast waits for the stack (reactionStack), each answer is paid for and worked out like any
// other use, and hits and damage open their own asks. Off (no fight, targeting off, or reactions off): exactly the old paths.
import { featureList } from '../character/play.ts';
import { db } from '../db.ts';
import type { Pt } from '../map/grid.ts';
import { moveTokens } from '../map/scene.ts';
import { editScene } from '../map/store.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { CampaignSettings, Character, Combat, Combatant, MonsterDef, Outcome, Resolution, Scene, Sheet, Snap, SpellDef, Token } from '../types.ts';
import { uid } from '../uid.ts';
import { aimPlan, foeWithin5, judge, noteEntries, snapOf, touched, workOut, type Aim, type AimPlan, type Aimed } from './aiming.ts';
import { currentRun } from './combat.ts';
import { BLOCKING } from './economy.ts';
import { budgetApplies, combatantForToken, recordMove } from './movement.ts';
import { ask, type Answer } from './reactionStack.svelte.ts';
import { counterReactors, countered, halved, hitReactors, leaveStep, oaAction, rebukeReactors, rejudge, type Body } from './reactions.ts';
import { targetOf } from './resolve.ts';
import { readSpell } from './spellText.ts';
import { applyResolution, editCharacter, setCondition, settleSave, updateCombat } from './store.ts';
import { reachOf, targetingOn, type Pickable } from './targeting.ts';
import { applyUse, attacksPerAction, monsterActions, payment, pcActions, problemOf, slotsLeft, spendOn, type TurnAction } from './turnActions.ts';

export interface FlowCtx {
  cid: string; settings: CampaignSettings; scene: () => Promise<Scene | undefined>; monster: (id: string) => MonsterDef | undefined;
  /** A spell by name (monsterActions asks with the stat block's lower-case names). */ spell: (name: string) => SpellDef | undefined;
  rng?: () => number;
  /** Rolls a monster's or a DM-controlled PC's reaction on this device (ui/map/aimRoll.ts); a player's answer brings its own dice. */
  rollAim?: (name: string, plan: AimPlan, judged?: Pickable) => { rolled: Aim['rolled'] };
  /** A Counterspell check's d20 when the answer brings none. */ d20?: () => number;
  /** An answer that could not be paid or worked out: it counts as a pass, and the reactor's player is told why. */
  onRefused?: (reactor: string, why: string) => void;
}

/** A Body with what paying needs: a PC's character and sheet, the attacks one Attack action allows. */
type Live = Body & { ch?: Character; sheet?: Sheet; per: number };
interface World { k: Combat; s: Scene; chars: Character[]; bs: Map<string, Live> }

const on = (k: Combat, settings: CampaignSettings) => k.round >= 1 && targetingOn(settings) && settings.reactions !== false;
const roll20 = (ctx: FlowCtx) => ctx.d20?.() ?? 1 + Math.floor((ctx.rng ?? Math.random)() * 20);
const reactionNamed = (b: Body, name: string) => b.actions.find((a) => a.cost === 'reaction' && a.name.toLowerCase() === name);
/** A reaction with no action of its own (Uncanny Dodge, Parry): its pip only. */
const pip = (name: string): TurnAction => ({ id: `react:${name}`, name, cost: 'reaction', group: 'feature' });

function bodyOf(ctx: FlowCtx, x: Combatant, t: Token, chars: Character[]): Live | undefined {
  const pt = { x: t.x, y: t.y, size: t.size }, ch = x.characterId ? chars.find((c) => c.id === x.characterId) : undefined;
  if (ch) {
    const sheet = computeSheet(ch, { settings: ctx.settings, viewer: 'dm' }), features = featureList(ch, ctx.settings), actions = pcActions(ch, sheet, features);
    const reach = oaAction({ pc: true, actions })?.attack?.properties.includes('reach') ? 10 : 5;
    return { x: { ...x, hp: ch.state.hp }, pt, conditions: ch.state.conditions, actions, features: features.map((f) => f.name),
      slots: slotsLeft(sheet, ch).flatMap((n, i) => (n > 0 ? [i + 1] : [])), reach, pc: true, name: ch.name, ch, sheet, per: attacksPerAction(features) };
  }
  if (x.kind !== 'monster') return undefined;
  const m = x.monsterId ? ctx.monster(x.monsterId) : undefined, actions = m ? monsterActions(m, { spell: ctx.spell, used: x.spellsUsed }) : [];
  const oa = oaAction({ pc: false, actions }), r = oa && reachOf(oa);
  const slots = [...new Set(actions.flatMap((a) => (a.spend?.startsWith('slot:') && a.uses && a.uses.left > 0 ? [+a.spend.slice(5)] : [])))].sort((a, b) => a - b);
  return { x, pt, conditions: x.conditions ?? [], actions, features: m?.traits.map((f) => f.name) ?? [], slots, reach: (r !== 'self' && r?.melee) || 5, pc: false, name: x.name, per: 1 };
}

async function world(ctx: FlowCtx): Promise<World | undefined> {
  const [k, s, chars] = await Promise.all([db.combat.get(ctx.cid), ctx.scene(), db.characters.list(ctx.cid)]);
  if (!k || !s) return undefined;
  const bs = new Map<string, Live>();
  for (const t of s.tokens) {
    const x = combatantForToken(k, t), b = x && !bs.has(x.id) ? bodyOf(ctx, x, t, chars) : undefined;
    if (b) bs.set(b.x.id, b);
  }
  return { k, s, chars, bs };
}

/** Every combatant with a token on the scene. */
export const bodies = async (ctx: FlowCtx): Promise<Map<string, Body>> => (await world(ctx))?.bs ?? new Map();

/** Pays a reaction on the fresh fight (its pip, a slot: `slot` or the lowest free); why not, or undefined. */
async function pay(ctx: FlowCtx, b: Live, a: TurnAction, slot?: number): Promise<string | undefined> {
  let level: number | undefined, pact: true | undefined;
  if (b.ch && b.sheet) { const p = payment(a, b.sheet, b.ch, slot); if (p.problem) return p.problem; ({ level, pact } = p); }
  if (!b.ch && slot !== undefined && a.spend) { // a monster's spell at a higher slot spends that slot's uses
    const at = b.actions.find((z) => z.spend === `slot:${slot}`);
    if (!at) return `no level ${slot} slot left`;
    a = { ...a, spend: at.spend, uses: at.uses };
  }
  const r: TurnAction = { ...a, cost: 'reaction' }; // a monster's Opportunity Attack is its melee action, taken as its reaction
  let why: string | undefined = 'not in the fight';
  await updateCombat(ctx.cid, (k) => {
    const y = k.combatants.find((z) => z.id === b.x.id);
    why = y ? problemOf(y, r, b.conditions, currentRun(k).has(y.id), b.per) : 'not in the fight';
    return y && !why ? applyUse(k, y, r, b.per, undefined, level) : k;
  });
  if (!why && b.ch && level !== undefined) await editCharacter(b.ch.id, (c) => spendOn(c, level, undefined, pact));
  return why;
}

const refused = (ctx: FlowCtx, id: string, why: string) => { ctx.onRefused?.(id, why); };

/** A reaction's aimed use worked out against `target` (the flow picks it: an answer's own target is ignored), with the answer's dice or this device's. */
async function aimed(ctx: FlowCtx, w: World, b: Live, a: TurnAction, target: string, ans: Answer, level?: number): Promise<Aimed | string> {
  const plan = aimPlan(a, { level, features: [...b.features] }), z = w.k.combatants.find((y) => y.id === target), d = ctx.settings.diagonal;
  const tokenOf = (id: string) => w.s.tokens.find((t) => combatantForToken(w.k, t)?.id === id), me = tokenOf(b.x.id), tt = tokenOf(target);
  const cond = (y: Combatant) => w.bs.get(y.id)?.conditions ?? y.conditions ?? [];
  if (!plan || !z) return 'that cannot be aimed';
  const judged = me && tt ? judge(plan, w.s.grid, d, me, foeWithin5(w.k, w.s, b.x, d, cond), tt, { attacker: b.conditions, target: cond(z), dodging: !!z.economy?.dodging }) : undefined;
  const rolled = ans.aim?.rolled ?? ctx.rollAim?.(a.name, plan, judged).rolled;
  if (!rolled) return 'no dice';
  const chOf = (y: Combatant) => (y.characterId ? w.chars.find((c) => c.id === y.characterId) : undefined);
  return workOut({ a, level, features: [...b.features], actor: b.x, combat: w.k, scene: w.s, diagonal: d, aim: { target, rolled, toggles: [] },
    findTarget: (id) => w.k.combatants.find((y) => y.id === id), conditionsOf: cond, exhaustionOf: (y) => chOf(y)?.state.exhaustion ?? 0,
    info: (y) => { const c = chOf(y); return c ? targetOf(y, { sheet: w.bs.get(y.id)?.sheet ?? computeSheet(c, { settings: ctx.settings, viewer: 'dm' }), hp: c.state.hp, conditions: c.state.conditions })
      : targetOf(y, { monster: y.monsterId ? ctx.monster(y.monsterId) : undefined }); },
    nameOf: (y) => w.bs.get(y.id)?.name ?? y.name, magical: !!b.ch?.inventory.find((e) => e.id === a.attack?.entryId)?.item.magic,
    id: uid(), now: Date.now(), rng: ctx.rng ?? Math.random });
}

/** Works out, pays and lands a reaction's aimed use (an Opportunity Attack, Hellish Rebuke after its own Counterspell asks); the landed result. */
async function strike(ctx: FlowCtx, ans: Answer, target: string, pick: (b: Live) => TurnAction | undefined, o: { melee?: boolean; cast?: boolean } = {}) {
  const w = await world(ctx), b = w?.bs.get(ans.reactor), a = b && pick(b);
  if (!w || !b || !a) return undefined;
  const r = await aimed(ctx, w, b, a, target, ans, ans.slot), why = typeof r === 'string' ? r : await pay(ctx, b, a, ans.slot);
  if (why || typeof r === 'string') { refused(ctx, b.x.id, why ?? 'not done'); return undefined; }
  if (o.cast && !(await guardCast(ctx, b.x.id, { name: a.name, level: ans.slot ?? a.spell?.level ?? 1 }))) return undefined;
  return { b, landed: await land(ctx, r.resolution, snapOf(w.k, w.chars, touched(r.resolution)), { melee: o.melee }) };
}

/** Writes the token's move to `to` as a plain move does (the turn's origin, entering a lasting area); where it ended. */
async function step(ctx: FlowCtx, s: Scene, tokenId: string, to: Pt): Promise<Pt> {
  let walked: { t: Token; from: Pt }[] = [], after: Scene | undefined;
  await editScene(s.id, (y) => {
    const out = (after = moveTokens(y, [tokenId], tokenId, to));
    walked = out.tokens.flatMap((t) => { const o = y.tokens.find((z) => z.id === t.id); return o && (o.x !== t.x || o.y !== t.y) ? [{ t, from: { x: o.x, y: o.y } }] : []; });
    return out;
  });
  if (walked.length && (await db.combat.get(ctx.cid))) await updateCombat(ctx.cid, (c) => {
    if (budgetApplies(c, ctx.settings)) { const now = currentRun(c); for (const { t, from } of walked) { const x = combatantForToken(c, t); if (x && now.has(x.id)) c = recordMove(c, x.id, from); } }
    return after ? noteEntries(c, after, walked) : c;
  });
  const t = after?.tokens.find((z) => z.id === tokenId) ?? s.tokens.find((z) => z.id === tokenId);
  return t ? { x: t.x, y: t.y } : to;
}

const STOP = [...BLOCKING, 'grappled'], walking = new Set<string>();
/** The whole move of the current-turn mover's token: step by step to `to`, asking at each reach edge; returns where it ended. A token already
 *  walking (waiting on an ask) does not start a second walk: it stays where it is. */
export async function guardMove(ctx: FlowCtx, tokenId: string, to: Pt): Promise<Pt> {
  if (walking.has(tokenId)) { const t = (await ctx.scene())?.tokens.find((z) => z.id === tokenId); return t ? { x: t.x, y: t.y } : to; }
  walking.add(tokenId);
  try { return await walk(ctx, tokenId, to); } finally { walking.delete(tokenId); }
}
async function walk(ctx: FlowCtx, tokenId: string, to: Pt): Promise<Pt> {
  const asked = new Set<string>(); // foes asked already (answered, passed or timed out): never asked again on this move
  for (;;) {
    const w = await world(ctx), t = w?.s.tokens.find((z) => z.id === tokenId), x = w && t && combatantForToken(w.k, t), me = x && w.bs.get(x.id);
    if (!w || !t) { const s = w?.s ?? await ctx.scene(); return s ? step(ctx, s, tokenId, to) : to; } // no fight: a plain move
    if (me && asked.size && !currentRun(w.k).has(me.x.id)) return { x: t.x, y: t.y }; // its turn ended during an ask: it stays
    if (!me || !on(w.k, ctx.settings) || !currentRun(w.k).has(me.x.id)) return step(ctx, w.s, tokenId, to);
    if (me.x.hp === 0 || me.conditions.some((c) => STOP.includes(c.toLowerCase())) || w.k.movement?.[me.x.id]?.mult === 0) return { x: t.x, y: t.y };
    const foes = [...w.bs.values()].filter((b) => b !== me && !asked.has(b.x.id));
    const edge = leaveStep(w.s.grid, ctx.settings.diagonal, me, foes, to, !!me.x.economy?.disengaging);
    if (!edge) return step(ctx, w.s, tokenId, to);
    await step(ctx, w.s, tokenId, edge.at);
    edge.reactors.forEach((r) => asked.add(r.id));
    const answers = await ask({ id: uid(), kind: 'opportunity', trigger: `${me.name} leaves the reach of ${edge.reactors.map((r) => r.name).join(', ')}`,
      playerTrigger: `${me.name} leaves your reach`, reactors: edge.reactors, waiting: me.x.id });
    for (const ans of answers) {
      const hit = await strike(ctx, ans, me.x.id, oaAction, { melee: true });
      if (hit?.b.features.includes('Sentinel') && hit.landed.outcomes.some((o) => o.hit)) { // Sentinel: its speed is 0 for the turn
        await updateCombat(ctx.cid, (k) => ({ ...k, movement: { ...k.movement, [me.x.id]: { dashes: 0, ...k.movement?.[me.x.id], mult: 0 } } }));
      }
    }
  }
}

/** Before a spell's effects: Counterspell asks (nested, so a Counterspell can be countered). true: it goes ahead. Its cost is already paid. */
export async function guardCast(ctx: FlowCtx, casterId: string, spell: { name: string; level: number }): Promise<boolean> {
  const w = await world(ctx), c = w?.bs.get(casterId);
  if (!w || !c || !on(w.k, ctx.settings)) return true;
  const reactors = counterReactors(w.s.grid, ctx.settings.diagonal, c, [...w.bs.values()]);
  const answers = await ask({ id: uid(), kind: 'counterspell', trigger: `${c.name} casts ${spell.name} (level ${spell.level})`,
    playerTrigger: c.pc ? `${c.name} casts ${spell.name}` : `${c.name} casts a spell`, reactors, waiting: casterId }); // a monster's spell stays hidden
  for (const ans of answers) {
    const b = (await world(ctx))?.bs.get(ans.reactor), a = b && reactionNamed(b, 'counterspell'), slot = ans.slot ?? 3;
    if (!b || !a) continue;
    const why = await pay(ctx, b, a, slot);
    if (why) { refused(ctx, b.x.id, why); continue; }
    if (!(await guardCast(ctx, b.x.id, { name: a.name, level: slot }))) continue;
    // the check: d20 + its spellcasting modifier (ponytail: a stat block that names no spellcasting ability checks at +0, monsterActions' `mod`)
    const check = spell.level > 3 && slot < spell.level ? (ans.d20 ?? roll20(ctx)) + (a.cast?.mod ?? 0) : undefined;
    if (countered(spell.level, slot, check)) return false; // ponytail: the first that counters ends it; the rest pay nothing
  }
  return true;
}

/** applyResolution with the reactions around it: hit asks on each hit outcome before, Hellish Rebuke asks after. `melee`: a melee attack (Parry). */
export async function land(ctx: FlowCtx, res: Omit<Resolution, 'applied'>, before?: Snap, opts: { melee?: boolean } = {}): Promise<Omit<Resolution, 'applied'>> {
  const w = await world(ctx), src = w?.bs.get(res.actor);
  if (!w || !on(w.k, ctx.settings)) { await applyResolution(ctx.cid, res, ctx.settings, before); return res; }
  const mm = res.action === 'Magic Missile', shielded = new Set<string>(), asked = new Set<string>(), outcomes: Outcome[] = [];
  const missHalf = readSpell(ctx.spell(res.action.toLowerCase()) ?? { text: [], level: 0, range: '' })?.missHalf; // Acid Arrow: Shield leaves half on the miss
  const blocked = (o: Outcome) => (mm ? { ...o, damage: 0, note: 'Shield' } : rejudge(o, 5, missHalf)); // each dart is a hit Shield stops
  for (let o of res.outcomes) {
    if (shielded.has(o.id)) o = blocked(o);
    else if (src && o.hit && o.id !== src.x.id && (o.roll !== undefined || mm) && !asked.has(o.id)) {
      asked.add(o.id); // ponytail: asked once per result (Scorching Ray's later rays don't ask again)
      const b = (await world(ctx))?.bs.get(o.id), all = b ? hitReactors(b, src, { melee: !!opts.melee }) : [];
      const reactors = mm ? all.map((r) => ({ ...r, options: r.options.filter((z) => z.id === 'shield') })).filter((r) => r.options.length) : all; // darts are not attacks: Shield only
      const answers = !b ? [] : await ask({ id: uid(), kind: 'hit', trigger: `${src.name} hits ${b.name} (${mm ? 'Magic Missile' : `${o.roll} vs AC ${o.ac}`})`,
        playerTrigger: mm ? `${src.name} hits you with ${src.pc ? 'Magic Missile' : 'a spell'}` : `${src.name} hits you (${o.roll})`, reactors, waiting: src.x.id });
      for (const ans of answers) {
        const opt = reactors[0]?.options.find((z) => z.id === ans.option), a = ans.option === 'shield' ? b && reactionNamed(b, 'shield') : pip(opt?.label ?? ans.option);
        const why = b && a ? await pay(ctx, b, a, ans.option === 'shield' ? ans.slot ?? b.slots[0] : undefined) : 'not available';
        if (why) { refused(ctx, ans.reactor, why); continue; }
        if (ans.option === 'shield') { await setCondition(ctx.cid, o.id, 'Shield', true, { rounds: 1, at: 'start', of: o.id }); shielded.add(o.id); o = blocked(o); }
        if (ans.option === 'parry') o = rejudge(o, opt?.bonus ?? 0, missHalf);
        if (ans.option === 'uncanny') o = halved(o);
      }
    }
    outcomes.push(o);
  }
  const out = { ...res, outcomes };
  await applyResolution(ctx.cid, out, ctx.settings, before);
  await rebukes(ctx, res.actor, outcomes.filter((o) => o.damage > 0 && !o.pending).map((o) => o.id));
  return out;
}

/** Hellish Rebuke asks: each of `victims` (once) against `actor`, who just hurt them. */
async function rebukes(ctx: FlowCtx, actor: string, victims: string[]): Promise<void> {
  for (const id of new Set(victims)) {
    const w = await world(ctx), v = w?.bs.get(id), s = w?.bs.get(actor);
    if (!w || !v || !s || v === s || !on(w.k, ctx.settings)) continue;
    const answers = await ask({ id: uid(), kind: 'rebuke', trigger: `${s.name} hurts ${v.name}`, playerTrigger: `${s.name} hurts you`,
      reactors: rebukeReactors(w.s.grid, ctx.settings.diagonal, v, s), waiting: actor });
    for (const ans of answers) await strike(ctx, ans, actor, (b) => reactionNamed(b, 'hellish rebuke'), { cast: true });
  }
}

/** Damage that landed outside `land` (a PC's settled save): the target's Hellish Rebuke against the result's actor. */
export const afterDamage = (ctx: FlowCtx, res: Pick<Resolution, 'actor' | 'outcomes'>, targetId: string): Promise<void> =>
  rebukes(ctx, res.actor, res.outcomes.filter((o) => o.id === targetId && o.damage > 0 && !o.pending).map((o) => o.id));

/** store.settleSave, then the damage it dealt asks for the PC's Hellish Rebuke (a save already settled asks nothing). */
export async function settle(ctx: FlowCtx, rid: string, target: string, d20: number): Promise<void> {
  const k = await settleSave(ctx.cid, rid, target, d20, ctx.settings), r = k?.resolutions?.find((y) => y.id === rid);
  if (r) await afterDamage(ctx, r, target);
}
