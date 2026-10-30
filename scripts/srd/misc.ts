// Shared converter helpers, plus backgrounds, feats and conditions.
import { entityId } from '../../src/lib/content/ids.ts';
import { textToRich } from '../../src/lib/content/richtext.ts';
import type { BackgroundDef, Choice, ConditionDef, EntityKind, FeatDef, Proficiencies, RichText } from '../../src/lib/types.ts';

export type Raw = any; // 5e-database JSON, unvalidated: a shape we don't expect throws via fail()
export type Read = (file: string) => Raw[]; // 'Classes' reads 5e-SRD-Classes.json

export const fail = (msg: string): never => { throw new Error(msg); };
export const id = (kind: EntityKind, name: string) => entityId(kind, name, 'SRD');
export const base = <K extends EntityKind>(kind: K, name: string, text: RichText) =>
  ({ kind, id: id(kind, name), name, source: 'SRD', srd: true as const, text });
export const rich = (desc: string | string[] = []) => textToRich([desc].flat());
export const qty = (n: number, name: string) => (n > 1 ? `${n} × ${name}` : name);
/** "Fighting Style: Defense" -> "Defense", so ids match the names 5etools uses. */
export const stripPrefix = (name: string) => name.replace(/^.*?: /, '');
export const scores = (list: Raw[], key: string) => Object.fromEntries(list.map(x => [x.ability_score.index, x[key]]));
export const noProfs = (): Proficiencies => ({ armor: [], weapons: [], tools: [], skills: [], languages: [] });

/** References offered by an option set, nested choices flattened. */
export const refsOf = (from: Raw): Raw[] => (from.options ?? []).flatMap((o: Raw) =>
  o.option_type === 'reference' ? [o.item] : o.option_type === 'choice' ? refsOf(o.choice.from) : fail(`unexpected option ${o.option_type}`));

const ARMOR: Record<string, string[]> = { 'light-armor': ['light'], 'medium-armor': ['medium'], 'heavy-armor': ['heavy'], 'all-armor': ['light', 'medium', 'heavy'], shields: ['shield'] };
const WEAPONS: Record<string, string> = { 'simple-weapons': 'simple', 'martial-weapons': 'martial' };

/** Proficiency references typed through 5e-SRD-Proficiencies.json, added to `into`. Saving throws are skipped. */
export function addProfs(read: Read, refs: Raw[] = [], into = noProfs()): Proficiencies {
  for (const ref of refs) {
    const p = read('Proficiencies').find(x => x.index === ref.index) ?? fail(`unknown proficiency ${ref.index}`);
    if (p.type === 'Saving Throws') continue;
    if (p.type === 'Skills') into.skills.push(p.reference.index);
    else if (p.type === 'Armor') into.armor.push(...(ARMOR[p.index] ?? [p.reference.name.toLowerCase()]));
    else if (p.type === 'Weapons') into.weapons.push(WEAPONS[p.index] ?? p.reference.name.toLowerCase()); // item name, e.g. 'crossbow, hand'
    else into.tools.push(p.name.toLowerCase());
  }
  return into;
}

/** A proficiency choice: all skills -> skill choice ('any' when every skill is offered), all tools -> tool choice. */
export function profChoice(read: Read, pc: Raw): Extract<Choice, { type: 'skill' | 'tool' }> {
  const refs = refsOf(pc.from), p = addProfs(read, refs);
  if (p.skills.length === refs.length) return { type: 'skill', count: pc.choose, from: p.skills.length === 18 ? 'any' : p.skills };
  if (p.tools.length === refs.length) return { type: 'tool', count: pc.choose, from: p.tools };
  return fail(`mixed proficiency choice: ${pc.desc}`);
}

export const languageChoice = (lo: Raw): Choice =>
  ({ type: 'language', count: lo.choose, ...(lo.from.options && { from: refsOf(lo.from).map(r => r.name) }) });

/** Label of one starting-equipment option (also used for background equipment text). */
export const equipmentLabel = (o: Raw): string =>
  o.option_type === 'counted_reference' ? qty(o.count, o.of.name)
  : o.option_type === 'multiple' ? o.items.map(equipmentLabel).join(', ')
  : o.option_type === 'choice' ? o.choice.desc ?? `${o.choice.from.equipment_category.name} (choose ${o.choice.choose})`
  : fail(`unexpected equipment option ${o.option_type}`);

export function backgrounds(read: Read): BackgroundDef[] {
  return read('Backgrounds').map((b): BackgroundDef => {
    const equipment = [
      ...b.starting_equipment.map((s: Raw) => qty(s.quantity, s.equipment.name)),
      ...b.starting_equipment_options.map((o: Raw) => equipmentLabel({ option_type: 'choice', choice: o })),
      ...(b.starting_gold ? [`${b.starting_gold.quantity} ${b.starting_gold.unit}`] : []),
    ];
    const table = (title: string, x: Raw) => ({ h: title, blocks: [{ list: x.from.options.map((o: Raw) => o.string ?? o.desc) }] });
    return {
      ...base('background', b.name, [table('Personality Traits', b.personality_traits), table('Ideals', b.ideals), table('Bonds', b.bonds), table('Flaws', b.flaws)]),
      proficiencies: addProfs(read, b.starting_proficiencies),
      equipment: { text: [{ list: equipment }], choices: [] }, // ponytail: text only, as the brief says; the 15 gp is part of the kit, not a gold alternative
      feature: { name: b.feature.name, text: rich(b.feature.desc) },
      ...(b.language_options && { choices: [languageChoice(b.language_options)] }),
    };
  });
}

export function feats(read: Read): FeatDef[] {
  return read('Feats').map((f): FeatDef => ({
    ...base('feat', f.name, rich(f.desc)),
    ...(f.prerequisites.length && { prerequisite: { abilities: [scores(f.prerequisites, 'minimum_score')] } }),
  }));
}

export const conditions = (read: Read): ConditionDef[] => read('Conditions').map(c => base('condition', c.name, rich(c.desc)));
