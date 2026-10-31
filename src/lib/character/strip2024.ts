import { idSource, is2024Source } from '../content/sources.ts';
import type { Campaign, Character, InventoryEntry } from '../types.ts';

// Pure (no Svelte/Vite/DOM). R54: 2024 content must never reach a character through what it carries (embedded entities, inventory
// items) or through campaign loot. The db applies these on every read and write, and the importers before they return.
// Tolerant of damaged records (they are reported elsewhere): anything not of the expected shape is passed through untouched.

const fromId = (id: unknown) => typeof id === 'string' && id.includes('@') && is2024Source(idSource(id));

/** R54/R60: an entity or item of the 2024 rules: its source, its id's `@SOURCE`, or (a customized copy) its `baseItemId`. */
export const is2024 = (x: unknown): boolean => {
  if (typeof x !== 'object' || x === null) return false;
  const { id, source, baseItemId } = x as { id?: unknown; source?: unknown; baseItemId?: unknown };
  return (typeof source === 'string' && is2024Source(source)) || fromId(id) || fromId(baseItemId);
};

const keepEntries = (list: InventoryEntry[]): InventoryEntry[] => list.filter((e) => !is2024((e as { item?: unknown } | null)?.item));

/** The character without embedded 2024 entities (by key, id or source) or inventory entries holding a 2024 item. Same object when nothing goes. */
export function strip2024(c: Character): Character {
  if (typeof c !== 'object' || c === null) return c;
  const emb = c.embedded, inv = c.inventory;
  const embedded = typeof emb === 'object' && emb !== null && !Array.isArray(emb)
    ? Object.fromEntries(Object.entries(emb).filter(([k, e]) => !fromId(k) && !is2024(e))) : emb;
  const inventory = Array.isArray(inv) ? keepEntries(inv) : inv;
  if ((embedded === emb || Object.keys(embedded).length === Object.keys(emb).length) && (inventory === inv || inventory.length === inv.length)) return c;
  return { ...c, embedded, inventory };
}

/** The campaign without loot entries holding a 2024 item. Same object when nothing goes. */
export function stripLoot(c: Campaign): Campaign {
  if (typeof c !== 'object' || c === null || !Array.isArray(c.loot)) return c;
  const loot = keepEntries(c.loot);
  return loot.length === c.loot.length ? c : { ...c, loot };
}
