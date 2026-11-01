import { is2024, strip2024 } from './character/strip2024.ts';
import { restorablePack } from './content/sources.ts';
import { fromBase64, toBase64 } from './base64.ts';
import { db, sha256Hex, type BlobRecord, type Snapshot, type TrashEntry } from './db.ts';
import { playerCharacter } from './items/playerView.ts';
import { soundMonster } from './monsters/homebrew.ts';
import { campaignProblem, characterProblem, encounterProblem, isRec, problem, sceneProblem, SHAPES, type Rec } from './recordShape.ts';
import type { Campaign, Character, Encounter, Pack, Scene, StoredItem, StoredMonster } from './types.ts';
import { uid } from './uid.ts';

const MY_SPELLS_PACK = 'pack:MYSPELLS'; // R3: the pasted spells (SpellEditor)
const json = (o: unknown) => new Blob([JSON.stringify(o)], { type: 'application/json' });
const parse = async (file: Blob): Promise<Rec | undefined> => {
  try {
    const o: unknown = JSON.parse(await file.text());
    return isRec(o) ? o : undefined;
  } catch {
    return undefined;
  }
};

const damaged = (why: string) => new Error('Backup file is damaged: ' + why);

/** A list of records; missing means empty. Every element is checked before anything is written. */
function records<T>(o: Rec, key: string, check: (r: unknown) => string | undefined): T[] {
  const list = o[key] ?? [];
  if (!Array.isArray(list)) throw damaged(`${key} is not a list`);
  list.forEach((r, i) => {
    const why = check(r);
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
    try { data = fromBase64(b.base64).buffer; } catch { throw damaged(`blobs[${i}] is not valid base64`); }
    if ((await sha256Hex(data)) !== b.hash) throw damaged(`blobs[${i}] does not match its hash`);
    return { hash: b.hash, type: b.type, data };
  }));
}

/** R9: the backup's Deleted characters, per campaign id; every entry is checked like a character. Missing means none. */
function trashRecords(o: Rec): Record<string, TrashEntry[]> {
  const t = o.trash ?? {};
  if (!isRec(t)) throw damaged('trash is not a record');
  const out: Record<string, TrashEntry[]> = Object.create(null); // a `__proto__` campaign id stays a plain key
  for (const [cid, list] of Object.entries(t)) {
    if (!Array.isArray(list)) throw damaged(`trash.${cid} is not a list`);
    list.forEach((e: unknown, i) => {
      const why = !isRec(e) || typeof e.by !== 'string' || typeof e.at !== 'number' ? 'is incomplete' : characterProblem(e.character);
      if (why) throw damaged(`trash.${cid}[${i}] ${why}`);
    });
    out[cid] = list;
  }
  return out;
}

/**
 * Whole library, or one campaign (its characters, items, monsters and prepared encounters, plus the packs it enables when
 * includePacks). Images and the "My spells" pack always travel with it. The live combat does not.
 */
export async function exportBackup(opts: { campaignId?: string; includePacks: boolean }): Promise<Blob> {
  let campaigns: Campaign[], characters: Character[], items: StoredItem[], monsters: StoredMonster[], packIds: string[];
  if (opts.campaignId === undefined) {
    campaigns = await db.campaigns.list();
    characters = await db.characters.list();
    items = (await Promise.all(campaigns.map((c) => db.items.list(c.id)))).flat();
    monsters = (await Promise.all(campaigns.map((c) => db.monsters.list(c.id)))).flat();
    packIds = (await db.packs.listMeta()).map((p) => p.id);
  } else {
    const c = await db.campaigns.get(opts.campaignId);
    if (!c) throw new Error('Campaign not found');
    campaigns = [c];
    characters = await db.characters.list(c.id);
    items = await db.items.list(c.id);
    monsters = await db.monsters.list(c.id);
    packIds = [...new Set([...c.enabledPacks, MY_SPELLS_PACK])];
  }
  // I5: "My spells" holds spells typed in on this device, which can't be imported again, so it always travels (when it exists).
  const wanted = packIds.filter((id) => opts.includePacks || id === MY_SPELLS_PACK);
  const packs = (await Promise.all(wanted.map((id) => db.packs.get(id)))).filter((p): p is Pack => !!p && restorablePack(p)); // never the cached SRD
  // ponytail: every blob, even for one campaign; filter by referenced hashes once maps make this heavy
  const blobs = (await db.blobs.all()).map(({ hash, type, data }) => ({ hash, type, base64: toBase64(data) }));
  // R9: the Deleted characters of each campaign travel too.
  const trash: Record<string, TrashEntry[]> = {};
  for (const c of campaigns) { const t = await db.trash.list(c.id); if (t.length) trash[c.id] = t; }
  const encounters = (await Promise.all(campaigns.map((c) => db.encounters.list(c.id)))).flat(); // stage 4
  const scenes = (await Promise.all(campaigns.map((c) => db.scenes.list(c.id)))).flat(); // stage 5
  const exportedAt = Date.now();
  const file = json({ format: 'dnd-app-backup', version: 1, exportedAt, campaigns, characters, items, monsters, encounters, scenes, packs, blobs, trash });
  // The built file must not be lost over a bookkeeping write (a full disk is when you need a backup most).
  // Only a whole-library export counts as "backed up": one campaign's file leaves the rest unprotected.
  if (opts.campaignId === undefined) await db.meta.set('lastBackupAt', exportedAt).catch((err) => console.warn('Could not record backup time', err));
  return file;
}

export type BackupCounts = { campaigns: number; characters: number; items: number; monsters: number; encounters: number; scenes: number; packs: number; skippedPacks?: string[]; skippedItems?: string[]; skippedMonsters?: string[] };
/** A validated backup waiting for the user's yes (R57). `replaced`: records stored here it would overwrite; `newer`: how many of those are newer than the file's copy. */
export interface BackupPlan { snapshot: Snapshot; counts: BackupCounts; replaced: number; newer: number }

/** Backup import, step 1 of 2 (R57): parses and validates the whole file and counts what it would do. Writes nothing. */
export async function readBackup(file: Blob): Promise<BackupPlan> {
  const o = await parse(file);
  if (o?.format !== 'dnd-app-backup') throw new Error('Not a dnd-app backup file');
  if (o.version !== 1) throw new Error('Unsupported backup version ' + o.version);
  const snapshot = {
    campaigns: records<Campaign>(o, 'campaigns', campaignProblem),
    characters: records<Character>(o, 'characters', characterProblem),
    items: records<StoredItem>(o, 'items', (r) => problem(r, SHAPES.item)),
    monsters: records<StoredMonster>(o, 'monsters', (r) => problem(r, SHAPES.monster)), // missing in backups from before monsters
    encounters: records<Encounter>(o, 'encounters', encounterProblem), // missing in backups from before stage 4
    scenes: records<Scene>(o, 'scenes', sceneProblem), // missing in backups from before stage 5
    packs: records<Pack>(o, 'packs', (r) => problem(r, SHAPES.pack)),
    blobs: await blobRecords(o),
    trash: trashRecords(o),
  };
  // R52: never the built-in SRD (id `srd`) nor a pack claiming a reserved source; the caller is told which were left out.
  const skippedPacks = snapshot.packs.filter((p) => !restorablePack(p)).map((p) => p.id);
  snapshot.packs = snapshot.packs.filter(restorablePack);
  // R60: nor a 2024 item (by source, id or base item); also reported.
  const skippedItems = snapshot.items.filter(is2024).map((i) => i.id);
  snapshot.items = snapshot.items.filter((i) => !is2024(i));
  // R60: and the same for monsters: a 2024 one, or one the stat block could not read.
  const skippedMonsters = snapshot.monsters.filter((m) => is2024(m) || !soundMonster(m)).map((m) => m.id);
  snapshot.monsters = snapshot.monsters.filter((m) => !is2024(m) && soundMonster(m));
  const counts = { campaigns: snapshot.campaigns.length, characters: snapshot.characters.length, items: snapshot.items.length, monsters: snapshot.monsters.length, encounters: snapshot.encounters.length, scenes: snapshot.scenes.length, packs: snapshot.packs.length,
    ...(skippedPacks.length && { skippedPacks }), ...(skippedItems.length && { skippedItems }), ...(skippedMonsters.length && { skippedMonsters }) };
  return { snapshot, counts, ...(await db.countReplaced(snapshot)) };
}

/** Step 2, only once the user has confirmed: upserts by id in one transaction, keeping each record's own updatedAt. */
export async function applyBackup(plan: BackupPlan): Promise<BackupCounts> {
  await db.restore(plan.snapshot);
  return plan.counts;
}

/** R51: a character exported in Player view is the player-safe copy, and the file says so (`viewer`), so an import can warn. */
export function exportRecord(kind: 'character' | 'item' | 'monster', data: Character | StoredItem | StoredMonster, viewer: 'dm' | 'player' = 'dm'): Blob {
  const safe = kind === 'character' && viewer === 'player';
  return json({ format: `dnd-app-${kind}`, version: 1, data: safe ? playerCharacter(data as Character) : data, ...(safe && { viewer }) });
}

/**
 * Reads a single-record file. Does not save it: the caller puts the result. `taken` says the id already exists locally;
 * the caller must then ask (R49) and either put it over the old one or put `keepBoth(data)`. Nothing is overwritten here.
 */
export async function importRecord(file: Blob): Promise<{ kind: 'character'; data: Character; taken: boolean; playerView: boolean } | { kind: 'item'; data: StoredItem; taken: boolean; playerView: boolean } | { kind: 'monster'; data: StoredMonster; taken: boolean; playerView: false }> {
  const o = await parse(file);
  const kind = o?.format === 'dnd-app-character' ? 'character' : o?.format === 'dnd-app-item' ? 'item' : o?.format === 'dnd-app-monster' ? 'monster' : undefined;
  if (!o || !kind || o.version !== 1) throw new Error('Not a dnd-app character, item or monster file');
  const why = kind === 'character' ? characterProblem(o.data) : problem(o.data, SHAPES[kind]) ?? (kind === 'monster' && !soundMonster(o.data) ? 'is damaged' : undefined);
  if (why) throw new Error(`Record file is damaged: ${kind} ${why}`);
  if (kind === 'monster') {
    if (is2024(o.data)) throw new Error('This monster is from the 2024 rules, which this app does not use.'); // R60
    const data = o.data as StoredMonster;
    return { kind, data, taken: !!(await db.monsters.get(data.id)), playerView: false };
  }
  const data = kind === 'character' ? strip2024(o.data as Character) : o.data as StoredItem; // R54
  const taken = !!(await (kind === 'character' ? db.characters.get(data.id) : db.items.get(data.id)));
  return { kind, data, taken, playerView: kind === 'character' && o.viewer === 'player' } as { kind: 'character'; data: Character; taken: boolean; playerView: boolean } | { kind: 'item'; data: StoredItem; taken: boolean; playerView: boolean };
}

import { restoreSecrets } from './items/playerView.ts';
export { restoreSecrets }; // R56; moved there so the sync engine can use it (stage 3)

/** R49 "Keep both": the imported record under a fresh id, so the existing one stays. "Replace" is the record as it is. */
export const keepBoth = <T extends { id: string }>(r: T): T => ({ ...r, id: uid() });

/**
 * I1: was this character's id deleted in its campaign (a sync tombstone)? Saved under that id, sync would delete it again on the next
 * connect, so an import takes it under a fresh id (keepBoth) and says so.
 */
export async function deletedInCampaign(c: Character): Promise<boolean> {
  const del = c.campaignId === undefined ? undefined : (await db.campaigns.get(c.campaignId))?.sync?.deleted;
  return !!del && Object.hasOwn(del, c.id);
}

/**
 * R10: "Replace" means replace. The file's `sync` is dropped, so the save stamps every path that differs from the stored copy as a fresh
 * local edit instead of rebasing the file onto newer stored values. A Player-view file first gets the real items back (R56).
 */
export function replacement(file: Character, stored: Character | undefined, playerView: boolean): Character {
  const { sync: _s, ...c } = playerView && stored ? restoreSecrets(file, stored) : file;
  return c;
}
