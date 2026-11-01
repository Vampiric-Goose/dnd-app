import type { Choice, RaceDef, Size, SubraceDef } from '../../types.ts';
import { ABILITIES, abilities, arr, base, proficiencies, speeds, table, traits, type Ctx, type Raw } from './common.ts';

const SIZES = new Set(['T', 'S', 'M', 'L', 'H', 'G']);
const OVERWRITE = table<NonNullable<SubraceDef['overwrite']>[number]>({
  ability: 'ability', skillProficiencies: 'skills', languageProficiencies: 'languages', toolProficiencies: 'tools', weaponProficiencies: 'weapons', armorProficiencies: 'armor',
});

/** 5etools names subraces without their race ("Hill" of "Dwarf"); ours read "Hill Dwarf", like the SRD. */
export const subraceName = (r: Raw): string | undefined =>
  r.name === undefined ? undefined : String(r.name).includes(r.raceName) ? r.name
  : String(r.name).includes(';') ? `${r.raceName} (${r.name})` : `${r.name} ${r.raceName}`; // "Half-Elf (Variant; Drow Descent)"

function shared(r: Raw, ctx: Ctx) {
  // `lineage` races (VRGR/MPMM) use the custom-lineage rule: +2 to one score and +1 to another
  const ab = abilities(r.ability ?? (r.lineage ? [{ choose: { weighted: { from: ABILITIES, weights: [2, 1] } } }] : undefined)), pr = proficiencies(r, ctx);
  // 5etools `feats: [{ any: n }]` (Variant Human, Custom Lineage): n feats of the character's choice
  const feats = arr(r.feats).flatMap((f): Choice[] => Array.from({ length: typeof f?.any === 'number' ? f.any : 0 }, () => ({ type: 'feat' as const })));
  const choices = [...ab.choices, ...pr.choices, ...feats];
  const resist = arr(r.resist).filter(x => typeof x === 'string');
  return {
    abilityBonuses: ab.bonuses, proficiencies: pr.proficiencies, traits: traits(r.entries),
    ...(typeof r.darkvision === 'number' && { darkvision: r.darkvision }),
    ...(resist.length && { resist }),
    ...(choices.length && { choices }),
  };
}

export const race = (r: Raw, ctx: Ctx, id: string, name: string): RaceDef => {
  const size = arr(r.size)[0];
  return { ...base('race', id, name, r), size: SIZES.has(size) ? size as Size : 'M', speed: speeds(r.speed) ?? { walk: 30 }, ...shared(r, ctx) };
};

export const subrace = (r: Raw, ctx: Ctx, id: string, name: string): SubraceDef => {
  const speed = speeds(r.speed);
  // 5etools keeps PHB Human's +1s on its nameless "standard" subrace, not the race: a sibling's own bonuses are its whole bonus,
  // so it replaces what our race carries (the SRD Human's +1s).
  const parent = ctx.rawRace?.(r.raceName, r.raceSource ?? r.source);
  const implicit = r.ability !== undefined && parent && parent.ability === undefined && !parent.lineage && !parent._copy;
  const explicit = Object.entries(r.overwrite ?? {}).filter(([, v]) => v).map(([k]) => OVERWRITE[k]).filter(Boolean);
  const overwrite = [...new Set([...(implicit ? ['ability' as const] : []), ...explicit])];
  const overwriteTraits = arr(r.entries).map(e => e?.data?.overwrite).filter((x): x is string => typeof x === 'string');
  return {
    ...base('subrace', id, name, r), raceId: ctx.ref('race', r.raceName, r.raceSource ?? r.source), ...(speed && { speed }), ...shared(r, ctx),
    ...(overwrite.length && { overwrite }), ...(overwriteTraits.length && { overwriteTraits }),
  };
};
