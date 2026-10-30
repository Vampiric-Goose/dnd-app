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

/** One readwrite transaction; any failure (including quota) surfaces as StorageError. */
async function write<N extends Stores>(names: N[], fn: (tx: IDBPTransaction<Schema, N[], 'readwrite'>) => Promise<unknown>): Promise<void> {
  try {
    const tx = (await open()).transaction(names, 'readwrite');
    await Promise.all([fn(tx), tx.done]); // awaiting both keeps tx.done's rejection handled
  } catch (e) {
    throw new StorageError('Could not save: ' + ((e as Error)?.message ?? e));
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function packMeta(p: Pack): PackMeta {
  const counts: PackMeta['counts'] = {};
  for (const e of p.entities) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  return { id: p.id, name: p.name, source: p.source, importedAt: p.importedAt, hash: p.hash, counts };
}

export interface Snapshot { campaigns: Campaign[]; characters: Character[]; items: StoredItem[]; packs: Pack[]; blobs: BlobRecord[] }

export const db = {
  campaigns: {
    list: async () => (await open()).getAll('campaigns'),
    get: async (id: string) => (await open()).get('campaigns', id),
    put: (c: Campaign) => write(['campaigns'], (tx) => tx.objectStore('campaigns').put({ ...c, updatedAt: Date.now() })),
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
      return campaignId === undefined ? d.getAll('characters') : d.getAllFromIndex('characters', 'campaignId', campaignId);
    },
    get: async (id: string) => (await open()).get('characters', id),
    put: (c: Character) => write(['characters'], (tx) => tx.objectStore('characters').put({ ...c, updatedAt: Date.now() })),
    delete: (id: string) => write(['characters'], (tx) => tx.objectStore('characters').delete(id)),
  },
  items: {
    list: async (campaignId: string) => (await open()).getAllFromIndex('items', 'campaignId', campaignId),
    get: async (id: string) => (await open()).get('items', id),
    put: (i: StoredItem) => write(['items'], (tx) => tx.objectStore('items').put({ ...i, updatedAt: Date.now() })),
    delete: (id: string) => write(['items'], (tx) => tx.objectStore('items').delete(id)),
  },
  packs: {
    listMeta: async (): Promise<PackMeta[]> => (await open()).getAll('packMeta'),
    get: async (id: string) => (await open()).get('packs', id),
    put: (p: Pack) => write(['packs', 'packMeta'], async (tx) => {
      await Promise.all([tx.objectStore('packs').put(p), tx.objectStore('packMeta').put(packMeta(p))]);
    }),
    delete: (id: string) => write(['packs', 'packMeta'], async (tx) => {
      await Promise.all([tx.objectStore('packs').delete(id), tx.objectStore('packMeta').delete(id)]);
    }),
  },
  raw5e: {
    getMany: async (keys: string[]): Promise<(unknown | undefined)[]> => {
      const store = (await open()).transaction('raw5e').store;
      return Promise.all(keys.map((k) => store.get(k)));
    },
    putMany: (entries: [string, unknown][]) => write(['raw5e'], (tx) => {
      const store = tx.objectStore('raw5e');
      return Promise.all(entries.map(([k, v]) => store.put(v, k)));
    }),
  },
  blobs: {
    /** Stores the blob and returns its SHA-256 hex. */
    put: async (blob: Blob): Promise<string> => {
      const data = await blob.arrayBuffer();
      const hash = hex(await crypto.subtle.digest('SHA-256', data));
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
  /** Backup import: one atomic upsert that keeps the records' own updatedAt. */
  restore: (s: Snapshot) => write(['campaigns', 'characters', 'items', 'packs', 'packMeta', 'blobs'], async (tx) => {
    await Promise.all([
      ...s.campaigns.map((r) => tx.objectStore('campaigns').put(r)),
      ...s.characters.map((r) => tx.objectStore('characters').put(r)),
      ...s.items.map((r) => tx.objectStore('items').put(r)),
      ...s.packs.flatMap((p) => [tx.objectStore('packs').put(p), tx.objectStore('packMeta').put(packMeta(p))]),
      ...s.blobs.map((r) => tx.objectStore('blobs').put(r)),
    ]);
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
