import { db, StorageError } from '../../lib/db.ts';
import { transfer } from '../../lib/items/inventory.ts';
import { refreshCampaigns, saveCampaign } from '../../lib/store.svelte.ts';
import { toast } from '../../lib/toast.svelte.ts';
import type { InventoryEntry } from '../../lib/types.ts';
import { message } from '../creator/labels.ts';

// The campaign's Unassigned list (stored as `campaign.loot`, so existing data keeps working). Every change re-reads the
// campaign first (a sheet may have moved items meanwhile) and runs one at a time. The page shows app.campaign, which only
// changes once the write has succeeded: on failure nothing moves.
let queue: Promise<unknown> = Promise.resolve();

const run = (f: () => Promise<void>) => {
  queue = queue.then(f).catch((e) => toast(e instanceof StorageError ? e.message : `Could not save: ${message(e)}`, true));
  return queue as Promise<void>;
};

export const editUnassigned = (campaignId: string, fn: (list: InventoryEntry[]) => InventoryEntry[]) => run(async () => {
  const fresh = await db.campaigns.get(campaignId);
  if (!fresh) throw new Error('The campaign no longer exists.');
  await saveCampaign({ ...fresh, loot: fn(fresh.loot) });
});

// R44: the Unassigned list and the receiving character commit in one transaction; the character is read fresh.
export const giveFromUnassigned = (campaignId: string, entryId: string, qty: number, charId: string) => run(async () => {
  const [fresh, ch] = await Promise.all([db.campaigns.get(campaignId), db.characters.get(charId)]);
  if (!fresh || !ch) throw new Error('Could not find the campaign or the character.');
  const moved = transfer(fresh.loot, ch.inventory, entryId, qty);
  if (moved.from === fresh.loot) throw new Error('Nothing was moved.');
  await db.saveTogether({ characters: [{ ...ch, inventory: moved.to }], campaign: { ...fresh, loot: moved.from } });
  await refreshCampaigns();
  toast(`Given to ${ch.name || 'Unnamed'}.`);
});
