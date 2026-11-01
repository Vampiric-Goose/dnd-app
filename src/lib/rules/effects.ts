import { enumerateChoices, getKind, raceParts, walkLevels } from '../character/choices.ts';
import type { LevelStep, Lookup, PendingChoice } from '../character/choices.ts';
import { playerItem } from '../items/playerView.ts';
import type { CampaignSettings, Character, Effect, InventoryEntry, ItemDef } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts.

export interface SheetOpts { settings: CampaignSettings; viewer: 'dm' | 'player' }
/** `classId` is the class whose level and table a formula in the effect reads (unset: total level, no table). */
export interface SourcedEffect { effect: Effect; source: string; classId?: string }
/** `item` is what this viewer sees; `active` (equipped, and attuned if it needs it) always comes from the real item. */
export interface ViewedItem { entry: InventoryEntry; item: ItemDef; active: boolean }

export interface Gathered { steps: LevelStep[]; pending: PendingChoice[]; items: ViewedItem[]; effects: SourcedEffect[] }

/** Everything computeSheet reads from the build: level steps, answered choices, items as seen by the viewer, and active effects. */
export function gather(c: Character, opts: SheetOpts, lookup: Lookup = id => c.embedded[id]): Gathered {
  const steps = walkLevels(c, lookup, opts.settings);
  const pending = enumerateChoices(c, lookup, opts.settings);
  const items = c.inventory.map(entry => ({
    entry,
    item: opts.viewer === 'player' ? playerItem(entry.item, entry.view) : entry.item,
    active: entry.equipped && (!entry.item.attunement || entry.attuned),
  }));
  const effects: SourcedEffect[] = [];
  const add = (source: string, list: Effect[] | undefined, classId?: string) =>
    list?.forEach(effect => effects.push({ effect, source, ...(classId && { classId }) }));

  const { race, sub } = raceParts(c, lookup);
  for (const r of [race, sub]) {
    if (!r) continue;
    add(r.name, r.effects);
    for (const t of r.traits) add(t.name, t.effects);
  }
  const bg = getKind(lookup, c.build.backgroundId, 'background');
  if (bg) { add(bg.name, bg.effects); add(bg.feature.name, bg.feature.effects); }

  const seen = new Set<string>();
  for (const s of steps) {
    for (const e of [s.cls, s.sub]) if (e && !seen.has(e.id)) { seen.add(e.id); add(e.name, e.effects, s.classId); }
    for (const f of s.features) add(f.name, f.effects, s.classId);
  }

  // Effects of what the answers picked: optional features, feats and option traits.
  const ownerClass = (p: PendingChoice): string | undefined => {
    const e = lookup(p.sourceId.split('/')[0]);
    return e?.kind === 'class' ? e.id : e?.kind === 'feature' || e?.kind === 'subclass' ? e.classId : undefined;
  };
  for (const p of pending) {
    const a = p.answer;
    if (!a) continue;
    const ids = a.type === 'ids' ? a.ids : a.type === 'asi' && a.featId ? [a.featId] : [];
    if (p.choice.type === 'optionalFeature') for (const id of ids) { const e = getKind(lookup, id, 'optionalFeature'); if (e) add(e.name, e.effects, ownerClass(p)); }
    if (p.choice.type === 'feat' || p.choice.type === 'asi') for (const id of ids) { const e = getKind(lookup, id, 'feat'); if (e) add(e.name, e.effects); }
    if (p.choice.type === 'option') for (const t of p.choice.options) if (ids.includes(t.name)) add(t.name, t.effects, ownerClass(p));
  }

  // ponytail: item `choices` (option traits on items) aren't applied; add when an item editor can answer them.
  for (const { entry, item, active } of items) {
    if (!active) continue;
    const hidden = opts.viewer === 'dm' && entry.view?.hidden.includes('effects');
    add(hidden ? `${item.name} (hidden)` : item.name, item.effects);
  }
  add('Custom', c.customEffects);
  return { steps, pending, items, effects };
}

/** Every effect currently in force on the character, with the name of what grants it. */
export const activeEffects = (c: Character, opts: SheetOpts): SourcedEffect[] => gather(c, opts).effects;

/** The effects of one type, narrowed. */
export const ofType = <T extends Effect['type']>(list: SourcedEffect[], type: T) =>
  list.flatMap(s => (s.effect.type === type ? [{ ...s, effect: s.effect as Extract<Effect, { type: T }> }] : []));
