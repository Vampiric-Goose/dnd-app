// The tracker's db operations (lazy: reached by dynamic import only). PC changes go through db.characters.put from a fresh read, so
// stage 3 stamps and syncs them; monster HP lives only in the combat record.
import { applyDamage, applyHealing, rollDeathSave } from '../character/rest.ts';
import { db, DeletedError } from '../db.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { CampaignSettings, Character, Combat, Combatant, Duration, Encounter, MonsterDef, Scene } from '../types.ts';
import { uid } from '../uid.ts';
import { addMonsters, concentrationDc, encounterPicks, initOk, monsterHp, newCombat, next, patchCombatant, removeStep, setInit, start, type Expired, type HpOp, type Step } from './combat.ts';
import { restoreCombat, restoreScene, snapshotFight } from './encounters.ts';

// One operation at a time (per tab): two quick hits each read the character after the other's write, so both land.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn);
  queue = p.catch(() => undefined);
  return p;
}

const update = async (cid: string, fn: (c: Combat) => Combat): Promise<Combat> =>
  (await db.combat.update(cid, (c) => ({ ...fn(c ?? newCombat(cid)), updatedAt: Date.now() })))!;

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
export const updateCombat = (cid: string, fn: (c: Combat) => Combat): Promise<Combat> => serial(() => update(cid, fn));

/** Start the fight, or end the turn and start the next; PC conditions that expire are removed from their characters. */
export const turn = (cid: string, dir: 'start' | 'next'): Promise<Step> => serial(async () => {
  let expired: Expired[] = [];
  const combat = await update(cid, (c) => { const s = dir === 'start' ? start(c) : next(c); expired = s.expired; return s.combat; });
  return clearExpired({ combat, expired });
});

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

/** Final M4: ends the fight (deletes the record) in the queue, so an operation sent just before it cannot write a fresh combat after. */
export const endCombat = (cid: string): Promise<unknown> => serial(() => db.combat.update(cid, () => undefined));

/** A PC's condition is on its character, a monster's on the combatant; the duration is on the combatant either way (off drops it). */
export const setCondition = (cid: string, combatantId: string, name: string, on: boolean, duration?: Duration): Promise<Combat> => serial(async () => {
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
    if (y.kind === 'pc') return { ...y, durations };
    const conditions = (y.conditions ?? []).filter((n) => n !== name);
    return { ...y, durations, conditions: on ? [...conditions, name] : conditions };
  }) }));
});

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
  return taken;
});
