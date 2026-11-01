import { slug } from '../content/ids.ts';
import type { CampaignSettings, Character, Choice, ChoiceAnswer, ClassDef, Entity, EntityKind, EntityOfKind, FeatureDef, RaceDef, SubclassDef, SubraceDef } from '../types.ts';

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

const CHOICE_OF: Partial<Record<string, Choice['type']>> = { ability: 'ability', skills: 'skill', languages: 'language', tools: 'tool' };

/**
 * The race and subrace as the character has them. A race field the subrace overwrites is emptied (ability bonuses, a
 * proficiency list, the traits it replaces by name); `dropped` lists the race choice types that go with it.
 */
export function raceParts(c: Character, lookup: Lookup): { race?: RaceDef; sub?: SubraceDef; dropped: Set<Choice['type']> } {
  const r = getKind(lookup, c.build.raceId, 'race'), sub = getKind(lookup, c.build.subraceId, 'subrace');
  const ow = sub?.overwrite ?? [], gone = sub?.overwriteTraits ?? [];
  const dropped = new Set(ow.flatMap(k => CHOICE_OF[k] ?? []));
  const race = r && (ow.length || gone.length) ? {
    ...r,
    abilityBonuses: ow.includes('ability') ? {} : r.abilityBonuses,
    proficiencies: { ...r.proficiencies, ...Object.fromEntries(ow.filter(k => k !== 'ability').map(k => [k, []])) },
    traits: r.traits.filter(t => !gone.includes(t.name)),
  } : r;
  return { race, sub, dropped };
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

/** How deep answers may nest (a pick whose choice picks something with choices...); deeper picks add nothing. */
const MAX_DEPTH = 8;

/**
 * Every choice the build offers, in level order, with its answer from `build.choices` when there is one.
 * Recursive: whatever an answer picks (an option trait, or any entity: feat, optional feature, subclass...) adds its own
 * choices at the same level. Keys: option traits `<owner>/option:<slug>`; feats their own id (as before); any other picked
 * entity `<sourceId>/<entityId>`. A visited set per top-level source and a depth cap stop cycles.
 */
export function enumerateChoices(c: Character, lookup: Lookup, settings: CampaignSettings): PendingChoice[] {
  const out: PendingChoice[] = [];
  const add = (level: number, sourceId: string, sourceName: string, choices: Choice[] | undefined, seen = new Set<string>(), depth = 0, drop?: Set<Choice['type']>): void => {
    if (depth > MAX_DEPTH) return;
    choices?.forEach((choice, i) => {
      if (drop?.has(choice.type)) return; // a subrace overwrites it; the rest keep their index keys
      const key = choiceKey(level, sourceId, i);
      const answer = c.build.choices[key];
      out.push({ key, level, sourceId, sourceName, choice, ...(answer && { answer }) });
      if (answer?.type === 'ids' && choice.type === 'option') {
        // Top-level options keep their original key (`<entity>/option:<slug>`); nested ones hang off their full path.
        const owner = depth === 0 ? sourceId.split('/')[0] : sourceId;
        for (const t of choice.options) if (answer.ids.includes(t.name)) add(level, `${owner}/option:${slug(t.name)}`, t.name, t.choices, seen, depth + 1);
        return;
      }
      if (choice.type === 'skill' || choice.type === 'tool' || choice.type === 'language' || choice.type === 'expertise') return; // answers are names, not entity ids: a lookup would only add a "Missing" warning
      const ids = answer?.type === 'ids' ? answer.ids : answer?.type === 'asi' && answer.featId ? [answer.featId] : [];
      for (const id of ids) {
        const e = lookup(id);
        if (!e?.choices?.length || seen.has(e.id)) continue;
        seen.add(e.id);
        // ponytail: a picked entity's optionalFeatureProgression only exists on subclasses, which walkLevels already steps through
        add(level, e.kind === 'feat' ? e.id : `${sourceId}/${e.id}`, e.name, e.choices, seen, depth + 1);
      }
    });
  };

  const { race, sub, dropped } = raceParts(c, lookup);
  for (const r of [race, sub]) {
    if (!r) continue;
    add(0, r.id, r.name, r.choices, undefined, 0, r === race ? dropped : undefined);
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
    for (const owner of [cls, s.sub]) for (const row of owner?.optionalFeatureProgression ?? []) {
      const n = (row.counts[s.classLevel - 1] ?? 0) - (row.counts[s.classLevel - 2] ?? 0);
      if (n > 0) add(s.level, `${owner!.id}/ofp:${slug(row.name)}`, row.name, [{ type: 'optionalFeature', count: n, featureTypes: row.featureTypes }]);
    }
    for (const f of s.features) add(s.level, f.id, f.name, f.choices);
  }
  return out;
}
