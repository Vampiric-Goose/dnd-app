// 5etools classes, subclasses, class features and subclass features. Pure (no Svelte/Vite/DOM).
// A book class/subclass/feature that overlaps the SRD becomes a patch on the SRD entity (which keeps its hand-authored effects);
// book features without an SRD counterpart become entities, listed in the class/subclass patch's `addFeatures`.
import { entityId, featureId, slug, sourceOf } from '../../content/ids.ts';
import { renderTags } from '../../content/richtext.ts';
import type { Ability, Choice, ClassDef, Entity, EntityPatch, FeatureDef, FeatureRef, MulticlassPrereq, Progression, Skill, Spellcasting, SubclassDef, Trait } from '../../types.ts';
import { ABILITIES, arr, base, code, fail, proficiencies, rich, table, type Ctx, type Raw } from './common.ts';

export const CLASS_KEYS = new Set(['class', 'subclass', 'classFeature', 'subclassFeature']);
type FeatureKind = 'classFeature' | 'subclassFeature';

const lc = (s: unknown) => String(s ?? '').toLowerCase();
const up = (s: unknown) => String(s ?? '').toUpperCase();
/** `className|CLASSSOURCE`, the parent-class part of every class-family key. */
const classKey = (name: unknown, source: unknown) => `${lc(name)}|${up(source || 'PHB')}`;

/**
 * Raw key of a class-family record, or of the `_copy` naming one (N11): names collide across classes, so the key carries the
 * parent context. `_copy` objects use the record's own field names (`shortName` for subclasses, `subclassShortName` for features).
 */
export function classRawKey(kind: string, x: Raw): string {
  const cls = classKey(x?.className, x?.classSource);
  switch (kind) {
    case 'class': return `class|${lc(x?.name)}|${up(x?.source)}`;
    case 'subclass': return `subclass|${cls}|${lc(x?.shortName)}|${up(x?.source)}`;
    case 'classFeature': return `classFeature|${lc(x?.name)}|${cls}|${x?.level}|${up(x?.source)}`;
    default: return `subclassFeature|${lc(x?.name)}|${cls}|${lc(x?.subclassShortName)}|${up(x?.subclassSource || 'PHB')}|${x?.level}|${up(x?.source)}`;
  }
}

/**
 * A feature reference (`Name|Class|ClassSource|Level|FeatureSource?`, or for subclasses
 * `Name|Class|ClassSource|SubShort|SubSource|Level|FeatureSource?`) -> the raw key of the record it names.
 * As in 5etools, an empty class or subclass source means PHB and an empty feature source means the class's (subclass's) source.
 */
function refKey(kind: FeatureKind, ref: unknown): { key: string; name: string; level: number } {
  const p = String(ref).split('|');
  const classSource = p[2] || 'PHB';
  if (kind === 'classFeature') {
    const level = Number(p[3]);
    return { key: classRawKey(kind, { name: p[0], className: p[1], classSource, level, source: p[4] || classSource }), name: p[0], level };
  }
  const subclassSource = p[4] || 'PHB', level = Number(p[5]);
  return { key: classRawKey(kind, { name: p[0], className: p[1], classSource, subclassShortName: p[3], subclassSource, level, source: p[6] || subclassSource }), name: p[0], level };
}

type Ref = { kind: FeatureKind; ref: string };
/**
 * `refClassFeature` / `refSubclassFeature` entries inside a feature's entries, in order: features it grants. A counted `options`
 * block ("choose 1": Totem Spirit, Hunter's Prey) offers its refs as a choice instead; an uncounted one grants them all.
 */
function nestedRefs(x: Raw, out: { refs: Ref[]; options: { count: number; refs: Ref[] }[] } = { refs: [], options: [] }) {
  if (Array.isArray(x)) for (const v of x) nestedRefs(v, out);
  else if (x && typeof x === 'object') {
    if (x.type === 'refClassFeature' && typeof x.classFeature === 'string') out.refs.push({ kind: 'classFeature', ref: x.classFeature });
    else if (x.type === 'refSubclassFeature' && typeof x.subclassFeature === 'string') out.refs.push({ kind: 'subclassFeature', ref: x.subclassFeature });
    else if (x.type === 'options' && typeof x.count === 'number') out.options.push({ count: x.count, refs: nestedRefs(x.entries).refs });
    else for (const v of Object.values(x)) nestedRefs(v, out);
  }
  return out;
}

const isAbility = (k: unknown): k is Ability => (ABILITIES as unknown[]).includes(k);
const PROGRESSION = table<Progression>({ full: 'full', '1/2': 'half', '1/3': 'third', pact: 'pact', artificer: 'artificer' });
const nums = (x: Raw): number[] | undefined => (Array.isArray(x) ? x.map(Number) : undefined);

function spellcasting(r: Raw): Spellcasting | undefined {
  const progression = PROGRESSION[r.casterProgression], ability = r.spellcastingAbility;
  if (!progression || !isAbility(ability)) return undefined;
  const cantrips = nums(r.cantripProgression), known = nums(r.spellsKnownProgression);
  return {
    ability, progression, preparation: r.preparedSpells ? 'prepared' : 'known',
    ...(r.spellsKnownProgressionFixed && { spellbook: true }),
    ...(cantrips && { cantrips }), ...(known && { known }),
    ...(typeof r.preparedSpells === 'string' && {
      preparedFormula: r.preparedSpells.replace(/<\$level\$>/g, 'level').replace(/<\$(\w+)_mod\$>/g, 'mod:$1').replace(/\s+/g, ''),
    }),
  };
}

/** `additionalSpells[0].prepared` (`{"1": ["bless", ...]}`) -> always-prepared spell ids by class level. */
function alwaysPrepared(r: Raw, ctx: Ctx): { level: number; spells: string[] }[] {
  const list = arr(r.additionalSpells);
  // ponytail: several additionalSpells entries are alternatives (Circle of the Land terrains); the text describes those
  if (list.length !== 1) return [];
  return Object.entries(list[0]?.prepared ?? {}).flatMap(([lvl, spells]) => {
    const ids = arr(spells).filter((s): s is string => typeof s === 'string').map(s => {
      const [n, src] = s.split('|');
      return ctx.ref('spell', n.replace(/#c$/, ''), src || 'PHB');
    });
    return /^\d+$/.test(lvl) && ids.length ? [{ level: Number(lvl), spells: ids }] : [];
  });
}

const signed = (v: Raw) => `${Number(v) >= 0 ? '+' : ''}${v}`;
/** A class table cell: numbers stay numbers; bonus/dice/speed objects become display text like the SRD's ('+2', '1d6', '+10 ft.'). */
function cell(c: Raw): number | string {
  if (typeof c === 'number') return c;
  if (typeof c === 'string') return /^-?\d+(\.\d+)?$/.test(c.trim()) ? Number(c) : renderTags(c);
  switch (c?.type) {
    case 'bonus': return signed(c.value);
    case 'bonusSpeed': return `${signed(c.value)} ft.`;
    case 'dice': return arr(c.toRoll).map(d => `${d?.number ?? 1}d${d?.faces}`).join(' + ');
  }
  return c?.value !== undefined ? String(c.value) : '';
}

/** `progression`: a 20-length array of totals, or `{ level: total }` (the total holds until the next listed level). */
function counts(p: Raw): number[] {
  if (Array.isArray(p)) return Array.from({ length: 20 }, (_, i) => Number(p[Math.min(i, p.length - 1)] ?? 0));
  let n = 0;
  return Array.from({ length: 20 }, (_, i) => (n = p && Object.hasOwn(p, String(i + 1)) ? Number(p[i + 1]) : n));
}

function multiclassPrereq(req: Raw): MulticlassPrereq | undefined {
  const pick = (o: Raw) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => isAbility(k) && typeof v === 'number'));
  const all = pick(req), any = pick(arr(req?.or)[0]);
  const out: MulticlassPrereq = { ...(Object.keys(all).length && { all }), ...(Object.keys(any).length && { any }) };
  return Object.keys(out).length ? out : undefined;
}

/** 'simple', '{@item longsword|phb|longswords}' (the item name), `{ proficiency, optional }` (optional ones dropped). */
const profName = (x: Raw): string | undefined => {
  if (x && typeof x === 'object') return x.optional ? undefined : profName(x.proficiency);
  if (typeof x !== 'string') return undefined;
  const tag = /^\{@\w+ ([^|}]+)/.exec(x);
  return (tag ? tag[1] : renderTags(x)).trim().toLowerCase();
};

/** `startingProficiencies` / `proficienciesGained`. */
function classProfs(sp: Raw, ctx: Ctx) {
  const { proficiencies: p, choices } = proficiencies({ toolProficiencies: sp?.toolProficiencies }, ctx);
  p.armor = arr(sp?.armor).map(profName).filter((x): x is string => !!x);
  p.weapons = arr(sp?.weapons).map(profName).filter((x): x is string => !!x);
  const s = arr(sp?.skills)[0];
  const skillChoice = s?.choose ? { count: s.choose.count ?? 1, from: arr(s.choose.from).map(x => slug(code(x)) as Skill) }
    : typeof s?.any === 'number' ? { count: s.any, from: 'any' as const } : undefined;
  return { p, choices, skillChoice };
}

interface Live { file: string; key: string; r: Raw; label: string }
export interface ClassOut {
  entity(e: Entity): void;
  patch(source: string, p: EntityPatch): void;
  error(file: string, message: string): void;
  warn(message: string): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const bare = (n: string) => slug(n.replace(/\s*\(.*\)\s*$/, ''));
/** Looser still, for SRD names that differ by more than a suffix: 'Channel Divinity: Sacred Weapon' / 'Sacred Weapon',
 * 'Wild Shape (CR 1 or below)' / 'Wild Shape Improvement', 'Signature Spell' / 'Signature Spells'. Only within one class, subclass and level. */
const loose = (n: string) => bare(n.replace(/^[^:]*:\s*/, '')).replace(/-improvements?$/, '').replace(/s$/, '');

/** Converts the batch's (already `_copy`-resolved, 2024-filtered) class-family records. Never throws: failures are per record. */
export async function importClasses(live: Live[], ctx: Ctx, rawLookup: (key: string) => Promise<unknown>, out: ClassOut): Promise<void> {
  const { index } = ctx;
  const byKey = new Map<string, Raw>();
  for (const e of live) byKey.set(classRawKey(e.key, e.r), e.r);
  const record = async (key: string): Promise<Raw | undefined> => byKey.get(key) ?? (await rawLookup(key));

  // 1. Classes (and their SRD twins) first, so subclasses and features in this batch resolve `Fighter|PHB` to class:fighter@SRD.
  const classIds = new Map<string, string>(), classTwins = new Map<string, Entity>(), subclassPick = new Set<string>();
  for (const { key, r } of live) {
    if (key !== 'class') continue;
    try {
      const twin = r.srd ? index.find('class', typeof r.srd === 'string' ? r.srd : r.name, 'SRD') : undefined;
      if (twin) classTwins.set(classKey(r.name, r.source), twin);
      classIds.set(classKey(r.name, r.source), twin?.id ?? entityId('class', r.name, r.source));
      const gains = arr(r.classFeatures).filter(f => f?.gainSubclassFeature).map(f => refKey('classFeature', f.classFeature));
      const first = gains.sort((a, b) => a.level - b.level)[0];
      if (first) subclassPick.add(first.key);
    } catch { /* reported when the class converts */ }
  }
  const classIdOf = (name: unknown, source: unknown) =>
    classIds.get(classKey(name, source)) ?? ctx.ref('class', String(name), String(source || 'PHB'));

  // 2. Subclasses, keyed by parent class + short name + source.
  const subKey = (className: unknown, classSource: unknown, short: unknown, source: unknown) => `${classKey(className, classSource)}|${lc(short)}|${up(source || 'PHB')}`;
  const subIds = new Map<string, string>();
  const subTwin = (r: Raw, classId: string): SubclassDef | undefined => {
    if (!r.srd) return undefined;
    const names = [r.srd, r.shortName, r.name].filter((n): n is string => typeof n === 'string').map(slug);
    return index.all('subclass').find(s => up(s.source) === 'SRD' && s.classId === classId && (names.includes(slug(s.name)) || names.includes(slug(s.shortName))));
  };
  for (const { key, r } of live) {
    if (key !== 'subclass') continue;
    try {
      subIds.set(subKey(r.className, r.classSource, r.shortName, r.source), subTwin(r, classIdOf(r.className, r.classSource))?.id ?? entityId('subclass', r.name, r.source));
    } catch { /* reported when the subclass converts */ }
  }
  const subIdOf = (r: Raw): string => {
    const id = subIds.get(subKey(r.className, r.classSource, r.subclassShortName, r.subclassSource));
    if (id) return id;
    const classId = classIdOf(r.className, r.classSource), src = up(r.subclassSource || 'PHB');
    return index.all('subclass').find(s => s.classId === classId && slug(s.shortName) === slug(String(r.subclassShortName))
      && (up(s.source) === src || s.aliases?.some(a => up(a) === src)))?.id
      // ponytail: a feature whose subclass is neither in the batch nor the index can only guess the id from the short name
      ?? entityId('subclass', String(r.subclassShortName), src);
  };

  // 3. A feature's parent ids, its SRD counterpart (N8) and its final id.
  const srdFeatures = new Map<string, FeatureDef[]>();
  for (const f of index.all('feature')) {
    if (up(f.source) !== 'SRD') continue;
    const k = `${f.classId}|${f.subclassId ?? ''}|${f.level}`;
    srdFeatures.set(k, [...(srdFeatures.get(k) ?? []), f]);
  }
  const feature = (kind: FeatureKind, r: Raw) => {
    const level = Number(r.level);
    if (!Number.isInteger(level)) fail('level is not a number');
    const classId = classIdOf(r.className, r.classSource);
    const subclassId = kind === 'subclassFeature' ? subIdOf(r) : undefined;
    let twin: FeatureDef | undefined;
    if (r.srd) {
      // Same class, subclass and level only; then the SRD name string, the exact name, the name without a parenthetical suffix, loose().
      const pool = srdFeatures.get(`${classId}|${subclassId ?? ''}|${level}`) ?? [];
      twin = (typeof r.srd === 'string' ? pool.find(f => slug(f.name) === slug(r.srd)) : undefined)
        ?? pool.find(f => slug(f.name) === slug(r.name)) ?? pool.find(f => bare(f.name) === bare(r.name))
        ?? pool.find(f => loose(f.name) === loose(r.name));
    }
    const id = twin?.id ?? featureId(String(r.className), kind === 'subclassFeature' ? String(r.subclassShortName) : undefined, r.name, level, r.source);
    return { level, classId, subclassId, twin, id };
  };

  /** Feature refs (and the refs nested in their entries) -> FeatureRefs, in order, without duplicates. */
  const expand = async (kind: FeatureKind, refs: unknown[], label: string, acc: FeatureRef[] = [], seen = new Set<string>()) => {
    for (const ref of refs) {
      const { key } = refKey(kind, ref);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const r = await record(key);
        if (!r) { out.warn(`${label}: feature "${String(ref)}" not found`); continue; }
        const f = feature(kind, r);
        if (!acc.some(x => x.id === f.id)) acc.push({ level: f.level, id: f.id });
        for (const n of nestedRefs(r.entries).refs) await expand(n.kind, [n.ref], label, acc, seen);
      } catch (err) {
        out.warn(`${label}: feature "${String(ref)}": ${message(err)}`);
      }
    }
    return acc;
  };
  const emit = (def: ClassDef | SubclassDef | FeatureDef, twin: Entity | undefined) => {
    if (!twin) return out.entity(def);
    const add = 'features' in def ? def.features.filter(f => sourceOf(f.id) !== 'SRD') : [];
    out.patch(def.source, { targetId: twin.id, alias: def.source, ...(def.text.length && { text: def.text }), ...(add.length && { addFeatures: add }) });
  };

  // 4. Convert.
  for (const { key, r, file, label } of live) {
    try {
      if (typeof r.name !== 'string') fail('missing name');
      if (!r.source) fail('missing source');
      if (key === 'class') {
        const twin = classTwins.get(classKey(r.name, r.source));
        const refs = arr(r.classFeatures).map(f => (typeof f === 'string' ? f : f?.classFeature));
        const parsed = refs.map(f => refKey('classFeature', f));
        const gain = arr(r.classFeatures).filter(f => f?.gainSubclassFeature).map(f => refKey('classFeature', f.classFeature).level);
        const start = classProfs(r.startingProficiencies, ctx), mc = classProfs(r.multiclassing?.proficienciesGained, ctx);
        const sc = spellcasting(r), ap = alwaysPrepared(r, ctx), se = r.startingEquipment, mcp = multiclassPrereq(r.multiclassing?.requirements);
        const def: ClassDef = {
          ...base('class', twin?.id ?? entityId('class', r.name, r.source), r.name, r),
          // ponytail: sidekick "classes" have no hit die of their own (the creature's is used); 0 until the sheet supports them
          hitDie: Number(r.hd?.faces ?? 0),
          saves: arr(r.proficiency).filter(isAbility),
          proficiencies: start.p,
          skillChoice: start.skillChoice ?? { count: 0, from: [] },
          ...(mcp && { multiclassPrereq: mcp }),
          multiclassProficiencies: mc.p,
          ...(mc.skillChoice && { multiclassSkillChoice: mc.skillChoice }),
          // ponytail: equipment is text only; `defaultData` item picks aren't mapped (the SRD classes carry structured picks)
          startingEquipment: { text: se?.default ? [{ list: arr(se.default).map(x => renderTags(String(x))) }] : [], choices: [], ...(se?.goldAlternative && { gold: renderTags(String(se.goldAlternative)) }) },
          subclassLevel: gain.length ? Math.min(...gain) : 0,
          subclassTitle: String(r.subclassTitle ?? ''),
          asiLevels: [...new Set(parsed.filter(p => slug(p.name) === 'ability-score-improvement').map(p => p.level))].sort((a, b) => a - b),
          features: await expand('classFeature', refs, label),
          ...(sc && { spellcasting: { ...sc, ...(ap.length && { alwaysPrepared: ap }) } }),
          table: arr(r.classTableGroups).filter(g => !g?.rowsSpellProgression).flatMap(g =>
            arr(g.colLabels).map((l, i) => ({ label: renderTags(String(l)), values: arr(g.rows).map(row => cell(arr(row)[i])) }))),
          optionalFeatureProgression: arr(r.optionalfeatureProgression).map(o => ({ name: String(o?.name ?? ''), featureTypes: arr(o?.featureType).map(String), counts: counts(o?.progression) })),
          ...(start.choices.length && { choices: start.choices }),
        };
        emit(def, twin);
      } else if (key === 'subclass') {
        const classId = classIdOf(r.className, r.classSource), twin = subTwin(r, classId), sc = spellcasting(r), ap = alwaysPrepared(r, ctx);
        const def: SubclassDef = {
          ...base('subclass', twin?.id ?? entityId('subclass', r.name, r.source), r.name, r),
          classId, shortName: String(r.shortName ?? r.name),
          features: await expand('subclassFeature', arr(r.subclassFeatures), label),
          ...(sc && { spellcasting: sc }), ...(ap.length && { alwaysPrepared: ap }),
        };
        emit(def, twin);
      } else {
        const kind = key as FeatureKind, f = feature(kind, r);
        const n = slug(r.name);
        const choices: Choice[] = kind !== 'classFeature' ? [] : [
          ...(subclassPick.has(classRawKey(kind, r)) ? [{ type: 'subclass' as const }] : []),
          ...(n === 'ability-score-improvement' ? [{ type: 'asi' as const }] : []),
          ...(n === 'expertise' ? [{ type: 'expertise' as const, count: 2 }] : []),
        ];
        for (const o of nestedRefs(r.entries).options) {
          const options: Trait[] = [];
          for (const x of o.refs) {
            const opt = await record(refKey(x.kind, x.ref).key);
            if (opt) options.push({ name: renderTags(String(opt.name)), text: rich(opt.entries) });
            else out.warn(`${label}: option "${x.ref}" not found`);
          }
          if (options.length) choices.push({ type: 'option', count: o.count, options });
        }
        const def: FeatureDef = {
          ...base('feature', f.id, r.name, r), level: f.level, classId: f.classId,
          ...(f.subclassId && { subclassId: f.subclassId }), ...(r.isClassFeatureVariant && { optional: true }), ...(choices.length && { choices }),
        };
        emit(def, f.twin);
      }
    } catch (err) {
      out.error(file, `${label}: ${message(err)}`);
    }
  }
}
