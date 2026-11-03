// Pure: breath weapons. A stat block's ("… exhales fire in a 60-foot cone. … a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a
// failed save, or half as much …", "(Recharge 5–6)") and a dragonborn's (its draconic ancestry, level and DC). Each is aimed and worked out
// like a spell's area (a spell-like use with `breath` set: never open to Counterspell).
import { richToPlain } from '../content/richtext.ts';
import type { Combatant, RichText } from '../types.ts';
import { readSpell, type SpellRead } from './spellText.ts';
import type { TurnAction } from './turnActions.ts';

export interface Breath { name: string; read: SpellRead; dc: number }

const SAVE: Record<string, string> = { strength: 'Str', dexterity: 'Dex', constitution: 'Con', intelligence: 'Int', wisdom: 'Wis', charisma: 'Cha' };

/** One exhalation's wording: its area from the breather, its save and DC, its damage dice (the conditions and repeat saves as a spell reads them). */
function one(t: string): Omit<Breath, 'name'> | undefined {
  const area = /(\d+)-foot (cone|line|cube|sphere)(?: that is (\d+) feet wide)?/i.exec(t), save = /DC (\d+) (\w+) saving throw/i.exec(t);
  if (!/\bexhales?\b/i.test(t) || !area || !save || !SAVE[save[2].toLowerCase()]) return undefined;
  const damage = [...t.matchAll(/\d+ \((\d+d\d+(?: ?[+-] ?\d+)?)\) (\w+) damage/g)].map((m) => ({ dice: m[1].replace(/ /g, ''), type: m[2].toLowerCase() }));
  const shape = area[2].toLowerCase() as NonNullable<SpellRead['area']>['shape'];
  return { dc: +save[1], read: { ...readSpell({ text: [{ p: t }], level: 1, range: 'Self' }), damage, save: SAVE[save[2].toLowerCase()],
    onSave: damage.length && /half as much/i.test(t) ? 'half' : 'none', range: 'self', area: { shape, feet: +area[1], ...(area[3] && { width: +area[3] }), self: true } } };
}

/** The breath weapons an action holds: itself, or each named one it offers ("Fire Breath. The dragon exhales …"); none for any other action. */
export function readBreath(name: string, text: RichText): Breath[] {
  const whole = one(richToPlain(text));
  if (whole && !text.some((b) => /^[A-Z][\w ]* Breath\.\s/.test(richToPlain([b])))) return [{ name, ...whole }];
  return text.flatMap((b) => {
    const p = richToPlain([b]), m = /^([A-Z][\w ]* Breath)\.\s+(.*)$/s.exec(p), x = m && one(m[2]);
    return m && x ? [{ name: m[1], ...x }] : [];
  });
}

/** "(Recharge 5–6)": the least d6 that brings it back. */
export const rechargeOf = (name: string): number | undefined => { const m = /\(Recharge (\d)/i.exec(name); return m ? +m[1] : undefined; };

/** Its start of turn: each spent recharge use ('recharge:<n>:<name>' in spellsUsed) comes back on a d6 of n or more. */
export function recharge(x: Combatant, d6: (key: string) => number): Combatant {
  const used = x.spellsUsed ?? {}, back = Object.keys(used).filter((k) => k.startsWith('recharge:') && used[k] > 0 && d6(k) >= +k.split(':')[1]);
  return back.length ? { ...x, spellsUsed: Object.fromEntries(Object.entries(used).filter(([k]) => !back.includes(k))) } : x;
}

/** SRD 5.1 Draconic Ancestry: its damage type, a 5 × 30 ft. line or a 15 ft. cone, and the save. */
const ANCESTRY: Record<string, [string, 'line' | 'cone', 'Dex' | 'Con']> = {
  black: ['acid', 'line', 'Dex'], blue: ['lightning', 'line', 'Dex'], brass: ['fire', 'line', 'Dex'], bronze: ['lightning', 'line', 'Dex'], copper: ['acid', 'line', 'Dex'],
  gold: ['fire', 'cone', 'Dex'], green: ['poison', 'cone', 'Con'], red: ['fire', 'cone', 'Dex'], silver: ['cold', 'cone', 'Con'], white: ['cold', 'cone', 'Con'],
};
/** A dragonborn's Breath Weapon (the trait and an ancestry picked, "Draconic Ancestry (Red)"): 2d6, 3d6 at 6th level, 4d6 at 11th, 5d6 at 16th. */
export function dragonbornBreath(features: string[], o: { level: number; dc: number }): Pick<TurnAction, 'spell' | 'cast' | 'breath'> | undefined {
  const pick = features.find((f) => /^Draconic Ancestry\b/i.test(f))?.match(/\b(black|blue|brass|bronze|copper|gold|green|red|silver|white)\b/i)?.[1].toLowerCase();
  if (!features.includes('Breath Weapon') || !pick) return undefined;
  const [type, shape, save] = ANCESTRY[pick], dice = `${o.level >= 16 ? 5 : o.level >= 11 ? 4 : o.level >= 6 ? 3 : 2}d6`;
  return { breath: true, spell: { id: 'breath:dragonborn', level: 0, concentration: false }, cast: { dc: o.dc, charLevel: 1, mod: 0,
    read: { damage: [{ dice, type }], save, onSave: 'half', range: 'self', area: shape === 'line' ? { shape, feet: 30, width: 5, self: true } : { shape, feet: 15, self: true } } } };
}
