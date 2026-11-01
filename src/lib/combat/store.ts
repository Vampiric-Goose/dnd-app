// The tracker's db operations (lazy: reached by dynamic import only). PC changes go through db.characters.put from a fresh read, so
// stage 3 stamps and syncs them; monster HP lives only in the combat record.
import { applyDamage, applyHealing, rollDeathSave } from '../character/rest.ts';
import { db, DeletedError } from '../db.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { CampaignSettings, Character, Combat, Combatant, Duration } from '../types.ts';
import { concentrationDc, monsterHp, newCombat, next, removeStep, setInit, start, type Expired, type HpOp, type Step } from './combat.ts';

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
async function editCharacter(id: string, fn: (c: Character) => Character): Promise<boolean> {
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

/** Each expired PC condition leaves its character (one put per character). */
async function clearExpired(combat: Combat, expired: Expired[]): Promise<void> {
  const byChar = new Map<string, Set<string>>();
  for (const e of expired) {
    const x = combat.combatants.find((y) => y.id === e.combatantId);
    if (x?.kind === 'pc' && x.characterId) byChar.set(x.characterId, (byChar.get(x.characterId) ?? new Set()).add(e.condition));
  }
  for (const [id, gone] of byChar) {
    await editCharacter(id, (c) => (c.state.conditions.some((n) => gone.has(n)) ? { ...c, state: { ...c.state, conditions: c.state.conditions.filter((n) => !gone.has(n)) } } : c));
  }
}

/** The campaign's combat changed by `fn` (a new one when there is none), with updatedAt stamped. */
export const updateCombat = (cid: string, fn: (c: Combat) => Combat): Promise<Combat> => serial(() => update(cid, fn));

/** Start the fight, or end the turn and start the next; PC conditions that expire are removed from their characters. */
export const turn = (cid: string, dir: 'start' | 'next'): Promise<Step> => serial(async () => {
  let expired: Expired[] = [];
  const combat = await update(cid, (c) => { const s = dir === 'start' ? start(c) : next(c); expired = s.expired; return s.combat; });
  await clearExpired(combat, expired);
  return { combat, expired };
});

/** removeCombatant, writing the PC side of any expiry the passed turn starts (see removeStep). */
export const remove = (cid: string, combatantId: string): Promise<Step> => serial(async () => {
  let expired: Expired[] = [];
  const combat = await update(cid, (c) => { const s = removeStep(c, combatantId); expired = s.expired; return s.combat; });
  await clearExpired(combat, expired);
  return { combat, expired };
});

/** `concentrationDc`: a damage op on a concentrating combatant (the full amount entered, temp HP included). */
export const changeHp = (cid: string, combatantId: string, op: HpOp, settings: CampaignSettings): Promise<{ combat: Combat; concentrationDc?: number }> => serial(async () => {
  const { combat: had, x } = await combatant(cid, combatantId);
  const dc = 'damage' in op && op.damage > 0 && x.concentrating ? concentrationDc(op.damage) : undefined;
  let combat = had;
  if (x.kind === 'pc') {
    if (x.characterId) await editCharacter(x.characterId, (c) => {
      const sheet = computeSheet(c, { settings, viewer: 'dm' });
      return 'damage' in op ? applyDamage(c, op.damage, sheet, op.crit) : 'heal' in op ? applyHealing(c, op.heal, sheet) : { ...c, state: { ...c.state, tempHp: Math.max(0, op.temp) } };
    });
  } else combat = await update(cid, (c) => ({ ...c, combatants: c.combatants.map((y) => (y.id === combatantId ? monsterHp(y, op) : y)) }));
  return { combat, ...(dc !== undefined && { concentrationDc: dc }) };
});

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

export const deathSave = (cid: string, combatantId: string, d20: number): Promise<void> => serial(async () => {
  const { x } = await combatant(cid, combatantId);
  if (x.kind === 'pc' && x.characterId) await editCharacter(x.characterId, (c) => rollDeathSave(c, d20));
});

/**
 * A player's own roll (validated by the host first): taken only while the fight holds that character as a PC with no initiative yet.
 * False otherwise, and the combat is left untouched.
 */
export const applyInitiative = (cid: string, characterId: string, total: number): Promise<boolean> => serial(async () => {
  let taken = false;
  await db.combat.update(cid, (c) => {
    const x = c?.combatants.find((y) => y.kind === 'pc' && y.characterId === characterId && y.init === undefined);
    if (!c || !x) return c;
    taken = true;
    return { ...setInit(c, x.id, total), updatedAt: Date.now() };
  });
  return taken;
});
