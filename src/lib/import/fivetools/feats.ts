import type { Effect, FeatDef, Scores } from '../../types.ts';
import { abilities, arr, base, prereqText, proficiencies, type Ctx, type Raw } from './common.ts';

export const feat = (r: Raw, ctx: Ctx, id: string, name: string): FeatDef => {
  const pre = arr(r.prerequisite);
  const abilityReqs: Partial<Scores>[] = pre.flatMap(p => arr(p.ability));
  const races: string[] = pre.flatMap(p => arr(p.race).map((x: Raw) => x.name)).filter(Boolean);
  const text = prereqText(pre);
  const prerequisite: FeatDef['prerequisite'] = {
    ...(abilityReqs.length && { abilities: abilityReqs }),
    ...(races.length && { races }),
    ...(pre.some(p => p.spellcasting || p.spellcasting2020) && { spellcasting: true }),
    ...(text && { text }),
  };
  const ab = abilities(r.ability), pr = proficiencies(r, ctx), choices = [...ab.choices, ...pr.choices];
  const p = pr.proficiencies;
  const effects: Effect[] = ([['skill', p.skills], ['tool', p.tools], ['language', p.languages], ['weapon', p.weapons], ['armor', p.armor]] as const)
    .flatMap(([category, values]) => values.map((value): Effect => ({ type: 'proficiency', category, value })));
  return {
    ...base('feat', id, name, r),
    ...(Object.keys(prerequisite).length && { prerequisite }),
    ...(Object.keys(ab.bonuses).length && { abilityBonus: ab.bonuses }),
    ...(choices.length && { choices }),
    ...(effects.length && { effects }),
  };
};
