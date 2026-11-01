import { renderTags } from '../../content/richtext.ts';
import type { BackgroundDef, EquipmentOption, Trait } from '../../types.ts';
import { arr, base, code, proficiencies, rich, table, type Ctx, type Raw } from './common.ts';

const gp = (cp: number) => (cp % 100 === 0 ? `${cp / 100} gp` : cp % 10 === 0 ? `${cp / 10} sp` : `${cp} cp`);
const EQUIPMENT_TYPE = table<string>({
  setGaming: 'gaming set', instrumentMusical: 'musical instrument', toolArtisan: "artisan's tools", focusSpellcastingArcane: 'arcane focus',
  focusSpellcastingDruidic: 'druidic focus', focusSpellcastingHoly: 'holy symbol', weaponSimple: 'simple weapon', weaponMartial: 'martial weapon',
});

/** One `startingEquipment` item: `'name|src'`, `{ item, quantity, displayName, containsValue }`, `{ special }`, `{ equipmentType }` or `{ value }` (cp). */
const label = (x: Raw): string => {
  if (typeof x === 'string') return code(x);
  if (x.value !== undefined) return gp(x.value);
  const name = x.displayName ?? (x.item ? code(x.item) : x.special ?? (x.equipmentType ? EQUIPMENT_TYPE[x.equipmentType] ?? x.equipmentType : '?'));
  return renderTags(`${x.quantity > 1 ? `${x.quantity} × ` : ''}${name}${x.containsValue ? ` containing ${gp(x.containsValue)}` : ''}`);
};

/** Each group's `_` items are listed; lettered alternatives become one "(a) … or (b) …" line. */
const equipmentText = (groups: Raw): string[] => arr(groups).flatMap((g: Raw) => [
  ...arr(g._).map(label),
  ...(Object.keys(g).some(k => k !== '_') ? [Object.entries(g).filter(([k]) => k !== '_').map(([k, v]) => `(${k}) ${arr(v).map(label).join(', ')}`).join(' or ')] : []),
]);

// The starting-equipment category each `equipmentType` offers (matched by itemsInCategory).
const EQUIPMENT_CATEGORY = table<string>({
  weaponSimple: 'simple-weapons', weaponMartial: 'martial-weapons', weaponSimpleMelee: 'simple-melee-weapons', weaponMartialMelee: 'martial-melee-weapons',
  weaponSimpleRanged: 'simple-ranged-weapons', weaponMartialRanged: 'martial-ranged-weapons', weaponMelee: 'melee-weapons', weaponRanged: 'ranged-weapons',
  armorLight: 'light-armor', armorMedium: 'medium-armor', armorHeavy: 'heavy-armor', instrumentMusical: 'musical-instruments', toolArtisan: 'artisans-tools',
  setGaming: 'gaming-sets', focusSpellcastingArcane: 'arcane-foci', focusSpellcastingDruidic: 'druidic-foci', focusSpellcastingHoly: 'holy-symbols',
});

/** One starting-equipment item as a pick: a named item, or a category to choose from; `{ special }` and coins are text only. */
const pick = (x: Raw, ctx: Ctx): EquipmentOption['items'] => {
  const quantity = Number.isInteger(x?.quantity) && x.quantity > 0 ? x.quantity : 1;
  const ref = typeof x === 'string' ? x : typeof x?.item === 'string' ? x.item : undefined;
  if (ref) { const [name, source = 'PHB'] = ref.split('|'); return [{ itemId: ctx.ref('item', name, source), quantity }]; }
  const category = typeof x?.equipmentType === 'string' ? EQUIPMENT_CATEGORY[x.equipmentType] : undefined;
  return category ? [{ category, quantity }] : [];
};

/** 5etools `defaultData` (a class's, or a background's `startingEquipment`): each group's `_` items, then its lettered choices. */
export const equipmentChoices = (groups: Raw, ctx: Ctx): EquipmentOption[][] => arr(groups).flatMap((g: Raw): EquipmentOption[][] => {
  if (!g || typeof g !== 'object') return [];
  const option = (v: Raw): EquipmentOption => ({ label: arr(v).map(label).join(', '), items: arr(v).flatMap(x => pick(x, ctx)) });
  const letters = Object.keys(g).filter(k => k !== '_').sort();
  return [...(arr(g._).length ? [[option(g._)]] : []), ...(letters.length ? [letters.map(k => option(g[k]))] : [])];
});

const isFeature = (e: Raw) => e && typeof e === 'object' && (e.data?.isFeature || /^Feature:/.test(e.name ?? ''));

export const background = (r: Raw, ctx: Ctx, id: string, name: string): BackgroundDef => {
  const pr = proficiencies(r, ctx), list = equipmentText(r.startingEquipment);
  const f = arr(r.entries).flatMap(e => (isFeature(e) ? [e] : e?.entries ? arr(e.entries).filter(isFeature) : []))[0];
  const feature: Trait = f ? { name: renderTags(String(f.name).replace(/^Feature:\s*/, '')), text: rich(f.entries) } : { name: 'Feature', text: [] };
  return {
    ...base('background', id, name, r), proficiencies: pr.proficiencies,
    equipment: { text: list.length ? [{ list }] : [], choices: equipmentChoices(r.startingEquipment, ctx) }, feature,
    ...(pr.choices.length && { choices: pr.choices }),
  };
};
