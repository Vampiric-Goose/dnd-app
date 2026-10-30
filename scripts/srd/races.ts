import type { Choice, Proficiencies, RaceDef, Size, SubraceDef, Trait } from '../../src/lib/types.ts';
import { addProfs, base, id, languageChoice, noProfs, profChoice, rich, scores, type Raw, type Read } from './misc.ts';

const SIZE: Record<string, Size> = { Tiny: 'T', Small: 'S', Medium: 'M', Large: 'L', Huge: 'H', Gargantuan: 'G' };

export function races(read: Read): (RaceDef | SubraceDef)[] {
  const traitById = (index: string): Raw => read('Traits').find(t => t.index === index);

  /** A subtrait option (dragonborn ancestry): its own damage type and breath weapon replace the shared boilerplate desc. */
  const subtrait = (t: Raw): Trait => {
    const bw = t.trait_specific?.breath_weapon;
    return { name: t.name, text: bw
      ? [{ p: `**Damage Type:** ${t.trait_specific.damage_type.name}. **Breath Weapon:** ${bw.area_of_effect.size} ft. ${bw.area_of_effect.type} (${bw.dc.dc_type.name} save).` }]
      : rich(t.desc) };
  };

  /** Trait proficiencies go to the race/subrace `profs` (as 5etools race proficiencies do); its choices stay on the trait. */
  const trait = (ref: Raw, profs: Proficiencies): Trait => {
    const t = traitById(ref.index);
    addProfs(read, t.proficiencies, profs);
    const choices: Choice[] = [];
    if (t.proficiency_choices) choices.push(profChoice(read, t.proficiency_choices));
    if (t.language_options) choices.push(languageChoice(t.language_options));
    const so = t.trait_specific?.subtrait_options;
    if (so) choices.push({ type: 'option', count: so.choose, options: so.from.options.map((o: Raw) => subtrait(traitById(o.item.index))) });
    // ponytail: high-elf-cantrip's spell_options has no Choice type; its text describes it
    return { name: t.name, text: rich(t.desc), ...(choices.length && { choices }) };
  };
  const darkvision = (refs: Raw[]) => (refs.some(t => t.index === 'darkvision') ? { darkvision: 60 } : {});

  const out: (RaceDef | SubraceDef)[] = read('Races').map((r): RaceDef => {
    const proficiencies = { ...noProfs(), languages: r.languages.map((l: Raw) => l.name) };
    const choices: Choice[] = [];
    const abo = r.ability_bonus_options;
    if (abo) choices.push({ type: 'ability', count: abo.choose, amount: abo.from.options[0].bonus, from: abo.from.options.map((o: Raw) => o.ability_score.index) });
    if (r.language_options) choices.push(languageChoice(r.language_options));
    return {
      ...base('race', r.name, [['Age', r.age], ['Alignment', r.alignment], ['Size', r.size_description], ['Languages', r.language_desc]].map(([h, p]) => ({ p: `**${h}.** ${p}` }))),
      size: SIZE[r.size],
      speed: { walk: r.speed },
      abilityBonuses: scores(r.ability_bonuses, 'bonus'),
      proficiencies,
      ...darkvision(r.traits),
      traits: r.traits.map((t: Raw) => trait(t, proficiencies)),
      ...(choices.length && { choices }),
    };
  });
  for (const s of read('Subraces')) {
    const proficiencies = noProfs();
    out.push({
      ...base('subrace', s.name, rich(s.desc)),
      raceId: id('race', s.race.name),
      abilityBonuses: scores(s.ability_bonuses, 'bonus'),
      proficiencies,
      ...darkvision(s.racial_traits),
      traits: s.racial_traits.map((t: Raw) => trait(t, proficiencies)),
    });
  }
  return out;
}
