import type { InventoryEntry, ItemDef, PlayerView, StoredItem } from '../types.ts';
import { playerItem } from './playerView.ts';

// Pure (no Svelte/Vite/DOM): what an inventory or loot row shows and offers, for one viewer.

export interface RowView {
  shown: ItemDef; // the item as this viewer sees it (a player gets the cover name, bars and hidden fields removed)
  name: string;
  secret: boolean; // DM only: the entry carries a player view
  canEquip: boolean;
  needsAttune: boolean;
  maxCharges: number;
  consumable: boolean;
}

export function rowView(e: InventoryEntry, viewer: 'dm' | 'player'): RowView {
  const shown = viewer === 'player' ? playerItem(e.item, e.view) : e.item;
  return {
    shown, name: shown.name, secret: viewer === 'dm' && !!e.view,
    canEquip: !!(shown.weapon || shown.armor || shown.magic),
    needsAttune: !!shown.attunement,
    maxCharges: shown.charges?.max ?? 0,
    consumable: !!shown.consumable,
  };
}

/** A view that hides and covers nothing is no view: dropping it keeps the Secret badge honest. */
export const normalizeView = (v: PlayerView | undefined): PlayerView | undefined =>
  v && (v.name || v.text || v.hidden.length || v.revealed.length) ? v : undefined;

/** The plain item behind a homebrew record. */
export const stripStored = ({ campaignId: _c, defaultView: _v, updatedAt: _u, ...item }: StoredItem): ItemDef => item;
