import { slug } from '../content/ids.ts';
import type { CampaignSettings, Character, Choice, ChoiceAnswer, ClassDef, Entity, EntityKind, EntityOfKind, FeatureDef, SubclassDef } from '../types.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts.

export type Lookup = (id: string) => Entity | undefined;

/** `level|sourceId|index`; level 0 for race, subrace and background choices. */
export const choiceKey = (level: number, sourceId: string, index: number): string => `${level}|${sourceId}|${index}`;

export interface PendingChoice { key: string; level: number; sourceId: string; sourceName: string; choice: Choice; answer?: ChoiceAnswer }

/** The entity `id` if it exists and is of `kind`. Empty ids are not looked up. */
export function getKind<K extends EntityKind>(lookup: Lookup, id: string | undefined, kind: K): EntityOfKind<K> | undefined {
  if (!id) return undefined;
  const e = lookup(id);
  return e?.kind === kind ? (e as EntityOfKind<K>) : undefined;
}

export interface LevelStep { level: number; classId: string; classLevel: number; cls?: ClassDef; sub?: SubclassDef; features: FeatureDef[] }

/** One step per character level: the class taken, its level in that class, and the class/subclass features gained there. */
export function walkLevels(c: Character, lookup: Lookup, settings: CampaignSettings): LevelStep[] {
  const counts: Record<string, number> = {};
  return c.build.levels.map(({ classId }, i) => {
    const classLevel = (counts[classId] = (counts[classId] ?? 0) + 1);
    const cls = getKind(lookup, classId, 'class');
    const sub = cls && getKind(lookup, c.build.subclasses[classId], 'subclass');
    const features = [...(cls?.features ?? []), ...(sub?.features ?? [])]
      .filter(r => r.level === classLevel)
      .map(r => getKind(lookup, r.id, 'feature'))
      .filter((f): f is FeatureDef => !!f && (!f.optional || settings.optionalClassFeatures));
    return { level: i + 1, classId, classLevel, cls, sub, features };
  });
}

/** Every choice the build offers, in level order, with its answer from `build.choices` when there is one. */
export function enumerateChoices(c: Character, lookup: Lookup, settings: CampaignSettings): PendingChoice[] {
  const out: PendingChoice[] = [];
  const add = (level: number, sourceId: string, sourceName: string, choices: Choice[] | undefined) => choices?.forEach((choice, i) => {
    const key = choiceKey(level, sourceId, i);
    const answer = c.build.choices[key];
    out.push({ key, level, sourceId, sourceName, choice, ...(answer && { answer }) });
    if (answer?.type === 'ids' && choice.type === 'option') {
      const owner = sourceId.split('/')[0];
      for (const t of choice.options) if (answer.ids.includes(t.name)) add(level, `${owner}/option:${slug(t.name)}`, t.name, t.choices);
    }
    const featIds = answer?.type === 'ids' && choice.type === 'feat' ? answer.ids : answer?.type === 'asi' && answer.featId ? [answer.featId] : [];
    for (const id of featIds) { const f = getKind(lookup, id, 'feat'); if (f) add(level, f.id, f.name, f.choices); }
  });

  for (const r of [getKind(lookup, c.build.raceId, 'race'), getKind(lookup, c.build.subraceId, 'subrace')]) {
    if (!r) continue;
    add(0, r.id, r.name, r.choices);
    for (const t of r.traits) add(0, `${r.id}/trait:${slug(t.name)}`, t.name, t.choices);
  }
  const bg = getKind(lookup, c.build.backgroundId, 'background');
  if (bg) { add(0, bg.id, bg.name, bg.choices); add(0, `${bg.id}/feature`, bg.feature.name, bg.feature.choices); }

  for (const s of walkLevels(c, lookup, settings)) {
    const cls = s.cls;
    if (cls && s.level === 1) {
      add(1, `${cls.id}/skills`, cls.name, [{ type: 'skill', ...cls.skillChoice }]);
      add(1, cls.id, cls.name, cls.choices);
    } else if (cls && s.classLevel === 1 && cls.multiclassSkillChoice) {
      add(s.level, `${cls.id}/skills`, cls.name, [{ type: 'skill', ...cls.multiclassSkillChoice }]);
    }
    for (const row of cls?.optionalFeatureProgression ?? []) {
      const n = (row.counts[s.classLevel - 1] ?? 0) - (row.counts[s.classLevel - 2] ?? 0);
      if (n > 0) add(s.level, `${cls!.id}/ofp:${slug(row.name)}`, row.name, [{ type: 'optionalFeature', count: n, featureTypes: row.featureTypes }]);
    }
    for (const f of s.features) add(s.level, f.id, f.name, f.choices);
  }
  return out;
}
