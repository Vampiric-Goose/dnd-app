import type { ItemDef, PlayerView, StoredItem } from '../types.ts';

// Pure (no Svelte/Vite/DOM): how a homebrew record is made from another item.

/** A fresh homebrew id. Not the name: a rename must not leave a stale slug. */
export const newHomebrewId = (): string => `item:homebrew-${crypto.randomUUID().slice(0, 8)}@HOMEBREW`;

/** Customize: every field of an SRD or pack item, as a new homebrew record that remembers where it came from. It carries no default player view. */
export function customize(item: ItemDef, campaignId: string): StoredItem {
  const { defaultView: _v, ...copy } = structuredClone(item) as ItemDef & { defaultView?: PlayerView };
  return { ...copy, id: newHomebrewId(), source: 'Homebrew', campaignId, baseItemId: item.id, updatedAt: Date.now() };
}

/** An imported item file (JSON or PDF) as this campaign's homebrew: a fresh id, so it never replaces anything. */
export function importedItem(data: ItemDef & { defaultView?: PlayerView }, campaignId: string): StoredItem {
  return { ...structuredClone(data), id: newHomebrewId(), source: 'Homebrew', campaignId, updatedAt: Date.now() };
}
