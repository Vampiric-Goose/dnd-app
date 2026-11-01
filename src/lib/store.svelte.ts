import { exportBackup } from './backup.ts';
import { ContentIndex } from './content/index.ts';
import { loadSrd } from './content/srd.ts';
import { entityAllowed, mayPatch, packAllowed, patchAllowed } from './content/sources.ts';
import { db, onUpgradeBlocked } from './db.ts';
import type { Campaign, Pack } from './types.ts';

export const app: {
  campaign: Campaign | undefined;
  campaigns: Campaign[];
  viewer: 'dm' | 'player';
  ready: boolean; // startup() finished (whether or not storage worked)
  error: string | undefined; // startup failure, e.g. IndexedDB unavailable
  lastBackupAt: number | undefined;
} = $state({ campaign: undefined, campaigns: [], viewer: 'dm', ready: false, error: undefined, lastBackupAt: undefined });

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Re-reads campaigns from storage and re-points the current one (it may have been deleted or restored over). */
export async function refreshCampaigns(): Promise<void> {
  app.campaigns = (await db.campaigns.list()).sort((a, b) => a.name.localeCompare(b.name));
  const id = app.campaign?.id;
  app.campaign = app.campaigns.find((c) => c.id === id);
  pinViewer();
}

/** The toggle shows only with a campaign, so nothing may stay hidden without one; a joined campaign is always seen as a player. */
function pinViewer(): void {
  if (!app.campaign) app.viewer = 'dm';
  else if (app.campaign.sync?.role === 'player') app.viewer = 'player';
}

/** Opens a campaign (or none) and remembers the choice. */
export async function setCampaign(id: string | undefined): Promise<void> {
  app.campaign = app.campaigns.find((c) => c.id === id);
  pinViewer();
  await db.meta.set('currentCampaign', app.campaign?.id ?? null);
}

/** Saves a campaign. Pass plain data or a $state value: it is snapshotted so IndexedDB can clone it. */
export async function saveCampaign(c: Campaign): Promise<void> {
  await db.campaigns.put($state.snapshot(c) as Campaign);
  await refreshCampaigns();
}

const BLOCKED = 'Another tab of this app is open with an older version. Close it to finish updating.';

/** Loads campaigns, the current campaign and the last-backup time. Never throws. */
export async function startup(): Promise<void> {
  onUpgradeBlocked(() => { app.error = BLOCKED; }); // the open below waits until the older tab closes, then carries on
  try {
    app.campaigns = (await db.campaigns.list()).sort((a, b) => a.name.localeCompare(b.name));
    const id = await db.meta.get<string>('currentCampaign');
    app.campaign = app.campaigns.find((c) => c.id === id);
    pinViewer();
    app.lastBackupAt = await db.meta.get<number>('lastBackupAt');
    if (app.error === BLOCKED) app.error = undefined;
  } catch (e) {
    app.error = 'Could not open local storage: ' + msg(e);
  } finally {
    app.ready = true;
  }
}

/** Builds a backup and hands it to the browser as a download. */
export async function saveBackup(opts: { campaignId?: string; includePacks: boolean }): Promise<void> {
  const blob = await exportBackup(opts);
  const name = opts.campaignId ? app.campaigns.find((c) => c.id === opts.campaignId)?.name ?? 'campaign' : 'library';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dnd-app-backup-${name.replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  if (opts.campaignId === undefined) app.lastBackupAt = Date.now(); // matches exportBackup: only full exports count
}

// One cached index at a time: the key is the sorted pack ids plus their hashes, so a re-import invalidates it.
let cache: { key: string; index: Promise<ContentIndex> } | undefined;

/**
 * Defence in depth against a crafted or restored pack (R52): whatever its own source says, an entity must carry its own source in its id, and none of a 2024 source or
 * a reserved id (SRD, HOMEBREW, HIDDEN) gets in, so it cannot add 2024 content or replace another source's entity; only official packs may patch.
 */
const clean = (p: Pack): Pack => ({
  ...p,
  entities: p.entities.filter(entityAllowed),
  patches: mayPatch(p) ? p.patches.filter(patchAllowed) : [],
});

async function build(ids: string[] | undefined): Promise<ContentIndex> {
  const srd = await loadSrd();
  // R52: a stored pack from a 2024 or unknown source never reaches the index, even before the user removes it.
  const metas = (await db.packs.listMeta()).filter((m) => m.id !== srd.id && packAllowed(m));
  const chosen = (ids ? metas.filter((m) => ids.includes(m.id)) : metas).sort((a, b) => (a.id < b.id ? -1 : 1));
  const key = [srd.hash, ...chosen.map((m) => `${m.id}:${m.hash}`)].join('|');
  if (cache?.key === key) return cache.index;
  const index = (async () => {
    const packs = (await Promise.all(chosen.map((m) => db.packs.get(m.id)))).filter((p): p is Pack => !!p && packAllowed(p)).map(clean);
    return new ContentIndex([srd, ...packs]);
  })();
  cache = { key, index };
  index.catch(() => { if (cache?.index === index) cache = undefined; }); // don't cache a failure
  return index;
}

/** The SRD plus the packs a campaign enables (default: the current campaign). With no campaign at all, every pack. */
export async function getIndex(campaignId?: string): Promise<ContentIndex> {
  const c = campaignId === undefined ? app.campaign : await db.campaigns.get(campaignId);
  return build(c && [...c.enabledPacks]);
}

/** The SRD plus every imported pack, whatever the campaign enables (what an import resolves references against). */
export const getFullIndex = () => build(undefined);
