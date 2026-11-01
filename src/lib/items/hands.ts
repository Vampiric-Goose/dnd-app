// Pure: what fits in a creature's hands (2014 rules, SRD 5.1 Equipment). Two hands; a two-handed weapon needs both, any other weapon
// one (a versatile weapon's two-handed die needs the other hand free); a shield is carried in one hand and only one counts; one suit of
// armor. "Equipped" means worn, or held in a hand.
import type { InventoryEntry, ItemDef } from '../types.ts';

export const HANDS = 2;
const body = (i: ItemDef) => !!i.armor && i.armor.category !== 'shield';
const shield = (i: ItemDef) => i.armor?.category === 'shield';

/** Hands it takes when equipped: a two-handed weapon 2, another weapon or a shield 1, anything else 0. */
export const handsFor = (i: ItemDef): number => (shield(i) ? 1 : i.weapon ? (i.weapon.properties.includes('two-handed') ? 2 : 1) : 0);

/** Hands the equipped entries take. */
export const handsHeld = (inv: InventoryEntry[]): number => inv.reduce((n, e) => n + (e.equipped ? handsFor(e.item) : 0), 0);

/**
 * Equips the entry, unequipping what the rules won't let it share: another suit of armor, another shield, and held items until its
 * hands are free (weapons first, in inventory order, then the shield). `stowed`: the names of what was unequipped.
 */
export function equip(inv: InventoryEntry[], id: string): { inventory: InventoryEntry[]; stowed: string[] } {
  const it = inv.find((x) => x.id === id);
  if (!it) return { inventory: inv, stowed: [] };
  const held = inv.filter((x) => x.equipped && x.id !== id), off = new Set<string>();
  for (const x of held) if ((body(it.item) && body(x.item)) || (shield(it.item) && shield(x.item))) off.add(x.id);
  let busy = held.reduce((n, x) => n + (off.has(x.id) ? 0 : handsFor(x.item)), 0);
  for (const x of [...held.filter((y) => y.item.weapon), ...held.filter((y) => shield(y.item))]) {
    if (busy + handsFor(it.item) <= HANDS) break;
    if (off.has(x.id)) continue;
    off.add(x.id);
    busy -= handsFor(x.item);
  }
  return {
    inventory: inv.map((x) => (x.id === id ? { ...x, equipped: true } : off.has(x.id) ? { ...x, equipped: false } : x)),
    stowed: inv.filter((x) => off.has(x.id)).map((x) => x.item.name),
  };
}

/** A new character's kit: the first suit of armor, then a shield, then weapons while hands are free (nothing is stowed for them). */
export function equipStarting(inv: InventoryEntry[]): InventoryEntry[] {
  let out = inv.map((x) => ({ ...x, equipped: false }));
  const order = [...out.filter((x) => body(x.item)).slice(0, 1), ...out.filter((x) => shield(x.item)).slice(0, 1), ...out.filter((x) => x.item.weapon)];
  for (const x of order) if (handsHeld(out) + handsFor(x.item) <= HANDS) out = out.map((y) => (y.id === x.id ? { ...y, equipped: true } : y));
  return out;
}
