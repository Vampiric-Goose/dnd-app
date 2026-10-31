import { restorablePack } from './content/sources.ts';
import { db, sha256Hex, type BlobRecord } from './db.ts';
import { playerCharacter } from './items/playerView.ts';
import { isRec, problem, SHAPES, type Rec, type Shape } from './recordShape.ts';
import type { Campaign, Character, Pack, StoredItem } from './types.ts';

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
  const packs = opts.includePacks ? (await Promise.all(packIds.map((id) => db.packs.get(id)))).filter((p): p is Pack => !!p && restorablePack(p)) : []; // never the cached SRD
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
export async function importBackup(file: Blob): Promise<{ campaigns: number; characters: number; items: number; packs: number; skippedPacks?: string[] }> {
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
  // R52: never the built-in SRD (id `srd`) nor a pack claiming a reserved source; the caller is told which were left out.
  const skippedPacks = snapshot.packs.filter((p) => !restorablePack(p)).map((p) => p.id);
  snapshot.packs = snapshot.packs.filter(restorablePack);
  await db.restore(snapshot);
  return { campaigns: snapshot.campaigns.length, characters: snapshot.characters.length, items: snapshot.items.length, packs: snapshot.packs.length, ...(skippedPacks.length && { skippedPacks }) };
}

/** R51: a character exported in Player view is the player-safe copy, and the file says so (`viewer`), so an import can warn. */
export function exportRecord(kind: 'character' | 'item', data: Character | StoredItem, viewer: 'dm' | 'player' = 'dm'): Blob {
  const safe = kind === 'character' && viewer === 'player';
  return json({ format: `dnd-app-${kind}`, version: 1, data: safe ? playerCharacter(data as Character) : data, ...(safe && { viewer }) });
}

/**
 * Reads a single-record file. Does not save it: the caller puts the result. `taken` says the id already exists locally;
 * the caller must then ask (R49) and either put it over the old one or put `keepBoth(data)`. Nothing is overwritten here.
 */
export async function importRecord(file: Blob): Promise<{ kind: 'character'; data: Character; taken: boolean; playerView: boolean } | { kind: 'item'; data: StoredItem; taken: boolean; playerView: boolean }> {
  const o = await parse(file);
  const kind = o?.format === 'dnd-app-character' ? 'character' : o?.format === 'dnd-app-item' ? 'item' : undefined;
  if (!o || !kind || o.version !== 1) throw new Error('Not a dnd-app character or item file');
  const why = problem(o.data, SHAPES[kind]);
  if (why) throw new Error(`Record file is damaged: ${kind} ${why}`);
  const data = o.data as Character | StoredItem;
  const taken = !!(await (kind === 'character' ? db.characters.get(data.id) : db.items.get(data.id)));
  return { kind, data, taken, playerView: kind === 'character' && o.viewer === 'player' } as { kind: 'character'; data: Character; taken: boolean; playerView: boolean } | { kind: 'item'; data: StoredItem; taken: boolean; playerView: boolean };
}

/** R49 "Keep both": the imported record under a fresh id, so the existing one stays. "Replace" is the record as it is. */
export const keepBoth = <T extends { id: string }>(r: T): T => ({ ...r, id: crypto.randomUUID() });
