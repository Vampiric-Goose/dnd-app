import type { Entity, EntityKind, EntityOfKind, Pack, SubclassDef } from '../types.ts';
import { baseKey, slug, sourceOf } from './ids.ts';

const up = (s: string) => s.toUpperCase();
const push = <T>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };

/** Read layer over the SRD plus imported packs. A later pack's entity replaces an earlier one with the same id. */
export class ContentIndex {
  #byId = new Map<string, Entity>();
  #byKind = new Map<string, Entity[]>();
  #byName = new Map<string, Entity[]>(); // `${kind}|${slug(name)}`
  #byAlias = new Map<string, Entity>(); // `${baseKey}@${ALIAS}`

  constructor(packs: Pack[]) {
    for (const p of packs) for (const e of p.entities) this.#byId.set(e.id, e);
    for (const p of packs) for (const patch of p.patches) {
      const target = this.#byId.get(patch.targetId);
      if (!target) continue;
      const copy = { ...target } as Entity;
      const aliases = [...(copy.aliases ?? [])];
      if (!aliases.some(a => up(a) === up(patch.alias))) aliases.push(patch.alias);
      copy.aliases = aliases;
      if (patch.text) copy.text = patch.text;
      if (patch.addFeatures && 'features' in copy) {
        const features = [...copy.features];
        for (const f of patch.addFeatures) if (!features.some(x => x.id === f.id)) features.push(f);
        copy.features = features;
      }
      this.#byId.set(copy.id, copy);
    }
    for (const e of this.#byId.values()) {
      push(this.#byKind, e.kind, e);
      push(this.#byName, `${e.kind}|${slug(e.name)}`, e);
      for (const a of e.aliases ?? []) this.#byAlias.set(`${baseKey(e.id)}@${up(a)}`, e);
    }
  }

  get(id: string): Entity | undefined { return this.#byId.get(id); }

  all<K extends EntityKind>(kind: K): EntityOfKind<K>[] { return [...(this.#byKind.get(kind) ?? [])] as EntityOfKind<K>[]; }

  find<K extends EntityKind>(kind: K, name: string, source?: string): EntityOfKind<K> | undefined {
    const hits = (this.#byName.get(`${kind}|${slug(name)}`) ?? []) as EntityOfKind<K>[];
    if (source) return hits.find(e => up(e.source) === up(source) || e.aliases?.some(a => up(a) === up(source)));
    return hits.find(e => up(e.source) === 'SRD') ?? hits[0];
  }

  /** Exact id, else the same entity under one of its aliases (e.g. `class:fighter@PHB` -> `class:fighter@SRD`). */
  resolve(id: string): Entity | undefined {
    return this.get(id) ?? this.#byAlias.get(`${baseKey(id)}@${up(sourceOf(id))}`);
  }

  /** Name matches, prefix matches first, then alphabetical. */
  search(q: string, kinds?: EntityKind[], limit = 200): Entity[] {
    const n = q.trim().toLowerCase();
    const pool = kinds ? kinds.flatMap(k => this.#byKind.get(k) ?? []) : [...this.#byId.values()];
    const hits: { e: Entity; prefix: boolean; name: string }[] = [];
    for (const e of pool) {
      const name = e.name.toLowerCase();
      if (name.includes(n)) hits.push({ e, prefix: name.startsWith(n), name });
    }
    hits.sort((a, b) => Number(b.prefix) - Number(a.prefix) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return hits.slice(0, limit).map(h => h.e);
  }

  subclassesOf(classId: string): SubclassDef[] {
    const id = this.resolve(classId)?.id ?? classId;
    return this.all('subclass').filter(s => (this.resolve(s.classId)?.id ?? s.classId) === id);
  }

  optionalFeatures(featureTypes: string[]): EntityOfKind<'optionalFeature'>[] {
    return this.all('optionalFeature').filter(o => o.featureTypes.some(t => featureTypes.includes(t)));
  }
}
