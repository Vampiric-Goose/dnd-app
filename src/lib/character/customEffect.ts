import { ABILITIES, SKILL_ABILITY } from '../rules/constants.ts';
import { evalFormula } from '../rules/formula.ts';
import type { Ability, BonusTarget, Effect, Skill } from '../types.ts';

// Pure (no Svelte/Vite/DOM): the custom-effect form's field model and the fields -> Effect conversion.

export type FieldKind = 'text' | 'longtext' | 'integer' | 'formula' | 'select' | 'check' | 'abilities';
/** `optional` fields are left off the effect when empty; `keepString` formulas stay text even when they are plain numbers (resource.max is a string). */
export interface Field { name: string; label: string; kind: FieldKind; options?: readonly string[]; optional?: boolean; keepString?: boolean }
export type FieldValue = string | boolean | string[];

const SKILLS = Object.keys(SKILL_ABILITY) as Skill[];
const BONUS_TARGETS: BonusTarget[] = [
  'ac', 'initiative', 'hpPerLevel', 'save.all',
  ...ABILITIES.map((a) => `save.${a}` as const), ...ABILITIES.map((a) => `check.${a}` as const), ...SKILLS.map((s) => `skill.${s}` as const),
  'attack.melee', 'attack.ranged', 'attack.spell', 'damage.melee', 'damage.ranged', 'spellDc', 'passive.perception',
];
const WHEN = ['armored', 'unarmored', 'notHeavy', 'noShield'];
const RECHARGE = ['short', 'long', 'dawn', 'dusk', 'none'];

// Keyed by the Effect union, so adding an effect type without a form fails the type check.
export const EFFECT_FIELDS: Record<Effect['type'], Field[]> = {
  bonus: [
    { name: 'target', label: 'Applies to', kind: 'select', options: BONUS_TARGETS },
    { name: 'value', label: 'Bonus (number or formula)', kind: 'formula' },
    { name: 'when', label: 'Only when', kind: 'select', options: WHEN, optional: true },
  ],
  acBase: [
    { name: 'base', label: 'Base AC', kind: 'integer' },
    { name: 'abilities', label: 'Add modifiers', kind: 'abilities' },
    { name: 'shieldAllowed', label: 'A shield still counts', kind: 'check' },
  ],
  setScore: [
    { name: 'ability', label: 'Ability', kind: 'select', options: ABILITIES },
    { name: 'value', label: 'Score (raises to at least this)', kind: 'integer' },
  ],
  proficiency: [
    { name: 'category', label: 'Category', kind: 'select', options: ['skill', 'save', 'tool', 'weapon', 'armor', 'language'] },
    { name: 'value', label: 'Name', kind: 'text' },
  ],
  expertise: [{ name: 'skill', label: 'Skill', kind: 'select', options: SKILLS }],
  halfProficiency: [
    { name: 'abilities', label: 'Abilities (none: every check and initiative)', kind: 'abilities', optional: true },
    { name: 'roundUp', label: 'Round up', kind: 'check' },
  ],
  damage: [
    { name: 'kind', label: 'Kind', kind: 'select', options: ['resistance', 'immunity', 'vulnerability'] },
    { name: 'damageType', label: 'Damage type', kind: 'text' },
  ],
  speed: [
    { name: 'mode', label: 'Movement', kind: 'select', options: ['walk', 'fly', 'swim', 'climb', 'burrow'] },
    { name: 'value', label: 'Feet added (number or formula)', kind: 'formula' },
    { name: 'when', label: 'Only when', kind: 'select', options: WHEN, optional: true },
  ],
  resource: [
    { name: 'name', label: 'Name', kind: 'text' },
    { name: 'max', label: 'Uses (number or formula)', kind: 'formula', keepString: true },
    { name: 'recharge', label: 'Recharges on', kind: 'select', options: RECHARGE },
  ],
  resourceRecharge: [
    { name: 'name', label: 'Resource name', kind: 'text' },
    { name: 'recharge', label: 'Recharges on', kind: 'select', options: RECHARGE },
  ],
  flag: [{ name: 'flag', label: 'Flag', kind: 'select', options: ['ignoreHeavyArmorSpeed', 'martialArts'] }],
  note: [{ name: 'text', label: 'Note', kind: 'longtext' }],
};
export const EFFECT_TYPES = Object.keys(EFFECT_FIELDS) as Effect['type'][];

/** Proficiency categories whose value must be a skill slug or an ability key (the sheet matches them exactly), so the form offers a select. */
export const PROFICIENCY_KEYS: Record<string, readonly string[]> = { skill: SKILLS, save: ABILITIES };

/** The form's starting values: first option of each select, empty elsewhere. */
export const blankValues = (type: Effect['type']): Record<string, FieldValue> => ({
  ...Object.fromEntries(EFFECT_FIELDS[type].map((f) => [f.name, f.kind === 'check' ? false : f.kind === 'abilities' ? [] : f.kind === 'select' && !f.optional ? f.options![0] : ''])),
  ...(type === 'proficiency' && { value: SKILLS[0] }), // the default category is skill
});

const ABILITY_KEY: Record<string, string> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const ZERO = Object.fromEntries(ABILITIES.map((a) => [a, 0])) as Record<Ability, number>;

/** Validates the form values for one effect type and builds the Effect, or says what is wrong. */
export function buildEffect(type: Effect['type'], values: Record<string, FieldValue>): { effect: Effect } | { error: string } {
  const out: Record<string, unknown> = { type };
  for (const f of EFFECT_FIELDS[type]) {
    const raw = values[f.name];
    if (f.kind === 'check') { out[f.name] = raw === true; continue; }
    if (f.kind === 'abilities') {
      const list = Array.isArray(raw) ? raw.filter((a) => (ABILITIES as string[]).includes(a)) : [];
      if (list.length || !f.optional) out[f.name] = list;
      continue;
    }
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) {
      if (f.optional) continue;
      return { error: `${f.label} is required.` };
    }
    if (f.kind === 'select') {
      if (!f.options!.includes(s)) return { error: `${f.label}: pick one of the options.` };
      out[f.name] = s;
    } else if (f.kind === 'integer') {
      if (!/^-?\d+$/.test(s)) return { error: `${f.label} must be a whole number.` };
      out[f.name] = Number(s);
    } else if (f.kind === 'formula') {
      if (/^-?\d+$/.test(s)) out[f.name] = f.keepString ? s : Number(s);
      else {
        // A custom effect has no owning class, so col[...] cannot resolve.
        if (/col\[/.test(s)) return { error: `${f.label}: col[...] needs a class table and a custom effect has none. Use a number, level, prof or mod:str.` };
        try { evalFormula(s, { level: 1, totalLevel: 1, prof: 2, mods: ZERO }); } catch (e) { return { error: (e as Error).message }; }
        out[f.name] = s;
      }
    } else if (type === 'proficiency' && f.name === 'value' && (out.category === 'skill' || out.category === 'save')) {
      // The sheet matches skill slugs and ability keys exactly, so accept the usual spellings and store the key.
      const key = out.category === 'skill' ? s.toLowerCase().replace(/\s+/g, '-') : ABILITY_KEY[s.toLowerCase()] ?? s.toLowerCase();
      if (!(out.category === 'skill' ? (SKILLS as string[]) : (ABILITIES as string[])).includes(key)) return { error: `"${s}" is not a ${out.category === 'skill' ? 'skill' : 'saving throw (an ability)'}.` };
      out[f.name] = key;
    } else out[f.name] = s;
  }
  return { effect: out as Effect };
}

/**
 * Is a stored or imported effect well-formed for its type? Checked against the same field model the form uses: a select holds one of
 * its options, a number is a number, a formula a number or text, an abilities list only ability keys. A missing check box reads false.
 */
export function effectOk(e: unknown): e is Effect {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
  const r = e as Record<string, unknown>;
  if (typeof r.type !== 'string' || !Object.hasOwn(EFFECT_FIELDS, r.type)) return false;
  return EFFECT_FIELDS[r.type as Effect['type']].every((f) => {
    const v = r[f.name];
    if (v === undefined) return !!f.optional || f.kind === 'check';
    switch (f.kind) {
      case 'select': return f.options!.includes(v as string);
      case 'integer': return typeof v === 'number' && Number.isFinite(v);
      case 'formula': return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
      case 'check': return typeof v === 'boolean';
      case 'abilities': return Array.isArray(v) && v.every((a) => (ABILITIES as string[]).includes(a));
      default: return typeof v === 'string';
    }
  });
}

/** 'bonus: target ac, value 1' for the list of added effects. */
export const describeEffect = (e: Effect): string =>
  `${e.type}: ${Object.entries(e).filter(([k]) => k !== 'type').map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('/') || 'none' : v}`).join(', ')}`;

export const EFFECT_LABEL: Record<Effect['type'], string> = {
  bonus: 'Bonus', acBase: 'Base armor class', setScore: 'Ability score', proficiency: 'Proficiency', expertise: 'Expertise', halfProficiency: 'Half proficiency',
  damage: 'Resistance, immunity or vulnerability', speed: 'Speed', resource: 'Resource with uses', resourceRecharge: 'Resource recharge change', flag: 'Special rule', note: 'Note',
};
