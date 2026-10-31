import type { ContentIndex } from '../../lib/content/index.ts';
import { db } from '../../lib/db.ts';
import { stripStored } from '../../lib/items/rows.ts';
import { getFullIndex, getIndex } from '../../lib/store.svelte.ts';
import type { ItemDef, StoredItem } from '../../lib/types.ts';

/** What can be added or refreshed from: the campaign's content index plus its homebrew items. */
export interface Pool { index: ContentIndex; homebrew: StoredItem[] }

export async function loadPool(campaignId: string | undefined): Promise<Pool> {
  const [index, homebrew] = await Promise.all([campaignId ? getIndex(campaignId) : getFullIndex(), campaignId ? db.items.list(campaignId) : []]);
  return { index, homebrew };
}

/** The current definition behind an entry's sourceId, or undefined when the pool no longer has it. */
export function latestItem(pool: Pool, sourceId: string): ItemDef | undefined {
  const h = pool.homebrew.find((x) => x.id === sourceId);
  if (h) return stripStored(h);
  const e = pool.index.resolve(sourceId);
  return e?.kind === 'item' ? e : undefined;
}
