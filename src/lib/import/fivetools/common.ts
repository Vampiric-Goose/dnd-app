// Shared helpers for the 5etools converters. Pure: no Svelte/Vite/DOM (Node scripts import this).
import type { ContentIndex } from '../../content/index.ts';
import { slug } from '../../content/ids.ts';
import { entriesToRich, renderTags } from '../../content/richtext.ts';
import type { Ability, Choice, EntityKind, Proficiencies, RichText, Scores, Skill, Speeds } from '../../types.ts';

export type Raw = any; // 5etools JSON, unvalidated: an unexpected shape throws and fails only that entity
export const fail = (msg: string): never => { throw new Error(msg); };
/** Converter context, built once per import batch. */
export interface Ctx {
  index: ContentIndex;
  /** May a class list from this source count? Official 2014 books and the batch's declared homebrew sources only (R52). */
  listed(source: string): boolean;
  /** The id a reference resolves to: a batch entity (its SRD target if it became a patch), else the index, else the id it would get. */
  ref(kind: EntityKind, name: string, source: string): string;
  /** Class-list entries for a spell from the spell-class lookup files in the batch. */
  spellClasses(name: string, source: string): ClassRef[];
  /** A legendary group (lair actions, regional effects), `_copy` resolved; undefined when it is missing or from a refused source. */
  legendaryGroup?(name: string, source: string): Raw | undefined;
  /** A problem that drops part of an entity, not the entity. */
  warn?(msg: string): void;
}
/** One spell class-list entry; `variantOf` (the books defining it) marks a classVariant (an expanded class list). */
export interface ClassRef { name: string; source: string; variantOf?: string[] }

/** A code table with no prototype, so a user-supplied code like 'constructor' or '__proto__' misses instead of hitting Object.prototype. */
export const table = <V>(o: Record<string, V>): Record<string, V> => Object.assign(Object.create(null), o);
/** 'M|XPHB' -> 'M'. 5etools appends a source to codes and references. */
export const code = (s: unknown): string => String(s).split('|')[0];
export const arr = (x: unknown): Raw[] => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x]);
export const rich = (entries: unknown): RichText => entriesToRich(arr(entries));
/** Deep copy with `f` applied to every string, except under the keys in `skip`. */
export const mapStrings = (x: Raw, f: (s: string) => string, skip: ReadonlySet<string> = new Set()): Raw =>
  typeof x === 'string' ? f(x)
  : Array.isArray(x) ? x.map(v => mapStrings(v, f, skip))
  : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, skip.has(k) ? v : mapStrings(v, f, skip)]))
  : x;
export const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const isAbility = (k: string): k is Ability => (ABILITIES as string[]).includes(k);
const ABILITY_NAME: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const title = (s: string) => s.replace(/(^|[\s-])\w/g, c => c.toUpperCase());

export const noProfs = (): Proficiencies => ({ armor: [], weapons: [], tools: [], skills: [], languages: [] });

/** A named entity's fields every converter shares. */
export const base = <K extends EntityKind>(kind: K, id: string, name: string, r: Raw) =>
  ({ kind, id, name, source: String(r.source).toUpperCase(), text: rich(r.entries) });

/** `speed`: a number, or `{ walk, fly, ... }` where `true` means "equal to walk" and `{ number }` carries a condition. */
export function speeds(s: Raw): Speeds | undefined {
  if (s === undefined) return undefined;
  if (typeof s === 'number') return { walk: s };
  const n = (v: Raw): number | undefined => (typeof v === 'number' ? v : typeof v?.number === 'number' ? v.number : undefined);
  const walk = n(s.walk) ?? 30;
  const out: Speeds = { walk };
  for (const k of ['fly', 'swim', 'climb', 'burrow'] as const) {
    const v = s[k] === true ? walk : n(s[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** `ability[0]`: fixed bonuses plus `choose` (`{ from, count, amount }` or `{ weighted: { from, weights } }`) as ability choices. */
export function abilities(list: Raw): { bonuses: Partial<Scores>; choices: Choice[] } {
  const a = arr(list)[0] ?? {}, bonuses: Partial<Scores> = {}, choices: Choice[] = [];
  for (const [k, v] of Object.entries(a)) if (isAbility(k) && typeof v === 'number') bonuses[k] = v;
  const c = a.choose;
  if (c?.weighted) {
    const from = arr(c.weighted.from).filter(isAbility), weights: number[] = arr(c.weighted.weights);
    // ponytail: weights [2,1] become two choices over the same list; picking one ability twice is left to validation
    for (const w of new Set(weights)) choices.push({ type: 'ability', count: weights.filter(x => x === w).length, amount: w, from });
  } else if (c) choices.push({ type: 'ability', count: c.count ?? 1, amount: c.amount ?? 1, from: arr(c.from).filter(isAbility) });
  return { bonuses, choices };
}

/** Tool names in an SRD gear category ('artisans-tools'), for "any artisan's tool" choices. */
const toolsIn = (ctx: Ctx, category: string) => ctx.index.all('item').filter(i => i.category === category).map(i => i.name.toLowerCase());
const TOOL_ANY = table<string>({ anyArtisansTool: 'artisans-tools', anyMusicalInstrument: 'musical-instruments', anyGamingSet: 'gaming-sets' });

/** Skill/language/tool/weapon/armor proficiencies (first alternative each): `true` keys are fixed, `choose`/`any*` become choices. */
export function proficiencies(r: Raw, ctx: Ctx): { proficiencies: Proficiencies; choices: Choice[] } {
  const p = noProfs(), choices: Choice[] = [];
  const first = (key: string): [string, Raw][] => Object.entries(arr(r[key])[0] ?? {});
  for (const [k, v] of first('skillProficiencies')) {
    if (v === true) p.skills.push(slug(code(k)) as Skill);
    else if (k === 'any') choices.push({ type: 'skill', count: v, from: 'any' });
    else if (k === 'choose') choices.push({ type: 'skill', count: v.count ?? 1, from: arr(v.from).map(x => slug(code(x)) as Skill) });
  }
  for (const [k, v] of first('languageProficiencies')) {
    if (v === true && k !== 'other') p.languages.push(title(code(k)));
    else if (k === 'any' || k === 'anyStandard' || k === 'anyExotic') choices.push({ type: 'language', count: v });
    else if (k === 'choose') choices.push({ type: 'language', count: v.count ?? 1, from: arr(v.from).map(x => title(code(x))) });
  }
  for (const [k, v] of first('toolProficiencies')) {
    if (v === true) p.tools.push(code(k).toLowerCase());
    else if (k === 'any') choices.push({ type: 'tool', count: v });
    else if (TOOL_ANY[k]) choices.push({ type: 'tool', count: v, from: toolsIn(ctx, TOOL_ANY[k]) });
    else if (k === 'choose') choices.push({ type: 'tool', count: v.count ?? 1, from: arr(v.from).flatMap(x => (TOOL_ANY[x] ? toolsIn(ctx, TOOL_ANY[x]) : [code(x).toLowerCase()])) });
  }
  // ponytail: weapon/armor `choose` has no Choice type; the entity text describes it
  for (const [k, v] of first('weaponProficiencies')) if (v === true) p.weapons.push(code(k).toLowerCase());
  for (const [k, v] of first('armorProficiencies')) if (v === true) p.armor.push(code(k).toLowerCase());
  return { proficiencies: p, choices };
}

/** Named object entries -> traits. */
export const traits = (entries: unknown) =>
  arr(entries).filter(e => e && typeof e === 'object' && typeof e.name === 'string').map(e => ({ name: renderTags(e.name), text: rich(e.entries) }));

const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const names = (x: Raw): string => arr(x).map(v => (typeof v === 'string' ? code(v) : v?.name ?? v?.displayEntry ?? '')).filter(Boolean).join(' or ');

/** A `prerequisite` array (alternatives) as display text. */
export function prereqText(prereq: Raw): string {
  return arr(prereq).map((p: Raw) => {
    const parts: string[] = [];
    if (p.level !== undefined) {
      const l = typeof p.level === 'object' ? p.level : { level: p.level };
      parts.push(`Level ${l.level}${l.class ? ` ${l.class.name}` : ''}${l.subclass ? ` (${l.subclass.name})` : ''}`);
    }
    for (const a of arr(p.ability)) parts.push(Object.entries(a).map(([k, v]) => `${isAbility(k) ? ABILITY_NAME[k] : k} ${v}`).join(' or '));
    if (p.race) parts.push(arr(p.race).map((x: Raw) => title(x.name ?? '') + (x.subrace ? ` (${title(x.subrace)})` : '')).join(' or '));
    if (p.background) parts.push(names(p.background));
    if (p.feat) parts.push(names(p.feat));
    if (p.spell) parts.push(arr(p.spell).map((s: Raw) => (typeof s === 'string' ? code(s).replace(/#c$/, ' cantrip').replace(/#(\d)$/, (_, n) => ` (${ord(+n)} level)`) : s.entry ?? '')).join(', '));
    if (p.pact) parts.push(`Pact of the ${p.pact}`);
    if (p.patron) parts.push(`${p.patron} patron`);
    if (p.spellcasting || p.spellcasting2020) parts.push('The ability to cast at least one spell');
    if (p.psionics) parts.push('Psionics');
    for (const pr of arr(p.proficiency)) parts.push(Object.entries(pr).map(([k, v]) => `Proficiency with ${v === true ? '' : `${v} `}${k}`).join(' or '));
    if (p.other) parts.push(String(p.other));
    else if (p.otherSummary?.entry) parts.push(String(p.otherSummary.entry));
    return renderTags(parts.join(', '));
  }).filter(Boolean).join(' or ');
}
