// Pure (no Svelte/Vite/DOM): the initiative tracker's rules. Lazy: only the tracker page and combat/store.ts import it at run time.
import { rollDice } from '../dice.ts';
import { abilityMod } from '../rules/constants.ts';
import type { Character, Combat, Combatant, Duration, Encounter, MonsterDef, Sheet } from '../types.ts';
import { uid } from '../uid.ts';
import { resetMovement } from './movement.ts';

export const MAX_COMBATANTS = 200;
/** An initiative total is an integer in this range (the one source; the sync protocol imports it). */
export const INIT_MIN = -10, INIT_MAX = 50;
export const initOk = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= INIT_MIN && (n as number) <= INIT_MAX;
export type HpOp = { damage: number; crit?: boolean } | { heal: number } | { temp: number };
export interface Expired { combatantId: string; condition: string }
/** `failed` (store only): names of characters whose expired conditions could not be removed (M3). */
export interface Step { combat: Combat; expired: Expired[]; failed?: string[] }
type Pick = { monster: MonsterDef; count: number };

export const newCombat = (campaignId: string): Combat => ({ campaignId, combatants: [], round: 0, groupMonsters: false, updatedAt: Date.now(), fightId: uid() });

/** a acts before b: higher init (unset last), a lair loses a tie, then higher Dex score, then the stored random tiebreak. */
export function outranks(a: Combatant, b: Combatant): boolean {
  if (a.init !== b.init) return b.init === undefined || (a.init !== undefined && a.init > b.init);
  if ((a.kind === 'lair') !== (b.kind === 'lair')) return b.kind === 'lair';
  if (a.dex !== b.dex) return a.dex > b.dex;
  return a.tie > b.tie;
}

export const sortCombatants = (cs: Combatant[]): Combatant[] => [...cs].sort((a, b) => (outranks(a, b) ? -1 : outranks(b, a) ? 1 : 0));

/** (Re)inserts c before the first combatant it outranks, so a manual order elsewhere is kept. */
export function place(cs: Combatant[], c: Combatant): Combatant[] {
  const rest = cs.filter((x) => x.id !== c.id);
  const i = rest.findIndex((x) => outranks(c, x));
  return i < 0 ? [...rest, c] : [...rest.slice(0, i), c, ...rest.slice(i)];
}

/** Drag (or up/down = index ± 1); the index clamps to the list. */
export function moveTo(cs: Combatant[], id: string, index: number): Combatant[] {
  const c = cs.find((x) => x.id === id);
  if (!c) return cs;
  const rest = cs.filter((x) => x.id !== id);
  const i = Math.max(0, Math.min(rest.length, Math.trunc(index) || 0));
  return [...rest.slice(0, i), c, ...rest.slice(i)];
}

/** S4-R2: a drag on the combat; Start then keeps the order until the next Sort or add. */
export const moveCombatant = (c: Combat, id: string, index: number): Combat => ({ ...c, combatants: moveTo(c.combatants, id, index), reordered: true });
/** The Sort button. */
export const sortCombat = (c: Combat): Combat => ({ ...c, combatants: sortCombatants(c.combatants), reordered: false });

export const rollInit = (mod: number, rng?: () => number): number => rollDice(mod < 0 ? `1d20${mod}` : `1d20+${mod}`, { rng }).total;

/** A party character; its initiative is unset (the player rolls, or the DM types or rolls). */
export const pcCombatant = (c: Character, sheet: Sheet, rng: () => number = Math.random): Combatant => ({
  id: `pc:${c.id}`, kind: 'pc', name: c.name, characterId: c.id, initMod: sheet.initiative, dex: sheet.scores.dex, tie: rng(), conSave: sheet.saves.con.bonus, ac: sheet.ac,
});

function rolledHp(formula: string, rng: () => number): number | undefined {
  try { return Math.max(1, rollDice(formula, { rng }).total); } catch { return undefined; } // a homebrew formula the roller can't read: the average
}

export function monsterCombatant(m: MonsterDef, name: string, hpMode: 'average' | 'roll', rng: () => number = Math.random): Combatant {
  const initMod = abilityMod(m.scores.dex);
  const init = rollInit(initMod, rng);
  const tie = rng();
  const hp = 'average' in m.hp ? (hpMode === 'roll' && m.hp.formula ? rolledHp(m.hp.formula, rng) : undefined) ?? m.hp.average : undefined; // {special}: the DM types it
  return {
    id: uid(), kind: 'monster', name, monsterId: m.id, ac: m.ac[0]?.value, init, initMod, dex: m.scores.dex, tie, conSave: m.saves.con ?? abilityMod(m.scores.con),
    ...(hp !== undefined && { hp, maxHp: hp }),
    ...(m.legendary.length && { legendary: { max: m.legendaryCount ?? 3, used: 0 } }),
  };
}

export const lairCombatant = (): Combatant => ({ id: 'lair', kind: 'lair', name: 'Lair actions', init: 20, initMod: 0, dex: 0, tie: 0, conSave: 0 });

/** Numbered when the batch has more than one or the fight already holds the name; numbers continue from the highest `Base` / `Base N`. */
export function numberedNames(base: string, count: number, existing: string[]): string[] {
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: (\\d+))?$');
  let top = 0;
  for (const n of existing) { const m = re.exec(n); if (m) top = Math.max(top, m[1] ? Number(m[1]) : 1); }
  if (count === 1 && top === 0) return [base];
  return Array.from({ length: count }, (_, i) => `${base} ${top + i + 1}`);
}

/** Places each; one already in (a PC, the lair) is skipped; stops at MAX_COMBATANTS. Never moves the turn. */
export function addCombatants(c: Combat, list: Combatant[]): Combat {
  let cs = c.combatants;
  for (const x of list) {
    if (cs.length >= MAX_COMBATANTS) break;
    if (!cs.some((y) => y.id === x.id)) cs = place(cs, x);
  }
  return { ...c, combatants: cs, reordered: false };
}

/** With groupMonsters on, copies of a monster share one roll, one tiebreak and `group` (a later copy joins the existing group). */
export function addMonsters(c: Combat, picks: Pick[], hpMode: 'average' | 'roll', rng: () => number = Math.random): Combat {
  const list: Combatant[] = [];
  let room = MAX_COMBATANTS - c.combatants.length;
  for (const { monster, count } of picks) {
    const n = Math.min(count, room);
    if (!(n >= 1)) continue;
    room -= n;
    const all = [...c.combatants, ...list];
    const built = numberedNames(monster.name, n, all.map((x) => x.name)).map((name) => monsterCombatant(monster, name, hpMode, rng));
    if (c.groupMonsters) {
      const lead = all.find((x) => x.group === monster.id) ?? built[0];
      for (const b of built) Object.assign(b, { group: monster.id, init: lead.init, tie: lead.tie });
    }
    list.push(...built);
  }
  return addCombatants(c, list);
}

/** A prepared encounter's lines that still resolve; `missing` names the monster ids that don't (deleted, pack disabled). */
export function encounterPicks(e: Encounter, lookup: (id: string) => MonsterDef | undefined): { picks: Pick[]; missing: string[] } {
  const picks: Pick[] = [], missing: string[] = [];
  for (const l of e.monsters) {
    const m = lookup(l.monsterId);
    if (m) picks.push({ monster: m, count: l.count }); else missing.push(l.name ?? l.monsterId);
  }
  return { picks, missing };
}

/**
 * Sets the initiative (an integer INIT_MIN–INIT_MAX, or undefined; anything else is refused) and re-places the combatant (a grouped
 * monster's whole group, which acts as one). S4-R1: during a fight nobody crosses the current turn. A member of the current run keeps
 * its place; anyone else is placed by key but stays on its side: already acted, or still to act (where an unset init counts).
 */
export function setInit(c: Combat, id: string, init: number | undefined): Combat {
  const x = c.combatants.find((y) => y.id === id);
  if (!x || (init !== undefined && !initOk(init))) return c;
  const members = new Set(c.combatants.filter((y) => y.id === id || (x.group !== undefined && y.group === x.group)).map((y) => y.id));
  const t = c.combatants.findIndex((y) => y.id === c.turn);
  if (c.round === 0 || t < 0) {
    let cs = c.combatants;
    for (const y of c.combatants) if (members.has(y.id)) cs = place(cs, { ...y, init });
    return { ...c, combatants: cs };
  }
  if (idsOf(c.combatants, runAt(c.combatants, t)).has(id)) return { ...c, combatants: c.combatants.map((y) => (members.has(y.id) ? { ...y, init } : y)) };
  let cs = c.combatants;
  for (const y of c.combatants) {
    if (!members.has(y.id)) continue;
    const toAct = y.init === undefined || cs.findIndex((z) => z.id === y.id) > runAt(cs, cs.findIndex((z) => z.id === c.turn))[1];
    const rest = cs.filter((z) => z.id !== y.id), moved = { ...y, init };
    const [ra, rb] = runAt(rest, rest.findIndex((z) => z.id === c.turn));
    let i = rest.findIndex((z) => outranks(moved, z));
    if (i < 0) i = rest.length;
    i = toAct ? Math.max(i, rb + 1) : Math.min(i, ra);
    cs = [...rest.slice(0, i), moved, ...rest.slice(i)];
  }
  return { ...c, combatants: cs };
}

export const patchCombatant = (c: Combat, id: string, patch: Partial<Combatant>): Combat =>
  ({ ...c, combatants: c.combatants.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) });

// ---- Turns ----

/** [first, last] index of the turn holding cs[i]: the combatant, or the run of adjacent ones sharing its group. */
function runAt(cs: Combatant[], i: number): [number, number] {
  const g = cs[i].group;
  let a = i, b = i;
  if (g !== undefined) {
    while (a > 0 && cs[a - 1].group === g) a--;
    while (b < cs.length - 1 && cs[b + 1].group === g) b++;
  }
  return [a, b];
}
const idsOf = (cs: Combatant[], [a, b]: [number, number]) => new Set(cs.slice(a, b + 1).map((x) => x.id));
/** The ids acting on the current turn (a grouped run is several); empty in setup or with no turn. */
export function currentRun(c: Combat): Set<string> {
  const i = c.combatants.findIndex((x) => x.id === c.turn);
  return c.round === 0 || i < 0 ? new Set() : idsOf(c.combatants, runAt(c.combatants, i));
}
/** Drops the movement entries of `ids` (their own turn starts, or they left the fight). */
const dropMoves = (c: Combat, ids: Iterable<string>): Combat => { for (const id of ids) c = resetMovement(c, id); return c; };

/** Ticks the durations triggered at `at` of the combatants in `run`; an ended one goes (with a monster's condition) and is listed. */
function tick(cs: Combatant[], run: Set<string>, at: Duration['at'], expired: Expired[]): Combatant[] {
  return cs.map((x) => {
    if (!x.durations) return x;
    let hit = false, conditions = x.conditions;
    const kept: [string, Duration][] = [];
    for (const [name, d] of Object.entries(x.durations)) {
      if (d.at !== at || !run.has(d.of)) { kept.push([name, d]); continue; }
      hit = true;
      if (d.rounds > 1) kept.push([name, { ...d, rounds: d.rounds - 1 }]);
      else {
        expired.push({ combatantId: x.id, condition: name });
        if (x.kind !== 'pc') conditions = conditions?.filter((n) => n !== name);
      }
    }
    return hit ? { ...x, durations: Object.fromEntries(kept), ...(conditions && { conditions }) } : x;
  });
}

/** Where its own turn starts: fresh pips and Reaction, legendary uses back. */
export const freshTurn = (x: Combatant): Combatant => {
  const { economy: _e, ...y } = x;
  return { ...y, reactionUsed: false, ...(x.legendary && { legendary: { ...x.legendary, used: 0 } }) };
};

function startTurn(cs: Combatant[], r: [number, number], expired: Expired[]): Combatant[] {
  const run = idsOf(cs, r);
  const reset = cs.map((x) => (run.has(x.id) ? freshTurn(x) : x));
  return tick(reset, run, 'start', expired);
}

/**
 * The turn goes to the run at index j (past the end: the first, in a new round), with its start-of-turn effects unless that boundary
 * was applied already (M1: after Previous). Markers older than the previous round are dropped.
 */
function pass(c: Combat, cs: Combatant[], j: number, expired: Expired[]): Combat {
  if (!cs.length) return { ...c, combatants: cs, turn: undefined };
  const wrap = j >= cs.length, at = wrap ? 0 : j;
  const round = wrap ? c.round + 1 : c.round, turn = cs[at].id, key = `${round}:s:${turn}`;
  const done = (c.done ?? []).filter((k) => parseInt(k, 10) >= round - 1);
  const fresh = !done.includes(key);
  if (!fresh) return { ...c, combatants: cs, round, turn, done };
  return dropMoves({ ...c, combatants: startTurn(cs, runAt(cs, at), expired), round, turn, done: [...done, key] }, idsOf(cs, runAt(cs, at)));
}

/** Round 1, the first combatant's turn (with its start-of-turn effects). Sorts first, unless the DM reordered by hand (S4-R2). */
export function start(c: Combat): Step {
  const cs = c.reordered ? c.combatants : sortCombatants(c.combatants);
  if (!cs.length) return { combat: { ...c, combatants: cs }, expired: [] };
  const expired: Expired[] = [];
  return { combat: dropMoves({ ...c, combatants: startTurn(cs, runAt(cs, 0), expired), round: 1, turn: cs[0].id, done: [`1:s:${cs[0].id}`] }, idsOf(cs, runAt(cs, 0))), expired };
}

/** Ends the current turn (its end-of-turn durations tick, once: M1), then starts the next (wrapping to a new round). */
export function next(c: Combat): Step {
  const i = c.combatants.findIndex((x) => x.id === c.turn);
  if (c.round === 0 || i < 0) return start(c);
  const expired: Expired[] = [];
  const r = runAt(c.combatants, i), key = `${c.round}:e:${c.turn}`;
  const ended = (c.done ?? []).includes(key);
  const cs = ended ? c.combatants : tick(c.combatants, idsOf(c.combatants, r), 'end', expired);
  return { combat: pass(ended ? c : { ...c, done: [...(c.done ?? []), key] }, cs, r[1] + 1, expired), expired };
}

/** The pointer only (round − 1 on a wrap, never below 1): undoes no resets or expirations. */
export function prev(c: Combat): Combat {
  const i = c.combatants.findIndex((x) => x.id === c.turn);
  if (c.round === 0 || i < 0) return c;
  let j = runAt(c.combatants, i)[0] - 1, round = c.round;
  if (j < 0) {
    if (round <= 1) return c;
    j = c.combatants.length - 1;
    round--;
  }
  return { ...c, round, turn: c.combatants[runAt(c.combatants, j)[0]].id };
}

/**
 * Removes a combatant. Durations counted on it become untimed (the condition stays). Removing the current one passes the turn as `next`
 * would, without its end-of-turn effects (a grouped monster's group keeps the turn). `expired`: the next turn's start-of-turn expirations.
 */
export function removeStep(c: Combat, id: string): Step {
  const i = c.combatants.findIndex((x) => x.id === id);
  if (i < 0) return { combat: c, expired: [] };
  c = resetMovement(c, id);
  const untimed = (x: Combatant): Combatant => (x.durations && Object.values(x.durations).some((d) => d.of === id)
    ? { ...x, durations: Object.fromEntries(Object.entries(x.durations).filter(([, d]) => d.of !== id)) } : x);
  const cs = c.combatants.filter((x) => x.id !== id).map(untimed);
  if (c.turn !== id || c.round === 0) return { combat: { ...c, combatants: cs }, expired: [] };
  const [a, b] = runAt(c.combatants, i);
  if (b > a) return { combat: { ...c, combatants: cs, turn: c.combatants.slice(a, b + 1).find((x) => x.id !== id)!.id }, expired: [] };
  const expired: Expired[] = [];
  return { combat: pass(c, cs, i, expired), expired };
}
export const removeCombatant = (c: Combat, id: string): Combat => removeStep(c, id).combat;

/** Damage takes temp HP first and HP floors at 0; healing caps at maxHp; temp HP replaces (no stacking). */
export function monsterHp(x: Combatant, op: HpOp): Combatant {
  if ('temp' in op) return { ...x, tempHp: Math.max(0, op.temp) };
  if ('heal' in op) return x.hp === undefined ? x : { ...x, hp: Math.min(x.maxHp ?? Infinity, x.hp + Math.max(0, op.heal)) };
  const n = Math.max(0, op.damage), temp = x.tempHp ?? 0, absorbed = Math.min(temp, n);
  return { ...x, tempHp: temp - absorbed, ...(x.hp !== undefined && { hp: Math.max(0, x.hp - (n - absorbed)) }) };
}

export const concentrationDc = (damage: number): number => Math.max(10, Math.floor(damage / 2));
