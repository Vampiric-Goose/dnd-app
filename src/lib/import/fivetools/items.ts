import { renderTags } from '../../content/richtext.ts';
import { entityId } from '../../content/ids.ts';
import type { ItemDef, ItemType, Rarity, Recharge } from '../../types.ts';
import { arr, base, code, mapStrings, type Ctx, type Raw } from './common.ts';

const TYPE: Record<string, ItemType> = {
  M: 'weapon', R: 'weapon', A: 'ammunition', LA: 'armor', MA: 'armor', HA: 'armor', S: 'shield', G: 'gear', SCF: 'gear',
  AT: 'tool', T: 'tool', INS: 'tool', GS: 'tool', P: 'potion', RG: 'ring', RD: 'rod', SC: 'scroll', ST: 'staff', WD: 'wand',
};
const DMG: Record<string, string> = {
  B: 'bludgeoning', P: 'piercing', S: 'slashing', A: 'acid', C: 'cold', F: 'fire', O: 'force', L: 'lightning', N: 'necrotic', I: 'poison', Y: 'psychic', R: 'radiant', T: 'thunder',
};
const PROP: Record<string, string> = { A: 'ammunition', F: 'finesse', H: 'heavy', L: 'light', LD: 'loading', R: 'reach', S: 'special', T: 'thrown', '2H': 'two-handed', V: 'versatile' };
const ARMOR: Record<string, 'light' | 'medium' | 'heavy'> = { LA: 'light', MA: 'medium', HA: 'heavy' };
const SCF: Record<string, string> = { arcane: 'arcane-foci', druid: 'druidic-foci', holy: 'holy-symbols' };
const CATEGORY: Record<string, string> = { INS: 'musical-instruments', AT: 'artisans-tools', GS: 'gaming-sets' };
const RECHARGE: Record<string, Recharge> = { dawn: 'dawn', dusk: 'dusk', restShort: 'short', restLong: 'long' };
const RARITIES = new Set<string>(['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies']);
const invert = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const CODE_OF = { prop: invert(PROP), dmg: invert(DMG), armor: invert(ARMOR), scf: invert(SCF), category: invert(CATEGORY) };

const bonus = (s: unknown): number | undefined => {
  const n = parseInt(String(s ?? ''), 10);
  return Number.isFinite(n) ? n : undefined;
};
const defined = <T extends object>(o: T): T | undefined => {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
};

export const item = (r: Raw, ctx: Ctx, id: string, name: string): ItemDef => {
  const t = code(r.type ?? '');
  let type: ItemType = r.packContents ? 'pack' : TYPE[t] ?? 'other';
  if (r.wondrous && (type === 'other' || type === 'gear')) type = 'wondrous';
  const rarity = typeof r.rarity === 'string' ? r.rarity : undefined;
  const range = String(r.range ?? '').split('/').map(Number);
  const weapon: ItemDef['weapon'] = type === 'weapon' ? {
    category: r.weaponCategory === 'martial' ? 'martial' : 'simple', ranged: t === 'R', damage: r.dmg1 ?? '', damageType: DMG[code(r.dmgType ?? '')] ?? '',
    ...(r.dmg2 && { versatile: r.dmg2 }),
    properties: arr(r.property).map(p => PROP[code(p?.uid ?? p)]).filter(Boolean),
    ...(range.length === 2 && range.every(Number.isFinite) && { range: range as [number, number] }),
  } : undefined;
  const armor: ItemDef['armor'] = ARMOR[t] ? {
    category: ARMOR[t], ac: r.ac ?? 10,
    ...(t === 'MA' && { dexCap: typeof r.dexterityMax === 'number' ? r.dexterityMax : 2 }), ...(t === 'HA' && { dexCap: 0 }),
    ...(r.strength && { strReq: Number(r.strength) }), ...(r.stealth && { stealthDisadvantage: true }),
  } : t === 'S' ? { category: 'shield', ac: r.ac ?? 2 } : undefined;
  const category = t === 'SCF' ? SCF[r.scfType] : CATEGORY[t];
  const bonuses = defined({
    attack: bonus(r.bonusWeapon ?? r.bonusWeaponAttack), damage: bonus(r.bonusWeapon ?? r.bonusWeaponDamage), ac: bonus(r.bonusAc),
    save: bonus(r.bonusSavingThrow), spellAttack: bonus(r.bonusSpellAttack), spellDc: bonus(r.bonusSpellSaveDc),
  });
  const [baseName, baseSource] = r.baseItem ? String(r.baseItem).split('|') : [];
  return {
    ...base('item', id, name, r), type,
    magic: (rarity !== undefined && rarity !== 'none' && rarity !== 'unknown') || !!r.wondrous, // 'unknown (magic)' is magic
    ...(typeof r.weight === 'number' && { weight: r.weight }),
    ...(typeof r.value === 'number' && { costCp: r.value }),
    ...(rarity && RARITIES.has(rarity) && { rarity: rarity as Rarity }),
    ...(r.reqAttune && { attunement: r.reqAttune === true ? true : renderTags(String(r.reqAttune)) }),
    ...(baseName && { baseItemId: ctx.ref('item', baseName, baseSource ?? 'PHB') }),
    ...((type === 'potion' || type === 'scroll' || type === 'ammunition') && { consumable: true }),
    ...(category && { category }),
    ...(weapon && { weapon }), ...(armor && { armor }), ...(bonuses && { bonuses }),
    ...(typeof r.charges === 'number' && { charges: {
      max: r.charges, recharge: RECHARGE[r.recharge] ?? 'none',
      ...(r.rechargeAmount !== undefined && { rechargeAmount: renderTags(String(r.rechargeAmount)) }),
    } }),
  };
};

/** The 5etools-shaped fields a magic variant's `requires`/`excludes` test, rebuilt from one of our items (an index base). */
export const viewOf = (d: ItemDef): Raw => ({
  name: d.name, source: d.source,
  type: d.weapon ? (d.weapon.ranged ? 'R' : 'M') : d.armor ? (d.armor.category === 'shield' ? 'S' : CODE_OF.armor[d.armor.category])
    : d.type === 'ammunition' ? 'A' : d.category && CODE_OF.scf[d.category] ? 'SCF' : (d.category && CODE_OF.category[d.category]) ?? (d.type === 'gear' ? 'G' : undefined),
  ...(d.weapon && { weapon: true, weaponCategory: d.weapon.category, property: d.weapon.properties.map(p => CODE_OF.prop[p]), dmgType: CODE_OF.dmg[d.weapon.damageType] }),
  ...(d.armor && d.armor.category !== 'shield' && { armor: true }),
  ...(d.category && CODE_OF.scf[d.category] && { scfType: CODE_OF.scf[d.category] }),
});

const norm = (v: unknown) => (typeof v === 'string' ? code(v).toLowerCase() : v);
const has = (b: Raw, k: string, want: unknown): boolean =>
  Array.isArray(b[k]) ? b[k].some((x: Raw) => norm(x?.uid ?? x) === norm(want)) : norm(b[k]) === norm(want);

/** True when the base matches every key of one `requires` object and no `excludes` value. */
export const variantApplies = (v: Raw, b: Raw): boolean =>
  arr(v.requires).some((req: Raw) => Object.entries(req).every(([k, want]) => has(b, k, want)))
  && !Object.entries(v.excludes ?? {}).some(([k, vals]) => arr(vals).some(x => has(b, k, x)));

const TEMPLATE = /\{=(\w+)(?:\/(\w+))?\}/g;

/** One magic variant applied to one base: the base's stats with the variant's name, rarity, bonuses and text. */
export function expandVariant(v: Raw, b: { view: Raw; def: ItemDef }, ctx: Ctx): { name: string; source: string; def: ItemDef } {
  const inh = v.inherits ?? {}, source = String(inh.source).toUpperCase();
  const name = `${inh.namePrefix ?? ''}${inh.nameRemove ? b.def.name.replace(inh.nameRemove, '') : b.def.name}${inh.nameSuffix ?? ''}`;
  const vars: Raw = { ...b.view, ...inh, baseName: b.def.name };
  const entries = mapStrings(arr(inh.entries), s => s.replace(TEMPLATE, (m, k: string, f?: string) => {
    const val = vars[k];
    if (val === undefined || typeof val === 'object') return m;
    return f === 'l' ? String(val).toLowerCase() : f === 'u' ? String(val).toUpperCase() : String(val);
  }));
  const id = entityId('item', name, source);
  const magic = item({ ...inh, type: undefined, name, source, entries }, ctx, id, name);
  const { srd: _s, aliases: _a, costCp: _c, ...stats } = b.def;
  const def: ItemDef = {
    ...stats, id, name, source, text: [...magic.text, ...b.def.text], magic: magic.magic, baseItemId: b.def.id,
    ...(magic.rarity && { rarity: magic.rarity }), ...(magic.attunement && { attunement: magic.attunement }),
    ...(magic.bonuses && { bonuses: magic.bonuses }), ...(magic.charges && { charges: magic.charges }),
  };
  return { name, source, def };
}
