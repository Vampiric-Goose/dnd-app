// The tracker's db operations (lazy: reached by dynamic import only). PC changes go through db.characters.put from a fresh read, so
// stage 3 stamps and syncs them; monster HP lives only in the combat record.
import { applyDamage, applyHealing, rollDeathSave } from '../character/rest.ts';
import { db, DeletedError } from '../db.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { Applied, CampaignSettings, Character, Combat, Combatant, Duration, Encounter, MonsterDef, Outcome, Resolution, Scene, Snap } from '../types.ts';
import { roll } from '../rolls.svelte.ts';
import { recharge } from './breath.ts';
import { settle } from './resolve.ts';
import { rollSpellDice, spellMods } from './spellEffects.ts';
import { castLive, driftAreas, endedSpells, snapOf, touched } from './aiming.ts';
import { canon } from '../sync/merge.ts';
import { uid } from '../uid.ts';
import { addCombatants, addMonsters, concentrationDc, turnIds, encounterPicks, initOk, monsterHp, newCombat, next, patchCombatant, removeStep, rollInit, setInit, start, type Expired, type HpOp, type Step } from './combat.ts';
import { restoreCombat, restoreScene, snapshotFight } from './encounters.ts';
import { BLOCKING } from './economy.ts';
import { endedSummons } from './summons.ts';

// One operation at a time (per tab): two quick hits each read the character after the other's write, so both land.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

/** Every combat write. A concentration spell that ends with it takes its conditions along (a PC's off its character, after the write). */
const update = async (cid: string, fn: (c: Combat) => Combat): Promise<Combat> => {
  let drop: { id: string; condition: string }[] = [], gone: string[] = [];
  const out = (await db.combat.update(cid, (c) => {
    const r = endedSpells(c, { ...fn(c ?? newCombat(cid)), updatedAt: Date.now() });
    drop = r.drop;
    const s = endedSummons(r.combat); // summons leave with their casting, or at 0 HP
    gone = s.gone;
    return s.combat;
  }))!;
  if (gone.length) await (await import('../map/store.ts')).dropFighterTokens(cid, gone); // one roster: their tokens go too
  for (const x of out.combatants) {
    const gone = drop.filter((d) => d.id === x.id).map((d) => d.condition);
    if (gone.length && x.kind === 'pc' && x.characterId) await editCharacter(x.characterId, (c) => (c.state.conditions.some((n) => gone.includes(n)) ? { ...c, state: { ...c.state, conditions: c.state.conditions.filter((n) => !gone.includes(n)) } } : c));
  }
  return out;
};

/** Reads the character fresh, changes it, saves it (stamped). False when it is gone (missing or deleted in its campaign). */
export async function editCharacter(id: string, fn: (c: Character) => Character): Promise<boolean> {
  const c = await db.characters.get(id);
  if (!c) return false;
  const out = fn(c);
  if (out === c) return true;
  try { await db.characters.put(out); } catch (e) { if (e instanceof DeletedError) return false; throw e; }
  return true;
}

async function combatant(cid: string, id: string): Promise<{ combat: Combat; x: Combatant }> {
  const combat = await db.combat.get(cid);
  const x = combat?.combatants.find((y) => y.id === id);
  if (!combat || !x) throw new Error('That combatant is not in the fight.');
  return { combat, x };
}

/**
 * Each expired PC condition leaves its character (one put per character). M3: a failed write doesn't fail the turn (it happened);
 * the step lists the combatant's name in `failed` so the page can say so.
 */
async function clearExpired(step: Step): Promise<Step> {
  const byChar = new Map<string, { name: string; gone: Set<string> }>();
  for (const e of step.expired) {
    const x = step.combat.combatants.find((y) => y.id === e.combatantId);
    if (x?.kind !== 'pc' || !x.characterId) continue;
    const entry = byChar.get(x.characterId) ?? { name: x.name, gone: new Set<string>() };
    byChar.set(x.characterId, entry);
    entry.gone.add(e.condition);
  }
  const failed: string[] = [];
  for (const [id, { name, gone }] of byChar) {
    try {
      await editCharacter(id, (c) => (c.state.conditions.some((n) => gone.has(n)) ? { ...c, state: { ...c.state, conditions: c.state.conditions.filter((n) => !gone.has(n)) } } : c));
    } catch (e) {
      console.warn(e);
      failed.push(name);
    }
  }
  return failed.length ? { ...step, failed } : step;
}

/** The campaign's combat changed by `fn` (a new one when there is none), with updatedAt stamped. */
export const updateCombat = (cid: string, fn: (c: Combat) => Combat): Promise<Combat> => serial(async () => {
  const c = await update(cid, fn);
  await readyStart(cid); // a typed initiative can be the last one a map Start combat waits for
  return (await db.combat.get(cid)) ?? c;
});

/**
 * Start the fight, or end the turn and start the next; PC conditions that expire are removed from their characters. `expect`: only
 * while that combatant holds the turn (a player's End turn that arrives after the turn moved on changes nothing).
 */
export const turn = async (cid: string, dir: 'start' | 'next', expect?: string): Promise<Step> => {
  let ended: string[] = [];
  const step = await serial(async () => {
    let expired: Expired[] = [];
    const combat = await update(cid, (c) => {
      if (expect !== undefined && c.turn !== expect) return c;
      if (dir === 'next') ended = turnIds(c);
      const s = dir === 'start' ? start(c) : next(c); expired = s.expired;
      // a turn that starts now (not one Previous stepped back over): its spent breath weapons roll to recharge, on the DM's private log
      const k = s.combat, starts = k.turn !== undefined && !(c.done ?? []).includes(`${k.round}:s:${k.turn}`) ? new Set(turnIds(k)) : new Set<string>();
      return starts.size ? { ...k, combatants: k.combatants.map((x) => (starts.has(x.id)
        ? recharge(x, (key) => roll(`${x.name}: ${key.split(':').slice(2).join(':').replace(/\s*\(Recharge[^)]*\)/i, '')} recharge`, '1d6', { mode: 'normal', public: false }).total) : x)) } : k;
    });
    const out = await clearExpired({ combat, expired });
    for (const id of ended) await repeatSaves(cid, id);
    return out;
  });
  for (const id of ended) await laterHits(cid, id); // outside the queue: its damage goes through changeHp, which queues itself
  // a drifting area (Cloudkill) moves away from its caster as the caster's turn starts
  const sc = step.combat.resolutions?.some((r) => r.linger?.read.drift) ? await fightScene(cid) : undefined;
  if (sc) await serial(() => update(cid, (c) => driftAreas(c, sc)));
  return ended.length || sc ? { ...step, combat: (await db.combat.get(cid)) ?? step.combat } : step;
};

/** removeCombatant, writing the PC side of any expiry the passed turn starts (see removeStep). */
export const remove = (cid: string, combatantId: string): Promise<Step> => serial(async () => {
  let expired: Expired[] = [];
  const combat = await update(cid, (c) => { const s = removeStep(c, combatantId); expired = s.expired; return s.combat; });
  return clearExpired({ combat, expired });
});

const GONE = 'That character is no longer in the campaign.';

/**
 * `concentrationDc`: a damage op on a concentrating combatant (the full amount entered, temp HP included). Final M6: damage that leaves it
 * at 0 HP ends concentration instead (unconscious, PHB p.203): `concentrating` is cleared and `concentrationLost` is set. Final M7: a PC
 * whose character is gone throws.
 */
export const changeHp = (cid: string, combatantId: string, op: HpOp, settings: CampaignSettings): Promise<{ combat: Combat; concentrationDc?: number; concentrationLost?: true }> => serial(async () => {
  const { combat: had, x } = await combatant(cid, combatantId);
  const hit = 'damage' in op && op.damage > 0 && !!x.concentrating;
  let combat = had, down = false;
  if (x.kind === 'pc') {
    if (x.characterId && !(await editCharacter(x.characterId, (c) => {
      const sheet = computeSheet(c, { settings, viewer: 'dm' });
      const out = 'damage' in op ? applyDamage(c, op.damage, sheet, op.crit) : 'heal' in op ? applyHealing(c, op.heal, sheet) : { ...c, state: { ...c.state, tempHp: Math.max(0, op.temp) } };
      down = out.state.hp === 0;
      return out;
    }))) throw new Error(GONE);
  } else {
    combat = await update(cid, (c) => ({ ...c, combatants: c.combatants.map((y) => (y.id === combatantId ? monsterHp(y, op) : y)) }));
    down = combat.combatants.find((y) => y.id === combatantId)?.hp === 0;
  }
  if (hit && down) {
    combat = await update(cid, (c) => patchCombatant(c, combatantId, { concentrating: false }));
    return { combat, concentrationLost: true };
  }
  return { combat, ...(hit && { concentrationDc: concentrationDc((op as { damage: number }).damage) }) };
});

/** HP and temp HP now: a monster's on its combatant, a PC's (with its dying state) on its character. */
async function hpOf(cid: string, id: string): Promise<{ hp: number; temp: number; dying?: Applied['dying'] }> {
  const x = (await db.combat.get(cid))?.combatants.find((y) => y.id === id);
  if (x?.kind !== 'pc') return { hp: x?.hp ?? 0, temp: x?.tempHp ?? 0 };
  const s = (await db.characters.get(x.characterId ?? ''))?.state;
  return { hp: s?.hp ?? 0, temp: s?.tempHp ?? 0, ...(s && { dying: { deathSaves: s.deathSaves, stable: !!s.stable, dead: !!s.dead } }) };
}

/** One outcome's damage through changeHp (temp HP, dying, concentration), and what it took off. */
async function hurtOne(cid: string, id: string, damage: number, crit: boolean, settings: CampaignSettings): Promise<Applied> {
  const before = await hpOf(cid, id);
  const { concentrationDc } = await changeHp(cid, id, { damage, ...(crit && { crit }) }, settings);
  const after = await hpOf(cid, id);
  const dying = before.dying && JSON.stringify(before.dying) !== JSON.stringify(after.dying) ? before.dying : undefined;
  return { id, hp: before.hp - after.hp, temp: before.temp - after.temp, ...(dying && { dying }), ...(concentrationDc && { conc: concentrationDc }) };
}

/** The touched creatures as stored now (see snapOf). */
async function snapNow(cid: string, ids: string[]): Promise<Snap> {
  const k = await db.combat.get(cid);
  if (!k) return { combatants: {}, states: {} };
  const chars = (await Promise.all(k.combatants.filter((x) => ids.includes(x.id) && x.characterId).map((x) => db.characters.get(x.characterId!)))).filter((c): c is Character => !!c);
  return snapOf(k, chars, ids);
}

/**
 * Targeting: a use worked out by resolve.ts. Its damage goes on (not a PC's pending save), and it joins the last 20 results with what it
 * touched before (`before`: taken before it was paid for; else now) and after, for Undo.
 */
/** The last 20 results, and older ones whose spell still runs (a concentration casting still up, a timed spell still in its rounds). */
function kept(c: Combat, list: Resolution[]): Resolution[] {
  const recent = new Set(list.slice(-20).map((r) => r.id));
  return list.filter((r) => recent.has(r.id) || (r.lasting && castLive(c, r)) || (r.rounds !== undefined && r.round !== undefined && c.round - r.round < r.rounds));
}

/** Who holds conditions from the live concentration spells of these casters: a result that ends one of them changes those creatures too. */
function holders(k: Combat | undefined, ids: string[]): string[] {
  return [...new Set((k?.resolutions ?? []).filter((r) => r.lasting && ids.includes(r.actor) && castLive(k!, r)).flatMap((r) => (r.inflicted ?? []).map((d) => d.id)))].filter((id) => !ids.includes(id));
}

export async function applyResolution(cid: string, r: Omit<Resolution, 'applied'>, settings: CampaignSettings, before?: Snap): Promise<Combat> {
  // Undo also gives back what ending a caster's concentration took off other creatures, so those are in the snapshots too
  const more = holders(await db.combat.get(cid), touched(r)), ids = [...touched(r), ...more];
  const extra = await snapNow(cid, more), was0 = before ?? await snapNow(cid, touched(r));
  const was: Snap = { combatants: { ...extra.combatants, ...was0.combatants }, states: { ...extra.states, ...was0.states } };
  const applied: Applied[] = [];
  for (const o of r.outcomes) if (o.damage > 0 && !o.pending) applied.push(await hurtOne(cid, o.id, o.damage, o.nat === 20 && o.part !== 'save', settings));
  const inflicted = await inflict(cid, r, r.outcomes.flatMap((o) => (o.inflict ?? []).map((condition) => ({ id: o.id, condition, ...(o.save && { bonus: o.save.total - o.save.roll }) }))));
  for (const o of r.outcomes) { // a helpful spell: healing (after its condition: Aid's higher maximum), and temp HP (the higher stays)
    if (o.heal) await changeHp(cid, o.id, { heal: o.heal }, settings);
    if (o.temp && o.temp > (await hpOf(cid, o.id)).temp) await changeHp(cid, o.id, { temp: o.temp }, settings);
  }
  if (r.rider || r.spent) await update(cid, (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id !== r.actor ? x : r.rider ? { ...x, rider: r.rider } : (({ rider: _r, ...rest }) => rest)(x))) }));
  const after = await snapNow(cid, ids);
  return serial(() => update(cid, (c) => ({ ...c, resolutions: kept(c, [...(c.resolutions ?? []), { ...r, applied, ...(inflicted.length && { inflicted }), undo: { before: was, after } }]) })));
}

/** The conditions a result's failed saves leave, put on; a non-concentration spell's last its rounds (to the start of its caster's turn). */
async function inflict<T extends { id: string; condition: string }>(cid: string, r: Pick<Resolution, 'actor' | 'rounds' | 'lasting'>, list: T[]): Promise<T[]> {
  const lasts: Duration | undefined = !r.lasting && r.rounds ? { rounds: r.rounds, at: 'start', of: r.actor } : undefined;
  for (const x of list) await conditionOn(cid, x.id, x.condition, true, lasts);
  return list;
}

/**
 * The end of `id`'s turn: each repeat-save spell whose conditions it still has gets a new result. A monster rolls at once (its bonus kept
 * from the first save) and a success ends them; a PC's save is pending, for its player's pop-up (settleSave ends them on a success).
 */
/** The end of `id`'s turn: damage a result held for then (Acid Arrow's second part) lands, once, as a result of its own (Undo-able). */
async function laterHits(cid: string, id: string): Promise<void> {
  const due = ((await db.combat.get(cid))?.resolutions ?? []).filter((r) => !r.laterDone && r.outcomes.some((o) => o.id === id && o.later));
  if (!due.length) return;
  const settings = (await db.campaigns.get(cid))?.settings;
  if (!settings) return;
  for (const r of due) {
    const damage = r.outcomes.find((o) => o.id === id && o.later)!.later!, before = await snapNow(cid, [id]);
    const applied = [await hurtOne(cid, id, damage, false, settings)], after = await snapNow(cid, [id]);
    const next: Resolution = { id: uid(), actor: r.actor, action: `${r.action} (end of turn)`, outcomes: [{ id, part: 'hit', hit: true, damage }], applied, at: Date.now(), undo: { before, after } };
    await update(cid, (c) => ({ ...c, resolutions: kept(c, [...(c.resolutions ?? []).map((y) => (y.id === r.id ? { ...y, laterDone: true as const } : y)), next]) }));
  }
}

async function repeatSaves(cid: string, id: string): Promise<void> {
  const k = await db.combat.get(cid), x = k?.combatants.find((y) => y.id === id);
  if (!k || !x) return;
  const has = x.kind === 'pc' ? ((x.characterId && (await db.characters.get(x.characterId))?.state.conditions) || []) : x.conditions ?? [];
  for (const r of k.resolutions ?? []) {
    const mine = (r.inflicted ?? []).filter((d) => d.id === id && has.includes(d.condition));
    if (!r.repeat || r.dc === undefined || !mine.length) continue;
    const ends = mine.map((d) => d.condition), before = await snapNow(cid, [id]);
    let o: Outcome = { id, part: 'save', pending: true, damage: 0, owed: [], ends };
    if (x.kind !== 'pc') {
      const roll = 1 + Math.floor(Math.random() * 20), total = roll + (mine[0].bonus ?? 0), ok = total >= r.dc;
      o = { id, part: 'save', save: { roll, total, ok }, damage: 0, ...(ok && { ends }) };
      if (ok) for (const c of ends) await conditionOn(cid, id, c, false);
    }
    const after = await snapNow(cid, [id]);
    const next: Resolution = { id: uid(), actor: r.actor, action: `${r.action} (repeat save)`, dc: r.dc, ...(r.ability && { ability: r.ability }), outcomes: [o], applied: [], at: Date.now(), undo: { before, after } };
    await update(cid, (c) => ({ ...c, resolutions: kept(c, [...(c.resolutions ?? []), next]) }));
  }
}

type Rec = Record<string, unknown>;
/**
 * Undo's three-way restore of one record: a field still as the result left it goes back to how it was before; a field changed since by
 * something else stays, except HP and temp HP, which get back what the result took (capped at `max`).
 */
function restore<T extends object>(cur: T, before: T, after: T, max: number): T {
  const c = cur as unknown as Rec, out: Rec = { ...c }, b = before as unknown as Rec, a = after as unknown as Rec;
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (canon(c[k]) === canon(a[k])) { if (b[k] === undefined) delete out[k]; else out[k] = b[k]; }
    else if ((k === 'hp' || k === 'tempHp') && typeof c[k] === 'number' && typeof a[k] === 'number' && typeof b[k] === 'number') {
      out[k] = Math.max(0, (c[k] as number) + (b[k] as number) - (a[k] as number));
      if (k === 'hp') out[k] = Math.min(max, out[k] as number);
    }
  }
  return out as T;
}

/** Undo: puts back exactly what the result took (capped at max HP), a PC's dying state too, and drops the result. */
export const undoResolution = (cid: string, rid: string, settings: CampaignSettings): Promise<Combat> => serial(async () => {
  const had = await db.combat.get(cid);
  const r = had?.resolutions?.find((x) => x.id === rid);
  if (!had || !r) throw new Error('That result is no longer there.');
  if (r.undo) { // the whole state it changed: pips, slots, resources, HP, dying, concentration
    const { before, after } = r.undo;
    for (const [chId, b] of Object.entries(before.states)) {
      if (after.states[chId]) await editCharacter(chId, (c) => ({ ...c, state: restore(c.state, b, after.states[chId], computeSheet(c, { settings, viewer: 'dm' }).maxHp) }));
    }
    // a summon the result dropped (it left the fight at 0 HP) comes back as it was; the DM's map puts its token back (placeUnplaced)
    const back = Object.values(before.combatants).filter((x) => x.summon && !after.combatants[x.id]);
    return update(cid, (c0) => {
      const c = back.length ? { ...addCombatants(c0, back), reordered: c0.reordered } : c0;
      return { ...c,
        combatants: c.combatants.map((x) => (before.combatants[x.id] && after.combatants[x.id] ? restore(x, before.combatants[x.id], after.combatants[x.id], x.maxHp ?? Infinity) : x)),
        resolutions: (c.resolutions ?? []).filter((x) => x.id !== rid) };
    });
  }
  for (const a of r.applied) { // a result stored before Undo kept states: its HP only
    const x = had.combatants.find((y) => y.id === a.id);
    if (x?.kind === 'pc' && x.characterId) {
      await editCharacter(x.characterId, (c) => ({ ...c, state: { ...c.state, ...a.dying,
        hp: Math.min(computeSheet(c, { settings, viewer: 'dm' }).maxHp, c.state.hp + a.hp), tempHp: c.state.tempHp + a.temp } }));
    } else if (x) {
      await update(cid, (c) => patchCombatant(c, a.id, { hp: Math.min(x.maxHp ?? Infinity, (c.combatants.find((y) => y.id === a.id)?.hp ?? 0) + a.hp),
        tempHp: (c.combatants.find((y) => y.id === a.id)?.tempHp ?? 0) + a.temp }));
    }
  }
  return update(cid, (c) => ({ ...c, resolutions: (c.resolutions ?? []).filter((x) => x.id !== rid) }));
});

/** A PC's own save roll (`d20`) for a pending outcome: against the DC with its sheet's bonus, half or none on a success. Settles once. */
/** A player's pick of the die that sets a hit's damage type (Chaos Bolt): that pick's damage lands, and Undo's "after" follows it. */
export async function settlePick(cid: string, rid: string, target: string, type: string, settings: CampaignSettings): Promise<Combat | undefined> {
  const o = (await db.combat.get(cid))?.resolutions?.find((y) => y.id === rid)?.outcomes.find((x) => x.id === target && x.choose);
  const c = o?.choose?.find((x) => x.type === type);
  if (!o || !c) return undefined;
  let took = false;
  await serial(() => update(cid, (k) => ({ ...k, resolutions: (k.resolutions ?? []).map((y) => (y.id !== rid ? y : { ...y, outcomes: y.outcomes.map((x) => {
    if (x.id !== target || !x.choose) return x;
    took = true;
    const { choose: _c, ...rest } = x;
    return { ...rest, damage: c.damage, ...(c.note && { note: c.note }) };
  }) })) })));
  if (!took) return undefined; // already picked
  const applied = c.damage > 0 ? await hurtOne(cid, target, c.damage, o.nat === 20, settings) : undefined;
  const now = await snapNow(cid, [target]);
  return serial(() => update(cid, (k) => ({ ...k, resolutions: (k.resolutions ?? []).map((y) => (y.id !== rid ? y : { ...y, ...(applied && { applied: [...y.applied, applied] }),
    ...(y.undo && { undo: { before: y.undo.before, after: { combatants: { ...y.undo.after.combatants, ...now.combatants }, states: { ...y.undo.after.states, ...now.states } } } }) })) })));
}

export async function settleSave(cid: string, rid: string, target: string, d20: number, settings: CampaignSettings): Promise<Combat | undefined> {
  const k = await db.combat.get(cid);
  const r = k?.resolutions?.find((x) => x.id === rid), x = k?.combatants.find((y) => y.id === target);
  const ch = x?.characterId ? await db.characters.get(x.characterId) : undefined;
  if (!r || r.dc === undefined || !ch) return undefined;
  const sheet = computeSheet(ch, { settings, viewer: 'dm' });
  const extra = rollSpellDice(spellMods(ch.state.conditions), 'save', Math.random); // Bless, Bane: rolled here, on the DM's device
  const total = d20 + sheet.saves[r.ability ?? 'dex'].bonus + extra.total, ok = total >= r.dc;
  let owed: Outcome['owed'], lost: string[] = [], freed: string[] = [];
  await serial(() => update(cid, (c) => ({ ...c, resolutions: (c.resolutions ?? []).map((y) => y.id !== rid ? y : { ...y, outcomes: y.outcomes.map((o) => {
    if (o.id !== target || !o.pending) return o;
    owed = o.owed;
    const { pending: _p, owed: _o, inflicts, ...rest } = o;
    if (!ok && inflicts) lost = inflicts;
    if (ok && o.ends) freed = o.ends;
    return { ...rest, ...(!ok && inflicts && { inflict: inflicts }), save: { roll: d20, total, ok }, ...settle({ pc: true, defenses: { resist: sheet.resistances, immune: sheet.immunities, vulnerable: sheet.vulnerabilities } }, o.owed ?? [], ok, y.onSave) };
  }) }) })));
  if (!owed) return undefined; // already settled
  const damage = (await db.combat.get(cid))?.resolutions?.find((y) => y.id === rid)?.outcomes.find((o) => o.id === target && o.part === 'save')?.damage ?? 0;
  const applied = damage > 0 ? await hurtOne(cid, target, damage, false, settings) : undefined;
  const live = !r.lasting || castLive((await db.combat.get(cid)) ?? k!, r); // a failure after the spell ended leaves nothing
  const inflicted = await inflict(cid, r, live ? lost.map((condition) => ({ id: target, condition })) : []);
  for (const c of freed) await conditionOn(cid, target, c, false);
  const now = await snapNow(cid, [target]); // Undo's "after" follows the save's damage
  return serial(() => update(cid, (c) => ({ ...c, resolutions: (c.resolutions ?? []).map((y) => (y.id !== rid ? y : { ...y, ...(applied && { applied: [...y.applied, applied] }), ...(inflicted.length && { inflicted: [...(y.inflicted ?? []), ...inflicted] }),
    ...(y.undo && { undo: { before: y.undo.before, after: { combatants: { ...y.undo.after.combatants, ...now.combatants }, states: { ...y.undo.after.states, ...now.states } } } }) })) })));
}

/** Final M4: ends the fight (deletes the record) in the queue, so an operation sent just before it cannot write a fresh combat after. */
export const endCombat = (cid: string): Promise<unknown> => serial(() => db.combat.update(cid, () => undefined));

/** A PC's condition is on its character, a monster's on the combatant; the duration is on the combatant either way (off drops it). */
export const setCondition = (cid: string, combatantId: string, name: string, on: boolean, duration?: Duration): Promise<Combat> => serial(() => conditionOn(cid, combatantId, name, on, duration));
async function conditionOn(cid: string, combatantId: string, name: string, on: boolean, duration?: Duration): Promise<Combat> {
  const { combat, x } = await combatant(cid, combatantId);
  if (x.kind === 'pc' && x.characterId) {
    const live = await editCharacter(x.characterId, (c) => (c.state.conditions.includes(name) === on ? c
      : { ...c, state: { ...c.state, conditions: on ? [...c.state.conditions, name] : c.state.conditions.filter((n) => n !== name) } }));
    if (!live) return combat;
  }
  return update(cid, (c) => ({ ...c, combatants: c.combatants.map((y) => {
    if (y.id !== combatantId) return y;
    const kept = Object.entries(y.durations ?? {}).filter(([n]) => n !== name);
    const durations = Object.fromEntries(on && duration ? [...kept, [name, duration]] : kept);
    const stop = on && BLOCKING.includes(name.toLowerCase()) ? { concentrating: false } : {}; // SRD 5.1: incapacitated ends concentration
    if (y.kind === 'pc') return { ...y, durations, ...stop };
    const conditions = (y.conditions ?? []).filter((n) => n !== name);
    return { ...y, durations, conditions: on ? [...conditions, name] : conditions, ...stop };
  }) }));
}

/**
 * P1: a prepared encounter's monsters join the live fight (a new one when there is none), whose link stays. `missing`: names of lines
 * whose monster no longer resolves (left out).
 */
export async function addPreparedToFight(cid: string, e: Encounter, lookup: (id: string) => MonsterDef | undefined, hpMode: 'average' | 'roll'): Promise<{ added: Combatant[]; missing: string[] }> {
  const { picks, missing } = encounterPicks(e, lookup);
  if (!picks.length) return { added: [], missing };
  let before = new Set<string>();
  const after = await updateCombat(cid, (c) => { before = new Set(c.combatants.map((x) => x.id)); return addMonsters(c, picks, hpMode); });
  return { added: after.combatants.filter((x) => !before.has(x.id)), missing };
}

/**
 * W5: the scene a fight is on: `prefer` (the encounter's saved scene, when it still exists), else the shown one, else the most recently
 * updated. The DM's map needs no "Show to players", so a fight run on an unshown scene still saves and resumes with it.
 */
export async function fightScene(cid: string, prefer?: string): Promise<Scene | undefined> {
  const scenes = await db.scenes.list(cid);
  return scenes.find((s) => s.id === prefer) ?? scenes.find((s) => s.shown) ?? scenes.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Saves the live fight (and its scene's tokens and fog, see fightScene) as a new encounter, and links the fight to it. */
export const saveFightAs = (cid: string, name: string): Promise<Encounter> => serial(async () => {
  const c = await db.combat.get(cid);
  if (!c) throw new Error('There is no fight to save.');
  const e: Encounter = { id: uid(), campaignId: cid, name, monsters: [], fight: snapshotFight(c, await fightScene(cid)), updatedAt: Date.now() };
  await db.encounters.put(e);
  await update(cid, (x) => ({ ...x, encounterId: e.id }));
  return e;
});

/** Overwrites the linked encounter with the live fight; undefined when the fight is not linked (or its encounter is gone). */
export const saveFight = (cid: string): Promise<Encounter | undefined> => serial(async () => {
  const c = await db.combat.get(cid);
  const had = c?.encounterId ? await db.encounters.get(c.encounterId) : undefined;
  if (!c || !had) return undefined;
  const scene = await fightScene(cid, had.fight?.map?.sceneId), fight = snapshotFight(c, scene);
  // with no scene at all, the map an earlier save stored stays
  const e: Encounter = { ...had, fight: { ...fight, ...(!scene && had.fight?.map && { map: had.fight.map }) }, updatedAt: Date.now() };
  await db.encounters.put(e);
  return e;
});

/**
 * The encounter's saved fight replaces the live one; its map comes back on its scene unless that scene was deleted. W5: the fight's scene
 * (else fightScene's) is shown, and every combatant with no token on it gets one (placeCombatants), so the Map tab shows the fight.
 */
export const resumeFight = (cid: string, e: Encounter, lookup: (id: string) => MonsterDef | undefined = () => undefined)
  : Promise<{ dropped: string[]; sceneMissing: boolean; place: { placed: number; why?: 'no scene' | 'full' } }> => serial(async () => {
  const f = e.fight;
  if (!f) throw new Error('That encounter holds no saved fight.');
  const chars = await db.characters.list(cid);
  const { combat, dropped } = restoreCombat(f, e.id, chars, cid);
  await db.combat.update(cid, () => combat);
  let sceneMissing = false, target: string | undefined;
  if (f.map) {
    const ids = new Set(chars.map((c) => c.id));
    if (await db.scenes.update(f.map.sceneId, (s) => restoreScene(s, f, ids))) target = f.map.sceneId;
    else sceneMissing = true;
  }
  target ??= (await fightScene(cid))?.id;
  if (target) await db.scenes.show(cid, target);
  const place = await (await import('../map/store.ts')).placeCombatants(cid, combat.combatants, lookup);
  return { dropped, sceneMissing, place };
});

/** Deletes the encounter; a live fight linked to it is unlinked and goes on. */
export const deleteEncounter = (cid: string, id: string): Promise<void> => serial(async () => {
  await db.encounters.delete(id);
  await db.combat.update(cid, (c) => {
    if (c?.encounterId !== id) return c;
    const { encounterId: _, ...rest } = c;
    return { ...rest, updatedAt: Date.now() };
  });
});

export const deathSave = (cid: string, combatantId: string, d20: number): Promise<void> => serial(async () => {
  const { x } = await combatant(cid, combatantId);
  if (x.kind === 'pc' && x.characterId && !(await editCharacter(x.characterId, (c) => rollDeathSave(c, d20)))) throw new Error(GONE);
});

/**
 * A player's own roll (validated by the host first): taken only while the fight holds that character as a PC with no initiative yet.
 * False otherwise, and the combat is left untouched.
 */
export const applyInitiative = (cid: string, characterId: string, total: number): Promise<boolean> => serial(async () => {
  if (!initOk(total)) return false; // M2: whoever calls
  let taken = false;
  await db.combat.update(cid, (c) => {
    const x = c?.combatants.find((y) => y.kind === 'pc' && y.characterId === characterId && y.init === undefined);
    if (!c || !x) return c;
    taken = true;
    return { ...setInit(c, x.id, total), updatedAt: Date.now() };
  });
  if (taken) await readyStart(cid);
  return taken;
});

/** An autoStart fight in setup whose initiatives are all in starts round 1 (inside serial). */
async function readyStart(cid: string): Promise<void> {
  const c = await db.combat.get(cid);
  if (!c || c.round !== 0 || !c.autoStart || !c.combatants.length || c.combatants.some((x) => x.init === undefined)) return;
  let expired: Expired[] = [];
  const combat = await update(cid, (k) => { const { autoStart: _a, ...rest } = k; const s = start(rest); expired = s.expired; return s.combat; });
  await clearExpired({ combat, expired });
}

/**
 * The map's Start combat, after its tokens joined: everyone without an initiative rolls but the players' characters (`waitFor`), and the
 * fight starts round 1 by itself once those are in; at once when there are none.
 */
export const prepareStart = (cid: string, waitFor: Set<string>): Promise<string[]> => serial(async () => {
  const c = await update(cid, (k) => {
    let out = k;
    for (const x of k.combatants) if (x.init === undefined && !(x.characterId && waitFor.has(x.characterId))) out = setInit(out, x.id, rollInit(x.initMod));
    return { ...out, autoStart: true, askInit: true };
  });
  await readyStart(cid);
  return c.combatants.filter((x) => x.init === undefined).map((x) => x.name);
});

