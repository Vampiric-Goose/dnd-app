import { slug } from '../content/ids.ts';
import { redact, redactionIds } from '../content/richtext.ts';
import type { Character, Choice, HideableField, InventoryEntry, ItemDef, PlayerView, RichText } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts. Nothing here mutates its arguments.

// Every ItemDef field a player may see. A field added to ItemDef later stays out until it is listed here.
const SHOWN = ['id', 'kind', 'name', 'source', 'srd', 'text', 'effects', 'choices', 'type', 'magic', 'weight', 'costCp', 'rarity', 'attunement',
  'consumable', 'category', 'curse', 'weapon', 'armor', 'bonuses', 'charges'] as const satisfies readonly (keyof ItemDef)[];
// These two give away what a covered item really is, so they are shown only without a cover name.
const SHOWN_UNCOVERED = [...SHOWN, 'aliases', 'baseItemId'] as const satisfies readonly (keyof ItemDef)[];

// ponytail: JSON round trip, not structuredClone: items are plain JSON, and it also copes with Svelte $state proxies.
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Redacts the text of every option trait, however deeply the options nest. */
const redactChoices = (choices: Choice[], revealed: ReadonlySet<string>): Choice[] => choices.map(c => c.type !== 'option' ? c : {
  ...c,
  options: c.options.map(t => ({ ...t, text: redact(t.text, revealed), ...(t.choices && { choices: redactChoices(t.choices, revealed) }) })),
});

/** Every RichText inside a choice list (option trait text, nested). */
export const choiceTexts = (choices: Choice[] = []): RichText[] =>
  choices.flatMap(c => c.type !== 'option' ? [] : c.options.flatMap(t => [t.text, ...choiceTexts(t.choices)]));

/**
 * What a player may see of `item`. This is the security boundary for item secrets: its output is what gets
 * sent to players and what a player's export holds, so hidden fields and unrevealed redactions must not
 * survive in it. It is built from an allowlist out of a deep copy, so it shares nothing with `item`.
 * With no view nothing is hidden, but redaction markers are still processed (fail closed).
 */
export function playerItem(item: ItemDef, view?: PlayerView): ItemDef {
  const src = clone(item);
  const revealed = new Set(view?.revealed);
  const hidden: readonly HideableField[] = view?.hidden ?? [];
  const cover = view?.name;
  const out = Object.fromEntries((cover === undefined ? SHOWN_UNCOVERED : SHOWN).filter(k => src[k] !== undefined).map(k => [k, src[k]])) as unknown as ItemDef;
  out.name = cover ?? src.name;
  if (cover !== undefined) out.id = `item:${slug(cover)}@HIDDEN`; // the real id is the real name slug
  out.text = redact(view?.text ?? src.text, revealed);
  for (const f of hidden) delete out[f];
  if (hidden.includes('effects')) {
    out.effects = [];
    delete out.choices; // option traits carry their own effects and text
  } else if (out.choices) out.choices = redactChoices(out.choices, revealed);
  if (out.curse) out.curse = redact(out.curse, revealed); // a shown curse can carry redactions too
  if (hidden.includes('rarity')) {
    out.magic = false; // reads as mundane until the rarity is revealed
    delete out.costCp;
  }
  return out;
}

/**
 * The item as the compendium shows it (R31). DM: the true item with every redaction revealed and the markers
 * removed (`text` and `curse`). Player: `playerItem` through the item's `defaultView` (homebrew), or with no
 * view, which still strips markers fail-closed.
 */
export function displayItem(item: ItemDef & { defaultView?: PlayerView }, viewer: 'dm' | 'player'): ItemDef {
  if (viewer === 'player') return playerItem(item, item.defaultView);
  const all = (t: RichText) => redact(t, new Set(redactionIds(t)));
  const out: ItemDef = { ...item, text: all(item.text) };
  if (item.curse) out.curse = all(item.curse);
  return out;
}

/** Shows one hidden field to the player. */
export const revealField = (view: PlayerView, f: HideableField): PlayerView =>
  ({ ...view, hidden: view.hidden.filter(h => h !== f), revealed: [...view.revealed] });

/** Shows one redacted span of text to the player. */
export const revealRedaction = (view: PlayerView, id: string): PlayerView =>
  ({ ...view, hidden: [...view.hidden], revealed: view.revealed.includes(id) ? [...view.revealed] : [...view.revealed, id] });

/**
 * The view of an item its player fully knows: no cover name or override text, nothing hidden and every
 * redaction revealed. (Dropping the view would leave the bars up, since no view still redacts.)
 */
export const revealedView = (item: ItemDef): PlayerView => {
  const { text, curse, choices } = item;
  const ids = [text, curse ?? [], ...choiceTexts(choices)].flatMap(redactionIds);
  return { hidden: [], revealed: [...new Set(ids)] };
};

/** `view` without revealed ids whose redaction is gone (the view's text, else the item's, plus curse and choices), so an id can't be reused already revealed. */
export const pruneRevealed = (item: ItemDef, view: PlayerView): PlayerView => {
  const ids = new Set([view.text ?? item.text, item.curse ?? [], ...choiceTexts(item.choices)].flatMap(redactionIds));
  return { ...view, revealed: view.revealed.filter(id => ids.has(id)) };
};

/** The player now knows everything, all at once. */
export const identify = (entry: InventoryEntry): InventoryEntry => ({ ...entry, view: revealedView(entry.item) });

/**
 * R51: the character as its player may carry it away (a Player-view export). Every item is `playerItem(item, view)`, and the entry's
 * `view` (which holds the hidden list and revealed ids) and the `sourceId` of a covered item (a real id) are dropped. The sheet the
 * player sees is unchanged: `computeSheet(playerCharacter(c), player)` equals `computeSheet(c, player)`.
 */
export function playerCharacter(c: Character): Character {
  return {
    ...c,
    inventory: c.inventory.map(({ view, sourceId, ...e }) => {
      const item = playerItem(e.item, view);
      // `active` (equipped, and attuned if the item needs it) is read from the real item. If its attunement is hidden, a worn but
      // unattuned item would turn active in the copy, so the bare requirement stays (the text of it, "by a wizard", does not).
      if (e.equipped && !e.attuned && e.item.attunement && !item.attunement) item.attunement = true;
      // A charge count would tell the player the item has charges (I8).
      return { ...e, item, ...(!item.charges && { chargesUsed: 0 }), ...(sourceId !== undefined && view?.name === undefined && { sourceId }) };
    }),
  };
}
