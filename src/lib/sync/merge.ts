// Pure (no Svelte/Vite/DOM). Field-level merge of two copies of a synced character (spec 3.6): every tracked path carries the
// HLC of its last change, and a merge takes, per path, the value with the later clock. Same-path conflicts are last-writer-wins.
// mergeCharacter is a join: commutative, associative and idempotent, so devices converge whatever order they sync in.
import type { Character, InventoryEntry } from '../types.ts';
import type { Hlc } from './hlc.ts';

/** `clock`: path → HLC of its last change (see SYNC_PATHS). `gone`: removed inventory entry id → HLC of the removal. */
export interface SyncMeta { clock: Record<string, Hlc>; gone: Record<string, Hlc> }
export type Synced<T> = T & { sync?: SyncMeta };

type Rec = Record<string, unknown>;
type Clocks = Record<string, Hlc>;
type Path = readonly string[];

const TOP = ['name', 'campaignId', 'ownerId', 'imported', 'customEffects'] as const;
const SPLIT = ['build', 'state', 'details', 'currency', 'overrides'] as const;
/**
 * R7: keyed maps split one level deeper, so different keys edited on different devices all survive.
 * N4: a whole-map reset is per-key deletes of the keys the resetting device had, so a key another device added unseen survives it.
 */
const DEEP = new Set(['build.choices', 'build.spells', 'build.subclasses', 'state.resourcesUsed', 'state.hitDiceUsed', 'state.slotsUsed']);
/** An array indexed by spell level: each index is a path, and a missing index reads as 0 (as the sheet reads it). */
const LIST = 'state.slotsUsed';

/**
 * The tracked paths. `*` is any key of that object, so optional keys (`state.stable`, `details.portrait`, a choice) are paths too;
 * a key removed on one device is that path set to "absent" at the removal's clock, and wins over older values like any change.
 * - `name`, `campaignId`, `ownerId`, `imported`, `customEffects`: each top-level field is one path.
 *   Limitation: `customEffects` is one last-writer-wins list (effects have no ids, and only the DM's Edit mode changes them).
 * - `build.*`, `state.*`, `details.*`, `currency.*`, `overrides.*`: one path per key.
 * - `build.choices.*`, `build.spells.*`, `build.subclasses.*`, `state.resourcesUsed.*`, `state.hitDiceUsed.*`: one path per map key.
 * - `state.slotsUsed.<i>`: one path per spell level; missing counts as 0, and a merged list has no trailing zeros.
 * - `inventory/<entryId>`: the whole entry. A removal is a tombstone in `gone`; it wins over any change with an earlier clock.
 * - `order/<entryId>`: not a value but the entry's list position, set when the entry first appears (its add clock plus index); a merge
 *   keeps the earliest. Inventory order is position order: the app only appends, so this is insertion order on every device.
 * Untracked: `id`; `updatedAt` (the merge time); `embedded` (a content cache: the union of both copies, per id the larger value).
 */
export const SYNC_PATHS: readonly string[] = [...TOP, ...SPLIT.map((k) => `${k}.*`), ...[...DEEP].map((k) => `${k}.*`), 'inventory/*', 'order/*'];

/** JSON with object keys sorted, so equal values compare equal whatever order their keys were written in. */
export const canon = (v: unknown): string => JSON.stringify(v, (_, x) =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x) ?? '';

/** Does (c1, v1) beat (c2, v2)? The later clock; on a tie (two unstamped copies, say) the larger value, so the choice is symmetric. */
const beats = (c1: Hlc, v1: unknown, c2: Hlc, v2: unknown): boolean => c1 > c2 || (c1 === c2 && canon(v1) > canon(v2));

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
/** Own properties only: an inherited `constructor` or `__proto__` is never a value. */
const own = (o: unknown, k: string): unknown => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const keysOf = (o: unknown): string[] => (isObj(o) ? Object.keys(o) : []);
const union = (x: unknown, y: unknown) => new Set([...keysOf(x), ...keysOf(y)]);
/** Defines a plain own property, so a `__proto__` key from the network can never set a prototype. */
const define = (o: Rec, k: string, v: unknown) => { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); };
const clockAt = (c: Clocks | undefined, k: string): Hlc => (own(c, k) as Hlc | undefined) ?? '';

/** Per key, the later clock. Built through a Map so a `__proto__` key stays a plain key. */
function join(x: Clocks = {}, y: Clocks = {}): Clocks {
  const m = new Map(Object.entries(x));
  for (const [k, v] of Object.entries(y)) if (!((m.get(k) ?? '') >= v)) m.set(k, v);
  return Object.fromEntries(m);
}

const pad = (i: number) => String(i).padStart(6, '0');
const keyOf = (p: Path) => p.join('.');
const isList = (p: Path) => p.length === 3 && `${p[0]}.${p[1]}` === LIST;

/** Every tracked value path (not inventory) present in either record. */
function valuePaths(a: unknown, b: unknown): Path[] {
  const out: Path[] = TOP.map((k) => [k]);
  for (const k of SPLIT) for (const f of union(own(a, k), own(b, k))) {
    if (!DEEP.has(`${k}.${f}`)) out.push([k, f]);
    else for (const g of union(own(own(a, k), f), own(own(b, k), f))) out.push([k, f, g]);
  }
  return out;
}

function valueAt(r: unknown, p: Path): unknown {
  let v = r;
  for (const k of p) v = own(v, k);
  return v === undefined && isList(p) ? 0 : v;
}

const MAX_SLOT_LEVELS = 20;
/** slotsUsed from its index → count map: holes 0, no trailing zeros. N3: only indexes 0–19 (a crafted key must not allocate), no spread. */
function toList(m: Rec): number[] {
  let len = 0;
  for (const k of Object.keys(m)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < MAX_SLOT_LEVELS && own(m, k) !== 0 && i + 1 > len) len = i + 1;
  }
  return Array.from({ length: len }, (_, i) => (own(m, String(i)) as number | undefined) ?? 0);
}

/** The record's tracked values rebuilt from `get(path)`: SPLIT objects and DEEP containers always exist, absent values are left out. */
function build(a: unknown, b: unknown, get: (p: Path) => unknown): Rec {
  const out: Rec = {};
  for (const k of SPLIT) {
    const o: Rec = {};
    define(out, k, o);
    for (const f of union(own(a, k), own(b, k))) if (DEEP.has(`${k}.${f}`)) define(o, f, {});
  }
  for (const p of valuePaths(a, b)) {
    const v = get(p);
    if (v === undefined) continue;
    let o = out;
    for (const s of p.slice(0, -1)) o = o[s] as Rec; // only SPLIT and DEEP names, never a key from the record
    define(o, p[p.length - 1], v);
  }
  const st = out.state as Rec;
  if (isObj(st.slotsUsed)) st.slotsUsed = toList(st.slotsUsed);
  return out;
}

/** The latest HLC anywhere in the record's clocks and tombstones ('' when unstamped): what a receiver feeds to hlcReceive. */
export function latestClock(c: Synced<Character>): Hlc {
  let max = '';
  for (const v of [...Object.values(c.sync?.clock ?? {}), ...Object.values(c.sync?.gone ?? {})]) if (v > max) max = v;
  return max;
}

/**
 * `next` with its sync meta: every path whose value differs from `prev` (JSON, keys sorted) gets the clock `at`, an inventory entry in
 * `prev` but not in `next` gets a `gone` tombstone, and an entry with no position yet gets one. Any `sync` already on `next` is ignored.
 */
export function stamp(prev: Synced<Character> | undefined, next: Character, at: Hlc): Synced<Character> {
  const clock = new Map(Object.entries(prev?.sync?.clock ?? {})), gone = new Map(Object.entries(prev?.sync?.gone ?? {}));
  for (const p of valuePaths(prev, next)) if (canon(valueAt(prev, p)) !== canon(valueAt(next, p))) clock.set(keyOf(p), at);
  const before = new Map((prev?.inventory ?? []).map((e) => [e.id, e]));
  next.inventory.forEach((e, i) => {
    const had = before.get(e.id);
    if (!had || canon(had) !== canon(e)) clock.set(`inventory/${e.id}`, at);
    if (!clock.has(`order/${e.id}`)) clock.set(`order/${e.id}`, `${at}/${pad(i)}`);
    before.delete(e.id);
  });
  for (const id of before.keys()) gone.set(id, at);
  return { ...next, sync: { clock: Object.fromEntries(clock), gone: Object.fromEntries(gone) } };
}

/**
 * C1: an edit made on a copy loaded before a merge, rebased onto the stored record before it is stamped. `edited.sync` is the meta the
 * editor loaded (its base): every path, entry or removal the store has seen since (a later stored clock) keeps the stored value
 * instead of being stamped back to the stale one. An entry missing from `edited` is a deletion only if its base had it (a position);
 * otherwise it arrived since and stays. Without `edited.sync` (a new or imported record) nothing changes.
 * Limitation: on a path changed remotely since the load, the remote value wins over the stale editor's change of the same path.
 */
export function rebase(stored: Synced<Character> | undefined, edited: Synced<Character>): Character {
  const base = edited.sync?.clock;
  if (!stored || !base) return edited;
  const sc = stored.sync?.clock;
  const newer = (k: string) => clockAt(sc, k) > clockAt(base, k);
  const fromStore = valuePaths(stored, edited).filter((p) => newer(keyOf(p))).map(keyOf);
  const taken = new Set(fromStore);
  const vals = build(stored, edited, (p) => valueAt(taken.has(keyOf(p)) ? stored : edited, p));
  const had = new Map(stored.inventory.map((e) => [e.id, e])), mine = new Set(edited.inventory.map((e) => e.id));
  const inventory = edited.inventory.flatMap((e) => {
    const s = had.get(e.id);
    if (s) return [newer(`inventory/${e.id}`) ? s : e];
    return clockAt(stored.sync?.gone, e.id) > clockAt(edited.sync?.gone, e.id) ? [] : [e]; // removed elsewhere since the load
  });
  for (const s of stored.inventory) if (!mine.has(s.id) && !Object.hasOwn(base, `order/${s.id}`)) inventory.push(s); // added since
  const pos = (e: InventoryEntry) => clockAt(sc, `order/${e.id}`);
  inventory.sort((p, q) => (!pos(p) === !pos(q) ? (pos(p) < pos(q) ? -1 : pos(p) > pos(q) ? 1 : 0) : pos(p) ? -1 : 1));
  // a build value taken from the store may need content the stale copy's snapshot lacks
  const embedded = fromStore.some((k) => k.startsWith('build.')) ? { ...stored.embedded, ...edited.embedded } : edited.embedded;
  const rest: Rec = { ...edited };
  for (const k of TOP) delete rest[k];
  return { ...rest, ...vals, embedded, inventory } as unknown as Character;
}

/**
 * The two copies merged: per path the value with the later clock; inventory the union of entries minus those whose tombstone is
 * later than the entry's clock, in position order. An unstamped copy counts as every path at clock ''. The result always has `sync`.
 */
export function mergeCharacter(a: Synced<Character>, b: Synced<Character>): Synced<Character> {
  const ca = a.sync?.clock ?? {}, cb = b.sync?.clock ?? {};
  const clock = join(ca, cb), gone = join(a.sync?.gone, b.sync?.gone);
  const out = build(a, b, (p) => {
    const va = valueAt(a, p), vb = valueAt(b, p), k = keyOf(p);
    return beats(clockAt(cb, k), vb, clockAt(ca, k), va) ? vb : va;
  });
  define(out, 'id', a.id);

  const embedded: Rec = {};
  for (const k of union(a.embedded, b.embedded)) {
    const x = own(a.embedded, k), y = own(b.embedded, k);
    define(embedded, k, x === undefined ? y : y === undefined || !beats('', y, '', x) ? x : y);
  }
  out.embedded = embedded;

  // Positions take the EARLIEST (an entry keeps the place it was first given). An entry with no stored position (an unstamped
  // copy) is at its index, which sorts before every stamped position.
  const order = new Map<string, string>();
  const earliest = (k: string, v: string) => { const had = order.get(k); if (had === undefined || v < had) order.set(k, v); };
  for (const c of [ca, cb]) for (const [k, v] of Object.entries(c)) if (k.startsWith('order/')) earliest(k, v);
  for (const [c, cl] of [[a, ca], [b, cb]] as const) c.inventory.forEach((e, i) => { if (!Object.hasOwn(cl, `order/${e.id}`)) earliest(`order/${e.id}`, `/${pad(i)}`); });

  const ha = new Map(a.inventory.map((e) => [e.id, e])), hb = new Map(b.inventory.map((e) => [e.id, e]));
  const kept: { e: InventoryEntry; pos: string }[] = [];
  for (const id of new Set([...ha.keys(), ...hb.keys()])) {
    const x = ha.get(id), y = hb.get(id), ip = `inventory/${id}`;
    const g = Object.hasOwn(gone, id) ? gone[id] : undefined;
    if (g !== undefined && g > clockAt(clock, ip)) continue; // the removal is later than the entry's last change
    kept.push({ e: !x ? y! : !y ? x : beats(clockAt(cb, ip), y, clockAt(ca, ip), x) ? y : x, pos: order.get(`order/${id}`)! });
  }
  out.inventory = kept.sort((p, q) => (p.pos < q.pos ? -1 : p.pos > q.pos ? 1 : p.e.id < q.e.id ? -1 : 1)).map((k) => k.e);
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  out.sync = { clock: { ...clock, ...Object.fromEntries(order) }, gone };
  return out as unknown as Synced<Character>;
}

/** Later than any real clock (15 nines of wall time): used only inside replay, never stored. */
const TOP_CLOCK: Hlc = '999999999999999:999999:~';

/**
 * B4: `stored` plus only what changed from `before` to `after` (the edits a holder made while `before` was being saved as `stored`).
 * Every other path keeps the stored value, which may be a remote one the save preserved (C1). The result carries `stored.sync`, so the
 * next save rebases on it and stamps exactly those edits.
 */
export function replay(stored: Synced<Character>, before: Synced<Character>, after: Character): Synced<Character> {
  const { sync: _s, ...m } = mergeCharacter(stored, stamp(before, after, TOP_CLOCK));
  return { ...m, updatedAt: stored.updatedAt, ...(stored.sync && { sync: stored.sync }) };
}
