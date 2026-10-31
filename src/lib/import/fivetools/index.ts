// 5etools JSON -> one Pack per source. Pure (no Svelte/Vite/DOM): scripts/import-check.ts runs it under plain Node.
import type { ContentIndex } from '../../content/index.ts';
import { entityId, slug } from '../../content/ids.ts';
import type { Entity, EntityKind, EntityPatch, ItemDef, Pack } from '../../types.ts';
import { background } from './backgrounds.ts';
import { CLASS_KEYS, classRawKey, importClasses } from './classes.ts';
import { classifySource, is2024Source, sourceInfo, type SourceVerdict } from '../../content/sources.ts';
import { arr, fail, type ClassRef, type Ctx, type Raw } from './common.ts';
import { condition } from './conditions.ts';
import { rawKey, resolveCopy } from './copy.ts';
import { feat } from './feats.ts';
import { expandVariant, item, variantApplies, viewOf } from './items.ts';
import { optionalFeature } from './optionalFeatures.ts';
import { race, subrace, subraceName } from './races.ts';
import { spell, spellKey, spellLookup } from './spells.ts';

/** Entities the importer refused, by upper-cased source: 2024 rules, or a source that is neither official 2014 nor declared homebrew. */
export interface Skipped { rules2024: Record<string, number>; unknown: Record<string, number> }
export interface ImportResult {
  packs: Pack[]; raw: [string, unknown][]; errors: { file: string; message: string }[]; warnings: string[];
  skipped2024: number; skippedUnknown: number; skipped: Skipped;
}

type Converter = (r: Raw, ctx: Ctx, id: string, name: string) => Entity;
const CONVERT: Record<string, [EntityKind, Converter]> = {
  race: ['race', race], subrace: ['subrace', subrace], background: ['background', background], feat: ['feat', feat],
  optionalfeature: ['optionalFeature', optionalFeature], condition: ['condition', condition], spell: ['spell', spell],
  baseitem: ['item', item], item: ['item', item],
};
const CONTENT_KEYS = [...Object.keys(CONVERT), 'magicvariant', ...CLASS_KEYS];
const META_KEYS = ['book', 'adventure'];
// A reference to a core book's item falls back to the SRD entity of the same name (the book's SRD subset).
const isCore = (source: string) => sourceInfo(source)?.kind === 'core';

const up = (s: unknown) => String(s).toUpperCase();
/** The source ids a file declares as its own homebrew (`_meta.sources[].json`). Official data files declare none. */
const declaredIn = (j: Raw): Set<string> => new Set(j && typeof j === 'object' && !Array.isArray(j)
  ? arr(j._meta?.sources).map(s => (typeof s === 'string' ? s : s?.json)).filter((s): s is string => typeof s === 'string' && !!s).map(up) : []);
const NOT_DECLARED: ReadonlySet<string> = new Set();
type Reject = '2024' | 'unknown';
/** Every raw key ends in `|SOURCE`. */
const keySourceOf = (key: string) => key.slice(key.lastIndexOf('|') + 1);
/** A `_copy` named a source the importer rejects; the entity is skipped, never built from it. */
class CopyRejected extends Error {
  why: Reject;
  source: string;
  constructor(why: Reject, source: string) { super(`_copy source ${source} is not 2014 official content`); this.why = why; this.source = source; }
}
const nameOf = (key: string, r: Raw): string | undefined => (key === 'subrace' ? subraceName(r) : r.name);
// A magic variant's items take inherits.source; it is keyed (for _copy) by its own source when it has one.
const sourceOf = (key: string, r: Raw): string | undefined => (key === 'magicvariant' ? r.inherits?.source ?? r.source : r.source);
const keySource = (r: Raw): string | undefined => r?.source ?? r?.inherits?.source;
/** The `_copy` / raw-store key; class-family records carry their parent class in it (names collide across classes). */
const keyOf = (key: string, r: Raw): string | undefined =>
  CLASS_KEYS.has(key) ? classRawKey(key, r) : r?.name !== undefined && keySource(r) ? rawKey(key, r.name, keySource(r)!) : undefined;
/** The name, then noun-first forms ("Light Crossbow" -> "Crossbow, Light"), which is how the SRD names much of its gear. */
const srdNames = (name: string): string[] => {
  const [, head, paren = ''] = /^(.*?)(\s*\(.*\))?$/.exec(name)!;
  const w = head.split(' ');
  return [name, ...w.slice(1).map((_, i) => `${w.slice(i + 1).join(' ')}, ${w.slice(0, i + 1).join(' ')}${paren}`)];
};
/** Why an entity can't even be keyed (files are untrusted), or undefined. */
const invalid = (key: string, r: Raw): string | undefined => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not an object';
  if (r.name !== undefined && typeof r.name !== 'string') return 'name is not a string';
  if (r.source !== undefined && typeof r.source !== 'string') return 'source is not a string';
  if (key === 'magicvariant' && r.inherits?.source !== undefined && typeof r.inherits.source !== 'string') return 'inherits.source is not a string';
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** FNV-1a over the pack content: sync, so mergePack stays sync. */
function hash(p: Pick<Pack, 'entities' | 'patches'>): string {
  let h = 0x811c9dc5;
  const s = JSON.stringify([p.entities, p.patches]);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
const finish = (p: Pack): Pack => ({ ...p, importedAt: Date.now(), hash: hash(p) });

/** Merges a re-import into a stored pack: same-id entities replaced, patches deduplicated by target + alias. */
export function mergePack(existing: Pack | undefined, incoming: Pack): Pack {
  const entities = new Map((existing?.entities ?? []).map(e => [e.id, e]));
  for (const e of incoming.entities) entities.set(e.id, e);
  const pk = (p: EntityPatch) => `${p.targetId}|${up(p.alias)}`;
  const patches = new Map((existing?.patches ?? []).map(p => [pk(p), p]));
  for (const p of incoming.patches) patches.set(pk(p), p);
  const name = incoming.name !== incoming.source ? incoming.name : existing?.name ?? incoming.name;
  return finish({ ...incoming, name, entities: [...entities.values()], patches: [...patches.values()] });
}

export async function import5etools(
  files: { name: string; json: unknown }[],
  ctx: { index: ContentIndex; rawLookup: (key: string) => Promise<unknown | undefined>; /** Sources of the homebrew packs already stored: their raw records may be `_copy` targets. */ homebrewSources?: Iterable<string> },
): Promise<ImportResult> {
  const { index } = ctx;
  const errors: ImportResult['errors'] = [], warnings: string[] = [], raw: [string, unknown][] = [];
  const skipped: Skipped = { rules2024: {}, unknown: {} };
  const unknownIn = new Map<string, Map<string, number>>(); // file -> source -> entries skipped as unrecognised
  const homebrewSources = new Set<string>(), allDeclared = new Set<string>();
  const packNames = new Map<string, string>(), lookups: Map<string, ClassRef[]>[] = [];
  const tally = (why: Reject, source: string, file: string) => {
    const s = up(source);
    if (why === '2024') { skipped.rules2024[s] = (skipped.rules2024[s] ?? 0) + 1; return; }
    skipped.unknown[s] = (skipped.unknown[s] ?? 0) + 1;
    const f = unknownIn.get(file) ?? new Map<string, number>();
    f.set(s, (f.get(s) ?? 0) + 1);
    unknownIn.set(file, f);
  };

  // 1. Collect entities; spell-class lookup files and book lists are side data.
  const found: { file: string; key: string; r: Raw; declared: ReadonlySet<string> }[] = [];
  const batch = new Map<string, { r: Raw; declared: ReadonlySet<string> }>();
  for (const f of files) {
    const j = f.json as Raw;
    const keys = j && typeof j === 'object' && !Array.isArray(j) ? [...CONTENT_KEYS, ...META_KEYS].filter(k => Array.isArray(j[k])) : [];
    // Foundry VTT overlays (foundry*.json) reuse the content keys but every entry is a partial with `migrationVersion`.
    const foundry = keys.length > 0 && keys.flatMap(k => j[k]).every((e: Raw) => e && typeof e === 'object' && 'migrationVersion' in e);
    if (!keys.length || foundry) {
      let l: Map<string, ClassRef[]> | undefined;
      try { l = spellLookup(j); } catch (err) { errors.push({ file: f.name, message: message(err) }); continue; }
      if (l) lookups.push(l);
      else errors.push({ file: f.name, message: 'No recognised 5etools content' });
      continue;
    }
    const declared = declaredIn(j);
    for (const s of declared) allDeclared.add(s);
    for (const k of META_KEYS) for (const b of arr(j[k])) if (b?.id && b?.name) packNames.set(up(b.id), String(b.name));
    for (const k of CONTENT_KEYS) for (const r of arr(j[k])) {
      const bad = invalid(k, r);
      if (bad) { errors.push({ file: f.name, message: `${k} "${r?.name ?? '?'}": ${bad}` }); continue; }
      found.push({ file: f.name, key: k, r, declared });
      const rk = keyOf(k, r);
      if (rk) batch.set(rk, { r, declared });
    }
  }

  // 2. Whitelist (R52): an entity is imported only from an official 2014 source, or from one its own file declares as homebrew.
  // Never from the 2024 rules or `edition: "one"`, and never through a `_copy` or a class that is itself refused.
  // Then resolve _copy (batch first, then stored raw entities).
  type Refusal = { why: Reject; source: string };
  const storedHomebrew: ReadonlySet<string> = new Set([...(ctx.homebrewSources ?? [])].map(up)); // sources of the homebrew packs already stored
  const sourceRefusal = (s: string, declared: ReadonlySet<string>): Refusal | undefined => {
    const v: SourceVerdict = classifySource(s, declared);
    return v === '2024' || v === 'unknown' ? { why: v, source: s } : undefined;
  };
  /**
   * The reason to refuse this record's own source, or undefined (a record with no source is left to fail in conversion).
   * A record that `inherits` (magic variants) is refused when either its own source or inherits.source is refused, or either is edition "one".
   */
  const refusal = (key: string, r: Raw, declared: ReadonlySet<string>): Refusal | undefined => {
    if (r?.edition === 'one' || r?.inherits?.edition === 'one') return { why: '2024', source: sourceOf(key, r) ?? '?' };
    for (const s of [r?.source, r?.inherits?.source]) if (typeof s === 'string') { const x = sourceRefusal(s, declared); if (x) return x; }
    return undefined;
  };
  const rejectedClasses = new Map<string, Reject>(); // `class|SOURCE` of every class in the batch that is refused
  for (const e of found) {
    const x = e.key === 'class' ? refusal(e.key, e.r, e.declared) : undefined;
    if (x) rejectedClasses.set(`${String(e.r.name).toLowerCase()}|${up(e.r.source)}`, x.why);
  }
  /** A record's parents: classSource, subclassSource and raceSource are judged like its own source; a class in the batch that was refused refuses its subclasses and features. */
  const parentDeclared: ReadonlySet<string> = new Set([...allDeclared, ...storedHomebrew]); // a parent may be homebrew from another file of the batch or a stored pack
  const parentRefusal = (key: string, r: Raw): Refusal | undefined => {
    for (const f of ['classSource', 'subclassSource', 'raceSource']) {
      const s = r?.[f];
      if (typeof s === 'string' && s) { const x = sourceRefusal(s, parentDeclared); if (x) return x; } // 2024 first, then official, then declared (classifySource's order)
    }
    if (!CLASS_KEYS.has(key) || key === 'class') return undefined;
    const why = rejectedClasses.get(`${String(r.className).toLowerCase()}|${up(r.classSource || 'PHB')}`);
    return why && { why, source: String(r.classSource || 'PHB') };
  };
  /** The one check every record goes through, whether it is imported, a `_copy` target in the batch, or a stored raw record. */
  const refuse = (key: string, r: Raw, declared: ReadonlySet<string>): Refusal | undefined => refusal(key, r, declared) ?? parentRefusal(key, r);
  // Raw records kept from earlier imports may predate the whitelist: they are judged like batch records, with the stored homebrew packs as their declarations.
  const storedRefusal = (key: string, r: Raw): Refusal | undefined =>
    refuse(key.split('|')[0], r, storedHomebrew) ?? sourceRefusal(keySourceOf(key), storedHomebrew);
  const stored = async (key: string) => {
    const r = await ctx.rawLookup(key) as Raw;
    return r && !storedRefusal(key, r) ? r : undefined;
  };
  const lookup = async (key: string) => {
    const src = keySourceOf(key);
    if (is2024Source(src)) throw new CopyRejected('2024', src);
    const hit = batch.get(key);
    if (hit) {
      const x = refuse(key.split('|')[0], hit.r, hit.declared);
      if (x) throw new CopyRejected(x.why, x.source);
      return hit.r;
    }
    const r = await ctx.rawLookup(key) as Raw;
    const x = r && storedRefusal(key, r);
    if (x) throw new CopyRejected(x.why, x.source);
    return r;
  };
  const live: { file: string; key: string; r: Raw; label: string }[] = [];
  for (const e of found) {
    const label = `${e.key} "${e.r?.name ?? '?'}"`;
    try {
      const early = refuse(e.key, e.r, e.declared); // before _copy: a refused class's copies need not resolve
      if (early) { tally(early.why, early.source, e.file); continue; }
      const r = await resolveCopy(e.key, e.r, lookup, m => warnings.push(`${e.file}: ${label}: ${m}`), CLASS_KEYS.has(e.key) ? classRawKey : undefined);
      const bad = invalid(e.key, r); // a copy can inherit a bad name or source
      if (bad) fail(bad);
      const late = refuse(e.key, r, e.declared);
      if (late) { tally(late.why, late.source, e.file); continue; }
      const s = sourceOf(e.key, r);
      if (s !== undefined && classifySource(s, e.declared) === 'homebrew') homebrewSources.add(up(s));
      live.push({ ...e, r, label });
      const rk = keyOf(e.key, r);
      if (rk) raw.push([rk, r]);
    } catch (err) {
      if (err instanceof CopyRejected) {
        tally(err.why, err.source, e.file);
        if (err.why === '2024') warnings.push(`${e.file}: ${label}: skipped, it is a copy of ${err.source} (2024 rules)`);
      } else errors.push({ file: e.file, message: `${label}: ${message(err)}` });
    }
  }
  for (const [file, by] of unknownIn) {
    const n = [...by.values()].reduce((a, b) => a + b, 0);
    warnings.push(`${file}: Skipped ${n} ${n === 1 ? 'entry' : 'entries'} from unrecognised sources: ${[...by.keys()].join(', ')} (not 2014 official books, and not declared as homebrew)`);
  }

  // 3. Every batch entity's final id: its SRD counterpart's when it overlaps (it becomes a patch), else its own.
  const srdTwin = (kind: EntityKind, name: string, r: Raw): Entity | undefined => {
    if (!r?.srd || classifySource(String(r.source)) !== 'official') return undefined; // homebrew may not overlap (and patch) the SRD
    for (const n of [...(typeof r.srd === 'string' ? [r.srd] : []), ...srdNames(name)]) {
      const e = index.find(kind, n, 'SRD');
      if (e) return e;
    }
  };
  const refKey = (kind: string, name: string, source: string) => `${kind}|${slug(name)}|${up(source)}`;
  const refs = new Map<string, string>();
  for (const { key, r } of live) {
    const kind = CONVERT[key]?.[0], name = nameOf(key, r);
    // A failure here resurfaces as this entity's conversion error in step 4.
    try { if (kind && name !== undefined && r.source) refs.set(refKey(kind, name, r.source), srdTwin(kind, name, r)?.id ?? entityId(kind, name, r.source)); } catch { /* reported in step 4 */ }
  }
  const conv: Ctx = {
    index,
    listed: source => { const v = classifySource(source, allDeclared); return v === 'official' || v === 'homebrew'; },
    ref: (kind, name, source) => refs.get(refKey(kind, name, source)) ?? index.find(kind, name, source)?.id
      ?? (isCore(source) ? index.find(kind, name, 'SRD')?.id : undefined) ?? entityId(kind, name, source),
    spellClasses: (name, source) => lookups.flatMap(l => l.get(spellKey(name, source)) ?? []),
  };

  // 4. Convert. An entity overlapping the SRD becomes a text patch on it.
  const packs = new Map<string, { entities: Map<string, Entity>; patches: Map<string, EntityPatch> }>();
  const pack = (source: string) => {
    let p = packs.get(source);
    if (!p) packs.set(source, p = { entities: new Map(), patches: new Map() });
    return p;
  };
  const emit = (def: Entity, twin: Entity | undefined) => {
    const p = pack(def.source);
    // An empty text (mundane gear often has none) would blank the SRD's own description.
    if (twin) p.patches.set(twin.id, { targetId: twin.id, alias: def.source, ...(def.text.length && { text: def.text }) });
    else p.entities.set(def.id, def);
  };
  const bases: { view: Raw; def: ItemDef }[] = [];
  for (const { key, r, file, label } of live) {
    const c = CONVERT[key];
    if (!c) continue;
    if (key === 'subrace' && r.name === undefined) continue; // a race's "no subrace" placeholder
    try {
      const name = nameOf(key, r) ?? fail('missing name');
      if (!r.source) fail('missing source');
      const twin = srdTwin(c[0], name, r);
      const def = c[1](r, conv, entityId(c[0], name, r.source), name);
      emit(def, twin);
      if (key === 'baseitem') bases.push({ view: r, def: { ...(def as ItemDef), id: twin?.id ?? def.id } });
    } catch (err) {
      errors.push({ file, message: `${label}: ${message(err)}` });
    }
  }

  await importClasses(live.filter(e => CLASS_KEYS.has(e.key)), conv, stored, {
    entity: e => pack(e.source).entities.set(e.id, e),
    patch: (source, pt) => pack(source).patches.set(pt.targetId, pt),
    error: (file, msg) => errors.push({ file, message: msg }),
    warn: msg => warnings.push(msg),
  });

  // 5. Magic variants against every base item in the batch or the index.
  const inBatch = new Set(bases.map(b => b.def.id));
  for (const d of index.all('item')) if (!d.magic && !inBatch.has(d.id)) bases.push({ view: viewOf(d), def: d });
  for (const { key, r, file, label } of live) {
    if (key !== 'magicvariant' || !r.requires) continue; // ponytail: generic variants ("+1 Weapon") aren't items themselves
    try {
      if (!r.inherits?.source) fail('missing inherits.source');
      for (const b of bases) {
        if (!variantApplies(r, b.view)) continue;
        const v = expandVariant(r, b, conv);
        emit(v.def, srdTwin('item', v.name, r.inherits));
      }
    } catch (err) {
      errors.push({ file, message: `${label}: ${message(err)}` });
    }
  }

  return {
    packs: [...packs].map(([source, p]) => finish({
      id: `pack:${source}`, name: packNames.get(source) ?? source, source, ...(homebrewSources.has(source) && { homebrew: true }), importedAt: 0, hash: '',
      entities: [...p.entities.values()], patches: [...p.patches.values()],
    })),
    raw, errors, warnings, skipped,
    skipped2024: Object.values(skipped.rules2024).reduce((a, b) => a + b, 0),
    skippedUnknown: Object.values(skipped.unknown).reduce((a, b) => a + b, 0),
  };
}
