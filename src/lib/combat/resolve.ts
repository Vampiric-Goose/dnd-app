// Pure (no Svelte/Vite/DOM): one targeted use worked out on the DM's device (PHB 2014 p.194-196, p.205). An attack: the kept d20 plus
// the bonus against AC, a natural 20 always hits with its damage dice twice, a natural 1 always misses. A save: d20 plus the target's
// bonus against the DC, the area's damage rolled once for everyone. Dice come as raw faces (a player's own roll, checked here);
// monsters' saves roll on this device. A PC's save waits for its player (`pending`, with what it owes).
import { parseDice } from '../dice.ts';
import type { Ability, Combatant, MonsterDef, Outcome, Sheet } from '../types.ts';
export type { Outcome };
import type { SpellRead } from './spellText.ts';
import { afterDefenses, type Defenses } from './targeting.ts';
import { rollSpellDice, spellEdges, spellMods } from './spellEffects.ts';

export interface TargetInfo { id: string; ac: number; save: Record<Ability, number>; defenses: Defenses; pc: boolean; hidden: boolean; conditionImmune?: string[]; /** missing any hit points (Toll the Dead) */ hurt?: boolean; /** what it holds, for its spells' save dice and advantage */ conditions?: string[] }
type Die = { expr: string; type: string; on?: 'hit' | 'save'; vs?: string; part?: 'alt' | 'later' };
/** A list's alternatives (Toll the Dead): for a hurt target each `alt` replaces the part before it, else alternatives drop. */
const pickAlt = <T extends Pick<Die, 'part'>>(list: T[], hurt?: boolean): T[] =>
  !list.some((d) => d.part === 'alt') ? list : list.filter((d, i) => (d.part === 'alt' ? !!hurt : !(hurt && list[i + 1]?.part === 'alt')));
/** Raw faces: `d20` one die, or two with advantage or disadvantage; `dmg[i]` the faces of damage expression i (twice the dice on a crit). */
export interface Rolled { d20?: number[]; mode?: 'adv' | 'dis'; dmg: number[][] }

/** The total of `expr` from these faces, or undefined when they don't fit it (die count, doubled on a crit; a face outside its die).
 *  `crit` 'all' (house rule): its constants doubled too. */
export function totalOf(expr: string, faces: number[], crit: boolean | 'all'): number | undefined {
  let i = 0, total = 0;
  for (const t of parseDice(expr)) {
    if ('const' in t) { total += t.sign * t.const * (crit === 'all' ? 2 : 1); continue; }
    const n = crit ? t.count * 2 : t.count;
    const mine = faces.slice(i, i + n);
    if (mine.length < n || mine.some((f) => !Number.isInteger(f) || f < 1 || f > t.sides)) return undefined;
    total += t.sign * mine.reduce((a, b) => a + b, 0);
    i += n;
  }
  return i === faces.length ? total : undefined;
}

/** What is wrong with dice another device sent, or undefined. */
export function checkFaces(dice: { expr: string; crit?: boolean }[], r: Rolled): string | undefined {
  if (r.d20 && (r.d20.length < 1 || r.d20.length > 2 || r.d20.some((f) => !Number.isInteger(f) || f < 1 || f > 20))) return 'bad d20';
  if (r.dmg.length !== dice.length || dice.some((d, i) => totalOf(d.expr, r.dmg[i], !!d.crit) === undefined)) return 'bad damage dice';
  return undefined;
}

/** The d20 that counts: the higher with advantage, the lower with disadvantage, else the first. */
export const keptD20 = (r: Rolled): number => {
  const d = r.d20 ?? [];
  return r.mode === 'adv' ? Math.max(...d) : r.mode === 'dis' ? Math.min(...d) : d[0];
};

/** Damage of these expressions (faces already checked) after the target's defenses, with the notes why it changed. */
/**
 * The table's ruling: halves apply to the total and it is rounded once, in the enemy's favour: up when a PC takes it, down for a monster
 * (a monster's 6.5 deals 7 to a PC; a PC's 6.5 deals 6 to a monster).
 */
export const roundDamage = (x: number, pc: boolean): number => (pc ? Math.ceil(x - 1e-9) : Math.floor(x + 1e-9));

function hurt(t: TargetInfo, dice: { expr: string; type: string }[], faces: number[][], crit: boolean | 'all', magical: boolean, pick?: SpellRead['typeFromDie']): { damage: number; note?: string; matched?: true } {
  let damage = 0, matched = false;
  const notes: string[] = [];
  dice.forEach((d, i) => {
    const amount = totalOf(d.expr, faces[i] ?? [], crit) ?? 0;
    const tries = !d.type && pick ? firstTwo(d.expr, faces[i] ?? [], pick.sides, crit).map((f) => ({ f, type: pick.types[f - 1] ?? '' })) : [];
    if (pick && tries.length) { // the caster's pick of the dice, made for them: the type that hurts this target more
      const best = tries.map((c) => ({ ...c, r: afterDefenses(amount, c.type, t.defenses, magical) })).reduce((a, b) => (b.r.amount > a.r.amount ? b : a));
      damage += best.r.amount;
      notes.push(`${best.type} (d${pick.sides} ${best.f})`, ...(best.r.note ? [best.r.note] : []));
      if (tries.length === 2 && tries[0].f === tries[1].f) matched = true;
      return;
    }
    const r = afterDefenses(amount, d.type, t.defenses, magical);
    damage += r.amount;
    if (r.note && !notes.includes(r.note)) notes.push(r.note);
  });
  return { damage: roundDamage(damage, t.pc), ...(notes.length && { note: notes.join(', ') }), ...(matched ? { matched: true as const } : {}) };
}

/** The first two faces rolled for the dice with `sides` sides in `expr`. */
function firstTwo(expr: string, faces: number[], sides: number, crit: boolean | 'all'): number[] {
  let i = 0;
  for (const t of parseDice(expr)) {
    if ('const' in t) continue;
    const n = crit ? t.count * 2 : t.count;
    if (t.sides === sides) return faces.slice(i, i + Math.min(2, n));
    i += n;
  }
  return [];
}

const attackRoll = (t: TargetInfo, toHit: number, r: Rolled): { hit: boolean; roll: number; die: number; nat?: 20 | 1; two?: Outcome['two'] } => {
  const d = keptD20(r), roll = d + toHit;
  return { hit: d === 20 || (d !== 1 && roll >= t.ac), roll, die: d, ...((r.mode === 'adv' || r.mode === 'dis') && (r.d20?.length ?? 0) > 1 && { two: { mode: r.mode, first: r.d20![0] } }), ...(d === 20 ? { nat: 20 as const } : d === 1 ? { nat: 1 as const } : {}) };
};

/** A weapon attack (or a monster's): hit or miss against AC, and its damage on a hit. Extra damage (GWM's +10) is one more expression.
 *  `all` (house rule): a critical hit doubles its modifiers too. */
export function resolveAttack(t: TargetInfo, toHit: number, dmg: { expr: string; type: string; vs?: string }[], r: Rolled, magical: boolean, autoCrit = false, all = false): Outcome {
  const a = attackRoll(t, toHit, r), crit = a.nat === 20 || autoCrit;
  const live = dmg.map((d, i) => ({ d, f: r.dmg[i] ?? [] })).filter((x) => !x.d.vs || x.d.vs === t.id); // a marked rider hurts only its mark
  return { id: t.id, ...a, ac: t.ac, ...(a.hit ? hurt(t, live.map((x) => x.d), live.map((x) => x.f), crit && all ? 'all' : crit, magical) : { damage: 0 }) };
}

const ABILITY: Record<string, Ability> = { Str: 'str', Dex: 'dex', Con: 'con', Int: 'int', Wis: 'wis', Cha: 'cha' };

/**
 * A spell: its attack on `target` (hit damage), then its save for everyone `caught` (the target alone when there's no area). Save damage
 * is rolled once: a failure takes it all, a success half (rounded down) or none, each after its own defenses. Spell damage is magical.
 */
export function resolveSpell(read: SpellRead, dice: Die[], dc: number | undefined, toHit: number | undefined,
  target: TargetInfo | undefined, caught: TargetInfo[], r: Rolled, rng: () => number, autoCrit = false, ask = false, all = false): Outcome[] {
  const out: Outcome[] = [];
  const idx = dice.map((d, i) => ({ ...d, faces: r.dmg[i] ?? [] }));
  const hitDice = read.attack ? idx.filter((d) => d.on !== 'save') : [], saveDice = read.attack ? idx.filter((d) => d.on === 'save') : idx;
  if (read.attack && target && toHit !== undefined) {
    const a = attackRoll(target, toHit, r), crits = a.nat === 20 || autoCrit, critAs = crits && all ? 'all' as const : crits;
    const marked = pickAlt(hitDice.filter((d) => !d.vs || d.vs === target.id), target.hurt); // a marked rider (Hex) hurts only its mark
    const live = marked.filter((d) => d.part !== 'later'), later = marked.filter((d) => d.part === 'later');
    const h = a.hit ? hurt(target, live, live.map((d) => d.faces), critAs, true, read.typeFromDie)
      : read.missHalf ? (({ damage, ...rest }) => ({ ...rest, damage: roundDamage(damage / 2, target.pc) }))(hurt(target, live, live.map((d) => d.faces), false, true)) : { damage: 0 };
    const due = a.hit && later.length ? hurt(target, later, later.map((d) => d.faces), critAs, true).damage : 0;
    const { matched, ...dealt } = h as ReturnType<typeof hurt>;
    const pick = read.typeFromDie, open = live.find((d) => !d.type), crit = critAs;
    // `ask` (a PC casts it): its player picks the die; each pick's damage is worked out here, where the defenses are known
    const choose = a.hit && ask && pick && open ? [...new Set(firstTwo(open.expr, open.faces, pick.sides, crit))].map((face) => {
      const type = pick.types[face - 1] ?? '', c = hurt(target, live.map((d) => (d.type ? d : { ...d, type })), live.map((d) => d.faces), crit, true);
      return { face, type, damage: c.damage, note: [`${type} (d${pick.sides} ${face})`, ...(c.note ? [c.note] : [])].join(', ') };
    }) : undefined;
    out.push({ id: target.id, part: 'hit', ...a, ac: target.ac, ...(choose ? { damage: 0, choose } : dealt), ...(matched && read.leap && { leap: true as const }), ...(due > 0 && { later: due }) }); // matching dice: it leaps (Chaos Bolt)
  }
  // ponytail: darts that always hit all go to the one target; split them between several when someone needs it
  if ((read.auto || (read.lingering && !read.save)) && target) out.push({ id: target.id, part: 'hit', hit: true, ...hurt(target, idx, idx.map((d) => d.faces), false, true, read.typeFromDie) });
  if (!read.save || dc === undefined) return out;
  const ability = ABILITY[read.save] ?? 'dex';
  const owedBy = (t: TargetInfo) => pickAlt(saveDice, t.hurt).map((d) => ({ amount: totalOf(d.expr, d.faces, false) ?? 0, type: d.type }));
  // the conditions a failure leaves, but none the target is immune to
  const lose = (t: TargetInfo) => (read.conditions ?? []).filter((c) => !t.conditionImmune?.some((i) => i.toLowerCase() === c.toLowerCase()));
  for (const t of caught.length ? caught : target ? [target] : []) {
    const would = lose(t);
    const owed = owedBy(t);
    if (t.pc) { out.push({ id: t.id, part: 'save', pending: true, damage: 0, owed, ...(would.length && { inflicts: would }) }); continue; }
    // its spells: advantage or disadvantage on this save (Haste on Dex), dice added (Bless, Bane), both on this device
    const sp = spellMods(t.conditions ?? []), modes = new Set(spellEdges(sp, `save.${ability}`, 'target has').map((e) => e.mode));
    const d1 = 1 + Math.floor(rng() * 20), d2 = modes.size === 1 ? 1 + Math.floor(rng() * 20) : d1;
    const roll = modes.has('adv') && !modes.has('dis') ? Math.max(d1, d2) : modes.has('dis') && !modes.has('adv') ? Math.min(d1, d2) : d1;
    const extra = rollSpellDice(sp, 'save', rng), total = roll + t.save[ability] + extra.total, ok = total >= dc;
    const s = settle(t, owed, ok, read.onSave), note = [s.note, extra.note].filter(Boolean).join(', ');
    out.push({ id: t.id, part: 'save', save: { roll, total, ok }, ...s, ...(note && { note }), ...(!ok && would.length && { inflict: would }) });
  }
  return out;
}

/** What a save leaves of the owed damage: all on a failure, half or none on a success, each type after the target's defenses. */
export function settle(t: Pick<TargetInfo, 'defenses'> & { pc?: boolean }, owed: { amount: number; type: string }[], ok: boolean, onSave: SpellRead['onSave']): { damage: number; note?: string } {
  let damage = 0;
  const notes: string[] = [];
  for (const o of owed) { // half of the total = half of each part, kept exact; resistance stays with its type
    const r = afterDefenses(!ok ? o.amount : onSave === 'half' ? o.amount / 2 : 0, o.type, t.defenses, true);
    damage += r.amount;
    if (r.note && !notes.includes(r.note)) notes.push(r.note);
  }
  return { damage: roundDamage(damage, !!t.pc), ...(notes.length && { note: notes.join(', ') }) };
}

const mod = (score: number) => Math.floor((score - 10) / 2);
/**
 * A monster's AC with the spells it holds: Mage Armor gives its printed "with mage armor" AC, else its base plus Dex when it wears no armor
 * (natural armor doesn't stack: the higher stays; a shield still counts); then Shield-like bonuses, then Barkskin's floor.
 */
export function monsterAc(x: Combatant, m: MonsterDef | undefined, held: readonly string[]): number {
  const sp = spellMods(held), worn = x.ac ?? m?.ac[0]?.value ?? 10, from = (m?.ac[0]?.from ?? '').toLowerCase();
  let ac = worn;
  if (sp.acBase) {
    const printed = m?.ac.find((a) => /mage armor/i.test(a.from ?? ''))?.value;
    const armored = /\barmor\b/.test(from.replace(/natural armor/g, ''));
    const own = sp.acBase.base + sp.acBase.abilities.reduce((t, a) => t + mod(m?.scores[a as Ability] ?? x.dex), 0) + (/\bshield\b/.test(from) ? 2 : 0);
    if (printed !== undefined) ac = Math.max(worn, printed); else if (!armored) ac = Math.max(worn, own);
  }
  return Math.max(sp.acMin ?? 0, ac + sp.ac);
}
/** A combatant as a target: a monster's AC, saves (printed, else its ability modifier) and defenses; a PC's from its sheet. */
export function targetOf(x: Combatant, o: { monster?: MonsterDef; sheet?: Sheet; /** a PC's current HP and conditions (its character's) */ hp?: number; conditions?: string[] }): TargetInfo {
  const keys: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const hasted = !!x.hasted && !x.hasted.ended; // Haste is kept on the combatant (combat.ts), not as a condition: +2 AC, Dex saves with advantage
  if (o.sheet) { // the sheet already holds what its spells do to AC and defenses (rules/effects.ts)
    const s = o.sheet, conditions = [...(o.conditions ?? []), ...(hasted ? ['Haste'] : [])];
    return { id: x.id, ac: s.ac + (hasted ? 2 : 0), pc: true, hidden: !!x.hidden, ...(o.hp !== undefined && o.hp < s.maxHp && { hurt: true }), save: Object.fromEntries(keys.map((k) => [k, s.saves[k].bonus])) as Record<Ability, number>,
      defenses: { resist: s.resistances, immune: s.immunities, vulnerable: s.vulnerabilities }, ...(conditions.length && { conditions }) };
  }
  const held = [...(x.conditions ?? []), ...(hasted ? ['Haste'] : [])], m = o.monster, sp = spellMods(held); // a monster's spells (Shield, Stoneskin) on top of its stat block
  return { id: x.id, ac: monsterAc(x, m, held), pc: false, hidden: !!x.hidden, ...(x.hp !== undefined && x.maxHp !== undefined && x.hp < x.maxHp && { hurt: true }),
    save: Object.fromEntries(keys.map((k) => [k, m?.saves[k] ?? (m ? mod(m.scores[k]) : 0)])) as Record<Ability, number>,
    defenses: { resist: [...(m?.resist ?? []), ...sp.resist], immune: [...(m?.immune ?? []), ...sp.immune], vulnerable: m?.vulnerable ?? [] }, conditionImmune: m?.conditionImmune ?? [],
    ...(held.length && { conditions: held }) };
}
