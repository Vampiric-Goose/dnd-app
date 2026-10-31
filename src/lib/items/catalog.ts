import { fold } from '../content/ids.ts';
import type { ItemDef, StoredItem } from '../types.ts';
import { soundItem } from './homebrew.ts';
import { displayItem } from './playerView.ts';

// Pure (no Svelte/Vite/DOM): the Items page's "All items" list. SRD and pack items plus the campaign's homebrew, merged,
// each shown the way the viewer may see it (R31), then filtered. Filters look at what the viewer sees, so a hidden rarity can't be probed.

export const HOMEBREW_SOURCE = 'HOMEBREW';

export interface CatalogRow {
  item: ItemDef; // the real item (the stored record for homebrew)
  stored?: StoredItem;
  shown: ItemDef; // displayItem(item, viewer)
  source: string; // HOMEBREW_SOURCE for the campaign's own items, else the item's source id
  folded: string; // search form of the shown name
}

export interface CatalogFilter { q?: string; magic?: '' | 'magic' | 'mundane'; type?: string; rarity?: string; source?: string }

/** One row per item, by name. Build once per (content, viewer); `filterCatalog` is the cheap part to repeat on each keystroke. */
export function catalogRows(items: ItemDef[], homebrew: StoredItem[], viewer: 'dm' | 'player'): CatalogRow[] {
  const mk = (item: ItemDef, stored?: StoredItem): CatalogRow => {
    if (stored && !soundItem(stored)) throw new Error('damaged item');
    const shown = displayItem(item, viewer);
    return { item, stored, shown, source: stored ? HOMEBREW_SOURCE : item.source, folded: fold(shown.name) };
  };
  // A stored record that cannot be shown (an old bad import, a damaged file) is left out rather than breaking the whole page.
  const safe = (item: ItemDef, stored?: StoredItem): CatalogRow[] => {
    try { return [mk(item, stored)]; } catch { return []; }
  };
  return [...homebrew.flatMap((h) => safe(h, h)), ...items.flatMap((i) => safe(i))].sort((a, b) => a.folded.localeCompare(b.folded));
}

export function filterCatalog(rows: CatalogRow[], f: CatalogFilter): CatalogRow[] {
  const n = fold((f.q ?? '').trim());
  return rows.filter((r) =>
    (!n || r.folded.includes(n))
    && (!f.magic || r.shown.magic === (f.magic === 'magic'))
    && (!f.type || r.shown.type === f.type)
    && (!f.rarity || r.shown.rarity === f.rarity)
    && (!f.source || r.source === f.source));
}
