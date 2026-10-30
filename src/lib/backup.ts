import { db, sha256Hex, type BlobRecord } from './db.ts';
import type { Campaign, Character, Pack, StoredItem } from './types.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const json = (o: unknown) => new Blob([JSON.stringify(o)], { type: 'application/json' });
const parse = async (file: Blob): Promise<Rec | undefined> => {
  try {
    const o: unknown = JSON.parse(await file.text());
    return isRec(o) ? o : undefined;
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

// What storage and the app rely on, nothing deeper: a file passing this can still hold bad values.
type Shape = { objs?: string[]; arrs?: string[]; kind?: string };
const SHAPES = {
  campaign: { objs: ['settings'], arrs: ['enabledPacks', 'loot'] },
  character: { objs: ['build', 'state'], arrs: ['inventory'] },
  item: { kind: 'item' },
  pack: { arrs: ['entities', 'patches'] },
} satisfies Record<string, Shape>;

/** What is wrong with a record read from a file, or undefined when it has the expected shape. */
function problem(r: unknown, { objs = [], arrs = [], kind }: Shape): string | undefined {
  if (!isRec(r)) return 'is not an object';
  if (typeof r.id !== 'string') return 'has no id';
  for (const k of objs) if (!isRec(r[k])) return `has no ${k}`;
  for (const k of arrs) if (!Array.isArray(r[k])) return `has no ${k} list`;
  if (kind && r.kind !== kind) return `is not an ${kind}`;
}

const damaged = (why: string) => new Error('Backup file is damaged: ' + why);

/** A list of records; missing means empty. Every element is checked before anything is written. */
function records<T>(o: Rec, key: string, shape: Shape): T[] {
  const list = o[key] ?? [];
  if (!Array.isArray(list)) throw damaged(`${key} is not a list`);
  list.forEach((r, i) => {
    const why = problem(r, shape);
    if (why) throw damaged(`${key}[${i}] ${why}`);
  });
  return list;
}

/** Decodes each image and checks it still matches the hash it is stored under. */
async function blobRecords(o: Rec): Promise<BlobRecord[]> {
  const list = o.blobs ?? [];
  if (!Array.isArray(list)) throw damaged('blobs is not a list');
  return Promise.all(list.map(async (b: unknown, i): Promise<BlobRecord> => {
    if (!isRec(b) || typeof b.hash !== 'string' || typeof b.type !== 'string' || typeof b.base64 !== 'string') throw damaged(`blobs[${i}] is incomplete`);
    let data: ArrayBuffer;
    try { data = fromBase64(b.base64); } catch { throw damaged(`blobs[${i}] is not valid base64`); }
    if ((await sha256Hex(data)) !== b.hash) throw damaged(`blobs[${i}] does not match its hash`);
    return { hash: b.hash, type: b.type, data };
  }));
}

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
  // The built file must not be lost over a bookkeeping write (a full disk is when you need a backup most).
  // Only a whole-library export counts as "backed up": one campaign's file leaves the rest unprotected.
  if (opts.campaignId === undefined) await db.meta.set('lastBackupAt', exportedAt).catch((err) => console.warn('Could not record backup time', err));
  return file;
}

/** Validates the whole file, then upserts by id in one transaction, keeping each record's own updatedAt. */
export async function importBackup(file: Blob): Promise<{ campaigns: number; characters: number; items: number; packs: number }> {
  const o = await parse(file);
  if (o?.format !== 'dnd-app-backup') throw new Error('Not a dnd-app backup file');
  if (o.version !== 1) throw new Error('Unsupported backup version ' + o.version);
  const snapshot = {
    campaigns: records<Campaign>(o, 'campaigns', SHAPES.campaign),
    characters: records<Character>(o, 'characters', SHAPES.character),
    items: records<StoredItem>(o, 'items', SHAPES.item),
    packs: records<Pack>(o, 'packs', SHAPES.pack),
    blobs: await blobRecords(o),
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
  if (!o || !kind || o.version !== 1) throw new Error('Not a dnd-app character or item file');
  const why = problem(o.data, SHAPES[kind]);
  if (why) throw new Error(`Record file is damaged: ${kind} ${why}`);
  const rec = o.data as Character | StoredItem;
  const taken = await (kind === 'character' ? db.characters.get(rec.id) : db.items.get(rec.id));
  const data = taken ? { ...rec, id: crypto.randomUUID() } : rec;
  return { kind, data } as { kind: 'character'; data: Character } | { kind: 'item'; data: StoredItem };
}
