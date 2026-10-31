import type { Ability, MonsterDef, RichText, Size, Skill, Trait } from '../../src/lib/types.ts';
import { SKILL_ABILITY } from '../../src/lib/rules/constants.ts';
import { base, fail, type Raw } from './misc.ts';

const SIZE: Record<string, Size> = { Tiny: 'T', Small: 'S', Medium: 'M', Large: 'L', Huge: 'H', Gargantuan: 'G' };
const CR: Record<number, string> = { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' };
const ABILITY_KEYS: [Ability, string][] = [['str', 'strength'], ['dex', 'dexterity'], ['con', 'constitution'], ['int', 'intelligence'], ['wis', 'wisdom'], ['cha', 'charisma']];
const SENSE_ORDER = ['blindsight', 'darkvision', 'tremorsense', 'truesight'];

const feet = (v: unknown, who: string): number => /^\d+ ft\.$/.test(String(v)) ? parseInt(String(v), 10) : fail(`${who}: unexpected distance ${JSON.stringify(v)}`);

/** One AC entry the way the SRD prints its parenthesis: "leather armor, shield", "natural armor", "with mage armor". */
const acFrom = (a: Raw): string | undefined =>
  a.type === 'natural' ? 'natural armor'
  : a.type === 'armor' ? (a.armor?.map((x: Raw) => x.name.toLowerCase()).join(', ') || a.desc)
  : a.type === 'spell' ? `with ${a.spell.name.toLowerCase()}`
  : a.type === 'condition' ? `while ${a.condition.name.toLowerCase()}`
  : undefined; // 'dex': unarmored

/** SRD prints usage after the name: "Fire Breath (Recharge 5–6)", "Legendary Resistance (3/Day)". */
function usage(u: Raw | undefined): string | undefined {
  if (!u) return undefined;
  if (u.type === 'per day') return `${u.times}/Day`;
  if (u.type === 'recharge on roll') return u.min_value >= 6 ? 'Recharge 6' : `Recharge ${u.min_value}–6`;
  if (u.type === 'recharge after rest') return `Recharges after a ${u.rest_types.map((r: string) => r[0].toUpperCase() + r.slice(1)).join(' or ')} Rest`;
  return fail(`unexpected usage ${JSON.stringify(u)}`);
}

/** desc lines: "- " runs are lists; every other line (including "* footnote") is a paragraph. */
function paragraphs(desc: string): RichText {
  const out: RichText = [];
  for (const line of desc.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const prev = out[out.length - 1];
    if (line.startsWith('- ')) { if (prev && 'list' in prev) prev.list.push(line.slice(2).trim()); else out.push({ list: [line.slice(2).trim()] }); }
    else out.push({ p: line });
  }
  return out;
}

const traits = (list: Raw[] = []): Trait[] =>
  list.map((t) => ({ name: usage(t.usage) ? `${t.name} (${usage(t.usage)})` : t.name, text: paragraphs(t.desc ?? '') }));

const bonuses = (m: Raw, prefix: string): [string, number][] =>
  m.proficiencies.filter((p: Raw) => p.proficiency.index.startsWith(prefix)).map((p: Raw): [string, number] => [p.proficiency.index.slice(prefix.length), p.value]);

export function convertMonsters(raw: Raw[]): MonsterDef[] {
  return raw.map((m): MonsterDef => {
    const who = `monster ${m.name}`;
    const speed: MonsterDef['speed'] = { walk: m.speed.walk === undefined ? 0 : feet(m.speed.walk, who) };
    for (const k of ['fly', 'swim', 'climb', 'burrow'] as const) if (m.speed[k] !== undefined) speed[k] = feet(m.speed[k], who);
    if (m.speed.hover) speed.hover = true;

    const saves = Object.fromEntries(bonuses(m, 'saving-throw-')) as MonsterDef['saves'];
    const skills = Object.fromEntries(bonuses(m, 'skill-').map(([k, v]) => [k in SKILL_ABILITY ? k : fail(`${who}: unknown skill ${k}`), v])) as Partial<Record<Skill, number>>;

    const { passive_perception: passive, ...senseMap } = m.senses;
    const senses = Object.keys(senseMap).sort((a, b) => SENSE_ORDER.indexOf(a) - SENSE_ORDER.indexOf(b)).map((k) => `${k} ${senseMap[k]}`);

    const legendary = traits(m.legendary_actions);
    return {
      ...base('monster', m.name, []),
      size: [SIZE[m.size] ?? fail(`${who}: size ${m.size}`)],
      type: m.subtype ? `${m.type} (${m.subtype})` : m.type,
      alignment: m.alignment,
      ac: m.armor_class.map((a: Raw) => ({ value: a.value, ...(acFrom(a) && { from: acFrom(a) }) })),
      hp: { average: m.hit_points, formula: String(m.hit_points_roll).replace(/\s*([+-])\s*/, ' $1 ') },
      speed,
      scores: Object.fromEntries(ABILITY_KEYS.map(([k, long]) => [k, m[long]])) as MonsterDef['scores'],
      saves, skills,
      vulnerable: m.damage_vulnerabilities, resist: m.damage_resistances, immune: m.damage_immunities,
      conditionImmune: m.condition_immunities.map((c: Raw) => c.index),
      senses, passive: passive ?? fail(`${who}: no passive perception`),
      languages: m.languages && m.languages !== '—' ? m.languages.split(/,\s*(?![^()]*\))/) : [],
      cr: CR[m.challenge_rating] ?? String(m.challenge_rating),
      traits: traits(m.special_abilities), actions: traits(m.actions), bonusActions: [], reactions: traits(m.reactions),
      legendary,
      ...(legendary.length && { legendaryCount: 3 }),
    };
  });
}
