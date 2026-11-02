// Pure (no Svelte/Vite/DOM): what a spell does, read from its wording (2014 rules, SRD 5.1 "Spellcasting"), and a monster's
// Spellcasting trait. Anything the wording doesn't say plainly is left out; the spell's text stays one tap away in the panel.
import { richToPlain } from '../content/richtext.ts';
import { spellLine } from '../monsters/library.ts';
import type { Ability, RichText, SpellDef, SpellMech, Trait } from '../types.ts';
import { SPELL_RULES } from './spellRules.ts';
import type { Shape } from '../map/templates.ts';

const TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };
const ABILITY_OF: Record<string, Ability> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const SHORT: Record<Ability, string> = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };
const SAVES: Record<string, string> = { strength: 'Str', dexterity: 'Dex', constitution: 'Con', intelligence: 'Int', wisdom: 'Wis', charisma: 'Cha' };

/** An area of effect; `self`: it starts from the caster (range Self), else from a point the caster picks. */
export interface SpellArea { shape: Shape; feet: number; width?: number; self: boolean }
export interface SpellRead {
  attack?: 'melee' | 'ranged';
  /** The save it forces, short ('Dex'). */
  save?: string;
  /** Damage dice; `mod`: plus the spellcasting modifier; `on` (a spell with an attack and a save): which part deals it. */
  damage: { dice: string; type: string; mod?: boolean; on?: 'hit' | 'save' }[];
  /** The types to pick from for damage whose type is chosen or rolled (its `type` is ''). */
  choices?: string[];
  /** Darts that always hit (no attack, no save): `count` of them, one more for each slot level above `above`. */
  auto?: { count: number; above?: number };
  /** A save's damage on a success: half ("half as much damage on a successful one"), else none. */
  onSave?: 'half' | 'none';
  /** "each creature within N feet of it": a burst of N feet around the target. */
  burst?: number;
  range?: { feet: number } | 'self' | 'touch';
  /** It hurts a creature that enters the area or starts its turn there (Moonbeam), not when cast. */
  lingering?: true;
  heal?: { dice: string; mod: boolean };
  /** Dice added for every `step` slot levels above `above` (to the healing, else the first damage). */
  perSlot?: { dice: string; above: number; step: number };
  /** A cantrip whose damage grows at 5th, 11th and 17th level. */
  scales?: boolean;
  /** A cantrip's damage dice by character level, from the book (wins over `scales`). */
  scaling?: Record<number, string>;
  /** Conditions a failed save inflicts, as the app names them ('Paralyzed'). */
  conditions?: string[];
  /** The type of `''` damage is the face of one of the first two dice with these sides (Chaos Bolt's d8s). */
  typeFromDie?: { sides: number; types: string[] };
  /** Why it can't be fully automated, shown where it is cast. */
  manual?: string;
  /** How long it lasts, in rounds (a minute is 10); none for an instantaneous or open-ended spell. */
  rounds?: number;
  /** The target saves again at the end of each of its turns, ending the conditions on a success. */
  repeat?: true;
  /** Extra damage on the caster's weapon hits (`type` '' = the weapon's): the next hit only (`once`), or hits on a creature it marks. */
  rider?: { dice: string; type: string; once?: true; marked?: true };
  area?: SpellArea;
}

/** What a spell does. Trust: a one-off rule (spellRules.ts), then the book's tags (`mech`), then the wording. */
export function readSpell(s: Pick<SpellDef, 'text' | 'level' | 'range'> & { name?: string; mech?: SpellMech; duration?: string; higherLevels?: RichText }): SpellRead {
  const t = richToPlain(s.text), h = s.higherLevels ? richToPlain(s.higherLevels) : t;
  const out: SpellRead = { damage: [] };
  const atk = /make a (melee|ranged) spell attack/i.exec(t);
  if (atk) out.attack = atk[1].toLowerCase() as 'melee' | 'ranged';
  const sv = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(t);
  if (sv) out.save = SAVES[sv[1].toLowerCase()];
  const mech = s.mech;
  if (mech?.save?.length) { const named = sv && ABILITY_OF[sv[1].toLowerCase()]; out.save = SHORT[named && mech.save.includes(named) ? named : mech.save[0]]; }
  if (mech?.attack) out.attack = mech.attack;
  const seen = new Set<string>();
  // the sentence a damage roll sits in says which part deals it, when the spell has both an attack and a save
  const partAt = (i: number): 'hit' | 'save' | undefined => {
    if (!out.attack || !out.save) return undefined;
    const end = t.indexOf('.', i);
    return /saving throw|failed save/i.test(t.slice(t.lastIndexOf('.', i) + 1, end < 0 ? t.length : end)) ? 'save' : 'hit';
  };
  const dmg = (dice: string, type: string, at: number, mod?: boolean) => {
    const key = `${dice}|${type}`.toLowerCase(), on = partAt(at);
    if (!seen.has(key)) { seen.add(key); out.damage.push({ dice: dice.replace(/\s+/g, ''), type: type.toLowerCase(), ...(mod && { mod: true }), ...(on && { on }) }); }
  };
  for (const m of t.matchAll(new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s+(${TYPES})\\s+damage`, 'gi'))) dmg(m[1], m[2], m.index);
  for (const m of t.matchAll(new RegExp(`(${TYPES}) damage equal to (\\d+d\\d+)( \\+ your spellcasting ability modifier)?`, 'gi'))) dmg(m[2], m[1], m.index, !!m[3]);
  // a type the caster picks: "NdM X or Y damage (your choice)", else untyped "takes NdM damage" from the types the wording names
  const either = new RegExp(`(\\d+d\\d+) (${TYPES}) or (${TYPES}) damage`, 'i').exec(t);
  if (either) { dmg(either[1], '', either.index); out.choices = [either[2].toLowerCase(), either[3].toLowerCase()]; }
  const untyped = !out.damage.length && /takes (\d+d\d+(?:\s*\+\s*\d+d\d+)*) damage/i.exec(t);
  if (untyped) {
    dmg(untyped[1], '', untyped.index);
    const named = [...new Set([...t.matchAll(new RegExp(`\\b(${TYPES})\\b`, 'gi'))].map((x) => x[1].toLowerCase()))];
    out.choices = named.length > 1 ? named : TYPES.split('|'); // one type word is no list (often the verb "fire")
  }
  const darts = /each (?:dart|bolt|missile) hits/i.test(t) && /\b(two|three|four|five|\d+)(?: glowing)? (?:darts|bolts|missiles)\b/i.exec(t);
  if (darts) {
    const more = /one more (?:dart|bolt|missile) for each slot level above (\d)/i.exec(h);
    out.auto = { count: WORDS[darts[1].toLowerCase()] ?? +darts[1], ...(more && { above: +more[1] }) };
  }
  if (mech?.types?.length === 1) {
    for (const d of out.damage) if (!d.type) d.type = mech.types[0];
    delete out.choices;
  } else if (mech?.types && mech.types.length > 1 && out.damage.some((d) => !d.type)) out.choices = mech.types;
  const conds = mech?.conditions ?? [...new Set([...t.matchAll(/\b(?:be|is|becomes?) (blinded|charmed|deafened|frightened|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)\b/gi)]
    .map((x) => x[1].charAt(0).toUpperCase() + x[1].slice(1).toLowerCase()))];
  if (conds.length) out.conditions = conds;
  if (mech?.scaling && s.level === 0) out.scaling = mech.scaling;
  if (/at the end of each of its turns[^.]*saving throw/i.test(t)) out.repeat = true;
  const lasts = /(\d+) (round|minute|hour)s?/i.exec(s.duration ?? '');
  if (lasts) out.rounds = +lasts[1] * ({ round: 1, minute: 10, hour: 600 } as Record<string, number>)[lasts[2].toLowerCase()];
  if (out.save) out.onSave = /half as much damage on a successful/i.test(t) ? 'half' : 'none';
  const burst = /each creature within (\d+) feet of (?:it|the target|that creature)\b/i.exec(t);
  if (burst) out.burst = +burst[1];
  const r = s.range.trim(), feet = /(\d+)\s*(?:feet|foot)/i.exec(r), miles = /(\d+)\s*miles?/i.exec(r);
  const range = /^self/i.test(r) ? 'self' as const : /^touch/i.test(r) ? 'touch' as const : feet ? { feet: +feet[1] } : miles ? { feet: +miles[1] * 5280 } : undefined;
  if (range) out.range = range;
  if (/starts its turn there|enters the (?:spell's )?area|starts its turn (?:with)?in/i.test(t)) out.lingering = true;
  const heal = /regains? (?:a number of )?hit points equal to (\d+d\d+)( \+ your spellcasting ability modifier)?/i.exec(t);
  if (heal) out.heal = { dice: heal[1], mod: !!heal[2] };
  const up = /increases by (\d+d\d+) for (each|every two) (?:slot )?levels? (?:above|of higher spell slot) (?:the )?(\d)/i.exec(h);
  if (up) out.perSlot = { dice: up[1], above: Number(up[3]), step: /two/i.test(up[2]) ? 2 : 1 };
  if (s.level === 0 && /when you reach 5th level \(\d+d\d+\)/i.test(t)) out.scales = true;
  const self = /^self/i.test(s.range.trim());
  let m: RegExpExecArray | null;
  if ((m = /(\d+)-foot[- ]radius,?\s*(?:\d+-foot[- ]high\s+)?(sphere|cylinder)/i.exec(t))) out.area = { shape: m[2].toLowerCase() as Shape, feet: +m[1], self };
  else if ((m = /(\d+)-foot cone/i.exec(t))) out.area = { shape: 'cone', feet: +m[1], self };
  else if ((m = /(\d+)-foot cube/i.exec(t))) out.area = { shape: 'cube', feet: +m[1], self };
  else if ((m = /line (\d+) feet long and (\d+) feet wide/i.exec(t)) || (m = /(\d+)-foot[- ]long,? (\d+)-foot[- ]wide line/i.exec(t))) out.area = { shape: 'line', feet: +m[1], width: +m[2], self };
  else if ((m = /(\d+)-foot-wide,? (\d+)-foot-long line/i.exec(t))) out.area = { shape: 'line', feet: +m[2], width: +m[1], self };
  else if ((m = /within (\d+) feet of a point you choose/i.exec(t))) out.area = { shape: 'sphere', feet: +m[1], self }; // Sleep
  // a save around the caster, by distance: "all creatures within 10 feet of you", "each creature within range" (the range is the radius)
  else if (out.save && (m = /\b(?:each|all)(?: other)? creatures? (?:you choose )?within (\d+) feet of you\b/i.exec(t))) out.area = { shape: 'sphere', feet: +m[1], self: true };
  else if (out.save && typeof range === 'object' && /each creature (?:within range|other than you in that area)/i.test(t)) out.area = { shape: 'sphere', feet: range.feet, self: true };
  // ponytail: a bare "N-foot radius" is often light or an aura (Light), not an area of effect: only an explicit sphere or cylinder counts
  if (out.save && mech?.area && !out.area && !out.burst) out.area = { shape: mech.area.shape, feet: mech.area.feet, self: true };
  // extra damage on weapon hits: hits on a marked target (Hex), every weapon hit (Divine Favor), or the next hit only (a smite)
  const ty = `(?:(${TYPES}) )?`, extra = new RegExp(`extra (\\d+d\\d+) ${ty}damage`, 'i');
  const marked = new RegExp(`extra (\\d+d\\d+) ${ty}damage to the target whenever you hit it`, 'i').exec(t);
  const every = new RegExp(`weapon attacks deal an extra (\\d+d\\d+) ${ty}damage`, 'i').exec(t);
  const nextHit = /next time you hit/i.test(t) ? extra.exec(t) : null;
  const rm = marked ?? every ?? nextHit;
  if (rm) out.rider = { dice: rm[1], type: (rm[2] ?? '').toLowerCase(), ...(rm === nextHit && { once: true as const }), ...(rm === marked && { marked: true as const }) };
  // never silently wrong: what the targeting can't deliver says so
  const hurts = out.damage.length > 0 || !!mech?.types?.length;
  if (out.rider) { /* delivered on the caster's weapon hits */ }
  else if (out.lingering && hurts) out.manual = 'Damage over time isn’t automated: apply it by hand.';
  else if (!out.attack && !out.save && t.split(/(?<=\.)\s+/).some((x) => /\bextra \d+d\d+/i.test(x) && /\b(?:hits?|weapon)\b/i.test(x)))
    out.manual = 'Extra damage on weapon hits isn’t automated: apply it by hand.';
  else if (hurts && !(out.damage.length && (out.attack || out.save || out.auto))) out.manual = 'Its damage isn’t automated: apply it by hand.';
  else if (out.conditions?.length && !out.save) out.manual = 'Its effect isn’t automated: apply it by hand.';
  const rule = s.name ? SPELL_RULES[s.name.toLowerCase()] : undefined;
  return rule ? { ...out, ...rule } : out;
}

/** `count`d`size` + more of the same die, or the two side by side. */
function addDice(base: string, extra: string, times: number): string {
  if (times <= 0) return base;
  const a = /^(\d+)d(\d+)(.*)$/.exec(base), b = /^(\d+)d(\d+)$/.exec(extra);
  if (a && b && a[2] === b[2]) return `${+a[1] + +b[1] * times}d${a[2]}${a[3]}`;
  return `${base}+${b ? `${+b[1] * times}d${b[2]}` : extra}`;
}
/** `n` of `NdM+K` rolled together: `nN`d`M`+`nK` (every dart's damage, summed). */
const timesDice = (dice: string, n: number) => dice.replace(/^(\d+)d(\d+)(?:\+(\d+))?$/, (_, c, d, k) => `${+c * n}d${d}${k ? `+${+k * n}` : ''}`);
const signedMod =(n: number) => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);

/**
 * The dice to roll: at slot `slot` for a spell of `level` (higher slots add perSlot), a cantrip at character level `charLevel` (×2 at
 * 5th, ×3 at 11th, ×4 at 17th), `mod` the spellcasting modifier where the wording adds it.
 */
export function diceAt(r: SpellRead, o: { slot?: number; level: number; charLevel?: number; mod?: number }): { damage: string[]; heal?: string } {
  const n = r.perSlot && o.slot !== undefined && o.slot > r.perSlot.above ? Math.floor((o.slot - r.perSlot.above) / r.perSlot.step) : 0;
  const tier = (o.charLevel ?? 1) >= 17 ? 4 : (o.charLevel ?? 1) >= 11 ? 3 : (o.charLevel ?? 1) >= 5 ? 2 : 1;
  const damage = r.damage.map((d, i) => {
    let dice = d.dice;
    const lvl = r.scaling && Object.keys(r.scaling).map(Number).filter((k) => k <= (o.charLevel ?? 1)).sort((a, b) => b - a)[0];
    if (r.scaling && i === 0 && lvl !== undefined) dice = r.scaling[lvl];
    else if (r.scales && i === 0) dice = dice.replace(/^(\d+)d/, (_, c) => `${+c * tier}d`);
    if (!r.heal && i === 0 && r.perSlot) dice = addDice(dice, r.perSlot.dice, n);
    if (r.auto && i === 0) dice = timesDice(dice, r.auto.count + (r.auto.above !== undefined && o.slot !== undefined ? Math.max(0, o.slot - r.auto.above) : 0));
    return `${dice}${d.mod ? signedMod(o.mod ?? 0) : ''} ${d.type}`;
  });
  const heal = r.heal && `${r.perSlot ? addDice(r.heal.dice, r.perSlot.dice, n) : r.heal.dice}${r.heal.mod ? signedMod(o.mod ?? 0) : ''}`;
  return { damage, ...(heal && { heal }) };
}

/** A monster's Spellcasting (or Innate Spellcasting) trait: DC, attack bonus, caster level and its groups of spells. */
export interface Spellbook {
  dc?: number; attack?: number; level?: number;
  groups: { spells: string[]; atWill?: boolean; perDay?: number; slots?: { level: number; count: number } }[];
}

export function readSpellcasting(t: Trait): Spellbook | undefined {
  if (!/spellcasting/i.test(t.name)) return undefined;
  const plain = richToPlain(t.text);
  const num = (re: RegExp) => { const m = re.exec(plain); return m ? Number(m[1]) : undefined; };
  const lines = t.text.flatMap((b) => ('p' in b ? [b.p] : 'list' in b ? b.list : []));
  const groups: Spellbook['groups'] = [];
  for (const line of lines) {
    const sl = spellLine(line);
    if (!sl) continue;
    const label = sl.label.toLowerCase();
    if (/constant|ritual/.test(label)) continue;
    const spells = sl.spells.split(',').map((s) => s.replace(/\*|\(.*?\)/g, '').trim().toLowerCase()).filter(Boolean);
    const lvl = /^(\d+)(?:st|nd|rd|th)/.exec(label), slots = /(\d+) slots?/.exec(label), day = /^(\d+)\/day/.exec(label);
    groups.push({ spells, ...(/at will|cantrip/.test(label) && { atWill: true }), ...(day && { perDay: +day[1] }),
      ...(lvl && slots && { slots: { level: +lvl[1], count: +slots[1] } }) });
  }
  const dc = num(/spell save DC (\d+)/i), attack = num(/([+-]\d+) to hit with spell attacks/i), level = num(/(\d+)(?:st|nd|rd|th)-level spellcaster/i);
  return { ...(dc !== undefined && { dc }), ...(attack !== undefined && { attack }), ...(level !== undefined && { level }), groups };
}
