import type { ItemDef } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts.

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
  return items.filter(i => !i.magic && ok(i)).sort((x, y) => x.name.localeCompare(y.name));
}

/** Reads a starting-gold text such as '5d4 × 10 gp' or '2d4 gp' into dice and a multiplier. */
export function goldFormula(text: string | undefined): { dice: string; times: number } | undefined {
  const m = /(\d+d\d+)(?:\s*[×x*]\s*(\d+))?/i.exec(text ?? '');
  return m ? { dice: m[1].toLowerCase(), times: Number(m[2] ?? 1) } : undefined;
}
