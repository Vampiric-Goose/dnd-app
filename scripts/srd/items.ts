import type { Block, ItemDef, ItemType, Rarity } from '../../src/lib/types.ts';
import { base, fail, qty, rich, type Raw, type Read } from './misc.ts';

const CP: Record<string, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
const GEAR: Record<string, ItemType> = { ammunition: 'ammunition', 'equipment-packs': 'pack' };

function equipment(e: Raw): ItemDef {
  const per = e.quantity ?? 1; // ammunition is sold in bundles; cost and weight are stored per piece
  const cat = e.equipment_category.index;
  const shield = e.armor_category === 'Shield';
  const type: ItemType = cat === 'weapon' ? 'weapon' : cat === 'armor' ? (shield ? 'shield' : 'armor')
    : cat === 'adventuring-gear' ? GEAR[e.gear_category.index] ?? 'gear' : cat === 'tools' ? 'tool' : 'other';
  const text: Block[] = rich([...(e.desc ?? []), ...(e.special ?? [])]);
  if (per > 1) text.push({ p: `Sold in bundles of ${per}.` });
  if (e.contents) text.push({ list: e.contents.map((c: Raw) => qty(c.quantity, c.item.name)) });
  if (e.speed) text.push({ p: `**Speed:** ${e.speed.quantity} ${e.speed.unit}` });
  if (e.capacity) text.push({ p: `**Carrying Capacity:** ${e.capacity}` });
  const ac = e.armor_class, r = e.weapon_range === 'Ranged' ? e.range : e.throw_range;
  return {
    ...base('item', e.name, text),
    type,
    magic: false,
    ...(e.weight !== undefined && { weight: e.weight / per }),
    costCp: (e.cost.quantity * (CP[e.cost.unit] ?? fail(`unit ${e.cost.unit}`))) / per,
    ...(cat === 'weapon' && { weapon: {
      category: e.weapon_category.toLowerCase(),
      ranged: e.weapon_range === 'Ranged',
      damage: e.damage?.damage_dice ?? '', // the net deals no damage
      damageType: e.damage?.damage_type.index ?? '',
      ...(e.two_handed_damage && { versatile: e.two_handed_damage.damage_dice }),
      properties: e.properties.map((p: Raw) => p.index),
      ...(r && { range: [r.normal, r.long ?? r.normal] as [number, number] }),
    } }),
    ...(cat === 'armor' && { armor: shield ? { category: 'shield' as const, ac: 2 } : {
      category: e.armor_category.toLowerCase(),
      ac: ac.base,
      ...(!ac.dex_bonus ? { dexCap: 0 } : ac.max_bonus !== undefined ? { dexCap: ac.max_bonus } : {}),
      ...(e.str_minimum > 0 && { strReq: e.str_minimum }),
      ...(e.stealth_disadvantage && { stealthDisadvantage: true }),
    } }),
  };
}

const MAGIC = /^(.+?), (common|uncommon|rare|very rare|legendary|artifact|rarity varies)(?: \((requires attunement(?: by [^)]+)?)\))?/i;
const SIMPLE: ItemType[] = ['potion', 'ring', 'rod', 'scroll', 'staff', 'wand'];

function magicItem(m: Raw): ItemDef {
  const [, word, rarity, attune] = MAGIC.exec(m.desc[0]) ?? fail(`magic item header: ${m.desc[0]}`);
  const w = word.toLowerCase();
  const type: ItemType = w.startsWith('wond') ? 'wondrous' // also matches the data's "Wondous item"
    : w.startsWith('armor') ? (w.includes('(shield)') ? 'shield' : 'armor')
    : w.startsWith('weapon') ? (m.equipment_category.index === 'ammunition' ? 'ammunition' : 'weapon')
    : SIMPLE.find(t => t === w) ?? 'other';
  const weapon = /^(Weapon|Ammunition), \+(\d)$/.exec(m.name), armor = /^(Armor|Shield), \+(\d)$/.exec(m.name);
  return {
    ...base('item', m.name, rich(m.desc.slice(1))),
    type,
    magic: true,
    rarity: (rarity.toLowerCase() === 'rarity varies' ? 'varies' : rarity.toLowerCase()) as Rarity,
    ...(attune && { attunement: attune === 'requires attunement' ? true : attune.replace(/^requires attunement /, '') }),
    ...(type === 'shield' && { armor: { category: 'shield' as const, ac: 2 } }),
    ...(weapon && { bonuses: { attack: +weapon[2], damage: +weapon[2] } }),
    ...(armor && { bonuses: { ac: +armor[2] } }),
  };
}

export const items = (read: Read): ItemDef[] => [
  ...read('Equipment').map(equipment),
  ...read('Magic-Items').filter(m => !m.variants.length).map(magicItem), // parents with variants are umbrella entries
];
