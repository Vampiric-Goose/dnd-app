import { renderTags } from '../../content/richtext.ts';
import type { BackgroundDef, Trait } from '../../types.ts';
import { arr, base, code, proficiencies, rich, type Ctx, type Raw } from './common.ts';

const gp = (cp: number) => (cp % 100 === 0 ? `${cp / 100} gp` : cp % 10 === 0 ? `${cp / 10} sp` : `${cp} cp`);
const EQUIPMENT_TYPE: Record<string, string> = {
  setGaming: 'gaming set', instrumentMusical: 'musical instrument', toolArtisan: "artisan's tools", focusSpellcastingArcane: 'arcane focus',
  focusSpellcastingDruidic: 'druidic focus', focusSpellcastingHoly: 'holy symbol', weaponSimple: 'simple weapon', weaponMartial: 'martial weapon',
};

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

const isFeature = (e: Raw) => e && typeof e === 'object' && (e.data?.isFeature || /^Feature:/.test(e.name ?? ''));

export const background = (r: Raw, ctx: Ctx, id: string, name: string): BackgroundDef => {
  const pr = proficiencies(r, ctx), list = equipmentText(r.startingEquipment);
  const f = arr(r.entries).flatMap(e => (isFeature(e) ? [e] : e?.entries ? arr(e.entries).filter(isFeature) : []))[0];
  const feature: Trait = f ? { name: renderTags(String(f.name).replace(/^Feature:\s*/, '')), text: rich(f.entries) } : { name: 'Feature', text: [] };
  return {
    ...base('background', id, name, r), proficiencies: pr.proficiencies,
    equipment: { text: list.length ? [{ list }] : [], choices: [] }, feature,
    ...(pr.choices.length && { choices: pr.choices }),
  };
};
