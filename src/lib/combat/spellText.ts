// Pure (no Svelte/Vite/DOM): what a spell does, read from its wording (2014 rules, SRD 5.1 "Spellcasting"), and a monster's
// Spellcasting trait. Anything the wording doesn't say plainly is left out; the spell's text stays one tap away in the panel.
import { richToPlain } from '../content/richtext.ts';
import { spellLine } from '../monsters/library.ts';
import type { RichText, SpellDef, Trait } from '../types.ts';
import type { Shape } from '../map/templates.ts';

const TYPES = 'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const SAVES: Record<string, string> = { strength: 'Str', dexterity: 'Dex', constitution: 'Con', intelligence: 'Int', wisdom: 'Wis', charisma: 'Cha' };

/** An area of effect; `self`: it starts from the caster (range Self), else from a point the caster picks. */
export interface SpellArea { shape: Shape; feet: number; width?: number; self: boolean }
export interface SpellRead {
  attack?: 'melee' | 'ranged';
  /** The save it forces, short ('Dex'). */
  save?: string;
  /** Damage dice; `mod`: plus the spellcasting modifier. */
  damage: { dice: string; type: string; mod?: boolean }[];
  heal?: { dice: string; mod: boolean };
  /** Dice added for every `step` slot levels above `above` (to the healing, else the first damage). */
  perSlot?: { dice: string; above: number; step: number };
  /** A cantrip whose damage grows at 5th, 11th and 17th level. */
  scales?: boolean;
  area?: SpellArea;
}

export function readSpell(s: Pick<SpellDef, 'text' | 'level' | 'range'> & { higherLevels?: RichText }): SpellRead {
  const t = richToPlain(s.text), h = s.higherLevels ? richToPlain(s.higherLevels) : t;
  const out: SpellRead = { damage: [] };
  const atk = /make a (melee|ranged) spell attack/i.exec(t);
  if (atk) out.attack = atk[1].toLowerCase() as 'melee' | 'ranged';
  const sv = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(t);
  if (sv) out.save = SAVES[sv[1].toLowerCase()];
  const seen = new Set<string>();
  const dmg = (dice: string, type: string, mod?: boolean) => {
    const key = `${dice}|${type}`.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.damage.push({ dice: dice.replace(/\s+/g, ''), type: type.toLowerCase(), ...(mod && { mod: true }) }); }
  };
  for (const m of t.matchAll(new RegExp(`(\\d+d\\d+(?:\\s*\\+\\s*\\d+)?)\\s+(${TYPES})\\s+damage`, 'gi'))) dmg(m[1], m[2]);
  for (const m of t.matchAll(new RegExp(`(${TYPES}) damage equal to (\\d+d\\d+)( \\+ your spellcasting ability modifier)?`, 'gi'))) dmg(m[2], m[1], !!m[3]);
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
  // ponytail: a bare "N-foot radius" is often light or an aura (Light), not an area of effect: only an explicit sphere or cylinder counts
  return out;
}

/** `count`d`size` + more of the same die, or the two side by side. */
function addDice(base: string, extra: string, times: number): string {
  if (times <= 0) return base;
  const a = /^(\d+)d(\d+)(.*)$/.exec(base), b = /^(\d+)d(\d+)$/.exec(extra);
  if (a && b && a[2] === b[2]) return `${+a[1] + +b[1] * times}d${a[2]}${a[3]}`;
  return `${base}+${b ? `${+b[1] * times}d${b[2]}` : extra}`;
}
const signedMod = (n: number) => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);

/**
 * The dice to roll: at slot `slot` for a spell of `level` (higher slots add perSlot), a cantrip at character level `charLevel` (×2 at
 * 5th, ×3 at 11th, ×4 at 17th), `mod` the spellcasting modifier where the wording adds it.
 */
export function diceAt(r: SpellRead, o: { slot?: number; level: number; charLevel?: number; mod?: number }): { damage: string[]; heal?: string } {
  const n = r.perSlot && o.slot !== undefined && o.slot > r.perSlot.above ? Math.floor((o.slot - r.perSlot.above) / r.perSlot.step) : 0;
  const tier = (o.charLevel ?? 1) >= 17 ? 4 : (o.charLevel ?? 1) >= 11 ? 3 : (o.charLevel ?? 1) >= 5 ? 2 : 1;
  const damage = r.damage.map((d, i) => {
    let dice = d.dice;
    if (r.scales && i === 0) dice = dice.replace(/^(\d+)d/, (_, c) => `${+c * tier}d`);
    if (!r.heal && i === 0 && r.perSlot) dice = addDice(dice, r.perSlot.dice, n);
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
