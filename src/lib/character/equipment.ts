import { makeEntry } from '../items/inventory.ts';
import type { Character, InventoryEntry, ItemDef, StartingEquipment } from '../types.ts';
import { getKind, type Lookup } from './choices.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts.

/** The creator's equipment picks. Keys: `<sourceId>|<group>` (option index) and `<sourceId>|<group>|<option>|<item>|<n>` (a category item's id). */
export interface Equip { mode: 'pack' | 'gold'; picks: Record<string, number>; cats: Record<string, string>; gold: { dice: string; times: number; total?: number } }
export interface EquipSource { id: string; name: string; eq: StartingEquipment }

/** The first class's and the background's starting equipment. */
export function equipmentSources(c: Character, lookup: Lookup): EquipSource[] {
  const cls = getKind(lookup, c.build.levels[0]?.classId, 'class'), bg = getKind(lookup, c.build.backgroundId, 'background');
  return [...(cls ? [{ id: cls.id, name: cls.name, eq: cls.startingEquipment }] : []), ...(bg ? [{ id: bg.id, name: bg.name, eq: bg.equipment }] : [])];
}

/**
 * The inventory and gold the picks give. Unpicked groups take their first option, so a new class starts on its own
 * defaults. Gold mode replaces the kit. One suit of armor, a shield and every weapon start equipped.
 */
export function startingInventory(sources: EquipSource[], equip: Equip, item: (id: string) => ItemDef | undefined): { inventory: InventoryEntry[]; gp: number } {
  if (equip.mode === 'gold') return { inventory: [], gp: equip.gold.total ?? 0 };
  const inventory: InventoryEntry[] = [];
  let armored = false;
  const add = (def: ItemDef | undefined, quantity: number) => {
    if (!def) return;
    const body = !!def.armor && def.armor.category !== 'shield';
    inventory.push({ ...makeEntry(def, { quantity }), equipped: !!def.weapon || def.armor?.category === 'shield' || (body && !armored) });
    armored ||= body;
  };
  for (const s of sources) s.eq.choices.forEach((group, g) => {
    const o = equip.picks[`${s.id}|${g}`] ?? 0;
    group[o]?.items.forEach((it, i) => {
      if (it.itemId) return add(item(it.itemId), it.quantity);
      for (let n = 0; n < it.quantity; n++) add(item(equip.cats[`${s.id}|${g}|${o}|${i}|${n}`] ?? ''), 1);
    });
  });
  return { inventory, gp: 0 };
}

/**
 * Mundane items a starting-equipment category option allows, by name. Weapon and armor categories
 * ('simple-weapons', 'martial-melee-weapons', 'light-armor', 'shields') match the item's weapon/armor data;
 * anything else ('holy-symbols', 'arcane-foci', 'musical-instruments'...) matches `ItemDef.category` (R15).
 */
export function itemsInCategory(items: ItemDef[], category: string): ItemDef[] {
  const w = /^(simple|martial)(?:-(melee|ranged))?-weapons$/.exec(category);
  const a = /^(light|medium|heavy)-armor$/.exec(category);
  const ok = (i: ItemDef): boolean =>
    w ? i.weapon?.category === w[1] && (!w[2] || i.weapon.ranged === (w[2] === 'ranged'))
    : a ? i.armor?.category === a[1]
    : category === 'shields' ? i.armor?.category === 'shield'
    : i.category === category;
  return items.filter(i => isMundane(i) && ok(i)).sort((x, y) => x.name.localeCompare(y.name));
}

/** A plain base item: not magic, no rarity, no bonuses, not wondrous, and not made from another item (a +1 or adamantine variant). */
export const isMundane = (i: ItemDef): boolean => !i.magic && !i.rarity && !i.baseItemId && !i.bonuses && i.type !== 'wondrous';

/** Reads a starting-gold text such as '5d4 × 10 gp' or '2d4 gp' into dice and a multiplier. */
export function goldFormula(text: string | undefined): { dice: string; times: number } | undefined {
  const m = /(\d+d\d+)(?:\s*[×x*]\s*(\d+))?/i.exec(text ?? '');
  return m ? { dice: m[1].toLowerCase(), times: Number(m[2] ?? 1) } : undefined;
}
