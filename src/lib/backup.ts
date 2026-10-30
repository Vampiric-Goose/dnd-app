import { db, type BlobRecord } from './db.ts';
import type { Campaign, Character, Pack, StoredItem } from './types.ts';

const json = (o: unknown) => new Blob([JSON.stringify(o)], { type: 'application/json' });
const parse = async (file: Blob): Promise<Record<string, any> | undefined> => {
  try {
    const o = JSON.parse(await file.text());
    return o && typeof o === 'object' ? o : undefined;
  } catch {
    return undefined;
  }
};

const toBase64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); // chunked: spread has an argument limit
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

/**
 * Whole library, or one campaign (its characters and items, plus the packs it enables when
 * includePacks). Images always travel with it.
 */
export async function exportBackup(opts: { campaignId?: string; includePacks: boolean }): Promise<Blob> {
  let campaigns: Campaign[], characters: Character[], items: StoredItem[], packIds: string[];
  if (opts.campaignId === undefined) {
    campaigns = await db.campaigns.list();
    characters = await db.characters.list();
    items = (await Promise.all(campaigns.map((c) => db.items.list(c.id)))).flat();
    packIds = (await db.packs.listMeta()).map((p) => p.id);
  } else {
    const c = await db.campaigns.get(opts.campaignId);
    if (!c) throw new Error('Campaign not found');
    campaigns = [c];
    characters = await db.characters.list(c.id);
    items = await db.items.list(c.id);
    packIds = c.enabledPacks;
  }
  const packs = opts.includePacks ? (await Promise.all(packIds.map((id) => db.packs.get(id)))).filter((p): p is Pack => !!p) : [];
  // ponytail: every blob, even for one campaign; filter by referenced hashes once maps make this heavy
  const blobs = (await db.blobs.all()).map(({ hash, type, data }) => ({ hash, type, base64: toBase64(data) }));
  const exportedAt = Date.now();
  const file = json({ format: 'dnd-app-backup', version: 1, exportedAt, campaigns, characters, items, packs, blobs });
  // A failed timestamp write must not block the backup (a full disk is when you need it most).
  await db.meta.set('lastBackupAt', exportedAt).catch(() => {});
  return file;
}

/** Upserts by id in one transaction, keeping each record's own updatedAt. */
export async function importBackup(file: Blob): Promise<{ campaigns: number; characters: number; items: number; packs: number }> {
  const o = await parse(file);
  if (o?.format !== 'dnd-app-backup') throw new Error('Not a dnd-app backup file');
  if (o.version !== 1) throw new Error('Unsupported backup version ' + o.version);
  const list = (k: string): any[] => (Array.isArray(o[k]) ? o[k] : []);
  const snapshot = {
    campaigns: list('campaigns'), characters: list('characters'), items: list('items'), packs: list('packs'),
    blobs: list('blobs').map(({ hash, type, base64 }): BlobRecord => ({ hash, type, data: fromBase64(base64) })),
  };
  await db.restore(snapshot);
  return { campaigns: snapshot.campaigns.length, characters: snapshot.characters.length, items: snapshot.items.length, packs: snapshot.packs.length };
}

export function exportRecord(kind: 'character' | 'item', data: Character | StoredItem): Blob {
  return json({ format: `dnd-app-${kind}`, version: 1, data });
}

/**
 * Reads a single-record file. Does not save it: the caller puts the result. An id that already
 * exists locally is replaced by a fresh one so nothing is overwritten.
 */
export async function importRecord(file: Blob): Promise<{ kind: 'character'; data: Character } | { kind: 'item'; data: StoredItem }> {
  const o = await parse(file);
  const kind = o?.format === 'dnd-app-character' ? 'character' : o?.format === 'dnd-app-item' ? 'item' : undefined;
  if (!kind || o?.version !== 1 || typeof o.data?.id !== 'string') throw new Error('Not a dnd-app character or item file');
  const taken = await (kind === 'character' ? db.characters.get(o.data.id) : db.items.get(o.data.id));
  const data = taken ? { ...o.data, id: crypto.randomUUID() } : o.data;
  return { kind, data };
}
