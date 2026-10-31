import type { ContentIndex } from '../../lib/content/index.ts';
import { db } from '../../lib/db.ts';
import { soundItem } from '../../lib/items/homebrew.ts';
import { stripStored } from '../../lib/items/rows.ts';
import { getFullIndex, getIndex } from '../../lib/store.svelte.ts';
import type { ItemDef, StoredItem } from '../../lib/types.ts';

/** What can be added or refreshed from: the campaign's content index plus its homebrew items. */
export interface Pool { index: ContentIndex; homebrew: StoredItem[]; damaged: StoredItem[] /* stored records that failed soundItem: kept out of `homebrew`, so nothing downstream can throw on them */ }

export async function loadPool(campaignId: string | undefined): Promise<Pool> {
  const [index, stored] = await Promise.all([campaignId ? getIndex(campaignId) : getFullIndex(), campaignId ? db.items.list(campaignId) : []]);
  return { index, homebrew: stored.filter(soundItem), damaged: stored.filter((i) => !soundItem(i)) };
}

/** The current definition behind an entry's sourceId, or undefined when the pool no longer has it. */
export function latestItem(pool: Pool, sourceId: string): ItemDef | undefined {
  const h = pool.homebrew.find((x) => x.id === sourceId);
  if (h) return stripStored(h);
  const e = pool.index.resolve(sourceId);
  return e?.kind === 'item' ? e : undefined;
}
