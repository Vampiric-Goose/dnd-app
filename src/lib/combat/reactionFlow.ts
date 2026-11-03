// The DM device's reaction flow: a move or a cast waits for the stack (reactionStack), each answer is paid for and worked out like any
// other use, and hits and damage open their own asks. Off (no fight, targeting off, or reactions off): exactly the old paths.
import { getKind } from '../character/choices.ts';
import { featureList } from '../character/play.ts';
import { richToPlain } from '../content/richtext.ts';
import { rollDice } from '../dice.ts';
import { db } from '../db.ts';
import { snap, type Pt } from '../map/grid.ts';
import { walkTokens } from '../map/scene.ts';
import { editScene } from '../map/store.ts';
import { computeSheet } from '../rules/sheet.ts';
import { playerTokens } from '../sync/scene.ts';
import type { CampaignSettings, Character, Combat, Combatant, MonsterDef, Outcome, Resolution, Scene, Sheet, Snap, SpellDef, Token } from '../types.ts';
import { uid } from '../uid.ts';
import { aimPlan, foeWithin5, judge, noteEntries, snapOf, touched, workOut, type Aim, type AimPlan, type Aimed } from './aiming.ts';
import { currentRun } from './combat.ts';
import { BLOCKING } from './economy.ts';
import { budgetApplies, chargeRoute, combatantForToken, routeFeet } from './movement.ts';
import { ask, type Answer } from './reactionStack.svelte.ts';
import { amount, enterOptions, entry, resourceOf, shapeFor, tableReactors, type Rx, type Trigger } from './reactionTable.ts';
import { counterReactors, countered, disadvantaged, halved, hitReactors, leaveStep, lowered, missOf, oaAction, rebukeReactors, rejudge, type Body, type ReactKind, type Reactor } from './reactions.ts';
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
  /** A d20 rolled on this device, never shown to players (a Counterspell check the answer brings none for, a disadvantage's second die). */ d20?: (label?: string) => number;
  /** A reaction's amount (a Parry's die), rolled on this device. */ dice?: (label: string, expr: string) => number;
  /** An answer that could not be paid or worked out: it counts as a pass, and the reactor's player is told why. */
  onRefused?: (reactor: string, why: string) => void;
}

/** A Body with what paying needs: a PC's character and sheet, the attacks one Attack action allows. */
type Live = Body & { ch?: Character; sheet?: Sheet; per: number };
interface World { k: Combat; s: Scene; chars: Character[]; bs: Map<string, Live> }

const on = (k: Combat, settings: CampaignSettings) => k.round >= 1 && targetingOn(settings) && settings.reactions !== false;
const roll20 = (ctx: FlowCtx, label?: string) => ctx.d20?.(label) ?? 1 + Math.floor((ctx.rng ?? Math.random)() * 20);
const rollAmt = (ctx: FlowCtx, label: string, expr: string) => ctx.dice?.(label, expr) ?? rollDice(expr, { rng: ctx.rng }).total;
const reactionNamed = (b: Body, name: string) => b.actions.find((a) => a.cost === 'reaction' && a.name.toLowerCase() === name);
/** A reaction with no action of its own (Uncanny Dodge, Parry): its pip only. */
const pip = (name: string): TurnAction => ({ id: `react:${name}`, name, cost: 'reaction', group: 'feature' });

/** 'party': a PC, or a summon whose summoner (or its summoner, and so on) is a PC. */
function sideOf(k: Combat, x: Combatant): Body['side'] {
  for (let y: Combatant | undefined = x, n = 0; y && n < 10; n++) {
    if (y.characterId || y.kind === 'pc') return 'party';
    const by: string | undefined = y.summon?.by;
    y = by === undefined ? undefined : k.combatants.find((z) => z.id === by);
  }
  return 'foes';
}

function bodyOf(ctx: FlowCtx, k: Combat, x: Combatant, t: Token, chars: Character[], shown: Set<string> | undefined): Live | undefined {
  const pt = { x: t.x, y: t.y, size: t.size }, ch = x.characterId ? chars.find((c) => c.id === x.characterId) : undefined;
  const hidden = !!x.hidden || (shown ? !shown.has(t.id) : !!t.hidden), side = sideOf(k, x);
  if (ch) { // a player's PC as its player's device sees it (their answer's dice fit that sheet, as a turn panel use's do)
    const sheet = computeSheet(ch, { settings: ctx.settings, viewer: ch.ownerId ? 'player' : 'dm' }), features = featureList(ch, ctx.settings), actions = pcActions(ch, sheet, features);
    const reach = oaAction({ pc: true, actions })?.attack?.properties.includes('reach') ? 10 : 5, levels: Record<string, number> = {};
    for (const { classId } of ch.build.levels) { const n = getKind((k) => ch.embedded[k], classId, 'class')?.name; if (n) levels[n] = (levels[n] ?? 0) + 1; }
    const stats = { prof: sheet.prof, mods: sheet.mods, levels, dc: sheet.spellcasting[0]?.dc, shield: ch.inventory.some((e) => e.equipped && e.item.armor?.category === 'shield'),
      left: Object.fromEntries(sheet.resources.map((r) => [r.name, Math.max(0, r.max - (ch.state.resourcesUsed[r.name] ?? 0))])) };
    return { x: { ...x, hp: ch.state.hp }, pt, conditions: ch.state.conditions, actions, features: features.map((f) => f.name), stats,
      slots: slotsLeft(sheet, ch).flatMap((n, i) => (n > 0 ? [i + 1] : [])), reach, pc: true, side, hidden, name: ch.name, ch, sheet, per: attacksPerAction(features) };
  }
  if (x.kind !== 'monster') return undefined;
  const m = x.monsterId ? ctx.monster(x.monsterId) : undefined, actions = m ? monsterActions(m, { spell: ctx.spell, used: x.spellsUsed }) : [];
  const oa = oaAction({ pc: false, actions }), r = oa && reachOf(oa);
  const slots = [...new Set(actions.flatMap((a) => (a.spend?.startsWith('slot:') && a.uses && a.uses.left > 0 ? [+a.spend.slice(5)] : [])))].sort((a, b) => a - b);
  return { x, pt, conditions: x.conditions ?? [], actions, features: m?.traits.map((f) => f.name) ?? [], slots, reach: (r !== 'self' && r?.melee) || 5, pc: false, side, hidden, name: x.name, per: 1 };
}

async function world(ctx: FlowCtx): Promise<World | undefined> {
  const [k, s, chars] = await Promise.all([db.combat.get(ctx.cid), ctx.scene(), db.characters.list(ctx.cid)]);
  if (!k || !s) return undefined;
  // host #aim's rule: no hidden or fogged token; a scene players aren't shown leaks nothing, so only the DM's own hides count there
  const bs = new Map<string, Live>(), shown = s.shown ? playerTokens(s, chars, k, ctx.settings) : undefined;
  for (const t of s.tokens) {
    const x = combatantForToken(k, t), b = x && !bs.has(x.id) ? bodyOf(ctx, k, x, t, chars, shown) : undefined;
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
    info: (y) => { const c = chOf(y); return c ? targetOf(y, { sheet: computeSheet(c, { settings: ctx.settings, viewer: 'dm' }), hp: c.state.hp, conditions: c.state.conditions })
      : targetOf(y, { monster: y.monsterId ? ctx.monster(y.monsterId) : undefined }); },
    nameOf: (y) => w.bs.get(y.id)?.name ?? y.name, magical: !!b.ch?.inventory.find((e) => e.id === a.attack?.entryId)?.item.magic,
    id: uid(), now: Date.now(), rng: ctx.rng ?? Math.random });
}

/**
 * Works out, pays and lands a reaction's aimed use (an Opportunity Attack, Hellish Rebuke after its own Counterspell asks); the landed result.
 * `pay`: how it is paid instead (a table reaction's own cost, or nothing more); `bonus`: dice added to a hit's damage (Riposte's die).
 */
async function strike(ctx: FlowCtx, ans: Answer, target: string, pick: (b: Live) => TurnAction | undefined,
  o: { melee?: boolean; cast?: boolean; pay?: (b: Live) => Promise<string | undefined>; bonus?: (b: Live) => string } = {}) {
  const w = await world(ctx), b = w?.bs.get(ans.reactor), a = b && pick(b);
  if (!w || !b || !a) return undefined;
  const r = await aimed(ctx, w, b, a, target, ans, ans.slot), why = typeof r === 'string' ? r : await (o.pay ? o.pay(b) : pay(ctx, b, a, ans.slot));
  if (why || typeof r === 'string') { refused(ctx, b.x.id, why ?? 'not done'); return undefined; }
  if (o.cast && !(await guardCast(ctx, b.x.id, { name: a.name, level: ans.slot ?? a.spell?.level ?? 1 }))) return undefined;
  const extra = o.bonus?.(b), res = extra ? { ...r.resolution, outcomes: r.resolution.outcomes.map((z) => (z.hit ? { ...z, damage: z.damage + rollAmt(ctx, `${b.name}: ${a.name}`, extra) } : z)) } : r.resolution;
  return { b, landed: await land(ctx, res, snapOf(w.k, w.chars, touched(r.resolution)), { melee: o.melee }) };
}

// ---- the name table's reactions (reactionTable.ts)
/** One list per reactor: the same creature's options from several sources on one card row. */
const merge = (...lists: Reactor[][]): Reactor[] => {
  const m = new Map<string, Reactor>();
  for (const r of lists.flat()) { const had = m.get(r.id); m.set(r.id, had ? { ...had, options: [...had.options, ...r.options] } : r); }
  return [...m.values()];
};
const DTYPE = /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage/i;
/** The damage type of the use named `action` (its weapon's, its spell's first, a stat block's first named). */
function damageType(b: Body, action: string): string | undefined {
  const a = b.actions.find((z) => z.name === action);
  return a?.attack?.damageType ?? a?.cast?.read.damage[0]?.type ?? (a?.text && DTYPE.exec(richToPlain(a.text))?.[1]?.toLowerCase()) ?? undefined;
}

/** Pays a table reaction: its pip (a spell's action and slot), a slot it spends by level (Song of Defense), its resource uses; why not, or undefined. */
async function payRx(ctx: FlowCtx, b: Live, key: string, slot?: number): Promise<string | undefined> {
  const rx = entry(key);
  if (!rx) return pay(ctx, b, pip(key.replace(/^mon:/, ''))); // a monster's own reaction: its pip
  const a = rx.spell ? reactionNamed(b, key.toLowerCase()) : pip(key);
  if (!a) return 'not available';
  let level: number | undefined, pact: true | undefined;
  if (rx.slots && b.ch && b.sheet) { const p = payment({ ...a, spell: { id: key, level: 1, concentration: false } }, b.sheet, b.ch, slot); if (p.problem) return p.problem; ({ level, pact } = p); }
  const why = await pay(ctx, b, a, rx.spell ? slot : undefined);
  if (why) return why;
  const res = resourceOf(b, key);
  if (b.ch && (res || level !== undefined)) await editCharacter(b.ch.id, (c) => {
    for (let i = 0; i < (res ? rx.count ?? 1 : 1); i++) c = spendOn(c, i ? undefined : level, res, pact);
    return c;
  });
  return undefined;
}

/** A reminder's note on the DM's Results list: the reaction was used, the DM settles it. */
const remind = (ctx: FlowCtx, b: Live, key: string, about: string) => applyResolution(ctx.cid,
  { id: uid(), actor: b.x.id, action: key.replace(/^mon:/, ''), outcomes: [{ id: about, damage: 0, note: 'Used: settle by hand' }], at: Date.now() }, ctx.settings);

/** Damage back as a use the aiming code works out: its dice (or the damage dealt), its type, its save against the reactor's spell DC. */
function backAction(key: string, rx: Rx, b: Body, dealt?: number): TurnAction {
  const save = rx.save && rx.save[0].toUpperCase() + rx.save.slice(1);
  return { id: `react:${key}`, name: key, cost: 'reaction', group: 'feature', spell: { id: `react:${key}`, level: 0, concentration: false },
    cast: { read: { damage: [{ dice: rx.dealt ? String(Math.max(1, dealt ?? 1)) : amount(key, b), type: rx.type ?? '' }], range: { feet: 120 },
      ...(save ? { save, onSave: rx.half ? 'half' as const : 'none' as const } : { auto: { count: 1 } }) }, dc: b.stats?.dc ?? 10, charLevel: 1, mod: 0 } };
}

/** An attack (or damage back) a table reaction brings once the result it answers has landed; `free`: already paid (Glorious Defense). */
type Follow = { ans: Answer; t: Trigger; free?: true };
async function follow(ctx: FlowCtx, f: Follow) {
  const key = f.ans.key!, rx = entry(key);
  if (!rx) return undefined;
  const payIt = f.free ? async () => undefined : (b: Live) => payRx(ctx, b, key, f.ans.slot);
  if (rx.shape === 'back') return strike(ctx, f.ans, f.t.actor.x.id, (b) => backAction(key, rx, b, f.t.damage), { pay: payIt });
  return strike(ctx, f.ans, f.t.actor.x.id, oaAction, { melee: true, pay: payIt, ...(rx.dice && { bonus: (b: Live) => amount(key, b) }) });
}

/** A table answer to an attack before its damage: paid and worked into the outcome (or queued in `later` when it is an attack or damage back). */
async function answerRx(ctx: FlowCtx, ans: Answer, t: Trigger, o: Outcome, missHalf: boolean | undefined, later: Follow[]): Promise<Outcome> {
  const rb = (await world(ctx))?.bs.get(ans.reactor), key = ans.key;
  if (!rb || !key) return o;
  const rx = entry(key), shape = rx ? shapeFor(rx, t) : 'note';
  if (shape === 'attack' || shape === 'back') { later.push({ ans, t }); return o; } // paid as it is worked out
  const why = await payRx(ctx, rb, key, ans.slot);
  if (why) { refused(ctx, rb.x.id, why); return o; }
  if (rx?.spell && !(await guardCast(ctx, rb.x.id, { name: key, level: ans.slot ?? rb.slots[0] ?? 1 }))) return o; // countered: paid, no effect
  const n = () => rollAmt(ctx, `${rb.name}: ${key}`, amount(key, rb, ans.slot));
  switch (shape) {
    case 'dis': return disadvantaged(o, roll20(ctx, `${rb.name}: ${key}`), missHalf);
    case 'ac': {
      const r = rejudge(o, n(), missHalf);
      if (o.hit && !r.hit && rx?.then === 'attack') later.push({ ans, t, free: true });
      return r.hit && rx?.then === 'resist' ? halved(r) : r;
    }
    case 'cut': return { ...o, damage: Math.max(0, o.damage - n()) };
    case 'resist': return halved(o);
    case 'roll': return lowered(o, n(), missHalf);
    case 'miss': return !rx?.chance || rollAmt(ctx, `${rb.name}: ${key}`, '1d6') >= rx.chance ? missOf(o, missHalf) : o;
    default: await remind(ctx, rb, key, (t.target ?? t.actor).x.id); return o;
  }
}

/** A window once a result has landed (after an attack, damage, a death, a save): the table's asks against `actorId` about `targetId`. */
async function askAfter(ctx: FlowCtx, kind: ReactKind, t: Omit<Trigger, 'actor' | 'target'>, actorId: string, targetId: string,
  extra: (w: World, v: Live, s: Live) => Reactor[] = () => []): Promise<void> {
  const w = await world(ctx), v = w?.bs.get(targetId), s = w?.bs.get(actorId);
  if (!w || !v || !s || v === s || !on(w.k, ctx.settings)) return;
  const trig: Trigger = { ...t, actor: s, target: v };
  const reactors = merge(extra(w, v, s), tableReactors(w.s.grid, ctx.settings.diagonal, trig, [...w.bs.values()]));
  if (!reactors.length) return;
  const who = s.hidden ? 'Something' : s.name, you = reactors.every((r) => r.id === v.x.id), them = you ? 'you' : v.hidden ? 'something' : v.name;
  const [dm, pl] = kind === 'after' ? [`${s.name} attacks ${v.name}`, `${who} attacks ${them}`]
    : kind === 'died' ? [`${v.name} drops`, `${v.hidden ? 'Something' : v.name} drops`]
    : kind === 'saved' ? [`${v.name} ${t.ok ? 'succeeds on' : 'fails'} a save against ${s.name}`, `${you ? 'You' : them} ${t.ok ? (you ? 'succeed on' : 'succeeds on') : you ? 'fail' : 'fails'} a save against ${who}`]
    : [`${s.name} hurts ${v.name}`, `${who} hurts ${them}`];
  const answers = await ask({ id: uid(), kind, trigger: dm, playerTrigger: pl, reactors, waiting: actorId });
  for (const ans of answers) {
    if (ans.option === 'rebuke') { await strike(ctx, ans, actorId, (b) => reactionNamed(b, 'hellish rebuke'), { cast: true }); continue; }
    const rb = (await world(ctx))?.bs.get(ans.reactor), key = ans.key, rx = key ? entry(key) : undefined;
    if (!rb || !key) continue;
    const shape = rx ? shapeFor(rx, trig) : 'note';
    if (shape === 'attack' || shape === 'back') { await follow(ctx, { ans, t: trig }); continue; }
    const why = await payRx(ctx, rb, key, ans.slot);
    if (why) refused(ctx, rb.x.id, why); else await remind(ctx, rb, key, targetId);
  }
}

/** Walks the token along `squares` (one square apart, from where it stands) in one scene write, with them as its trail; on the current-turn
 *  mover's turn under a budget their feet are charged; entering a lasting area is noted. Where it ended. */
async function step(ctx: FlowCtx, s: Scene, tokenId: string, squares: Pt[]): Promise<Pt> {
  let from: Pt | undefined, after: Scene | undefined;
  await editScene(s.id, (y) => {
    const t = y.tokens.find((z) => z.id === tokenId), out = walkTokens(y, [tokenId], tokenId, squares);
    if (t && out !== y) { from = { x: t.x, y: t.y }; after = out; }
    return out;
  });
  const t = after?.tokens.find((z) => z.id === tokenId);
  if (t && from && (await db.combat.get(ctx.cid))) await updateCombat(ctx.cid, (c) => {
    const x = combatantForToken(c, t), g = after!.grid, d = ctx.settings.diagonal;
    if (x && budgetApplies(c, ctx.settings) && currentRun(c).has(x.id)) {
      c = chargeRoute(c, x.id, from!, routeFeet(g, snap(g, from!, t.size), squares, d, c.movement?.[x.id]?.diags ?? 0), g, d);
    }
    return noteEntries(c, after!, [{ t, from: from! }]);
  });
  const now = t ?? s.tokens.find((z) => z.id === tokenId);
  return now ? { x: now.x, y: now.y } : squares.at(-1) ?? { x: 0, y: 0 };
}

const STOP = [...BLOCKING, 'grappled'], walking = new Set<string>();
/** The token is walking a route (or waiting on an ask during one): it can't start another. */
export const isWalking = (tokenId: string) => walking.has(tokenId);
/** The whole move of a token along `route` (squares one apart from where it stands, ending where it goes): the current-turn mover asks at the
 *  first step that leaves each foe's reach; returns where it ended. A token already walking does not start a second walk: it stays where it is. */
export async function guardMove(ctx: FlowCtx, tokenId: string, route: Pt[]): Promise<Pt> {
  if (walking.has(tokenId) || !route.length) { const t = (await ctx.scene())?.tokens.find((z) => z.id === tokenId); return t ? { x: t.x, y: t.y } : route.at(-1) ?? { x: 0, y: 0 }; }
  walking.add(tokenId);
  try { return await walk(ctx, tokenId, route); } finally { walking.delete(tokenId); }
}
async function walk(ctx: FlowCtx, tokenId: string, route: Pt[]): Promise<Pt> {
  const asked = new Set<string>(); // `leave:<id>` / `enter:<id>`: foes asked already on that edge (answered, passed or timed out), not asked there again this move
  for (let i = 0; ; ) { // route[i..]: the squares still to walk
    const rest = route.slice(i), w = await world(ctx), t = w?.s.tokens.find((z) => z.id === tokenId), x = w && t && combatantForToken(w.k, t), me = x && w.bs.get(x.id);
    if (!w || !t) { const s = w?.s ?? await ctx.scene(); return s ? step(ctx, s, tokenId, rest) : route.at(-1)!; } // no fight: a plain walk
    const here = { x: t.x, y: t.y };
    if (me && asked.size && !currentRun(w.k).has(me.x.id)) return here; // its turn ended during an ask: it stays
    if (!me || !on(w.k, ctx.settings) || !currentRun(w.k).has(me.x.id)) return step(ctx, w.s, tokenId, rest);
    if (me.x.hp === 0 || me.conditions.some((c) => STOP.includes(c.toLowerCase())) || w.k.movement?.[me.x.id]?.mult === 0) return here;
    const foes = [...w.bs.values()].filter((b) => b !== me), off = !!me.x.economy?.disengaging, was = (f: Body, on: 'leave' | 'enter') => asked.has(`${on}:${f.x.id}`);
    let j = 0, edge: ReturnType<typeof leaveStep>;
    for (let prev = here; j < rest.length; prev = rest[j++]) if ((edge = leaveStep(w.s.grid, ctx.settings.diagonal, { ...me, pt: { ...me.pt, ...prev } }, foes, rest[j], off, enterOptions, was))) break;
    if (!edge) return step(ctx, w.s, tokenId, rest);
    if (edge.enter) j++; // entering a reach: the mover takes that square first
    if (j) { // up to the edge (a write refused, off the map: it stays)
      const at = await step(ctx, w.s, tokenId, rest.slice(0, j)), e = snap(w.s.grid, rest[j - 1], t.size);
      if (at.x !== e.x || at.y !== e.y) return at;
    }
    i += j;
    edge.reactors.forEach((r) => asked.add(`${edge!.enter ? 'enter' : 'leave'}:${r.id}`));
    const names = edge.reactors.map((r) => r.name).join(', ');
    const answers = await ask({ id: uid(), kind: edge.enter ? 'enter' : 'opportunity', trigger: edge.enter ? `${me.name} comes within reach of ${names}` : `${me.name} leaves the reach of ${names}`,
      playerTrigger: edge.enter ? `${me.name} comes within your reach` : `${me.name} leaves your reach`, reactors: edge.reactors, waiting: me.x.id });
    for (const ans of answers) {
      const hit = ans.option === 'more' ? await follow(ctx, { ans, t: { window: 'enter', actor: me } }) // Polearm Master's is an Opportunity Attack too (Sentinel)
        : ans.spell ? await strike(ctx, ans, me.x.id, (b) => b.actions.find((a) => !!a.spell && a.name === ans.spell), { cast: true }) // War Caster
        : await strike(ctx, ans, me.x.id, oaAction, { melee: true });
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
  const t: Trigger = { window: 'cast', actor: c }, all = [...w.bs.values()];
  const reactors = merge(counterReactors(w.s.grid, ctx.settings.diagonal, c, all), tableReactors(w.s.grid, ctx.settings.diagonal, t, all));
  const answers = await ask({ id: uid(), kind: 'counterspell', trigger: `${c.name} casts ${spell.name} (level ${spell.level})`,
    playerTrigger: c.hidden ? 'Something casts a spell' : c.pc ? `${c.name} casts ${spell.name}` : `${c.name} casts a spell`, reactors, waiting: casterId }); // a monster's spell stays hidden
  for (const ans of answers) {
    if (ans.option === 'more') { if (await castAnswer(ctx, ans, t, spell)) return false; continue; }
    const b = (await world(ctx))?.bs.get(ans.reactor), a = b && reactionNamed(b, 'counterspell'), slot = ans.slot ?? 3;
    if (!b || !a) continue;
    const why = await pay(ctx, b, a, slot);
    if (why) { refused(ctx, b.x.id, why); continue; }
    if (!(await guardCast(ctx, b.x.id, { name: a.name, level: slot }))) continue;
    // the check: d20 + its spellcasting modifier (ponytail: a stat block that names no spellcasting ability checks at +0, monsterActions' `mod`)
    const check = spell.level > 3 && slot < spell.level ? (ans.d20 ?? roll20(ctx)) + (a.cast?.mod ?? 0) : undefined;
    if (countered(spell.level, slot, check)) { await fizzle(ctx, casterId, spell.name); return false; } // ponytail: the first that counters ends it; the rest pay nothing
  }
  return true;
}

/** A spell that never took effect: the concentration it began (at payment) is not held (the spell it replaced stays dropped, it was cast), nor the haste it gave. */
async function fizzle(ctx: FlowCtx, casterId: string, name: string): Promise<void> {
  const gave = (z: Combatant, round: number) => name === 'Haste' && z.hasted?.by === casterId && z.hasted.round === round && !z.hasted.ended;
  await updateCombat(ctx.cid, (k) => ({ ...k, combatants: k.combatants.map((z) => {
    if (gave(z, k.round)) z = { ...z, hasted: { ...z.hasted!, ended: true as const } };
    return z.id === casterId && z.concentratingOn === name ? { ...z, concentrating: false, concentratingOn: undefined, concentrationSlot: undefined } : z;
  }) }));
}

/** A table answer to a spell being cast (Mage Slayer's attack, Magic-User's Nemesis, a reminder); true: the spell fails. */
async function castAnswer(ctx: FlowCtx, ans: Answer, t: Trigger, spell: { name: string }): Promise<boolean> {
  const rb = (await world(ctx))?.bs.get(ans.reactor), key = ans.key, rx = key ? entry(key) : undefined;
  if (!rb || !key) return false;
  if (rx?.shape === 'attack') { await follow(ctx, { ans, t }); return false; }
  const why = await payRx(ctx, rb, key, ans.slot);
  if (why) { refused(ctx, rb.x.id, why); return false; }
  if (rx?.shape !== 'nemesis') { await remind(ctx, rb, key, t.actor.x.id); return false; }
  // the caster's Wisdom save against the reactor's spell save DC (none: 10), rolled on this device
  const c = (await world(ctx))?.bs.get(t.actor.x.id), m = c?.x.monsterId ? ctx.monster(c.x.monsterId) : undefined;
  const bonus = c?.sheet ? c.sheet.saves.wis.bonus : m ? m.saves.wis ?? Math.floor((m.scores.wis - 10) / 2) : 0;
  if (roll20(ctx, `${t.actor.name}: Wisdom save`) + bonus >= (rb.stats?.dc ?? 10)) return false;
  await fizzle(ctx, t.actor.x.id, spell.name);
  return true;
}

/**
 * applyResolution with the reactions around it. Each attack outcome: an ask as it is declared (disadvantage, before its roll is known), then
 * a hit or miss ask before its damage; then it lands; then asks after the attack, on damage (Hellish Rebuke too), on a death, on a save.
 * `melee`: a melee attack (Parry).
 */
export async function land(ctx: FlowCtx, res: Omit<Resolution, 'applied'>, before?: Snap, opts: { melee?: boolean } = {}): Promise<Omit<Resolution, 'applied'>> {
  const w = await world(ctx), src = w?.bs.get(res.actor);
  if (!w || !on(w.k, ctx.settings)) { await applyResolution(ctx.cid, res, ctx.settings, before); return res; }
  const mm = res.action === 'Magic Missile', shielded = new Set<string>(), asked = new Set<string>(), declared = new Set<string>(), outcomes: Outcome[] = [];
  const missHalf = readSpell(ctx.spell(res.action.toLowerCase()) ?? { text: [], level: 0, range: '' })?.missHalf; // Acid Arrow: Shield leaves half on the miss
  const blocked = (o: Outcome) => (mm ? { ...o, damage: 0, note: 'Shield' } : rejudge(o, 5, missHalf)); // each dart is a hit Shield stops
  const d = ctx.settings.diagonal, act = src?.actions.find((a) => a.name === res.action), spellish = !!act?.spell || !!ctx.spell(res.action.toLowerCase());
  const kind = { melee: !!opts.melee, ranged: !opts.melee && !spellish, type: src && damageType(src, res.action) }; // ranged: a ranged weapon attack (Deflect Missiles)
  const who = src?.hidden ? 'Something' : src?.name, later: Follow[] = [];
  const attackOn = (o: Outcome) => !!src && o.id !== src.x.id && o.roll !== undefined && o.part !== 'save';
  for (let o of res.outcomes) {
    if (shielded.has(o.id)) { outcomes.push(blocked(o)); continue; }
    if (src && attackOn(o) && !declared.has(o.id)) { // ponytail: asked once per result (Scorching Ray's later rays don't ask again)
      declared.add(o.id);
      const w2 = await world(ctx), b = w2?.bs.get(o.id), t: Trigger | undefined = b && { window: 'declared', actor: src, target: b, ...kind, edge: !!o.edge };
      const reactors = w2 && t ? tableReactors(w2.s.grid, d, t, [...w2.bs.values()]) : [];
      const them = b && (reactors.every((r) => r.id === b.x.id) ? 'you' : b.hidden ? 'something' : b.name);
      const answers = !b || !t ? [] : await ask({ id: uid(), kind: 'declared', trigger: `${src.name} attacks ${b.name}`, playerTrigger: `${who} attacks ${them}`, reactors, waiting: src.x.id });
      for (const ans of answers) o = await answerRx(ctx, ans, t!, o, missHalf, later);
    }
    if (src && o.hit && o.id !== src.x.id && (o.roll !== undefined || mm) && !asked.has(o.id)) {
      asked.add(o.id);
      const w2 = await world(ctx), b = w2?.bs.get(o.id), all = b ? hitReactors(b, src, { melee: !!opts.melee }) : [];
      const t: Trigger | undefined = b && { window: 'hit', actor: src, target: b, ...kind, damage: o.damage, crit: o.nat === 20, edge: !!o.edge };
      const reactors = mm ? all.map((r) => ({ ...r, options: r.options.filter((z) => z.id === 'shield') })).filter((r) => r.options.length) // darts are not attacks: Shield only
        : merge(all, w2 && t ? tableReactors(w2.s.grid, d, t, [...w2.bs.values()]) : []);
      const them = b && (reactors.every((r) => r.id === b.x.id) ? 'you' : b.hidden ? 'something' : b.name); // an attacker hidden from the players stays unnamed on their card
      const answers = !b ? [] : await ask({ id: uid(), kind: 'hit', trigger: `${src.name} hits ${b.name} (${mm ? 'Magic Missile' : `${o.roll} vs AC ${o.ac}`})`,
        playerTrigger: mm ? `${who} hits ${them} with ${src.pc && !src.hidden ? 'Magic Missile' : 'a spell'}` : `${who} hits ${them}${them === 'you' ? ` (${o.roll})` : ''}`, reactors, waiting: src.x.id }); // the roll for its target only
      for (const ans of answers) {
        if (ans.option === 'more') { o = await answerRx(ctx, ans, t!, o, missHalf, later); continue; }
        const opt = reactors.find((r) => r.id === ans.reactor)?.options.find((z) => z.id === ans.option), a = ans.option === 'shield' ? b && reactionNamed(b, 'shield') : pip(opt?.label ?? ans.option);
        const slot = ans.option === 'shield' ? ans.slot ?? b?.slots[0] : undefined;
        const why = b && a ? await pay(ctx, b, a, slot) : 'not available';
        if (why) { refused(ctx, ans.reactor, why); continue; }
        if (ans.option === 'shield' && !(await guardCast(ctx, ans.reactor, { name: 'Shield', level: slot ?? 1 }))) continue; // countered: paid, no Shield
        if (ans.option === 'shield') { await setCondition(ctx.cid, o.id, 'Shield', true, { rounds: 1, at: 'start', of: o.id }); shielded.add(o.id); o = blocked(o); }
        if (ans.option === 'parry') o = rejudge(o, opt?.bonus ?? 0, missHalf);
        if (ans.option === 'uncanny') o = halved(o);
      }
    } else if (src && attackOn(o) && !o.hit && !asked.has(o.id)) {
      asked.add(o.id);
      const w2 = await world(ctx), b = w2?.bs.get(o.id), t: Trigger | undefined = b && { window: 'miss', actor: src, target: b, ...kind, nat1: o.nat === 1, edge: !!o.edge };
      const reactors = w2 && t ? tableReactors(w2.s.grid, d, t, [...w2.bs.values()]) : [];
      const them = b && (reactors.every((r) => r.id === b.x.id) ? 'you' : b.hidden ? 'something' : b.name);
      const answers = !b || !t ? [] : await ask({ id: uid(), kind: 'miss', trigger: `${src.name} misses ${b.name}`, playerTrigger: `${who} misses ${them}`, reactors, waiting: src.x.id });
      for (const ans of answers) o = await answerRx(ctx, ans, t!, o, missHalf, later);
    }
    outcomes.push(o);
  }
  const out = { ...res, outcomes };
  await applyResolution(ctx.cid, out, ctx.settings, before);
  for (const f of later) await follow(ctx, f);
  if (src) for (const id of new Set(outcomes.filter(attackOn).map((o) => o.id))) await askAfter(ctx, 'after', { window: 'after', ...kind }, res.actor, id);
  await afterHurt(ctx, res.actor, outcomes, kind);
  return out;
}

/** The asks once damage and saves have landed: on damage (Hellish Rebuke, the table's), on a death, on a save. */
async function afterHurt(ctx: FlowCtx, actor: string, outcomes: Outcome[], kind: Pick<Trigger, 'melee' | 'ranged' | 'type'> = {}): Promise<void> {
  const hurt = new Map<string, Outcome[]>();
  for (const o of outcomes) if (o.damage > 0 && !o.pending) hurt.set(o.id, [...(hurt.get(o.id) ?? []), o]);
  for (const [id, os] of hurt) {
    const save = os.every((o) => o.roll === undefined), damage = os.reduce((n, o) => n + o.damage, 0);
    await askAfter(ctx, 'rebuke', { window: 'damaged', ...kind, damage, save }, actor, id, (w, v, s) => rebukeReactors(w.s.grid, ctx.settings.diagonal, v, s));
  }
  const w = await world(ctx);
  for (const id of hurt.keys()) if (w?.bs.get(id)?.x.hp === 0) await askAfter(ctx, 'died', { window: 'died' }, actor, id);
  for (const o of outcomes) if (o.save && !o.pending) await askAfter(ctx, 'saved', { window: 'saved', ok: o.save.ok, damage: o.damage }, actor, o.id);
}

/** Damage or a save that landed outside `land` (a PC's settled save): the asks on damage, a death and the save against the result's actor. */
export const afterDamage = (ctx: FlowCtx, res: Pick<Resolution, 'actor' | 'outcomes'>, targetId: string): Promise<void> =>
  afterHurt(ctx, res.actor, res.outcomes.filter((o) => o.id === targetId));

/** store.settleSave, then the damage it dealt asks for the PC's Hellish Rebuke (a save already settled asks nothing). */
export async function settle(ctx: FlowCtx, rid: string, target: string, d20: number): Promise<void> {
  const k = await settleSave(ctx.cid, rid, target, d20, ctx.settings), r = k?.resolutions?.find((y) => y.id === rid);
  if (r) await afterDamage(ctx, r, target);
}
