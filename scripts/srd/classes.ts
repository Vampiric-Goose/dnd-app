import { featureId } from '../../src/lib/content/ids.ts';
import type { Block, Choice, ClassDef, EquipmentOption, FeatureDef, FeatureRef, OptionalFeatureDef, Progression, Spellcasting, SubclassDef } from '../../src/lib/types.ts';
import { addProfs, base, equipmentLabel, fail, id, profChoice, qty, rich, scores, stripPrefix, type Raw, type Read } from './misc.ts';

const LABELS: Record<string, string> = {
  rage_count: 'Rages', rage_damage_bonus: 'Rage Damage', martial_arts: 'Martial Arts', ki_points: 'Ki Points',
  unarmored_movement: 'Unarmored Movement', sneak_attack: 'Sneak Attack', sorcery_points: 'Sorcery Points',
  invocations_known: 'Invocations Known', channel_divinity_charges: 'Channel Divinity', action_surges: 'Action Surges',
  indomitable_uses: 'Indomitable', extra_attacks: 'Extra Attacks', bardic_inspiration_die: 'Bardic Inspiration',
};
const titleCase = (s: string) => s.split(/[_ ]/).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const cell = (key: string, v: Raw): number | string =>
  v === 9999 ? 'Unlimited' // the data's "unlimited" (rages at 20); evalFormula reads 'Unlimited' as Infinity
  : key === 'unarmored_movement' ? `+${v} ft.` : key === 'bardic_inspiration_die' ? `d${v}`
  : typeof v === 'object' ? `${v.dice_count}d${v.dice_value}` // martial_arts, sneak_attack
  : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v;

const PROGRESSION: Record<string, Progression> = { bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half', warlock: 'pact' };
const PREPARED: Record<string, string> = { cleric: 'level+mod:wis', druid: 'level+mod:wis', wizard: 'level+mod:int', paladin: 'level/2+mod:cha' };
const FIGHTING_STYLE: Record<string, string> = { fighter: 'FS:F', paladin: 'FS:P', ranger: 'FS:R' };
const METAMAGIC_COUNTS = [0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];
const SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
const ordinal = new Intl.PluralRules('en', { type: 'ordinal' });
const nth = (n: number) => n + SUFFIX[ordinal.select(n)];

// Errata: corrections to the upstream 5e-database data, each checked against the SRD 5.1 text.
const SUBCLASS_SPELL_ERRATA: Record<string, { level: number; spell: string }[]> = {
  life: [{ level: 7, spell: 'Guardian of Faith' }], // upstream lists only Death Ward at cleric 7
};
const withErrata = (s: Raw): Raw => ({ ...s, spells: [...(s.spells ?? []), ...(SUBCLASS_SPELL_ERRATA[s.index] ?? []).map(e => ({
  prerequisites: [{ type: 'level', index: `${s.class.index}-${e.level}`, name: `${s.class.name} ${e.level}` }],
  spell: { name: e.spell },
}))] });

// Features upstream gives the whole class that the SRD 5.1 prints under one subclass: feature index -> subclass index.
// (Oath Spells stays a paladin feature: its text is about every oath's list.)
const SUBCLASS_FEATURE_ERRATA: Record<string, string> = { 'supreme-healing': 'life' }; // Life Domain, 17th level

type Out = ClassDef | SubclassDef | FeatureDef | OptionalFeatureDef;

export function classes(read: Read): Out[] {
  const F = read('Features').map(f => {
    const s = SUBCLASS_FEATURE_ERRATA[f.index];
    return s ? { ...f, subclass: read('Subclasses').find(x => x.index === s) ?? fail(`errata: unknown subclass ${s}`) } : f;
  });
  const byUrl = (file: string, url: string): Raw => read(file).find(x => x.url === url) ?? fail(`unknown ${url}`);
  const feat = (index: string): Raw => F.find(f => f.index === index) ?? fail(`unknown feature ${index}`);
  // Features offered as options (fighting styles, invocations, terrains...) aren't gained by level. Twinned Spell lacks a `parent`.
  const optionIndexes = new Set(F.flatMap(f => [
    ...(f.feature_specific?.subfeature_options?.from.options ?? []).map((o: Raw) => o.item.index),
    ...(f.feature_specific?.invocations ?? []).map((r: Raw) => r.index),
  ]));

  const prerequisite = (f: Raw) => f.prerequisites.map((p: Raw) => {
    if (p.type === 'level') return `${nth(p.level)} level`;
    if (p.type === 'feature') return `${byUrl('Features', p.feature).name} feature`;
    if (p.type === 'spell') { const s = byUrl('Spells', p.spell); return `${s.name.toLowerCase()} ${s.level ? 'spell' : 'cantrip'}`; }
    return fail(`prerequisite ${p.type}`);
  }).join(', ');
  const optional = new Map<string, OptionalFeatureDef>(); // deduplicated by name, featureTypes combined
  const addOptional = (f: Raw, featureTypes: string[]) => {
    const name = stripPrefix(f.name), had = optional.get(id('optionalFeature', name));
    if (had) had.featureTypes = [...new Set([...had.featureTypes, ...featureTypes])];
    else optional.set(id('optionalFeature', name), { ...base('optionalFeature', name, rich(f.desc)), featureTypes, ...(f.prerequisites.length && { prerequisite: prerequisite(f) }) });
  };
  /** "Druid 3: Hold Person, Spike Growth" lines, from subclass `spells` entries. */
  const spellList = (spells: Raw[]): Block[] => {
    const by = new Map<string, string[]>();
    for (const s of spells) {
      const lvl = s.prerequisites.find((p: Raw) => p.type === 'level').name;
      by.set(lvl, [...(by.get(lvl) ?? []), s.spell.name]);
    }
    return by.size ? [{ list: [...by].map(([l, names]) => `${l}: ${names.join(', ')}`) }] : [];
  };

  const out: Out[] = [];
  for (const c of read('Classes')) {
    const classId = id('class', c.name);
    const levels = read('Levels').filter(l => l.class.index === c.index && !l.subclass).sort((a, b) => a.level - b.level);
    const subclasses = read('Subclasses').filter(s => s.class.index === c.index).map(withErrata);
    const gained = F.filter(f => f.class.index === c.index && !f.parent && !optionIndexes.has(f.index));
    const subclassLevel = Math.min(...gained.filter(f => f.subclass).map(f => f.level));
    const subclassTitle: string = subclasses[0]?.subclass_flavor ?? fail(`${c.index} has no subclass`);
    const spellInfo: Block[] = (c.spellcasting?.info ?? []).map((i: Raw) => ({ h: i.name, blocks: rich(i.desc) }));

    const choicesOf = (f: Raw, subclassSpells: Raw[]): Choice[] => {
      const fs = f.feature_specific ?? {}, choices: Choice[] = [];
      if (f.name === 'Ability Score Improvement') choices.push({ type: 'asi' });
      if (fs.expertise_options) {
        const first = fs.expertise_options.from.options[0]; // rogue: "two skills" or "one skill + thieves' tools", both 2 picks
        choices.push({ type: 'expertise', count: first.option_type === 'choice' ? first.choice.choose : fs.expertise_options.choose });
      }
      for (const o of [fs.enemy_type_options, fs.terrain_type_options].filter(Boolean)) {
        choices.push({ type: 'option', count: o.choose, options: o.from.options.map((s: string) => ({ name: titleCase(s), text: [] })) });
      }
      for (const r of fs.invocations ?? []) addOptional(feat(r.index), ['EI']); // counted by optionalFeatureProgression
      const so = fs.subfeature_options;
      if (so) {
        const kids = so.from.options.map((o: Raw) => feat(o.item.index));
        if (kids.every((k: Raw) => k.name.startsWith('Metamagic: '))) kids.forEach((k: Raw) => addOptional(k, ['MM'])); // counted by optionalFeatureProgression
        else if (kids.every((k: Raw) => k.name.startsWith('Fighting Style: '))) {
          const t = FIGHTING_STYLE[c.index] ?? fail(`fighting style type for ${c.index}`);
          kids.forEach((k: Raw) => addOptional(k, [t]));
          choices.push({ type: 'optionalFeature', featureTypes: [t], count: so.choose });
        } else {
          choices.push({ type: 'option', count: so.choose, options: kids.map((k: Raw) => ({
            name: stripPrefix(k.name),
            text: [
              ...(k.desc.join() === f.desc.join() ? [] : rich(k.desc)), // land and dragon-ancestor kids just repeat the parent's desc
              ...spellList(subclassSpells.filter(s => s.prerequisites.some((p: Raw) => p.index === k.index))), // land: circle spells per terrain
            ],
          })) });
        }
      }
      return choices;
    };
    const feature = (f: Raw, sub?: Raw): FeatureDef => {
      const name: string = f.name.replace(/^Spellcasting: .*/, 'Spellcasting'); // matches 5etools' feature name
      const choices = choicesOf(f, sub?.spells ?? []);
      if (!sub && f.level === subclassLevel && name === subclassTitle) choices.push({ type: 'subclass' });
      return {
        ...base('feature', name, [...rich(f.desc), ...(f.reference === `/api/2014/classes/${c.index}/spellcasting` ? spellInfo : [])]),
        id: featureId(c.name, sub?.name, name, f.level, 'SRD'),
        level: f.level,
        classId,
        ...(sub && { subclassId: id('subclass', sub.name) }),
        ...(choices.length ? { choices } : {}),
      };
    };
    const refs = (fs: FeatureDef[]): FeatureRef[] => fs.map(f => ({ level: f.level, id: f.id })).sort((a, b) => a.level - b.level);

    const features = gained.filter(f => !f.subclass).map(f => feature(f));
    if (!features.some(f => f.choices?.some(ch => ch.type === 'subclass'))) {
      features.push({ ...base('feature', subclassTitle, []), id: featureId(c.name, undefined, subclassTitle, subclassLevel, 'SRD'), level: subclassLevel, classId, choices: [{ type: 'subclass' }] });
    }

    const pcs = c.proficiency_choices.map((pc: Raw) => profChoice(read, pc));
    const isSkill = (p: Choice): p is Extract<Choice, { type: 'skill' }> => p.type === 'skill';
    const skill = pcs.find(isSkill) ?? fail(`${c.index} has no skill choice`);
    const mcSkill = (c.multi_classing.proficiency_choices ?? []).map((pc: Raw) => profChoice(read, pc)).find(isSkill); // ponytail: bard's multiclass instrument pick has no ClassDef field
    const mc = c.multi_classing;

    const fixed: Raw[] = c.starting_equipment;
    const groups: Raw[] = c.starting_equipment_options;
    const optionsOf = (g: Raw): Raw[] => g.from.option_set_type === 'equipment_category' ? [{ option_type: 'choice', choice: g }]
      : g.choose === 1 ? g.from.options : fail(`${c.index}: equipment group choosing ${g.choose}`);
    const itemsOf = (o: Raw): EquipmentOption['items'] =>
      o.option_type === 'counted_reference' ? [{ itemId: id('item', o.of.name), quantity: o.count }]
      : o.option_type === 'multiple' ? o.items.flatMap(itemsOf)
      : [{ category: o.choice.from.equipment_category?.index ?? fail(`${c.index}: equipment choice without category`), quantity: o.choice.choose }];
    const startingEquipment = {
      text: [{ list: [...fixed.map(s => qty(s.quantity, s.equipment.name)), ...groups.map(g => g.desc ?? optionsOf(g).map(equipmentLabel).join(' or '))] }],
      choices: [
        ...(fixed.length ? [[{ label: fixed.map(s => qty(s.quantity, s.equipment.name)).join(', '), items: fixed.map(s => ({ itemId: id('item', s.equipment.name), quantity: s.quantity })) }]] : []),
        ...groups.map(g => optionsOf(g).map((o): EquipmentOption => ({ label: equipmentLabel(o), items: itemsOf(o) }))),
      ],
    };

    const spells = (key: string) => (levels.some(l => l.spellcasting?.[key] !== undefined) ? levels.map(l => l.spellcasting?.[key] ?? 0) : undefined);
    const cantrips = spells('cantrips_known'), known = spells('spells_known'), formula = PREPARED[c.index];
    const spellcasting: Spellcasting | undefined = c.spellcasting && {
      ability: c.spellcasting.spellcasting_ability.index,
      progression: PROGRESSION[c.index] ?? fail(`no progression for ${c.index}`),
      preparation: formula ? 'prepared' : 'known',
      ...(c.index === 'wizard' && { spellbook: true }),
      ...(cantrips && { cantrips }),
      ...(known && { known }),
      ...(formula && { preparedFormula: formula }),
    };
    const keys = Object.keys(levels[0].class_specific ?? {}).filter(k => !Array.isArray(levels[0].class_specific[k])); // drops creating_spell_slots (a cost table, same every level)
    const table = keys.map(k => ({ label: LABELS[k] ?? titleCase(k), values: levels.map(l => cell(k, l.class_specific[k])) }));
    const ofp: Record<string, ClassDef['optionalFeatureProgression']> = {
      warlock: [{ name: 'Eldritch Invocations', featureTypes: ['EI'], counts: levels.map(l => l.class_specific.invocations_known) }],
      sorcerer: [{ name: 'Metamagic', featureTypes: ['MM'], counts: METAMAGIC_COUNTS }],
    };
    const tools = pcs.filter((p: Choice) => p.type === 'tool'); // bard instruments, monk tool or instrument

    out.push({
      ...base('class', c.name, []),
      hitDie: c.hit_die,
      saves: c.saving_throws.map((s: Raw) => s.index),
      proficiencies: addProfs(read, c.proficiencies),
      skillChoice: { count: skill.count, from: skill.from },
      ...(mc.prerequisites ? { multiclassPrereq: { all: scores(mc.prerequisites, 'minimum_score') } }
        : mc.prerequisite_options ? { multiclassPrereq: { any: scores(mc.prerequisite_options.from.options, 'minimum_score') } } : {}),
      multiclassProficiencies: addProfs(read, mc.proficiencies),
      ...(mcSkill && { multiclassSkillChoice: { count: mcSkill.count, from: mcSkill.from } }),
      startingEquipment,
      subclassLevel,
      subclassTitle,
      asiLevels: levels.filter((l, i) => l.ability_score_bonuses > (levels[i - 1]?.ability_score_bonuses ?? 0)).map(l => l.level),
      features: refs(features),
      ...(spellcasting && { spellcasting }),
      table,
      optionalFeatureProgression: ofp[c.index] ?? [],
      ...(tools.length ? { choices: tools } : {}),
    }, ...features);

    for (const s of subclasses) {
      const sf = gained.filter(f => f.subclass?.index === s.index).map(f => feature(f, s));
      const byLevelOnly = (s.spells ?? []).filter((x: Raw) => x.prerequisites.every((p: Raw) => p.type === 'level')); // land's per-terrain spells live on its terrain options
      const prepared = new Map<number, string[]>();
      if (formula) for (const x of byLevelOnly) { // a prepared caster's domain/oath spells; the warlock's expanded list is only text
        const lvl = read('Levels').find(l => l.index === x.prerequisites[0].index).level;
        prepared.set(lvl, [...(prepared.get(lvl) ?? []), id('spell', x.spell.name)]);
      }
      out.push({
        ...base('subclass', s.name, [...rich(s.desc), ...(byLevelOnly.length ? [{ h: 'Spells', blocks: spellList(byLevelOnly) }] : [])]),
        classId,
        shortName: s.name,
        features: refs(sf),
        ...(prepared.size ? { alwaysPrepared: [...prepared].map(([level, ids]) => ({ level, spells: ids })) } : {}),
      }, ...sf);
    }
  }
  return [...out, ...optional.values()];
}
