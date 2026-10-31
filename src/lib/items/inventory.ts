import { rollDice } from '../dice.ts';
import { pruneRevealed } from './playerView.ts';
import type { InventoryEntry, ItemDef, PlayerView, Recharge } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts. Every operation returns new entries; none mutates.

const maxCharges = (item: ItemDef): number => item.charges?.max ?? 0;

export function makeEntry(item: ItemDef, opts: { sourceId?: string; view?: PlayerView; quantity?: number } = {}): InventoryEntry {
  return {
    id: crypto.randomUUID(), item, quantity: opts.quantity ?? 1, equipped: false, attuned: false, chargesUsed: 0, notes: '',
    ...(opts.sourceId !== undefined && { sourceId: opts.sourceId }),
    ...(opts.view && { view: opts.view }),
  };
}

/** Uses up one; null when that was the last, so the caller removes the entry. */
export const useItem = (e: InventoryEntry): InventoryEntry | null => e.quantity > 1 ? { ...e, quantity: e.quantity - 1 } : null;

export const useCharge = (e: InventoryEntry, n = 1): InventoryEntry =>
  ({ ...e, chargesUsed: Math.min(maxCharges(e.item), Math.max(0, e.chargesUsed + n)) });

/**
 * Restores charges when `event` matches the item's recharge: its own event, and a long rest also covers
 * 'short'. Dawn and dusk match only themselves. Restores `rechargeAmount` rolled, or everything without one.
 */
export function rechargeEntry(e: InventoryEntry, event: Recharge, rng?: () => number): InventoryEntry {
  const c = e.item.charges;
  if (!c || c.recharge === 'none' || (c.recharge !== event && !(event === 'long' && c.recharge === 'short'))) return e;
  let restored = c.max; // a malformed rechargeAmount falls back to a full recharge rather than breaking the rest
  if (c.rechargeAmount) try { restored = rollDice(c.rechargeAmount, { rng }).total; } catch { /* keep the full recharge */ }
  return { ...e, chargesUsed: Math.max(0, e.chargesUsed - restored) };
}

export const attunedCount = (entries: InventoryEntry[]): number => entries.filter(e => e.attuned).length;

/** Pounds: quantity × weight of every entry, plus 1 lb per 50 coins. */
export const carriedWeight = (entries: InventoryEntry[], currency: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number>): number =>
  entries.reduce((sum, e) => sum + e.quantity * (e.item.weight ?? 0), 0)
  + (currency.cp + currency.sp + currency.ep + currency.gp + currency.pp) / 50;

/** Swaps in the latest definition of the item, keeping what the character did with it. Revealed ids the new text no longer has are dropped. */
export const refreshEntry = (e: InventoryEntry, latest: ItemDef): InventoryEntry =>
  ({ ...e, item: latest, chargesUsed: Math.min(e.chargesUsed, maxCharges(latest)), ...(e.view && { view: pruneRevealed(latest, e.view) }) });

/**
 * Moves `qty` of an entry to another inventory as a new entry (new id, not equipped or attuned). Asking for
 * more than there is moves the whole stack; an unknown entry or a quantity below 1 changes nothing.
 */
export function transfer(from: InventoryEntry[], to: InventoryEntry[], entryId: string, qty: number): { from: InventoryEntry[]; to: InventoryEntry[] } {
  const e = from.find(x => x.id === entryId);
  if (!e) return { from, to };
  const n = Math.min(Math.floor(qty), e.quantity);
  if (!(n >= 1)) return { from, to }; // also catches NaN
  const moved: InventoryEntry = { ...e, id: crypto.randomUUID(), quantity: n, equipped: false, attuned: false };
  return {
    from: n === e.quantity ? from.filter(x => x !== e) : from.map(x => x === e ? { ...e, quantity: e.quantity - n } : x),
    to: [...to, moved],
  };
}
