import { effectOk } from '../character/customEffect.ts';
import { is2024 } from '../character/strip2024.ts';
import { isRichText } from '../content/richtext.ts';
import { isRec } from '../recordShape.ts';
import { uid } from '../uid.ts';
import type { Choice, Effect, ItemDef, ItemType, PlayerView, Rarity, Recharge, StoredItem } from '../types.ts';

// Pure (no Svelte/Vite/DOM): how a homebrew record is made from another item.

export const ITEM_TYPES: readonly ItemType[] = ['weapon', 'armor', 'shield', 'ammunition', 'gear', 'pack', 'tool', 'wondrous', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'other'];
const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
const RECHARGES: readonly Recharge[] = ['short', 'long', 'dawn', 'dusk', 'none'];
const BONUS_KEYS = ['attack', 'damage', 'ac', 'save', 'spellAttack', 'spellDc'] as const;

const NO_2024 = 'This item is from the 2024 rules, which this app does not use.';

/** A fresh homebrew id. Not the name: a rename must not leave a stale slug. */
export const newHomebrewId = (): string => `item:homebrew-${uid().slice(0, 8)}@HOMEBREW`;

/**
 * Customize: every field of an SRD or pack item, as a new homebrew record that remembers where it came from.
 * It carries no default player view. An item that already has a base (a "+1 Longsword") keeps it, so proficiency still works.
 */
export function customize(item: ItemDef, campaignId: string): StoredItem {
  if (is2024(item)) throw new Error(NO_2024); // R60: the index already leaves these out; defence in depth
  const { defaultView: _v, ...copy } = structuredClone(item) as ItemDef & { defaultView?: PlayerView };
  return { ...copy, id: newHomebrewId(), source: 'Homebrew', campaignId, baseItemId: item.baseItemId ?? item.id, updatedAt: Date.now() };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

// Each effect is checked for its type's fields (the custom-effect form's model), so the sheet can rely on them.
const effectsOk = (v: unknown): v is Effect[] => Array.isArray(v) && v.every(effectOk);
export const traitOk = (t: unknown, depth: number): boolean =>
  isRec(t) && str(t.name) && isRichText(t.text) && (t.effects === undefined || effectsOk(t.effects)) && (t.choices === undefined || choicesOk(t.choices, depth + 1));
function choicesOk(v: unknown, depth = 0): v is Choice[] {
  return depth <= 8 && Array.isArray(v) && v.every((c) => isRec(c) && str(c.type) && (c.type !== 'option' || (Array.isArray(c.options) && c.options.every((t) => traitOk(t, depth)))));
}

/**
 * The one guard for a stored item (R-guard): a name, every piece of rich text the app reads is well-formed, and every effect fits its type. A record that fails
 * would make `displayItem` and the lists throw, so every place that reads stored items filters through this.
 */
export function soundItem(item: StoredItem | ItemDef): boolean {
  if (!isRec(item) || !str(item.name) || !item.name.trim() || !isRichText(item.text)) return false;
  const i = item as unknown as Record<string, unknown>;
  if (i.curse !== undefined && !isRichText(i.curse)) return false;
  if (i.effects !== undefined && !effectsOk(i.effects)) return false;
  if (i.choices !== undefined && !choicesOk(i.choices)) return false;
  const v = i.defaultView;
  return v === undefined || (isRec(v) && (v.text === undefined || isRichText(v.text)));
}

function weapon(w: unknown): ItemDef['weapon'] {
  if (!isRec(w) || !oneOf(['simple', 'martial'], w.category) || typeof w.ranged !== 'boolean' || !str(w.damage) || !str(w.damageType) || !strs(w.properties)) return undefined;
  const range = Array.isArray(w.range) && w.range.length === 2 && w.range.every(num) ? { range: [w.range[0], w.range[1]] as [number, number] } : {};
  return { category: w.category, ranged: w.ranged, damage: w.damage, damageType: w.damageType, properties: w.properties, ...(str(w.versatile) && { versatile: w.versatile }), ...range };
}

function armor(a: unknown): ItemDef['armor'] {
  if (!isRec(a) || !oneOf(['light', 'medium', 'heavy', 'shield'], a.category) || !num(a.ac)) return undefined;
  return { category: a.category, ac: a.ac, ...(num(a.dexCap) && { dexCap: a.dexCap }), ...(num(a.strReq) && { strReq: a.strReq }), ...(a.stealthDisadvantage === true && { stealthDisadvantage: true }) };
}

function bonuses(b: unknown): ItemDef['bonuses'] {
  if (!isRec(b)) return undefined;
  const out = Object.fromEntries(BONUS_KEYS.filter((k) => num(b[k])).map((k) => [k, b[k]]));
  return Object.keys(out).length ? out : undefined;
}

function charges(c: unknown): ItemDef['charges'] {
  if (!isRec(c) || !num(c.max) || c.max < 1 || !oneOf(RECHARGES, c.recharge)) return undefined;
  return { max: c.max, recharge: c.recharge, ...(str(c.rechargeAmount) && c.rechargeAmount && { rechargeAmount: c.rechargeAmount }) };
}

function view(v: unknown): PlayerView | undefined {
  if (!isRec(v) || !strs(v.hidden) || !strs(v.revealed) || (v.text !== undefined && !isRichText(v.text))) return undefined;
  return { hidden: v.hidden as PlayerView['hidden'], revealed: v.revealed, ...(str(v.name) && { name: v.name }), ...(v.text !== undefined && { text: v.text }) };
}

const present = (v: unknown) => v !== undefined && !(Array.isArray(v) && !v.length) && !(isRec(v) && !Object.keys(v).length); // an empty block is nothing to lose

/**
 * An imported item file (JSON or PDF) as this campaign's homebrew: a fresh id, so it never replaces anything.
 * The file is untrusted. What the rest of the app relies on (name, text, type, the numbers) must be valid or this throws a message the
 * page can show. Optional blocks that are malformed are dropped, and `ignored` names each one so the DM is told. Fields this app does
 * not know are not kept.
 */
export function importedItem(data: unknown, campaignId: string): { item: StoredItem; ignored: string[] } {
  if (!isRec(data)) throw new Error('That file does not hold an item.');
  const d = data;
  if (is2024(d)) throw new Error(NO_2024); // R60: its source, id or base item is 2024 content
  if (!str(d.name) || !d.name.trim()) throw new Error('The item has no name.');
  if (d.text !== undefined && !isRichText(d.text)) throw new Error(`The item "${d.name}" has a damaged description (text).`);
  if (!oneOf(ITEM_TYPES, d.type)) throw new Error(`The item "${d.name}" has an unknown type.`);
  if (d.magic !== undefined && typeof d.magic !== 'boolean') throw new Error(`The item "${d.name}" has a damaged magic flag.`);
  if (d.weight !== undefined && !num(d.weight)) throw new Error(`The item "${d.name}" has a damaged weight.`);
  if (d.costCp !== undefined && !num(d.costCp)) throw new Error(`The item "${d.name}" has a damaged cost.`);
  if (d.rarity !== undefined && !oneOf(RARITIES, d.rarity)) throw new Error(`The item "${d.name}" has an unknown rarity.`);

  const kept = {
    weapon: weapon(d.weapon), armor: armor(d.armor), bonuses: bonuses(d.bonuses), charges: charges(d.charges), defaultView: view(d.defaultView),
    curse: isRichText(d.curse) && d.curse.length ? d.curse : undefined,
    effects: effectsOk(d.effects) ? d.effects : undefined,
    choices: choicesOk(d.choices) ? d.choices : undefined,
  };
  const ignored = Object.entries(kept).filter(([k, v]) => v === undefined && present(d[k])).map(([k]) => k);
  const out = {
    id: newHomebrewId(), kind: 'item', name: d.name.trim(), source: 'Homebrew', campaignId, updatedAt: Date.now(),
    text: d.text ?? [], type: d.type, magic: d.magic === true,
    ...(d.srd === true && { srd: true }),
    ...(num(d.weight) && { weight: d.weight }), ...(num(d.costCp) && { costCp: d.costCp }), ...(d.rarity !== undefined && { rarity: d.rarity }),
    ...(str(d.baseItemId) && { baseItemId: d.baseItemId }), ...(str(d.category) && { category: d.category }),
    ...((str(d.attunement) || typeof d.attunement === 'boolean') && { attunement: d.attunement }),
    ...(d.consumable === true && { consumable: true }), ...(strs(d.aliases) && d.aliases.length && { aliases: d.aliases }),
    ...Object.fromEntries(Object.entries(kept).filter(([, v]) => v !== undefined)),
  } as StoredItem;
  return { item: structuredClone(out), ignored };
}
