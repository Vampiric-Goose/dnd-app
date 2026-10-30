import { slug } from '../../content/ids.ts';
import { renderTags } from '../../content/richtext.ts';
import type { SpellDef } from '../../types.ts';
import { arr, base, DROP_SOURCES, rich, type ClassRef, type Ctx, type Raw } from './common.ts';

const SCHOOL: Record<string, string> = { A: 'abjuration', C: 'conjuration', D: 'divination', E: 'enchantment', V: 'evocation', I: 'illusion', N: 'necromancy', T: 'transmutation' };
const UNIT: Record<string, string> = { bonus: 'bonus action' };
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function castingTime(t: Raw): string {
  if (!t) return '';
  const s = plural(t.number ?? 1, UNIT[t.unit] ?? t.unit);
  return t.condition ? `${s}, ${renderTags(t.condition)}` : s;
}

function range(r: Raw): string {
  const d = r?.distance ?? {};
  const dist = () => (d.type === 'feet' ? `${d.amount} feet` : d.type === 'miles' ? plural(d.amount, 'mile') : cap(String(d.type)));
  if (r?.type === 'point') return dist();
  if (r?.type === 'special' || !r) return 'Special';
  // area types (cone, radius, sphere, line, cube, hemisphere, emanation, cylinder) centred on the caster
  const size = d.type === 'miles' ? `${d.amount}-mile` : `${d.amount}-foot`;
  return `Self (${size} ${r.type})`;
}

function duration(list: Raw[]): string {
  return list.map((d): string => {
    switch (d.type) {
      case 'instant': return 'Instantaneous';
      case 'timed': {
        const t = plural(d.duration?.amount ?? 1, d.duration?.type ?? '');
        return d.concentration ? `Concentration, up to ${t}` : d.duration?.upTo ? `Up to ${t}` : t;
      }
      case 'permanent': {
        const ends = arr(d.ends);
        return ends.includes('trigger') ? (ends.includes('dispel') ? 'Until dispelled or triggered' : 'Until triggered') : 'Until dispelled';
      }
      default: return 'Special';
    }
  }).join(' or ');
}

/**
 * A spell's class slugs. A classVariant counts only when the spell's own book defines it (XGE's new spells), not when a
 * later book adds an older spell to a list (TCE's optional expanded lists). 2014 lists win; a spell only on 2024 lists
 * (from a 2024-era book that isn't dropped) keeps those.
 */
function classesOf(refs: ClassRef[], spellSource: string): string[] {
  const up = (s: unknown) => String(s).toUpperCase();
  const ok = refs.filter(c => !c.variantOf || c.variantOf.some(s => up(s) === up(spellSource)));
  const classic = ok.filter(c => !DROP_SOURCES.has(up(c.source)));
  return [...new Set((classic.length ? classic : ok).map(c => slug(c.name)))];
}

export const spell = (r: Raw, ctx: Ctx, id: string, name: string): SpellDef => {
  const c = r.components ?? {}, m = typeof c.m === 'string' ? c.m : typeof c.m?.text === 'string' ? c.m.text : undefined;
  const higher = arr(r.entriesHigherLevel).flatMap(e => (e?.entries ? arr(e.entries) : [e]));
  const refs: ClassRef[] = [
    ...arr(r.classes?.fromClassList).map(x => ({ name: x.name, source: x.source })),
    ...arr(r.classes?.fromClassListVariant).map(x => ({ name: x.name, source: x.source, variantOf: [x.definedInSource] })),
    ...ctx.spellClasses(r.name, r.source),
  ];
  const durations = arr(r.duration);
  return {
    ...base('spell', id, name, r),
    level: r.level ?? 0, school: SCHOOL[r.school] ?? String(r.school ?? '').toLowerCase(),
    castingTime: castingTime(arr(r.time)[0]), range: range(r.range),
    components: { ...(c.v && { v: true }), ...(c.s && { s: true }), ...(m !== undefined && { m: renderTags(m) }) },
    duration: duration(durations), concentration: durations.some(d => d.concentration === true), ritual: r.meta?.ritual === true,
    ...(higher.length && { higherLevels: rich(higher) }),
    classes: classesOf(refs, r.source),
  };
};

/**
 * Spell -> class-list entries from a `spells/sources.json`-shaped file
 * (`{ SRC: { Name: { class: [{ name, source }], classVariant: [{ name, source, definedInSource }] } } }`) or the v2.39
 * `generated/gendata-spell-source-lookup.json` (`{ src: { name: { class: { SRC: { Name: true } }, classVariant: { SRC: { Name: { definedInSources } } } } } }`).
 * Undefined if the file is neither.
 */
export function spellLookup(json: Raw): Map<string, ClassRef[]> | undefined {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
  const top = Object.values(json);
  const isLookup = top.length > 0 && top.every(v => v && typeof v === 'object' && !Array.isArray(v))
    && Object.values(top[0] as object).some((s: Raw) => s && typeof s === 'object' && ('class' in s || 'classVariant' in s));
  if (!isLookup) return undefined;
  const refs = (x: Raw, variant: boolean): ClassRef[] => (Array.isArray(x)
    ? x.map((c: Raw) => ({ name: c.name, source: c.source, ...(variant && { variantOf: [c.definedInSource] }) }))
    : Object.entries(x ?? {}).flatMap(([source, byName]) => Object.entries(byName as Record<string, Raw>)
      .map(([name, v]) => ({ name, source, ...(variant && { variantOf: arr(v?.definedInSources) }) }))));
  const out = new Map<string, ClassRef[]>();
  for (const [src, spells] of Object.entries(json as Record<string, Record<string, Raw>>)) {
    for (const [name, s] of Object.entries(spells)) {
      const found = [...refs(s?.class, false), ...refs(s?.classVariant, true)];
      if (found.length) out.set(spellKey(name, src), [...(out.get(spellKey(name, src)) ?? []), ...found]);
    }
  }
  return out;
}
export const spellKey = (name: string, source: string) => `${String(source).toUpperCase()}|${String(name).toLowerCase()}`;
