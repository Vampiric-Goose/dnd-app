import { redact } from '../content/richtext.ts';
import type { HideableField, InventoryEntry, ItemDef, PlayerView } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts. Nothing here mutates its arguments.

/**
 * What a player may see of `item`. This is the security boundary for item secrets: its output is what gets
 * sent to players and what a player's export holds, so hidden fields and unrevealed redactions must not
 * survive in it. With no view nothing is hidden, but redaction markers are still processed (fail closed).
 */
export function playerItem(item: ItemDef, view?: PlayerView): ItemDef {
  const revealed = new Set(view?.revealed);
  const out: ItemDef = { ...item, name: view?.name ?? item.name, text: redact(view?.text ?? item.text, revealed) };
  if (view?.name !== undefined) delete out.aliases; // an alias would give the real name away
  for (const f of view?.hidden ?? []) delete out[f];
  if (view?.hidden.includes('effects')) out.effects = [];
  if (out.curse) out.curse = redact(out.curse, revealed); // a shown curse can carry redactions too
  return out;
}

/** Shows one hidden field to the player. */
export const revealField = (view: PlayerView, f: HideableField): PlayerView =>
  ({ ...view, hidden: view.hidden.filter(h => h !== f), revealed: [...view.revealed] });

/** Shows one redacted span of text to the player. */
export const revealRedaction = (view: PlayerView, id: string): PlayerView =>
  ({ ...view, hidden: [...view.hidden], revealed: view.revealed.includes(id) ? [...view.revealed] : [...view.revealed, id] });

/** The player now knows everything: drops the view. */
export const identify = (entry: InventoryEntry): InventoryEntry => {
  const { view: _view, ...rest } = entry;
  return rest;
};
