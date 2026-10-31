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

const TOP = ['name', 'campaignId', 'ownerId', 'imported', 'overrides', 'customEffects'] as const;
const SPLIT = ['build', 'state', 'details', 'currency'] as const;

/**
 * The tracked paths. `*` is any key of that object (so optional keys such as `state.stable` are paths too).
 * - `name` … `customEffects`: each top-level field is one path.
 * - `build.*`, `state.*`, `details.*`, `currency.*`: one path per key, one level deep.
 * - `inventory/<entryId>`: the whole entry. A removal is a tombstone in `gone`; it wins over any change with an earlier clock.
 * - `order/<entryId>`: not a value but the entry's list position, set when the entry first appears (its add clock plus index); a merge keeps the
 *   earliest. Inventory order is position order: the app only appends, so this is insertion order on every device.
 * Untracked: `id`; `updatedAt` (the merge time); `embedded` (taken from the copy whose newest `build.*` clock is later).
 */
export const SYNC_PATHS: readonly string[] = [...TOP, ...SPLIT.map((k) => `${k}.*`), 'inventory/*', 'order/*'];

/** JSON with object keys sorted, so equal values compare equal whatever order their keys were written in. */
export const canon = (v: unknown): string => JSON.stringify(v, (_, x) =>
  typeof x === 'object' && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x) ?? '';

/** Does (c1, v1) beat (c2, v2)? The later clock; on a tie (two unstamped copies, say) the larger value, so the choice is symmetric. */
const beats = (c1: Hlc, v1: unknown, c2: Hlc, v2: unknown): boolean => c1 > c2 || (c1 === c2 && canon(v1) > canon(v2));

/** Per key, the later clock. Built through a Map so a `__proto__` key stays a plain key. */
function join(x: Clocks = {}, y: Clocks = {}): Clocks {
  const m = new Map(Object.entries(x));
  for (const [k, v] of Object.entries(y)) if (!((m.get(k) ?? '') >= v)) m.set(k, v);
  return Object.fromEntries(m);
}

const fields = (r: Rec | undefined, k: string) => (r?.[k] ?? {}) as Rec;
const pad = (i: number) => String(i).padStart(6, '0');

/** Every tracked value path (not inventory) present in either record. */
function valuePaths(a: Rec | undefined, b: Rec): string[] {
  const out: string[] = [...TOP];
  for (const k of SPLIT) for (const f of new Set([...Object.keys(fields(a, k)), ...Object.keys(fields(b, k))])) out.push(`${k}.${f}`);
  return out;
}

const valueAt = (r: Rec | undefined, path: string): unknown => {
  const dot = path.indexOf('.');
  return dot < 0 ? r?.[path] : fields(r, path.slice(0, dot))[path.slice(dot + 1)];
};

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
  const p = prev as Rec | undefined, n = next as unknown as Rec;
  for (const path of valuePaths(p, n)) if (canon(valueAt(p, path)) !== canon(valueAt(n, path))) clock.set(path, at);
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

/** The newest `build.*` clock of a record. */
const buildClock = (c: Clocks) => Object.entries(c).reduce((m, [k, v]) => (k.startsWith('build.') && v > m ? v : m), '');

/**
 * The two copies merged: per path the value with the later clock; inventory the union of entries minus those whose tombstone is
 * later than the entry's clock, in position order. An unstamped copy counts as every path at clock ''. The result always has `sync`.
 */
export function mergeCharacter(a: Synced<Character>, b: Synced<Character>): Synced<Character> {
  const ca = a.sync?.clock ?? {}, cb = b.sync?.clock ?? {};
  const ra = a as unknown as Rec, rb = b as unknown as Rec;
  const clock = join(ca, cb), gone = join(a.sync?.gone, b.sync?.gone);
  const pick = (path: string) => {
    const va = valueAt(ra, path), vb = valueAt(rb, path);
    return beats(cb[path] ?? '', vb, ca[path] ?? '', va) ? vb : va;
  };
  const out: Rec = { id: a.id };
  for (const k of TOP) { const v = pick(k); if (v !== undefined) out[k] = v; }
  for (const k of SPLIT) {
    const keys = new Set([...Object.keys(fields(ra, k)), ...Object.keys(fields(rb, k))]);
    out[k] = Object.fromEntries([...keys].flatMap((f) => { const v = pick(`${k}.${f}`); return v === undefined ? [] : [[f, v]]; }));
  }
  out.embedded = beats(buildClock(cb), b.embedded, buildClock(ca), a.embedded) ? b.embedded : a.embedded;

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
    if (g !== undefined && g > (clock[ip] ?? '')) continue; // the removal is later than the entry's last change
    kept.push({ e: !x ? y! : !y ? x : beats(cb[ip] ?? '', y, ca[ip] ?? '', x) ? y : x, pos: order.get(`order/${id}`)! });
  }
  out.inventory = kept.sort((p, q) => (p.pos < q.pos ? -1 : p.pos > q.pos ? 1 : p.e.id < q.e.id ? -1 : 1)).map((k) => k.e);
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  out.sync = { clock: { ...clock, ...Object.fromEntries(order) }, gone };
  return out as unknown as Synced<Character>;
}
