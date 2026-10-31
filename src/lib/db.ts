import { is2024, strip2024, stripLoot } from './character/strip2024.ts';
import { restorablePack } from './content/sources.ts';
import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb';
import type { Campaign, Character, Pack, PackMeta, StoredItem } from './types.ts';

export class StorageError extends Error {
  override name = 'StorageError';
}

/** Blobs live as bytes + type (structured-cloning a Blob is unreliable under Node and old Safari). */
export interface BlobRecord { hash: string; type: string; data: ArrayBuffer }

interface Schema extends DBSchema {
  campaigns: { key: string; value: Campaign };
  characters: { key: string; value: Character; indexes: { campaignId: string } };
  items: { key: string; value: StoredItem; indexes: { campaignId: string } };
  packMeta: { key: string; value: PackMeta };
  packs: { key: string; value: Pack };
  raw5e: { key: string; value: unknown };
  blobs: { key: string; value: BlobRecord };
  meta: { key: string; value: unknown };
}
type Stores = StoreNames<Schema>;

const NAME = 'dnd-app';
let conn: Promise<IDBPDatabase<Schema>> | undefined;

function open() {
  return (conn ??= openDB<Schema>(NAME, 1, {
    upgrade(d) {
      d.createObjectStore('campaigns', { keyPath: 'id' });
      d.createObjectStore('characters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      d.createObjectStore('items', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      d.createObjectStore('packMeta', { keyPath: 'id' });
      d.createObjectStore('packs', { keyPath: 'id' });
      d.createObjectStore('raw5e');
      d.createObjectStore('blobs', { keyPath: 'hash' });
      d.createObjectStore('meta');
    },
    terminated() { conn = undefined; },
  }).catch((e) => { conn = undefined; throw e; })); // don't cache a failed open
}

/** Test-only: close and delete the database. */
export async function resetDb(): Promise<void> {
  const c = conn;
  conn = undefined;
  (await c)?.close();
  await deleteDB(NAME);
}

/**
 * One readwrite transaction; any failure (including quota) surfaces as StorageError.
 * A throw inside fn does not abort an IndexedDB transaction by itself, so earlier queued writes
 * would commit; we abort explicitly to keep the transaction all-or-nothing.
 * fn must await each request before starting the next: a request promise dropped by a throw
 * would reject unhandled when the abort cancels it.
 */
async function write<N extends Stores>(names: N[], fn: (tx: IDBPTransaction<Schema, N[], 'readwrite'>) => Promise<unknown>): Promise<void> {
  try {
    const tx = (await open()).transaction(names, 'readwrite');
    try {
      // tx.done is read first and the async wrapper turns a synchronous throw from fn into a rejection,
      // so Promise.all always observes tx.done (it rejects once we abort)
      await Promise.all([tx.done, (async () => fn(tx))()]);
    } catch (e) {
      try { tx.abort(); } catch { /* already finished or aborted */ }
      throw e;
    }
  } catch (e) {
    throw new StorageError('Could not save: ' + ((e as Error)?.message ?? e));
  }
}

/** SHA-256 of the bytes, lowercase hex. This is the key blobs are stored under. */
export const sha256Hex = async (data: ArrayBuffer) => {
  if (!crypto.subtle) throw new Error('Images need a secure connection (https): this browser offers no hashing over plain http.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
};

function packMeta(p: Pack): PackMeta {
  const counts: PackMeta['counts'] = {};
  for (const e of p.entities) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return { id: p.id, name: p.name, source: p.source, ...(p.homebrew && { homebrew: true }), importedAt: p.importedAt, hash: p.hash, counts };
}

const maybe = <T>(f: (x: T) => T, x: T | undefined) => (x === undefined ? x : f(x));

export interface Snapshot { campaigns: Campaign[]; characters: Character[]; items: StoredItem[]; packs: Pack[]; blobs: BlobRecord[] }

export const db = {
  // R54: characters and campaigns pass through strip2024 / stripLoot on every read and write (a read strips only the copy in memory).
  campaigns: {
    list: async () => (await (await open()).getAll('campaigns')).map(stripLoot),
    get: async (id: string) => maybe(stripLoot, await (await open()).get('campaigns', id)),
    put: (c: Campaign) => write(['campaigns'], (tx) => tx.objectStore('campaigns').put({ ...stripLoot(c), updatedAt: Date.now() })),
    /** Removes the campaign and its items; its characters stay, unassigned. */
    delete: (id: string) => write(['campaigns', 'characters', 'items'], async (tx) => {
      await tx.objectStore('campaigns').delete(id);
      const items = tx.objectStore('items');
      for (const k of await items.index('campaignId').getAllKeys(id)) await items.delete(k);
      const chars = tx.objectStore('characters');
      for (const c of await chars.index('campaignId').getAll(id)) await chars.put({ ...c, campaignId: undefined, updatedAt: Date.now() });
    }),
  },
  characters: {
    list: async (campaignId?: string) => {
      const d = await open();
      return (await (campaignId === undefined ? d.getAll('characters') : d.getAllFromIndex('characters', 'campaignId', campaignId))).map(strip2024);
    },
    get: async (id: string) => maybe(strip2024, await (await open()).get('characters', id)),
    put: (c: Character) => write(['characters'], (tx) => tx.objectStore('characters').put({ ...strip2024(c), updatedAt: Date.now() })),
    delete: (id: string) => write(['characters'], (tx) => tx.objectStore('characters').delete(id)),
  },
  items: {
    // R60: a stored 2024 item (an old import, a crafted file) is hidden, never deleted, like R54's stripping.
    list: async (campaignId: string) => (await (await open()).getAllFromIndex('items', 'campaignId', campaignId)).filter((i) => !is2024(i)),
    get: async (id: string) => {
      const i = await (await open()).get('items', id);
      return is2024(i) ? undefined : i;
    },
    put: (i: StoredItem) => write(['items'], (tx) => tx.objectStore('items').put({ ...i, updatedAt: Date.now() })),
    delete: (id: string) => write(['items'], (tx) => tx.objectStore('items').delete(id)),
  },
  packs: {
    listMeta: async (): Promise<PackMeta[]> => (await open()).getAll('packMeta'),
    get: async (id: string) => (await open()).get('packs', id),
    put: (p: Pack) => write(['packs', 'packMeta'], async (tx) => {
      await tx.objectStore('packs').put(p);
      await tx.objectStore('packMeta').put(packMeta(p));
    }),
    delete: (id: string) => write(['packs', 'packMeta'], async (tx) => {
      await tx.objectStore('packs').delete(id);
      await tx.objectStore('packMeta').delete(id);
    }),
    /**
     * R52: removes a pack, drops it from every campaign's enabledPacks and forgets its stored raw entities (raw keys end in
     * `|SOURCE`), all in one transaction. Characters keep the content they embedded.
     */
    remove: (id: string) => write(['packs', 'packMeta', 'campaigns', 'raw5e'], async (tx) => {
      const source = (await tx.objectStore('packMeta').get(id))?.source ?? (await tx.objectStore('packs').get(id))?.source;
      await tx.objectStore('packs').delete(id);
      await tx.objectStore('packMeta').delete(id);
      const campaigns = tx.objectStore('campaigns');
      for (const c of await campaigns.getAll()) {
        if (c.enabledPacks.includes(id)) await campaigns.put({ ...c, enabledPacks: c.enabledPacks.filter((x) => x !== id), updatedAt: Date.now() });
      }
      if (source === undefined) return;
      const raw = tx.objectStore('raw5e'), suffix = '|' + source.toUpperCase();
      for (const k of await raw.getAllKeys()) if (typeof k === 'string' && k.endsWith(suffix)) await raw.delete(k);
    }),
  },
  raw5e: {
    getMany: async (keys: string[]): Promise<(unknown | undefined)[]> => {
      const store = (await open()).transaction('raw5e').store;
      return Promise.all(keys.map((k) => store.get(k)));
    },
    putMany: (entries: [string, unknown][]) => write(['raw5e'], async (tx) => {
      const store = tx.objectStore('raw5e');
      for (const [k, v] of entries) await store.put(v, k);
    }),
  },
  blobs: {
    /** Stores the blob and returns its SHA-256 hex. */
    put: async (blob: Blob): Promise<string> => {
      const data = await blob.arrayBuffer();
      const hash = await sha256Hex(data);
      await write(['blobs'], (tx) => tx.objectStore('blobs').put({ hash, type: blob.type, data }));
      return hash;
    },
    get: async (hash: string): Promise<Blob | undefined> => {
      const r = await (await open()).get('blobs', hash);
      return r && new Blob([r.data], { type: r.type });
    },
    all: async () => (await open()).getAll('blobs'),
  },
  meta: {
    get: async <T>(key: string) => (await (await open()).get('meta', key)) as T | undefined,
    set: (key: string, value: unknown) => write(['meta'], (tx) => tx.objectStore('meta').put(value, key)),
  },
  /** R44: characters and a campaign in one transaction (an item transfer touches both sides), stamping updatedAt like put. */
  saveTogether: ({ characters = [], campaign }: { characters?: Character[]; campaign?: Campaign }) => write(['characters', 'campaigns'], async (tx) => {
    for (const c of characters) await tx.objectStore('characters').put({ ...strip2024(c), updatedAt: Date.now() });
    if (campaign) await tx.objectStore('campaigns').put({ ...stripLoot(campaign), updatedAt: Date.now() });
  }),
  /**
   * R57: what a backup import would overwrite here. `replaced`: stored records with the same key (campaigns, characters, items, packs,
   * blobs); `newer`: those of them with a later updatedAt than the file's copy. A record with no numeric updatedAt counts only as replaced.
   */
  countReplaced: async (s: Snapshot): Promise<{ replaced: number; newer: number }> => {
    const tx = (await open()).transaction(['campaigns', 'characters', 'items', 'packs', 'blobs']);
    let replaced = 0, newer = 0;
    for (const name of ['campaigns', 'characters', 'items', 'packs'] as const) {
      for (const r of s[name] as { id: string; updatedAt?: unknown }[]) {
        const had = (await tx.objectStore(name).get(r.id)) as { updatedAt?: unknown } | undefined;
        if (!had) continue;
        replaced++;
        if (typeof r.updatedAt === 'number' && typeof had.updatedAt === 'number' && had.updatedAt > r.updatedAt) newer++;
      }
    }
    for (const b of s.blobs) if (await tx.objectStore('blobs').getKey(b.hash)) replaced++;
    return { replaced, newer };
  },
  /** Backup import: one atomic upsert that keeps the records' own updatedAt. */
  restore: (s: Snapshot) => write(['campaigns', 'characters', 'items', 'packs', 'packMeta', 'blobs'], async (tx) => {
    for (const r of s.campaigns) await tx.objectStore('campaigns').put(stripLoot(r));
    for (const r of s.characters) await tx.objectStore('characters').put(strip2024(r));
    for (const r of s.items.filter((i) => !is2024(i))) await tx.objectStore('items').put(r); // R60
    for (const p of s.packs.filter(restorablePack)) { // the built-in SRD always comes from the shipped asset (R52)
      await tx.objectStore('packs').put(p);
      await tx.objectStore('packMeta').put(packMeta(p));
    }
    for (const r of s.blobs) await tx.objectStore('blobs').put(r);
  }),
};

/** Ask the browser not to evict our data. False when unsupported or denied. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
