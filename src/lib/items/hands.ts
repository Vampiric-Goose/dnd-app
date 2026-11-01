// Pure: what fits in a creature's hands (2014 rules, SRD 5.1 Equipment). Two hands; a two-handed weapon needs both, any other weapon
// one (a versatile weapon's two-handed die needs the other hand free); a shield is carried in one hand and only one counts; one suit of
// armor. "Equipped" means worn, or held in a hand.
import type { InventoryEntry, ItemDef } from '../types.ts';
import { uid } from '../uid.ts';

export const HANDS = 2;
const body = (i: ItemDef) => !!i.armor && i.armor.category !== 'shield';
const shield = (i: ItemDef) => i.armor?.category === 'shield';

/** Hands it takes when equipped: a two-handed weapon 2, another weapon or a shield 1, anything else 0. */
export const handsFor = (i: ItemDef): number => (shield(i) ? 1 : i.weapon ? (i.weapon.properties.includes('two-handed') ? 2 : 1) : 0);

/** Hands the equipped entries take. */
export const handsHeld = (inv: InventoryEntry[]): number => inv.reduce((n, e) => n + (e.equipped ? handsFor(e.item) : 0), 0);

/** Two entries of the same thing that can share a row (not held, not attuned, no charges used, the same notes). */
const sameStack = (a: InventoryEntry, b: InventoryEntry) => a.item.id === b.item.id && a.sourceId === b.sourceId && !a.attuned && !b.attuned
  && a.chargesUsed === 0 && b.chargesUsed === 0 && a.notes === b.notes;

/**
 * Equips the entry, unequipping what the rules won't let it share: another suit of armor, another shield, and held items until its
 * hands are free (weapons first, in inventory order, then the shield). `stowed`: the names of what was unequipped. From a stack
 * (quantity > 1) one is taken into its own row and equipped, the rest stays carried, so a second one can be held too (two handaxes).
 */
export function equip(inv: InventoryEntry[], id: string): { inventory: InventoryEntry[]; stowed: string[] } {
  const stack = inv.find((x) => x.id === id);
  if (!stack) return { inventory: inv, stowed: [] };
  if (stack.quantity > 1 && !stack.equipped) {
    const one: InventoryEntry = { ...stack, id: uid(), quantity: 1 };
    inv = inv.flatMap((x) => (x.id === id ? [{ ...x, quantity: x.quantity - 1 }, one] : [x]));
    id = one.id;
  }
  const it = inv.find((x) => x.id === id)!;
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

/** Unequips the entry; back on its stack when a carried one of the same thing is there to join. */
export function unequip(inv: InventoryEntry[], id: string): InventoryEntry[] {
  const it = inv.find((x) => x.id === id);
  if (!it) return inv;
  const to = inv.find((x) => x.id !== id && !x.equipped && sameStack(x, it));
  return to ? inv.flatMap((x) => (x.id === id ? [] : x.id === to.id ? [{ ...x, quantity: x.quantity + it.quantity }] : [x]))
    : inv.map((x) => (x.id === id ? { ...x, equipped: false } : x));
}

/** A new character's kit: the first suit of armor, then a shield, then weapons (one at a time from a stack) while hands are free. */
export function equipStarting(inv: InventoryEntry[]): InventoryEntry[] {
  let out = inv.map((x) => ({ ...x, equipped: false }));
  const order = [...out.filter((x) => body(x.item)).slice(0, 1), ...out.filter((x) => shield(x.item)).slice(0, 1), ...out.filter((x) => x.item.weapon)];
  for (const x of order) {
    for (let n = 0; n < (x.item.weapon ? x.quantity : 1); n++) {
      const left = out.find((y) => y.id === x.id);
      if (!left || left.equipped || handsHeld(out) + handsFor(x.item) > HANDS) break;
      out = equip(out, x.id).inventory;
    }
  }
  return out;
}
