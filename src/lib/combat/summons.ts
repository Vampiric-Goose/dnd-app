// Pure: summons. A TCE spirit's stat block, as the import keeps it, carries its spell-level formulas as words ("11 + the level of the
// spell", "30 + 5 for each spell level above 2nd", "your spell attack modifier to hit", "summonSpellLevel"); scaleSummon turns them into
// numbers. A conjure spell lists its options by count and challenge rating. Summoned creatures join the fight marked with the casting that
// holds them, and leave with it (or at 0 HP). Mechanics only, read off the user's own import (the 11-02 ruling).
import { richToPlain } from '../content/richtext.ts';
import { slug } from '../content/ids.ts';
import type { Block, Combat, Combatant, MonsterDef, RichText } from '../types.ts';
import { monsterCombatant, rollInit } from './combat.ts';

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8 };
const flat = (expr: string) => expr.replace(/((?:\s*[+-]\s*\d+)+)$/, (all) => { const n = [...all.matchAll(/([+-])\s*(\d+)/g)].reduce((t, m) => t + (m[1] === '-' ? -1 : 1) * +m[2], 0); return n ? ` ${n < 0 ? '-' : '+'} ${Math.abs(n)}` : ''; });
const average = (expr: string) => Math.floor([...expr.matchAll(/(\d+)d(\d+)/g)].reduce((t, m) => t + (+m[1] * (+m[2] + 1)) / 2, 0)
  + [...expr.replace(/\d+d\d+/g, '').matchAll(/([+-])\s*(\d+)/g)].reduce((t, m) => t + (m[1] === '-' ? -1 : 1) * +m[2], 0));

/** One action or trait's wording at this spell level and caster: attack bonus, damage dice with the level added, the number of attacks. */
function scaleText(p: string, level: number, attack: number): string {
  return p.replace(/your spell attack modifier to hit/gi, `+${attack} to hit`)
    .replace(/(\d+d\d+(?:\s*[+-]\s*(?:\d+|summonSpellLevel))*)/g, (expr) => {
      if (!/summonSpellLevel/.test(expr)) return expr;
      const e = `${expr.match(/^\d+d\d+/)![0]}${flat(expr.replace(/^\d+d\d+/, '').replace(/summonSpellLevel/g, String(level)))}`;
      return `${average(e)} (${e})`;
    })
    .replace(/a number of attacks equal to half this spell's level \(rounded down\)/gi, `${Math.floor(level / 2)} attacks`);
}
const scaleBlocks = (r: RichText, level: number, attack: number): RichText =>
  r.map((b) => ('p' in b ? { ...b, p: scaleText(b.p, level, attack) } : 'list' in b ? { ...b, list: b.list.map((x) => scaleText(x, level, attack)) } : b) as Block);

/** The stat block at this spell level: AC, HP (the variant's base when it names several), attacks, damage and attack count. */
export function scaleSummon(m: MonsterDef, o: { level: number; attack: number; variant?: string; campaignId?: string }): MonsterDef {
  const { level: L, attack } = o;
  const acm = /(\d+) \+ the level of the spell/i.exec(m.ac[0]?.from ?? '');
  const ac = acm ? [{ ...m.ac[0], value: +acm[1] + L }, ...m.ac.slice(1)] : m.ac;
  let hp = m.hp;
  if ('special' in m.hp) {
    const s = m.hp.special, variants = [...s.matchAll(/(\d+) \(([^)]*?) only\)/gi)];
    const base = (o.variant && variants.find((v) => v[2].toLowerCase().includes(o.variant!.toLowerCase()))?.[1]) ?? variants[0]?.[1] ?? /^(\d+)/.exec(s)?.[1];
    const per = /\+ (\d+) for each spell level above (\d)/i.exec(s);
    if (base) hp = { average: +base + (per ? +per[1] * Math.max(0, L - +per[2]) : 0) };
  }
  const part = <T extends { text: RichText }>(list: T[]) => list.map((x) => ({ ...x, text: scaleBlocks(x.text, L, attack) }));
  const [kind, source] = m.id.split('@'), tag = `l${L}${o.variant ? `-${slug(o.variant)}` : ''}${o.campaignId ? `-${o.campaignId.slice(0, 8)}` : ''}`;
  return { ...m, id: `${kind}-${tag}@${source}`, name: o.variant ? `${m.name} (${o.variant})` : m.name, ac, hp,
    traits: part(m.traits), actions: part(m.actions), bonusActions: part(m.bonusActions), reactions: part(m.reactions) };
}

/** What a spell summons: a named stat block (with its choices, such as Air, Land or Water), or options by count, challenge rating and type. */
export function summonOptions(text: RichText): { creature: string; variants?: string[] } | { options: { count: number; cr: number; type?: string }[] } | undefined {
  const t = richToPlain(text), named = /\buses the (.+?) stat block\b/i.exec(t);
  if (named) {
    const v = /\bchoose an? [a-z ]+?: ((?:[A-Z][a-z]+, )*[A-Z][a-z]+,? or [A-Z][a-z]+)/.exec(t);
    return { creature: named[1], ...(v && { variants: v[1].split(/,\s*(?:or\s+)?|\s+or\s+/).filter(Boolean) }) };
  }
  const items = text.flatMap((b) => ('list' in b ? b.list : []));
  const options = items.flatMap((x) => {
    const m = /^(\w+) (.+?) of challenge rating (\d+(?:\/\d+)?) or lower/i.exec(x);
    if (!m || !WORDS[m[1].toLowerCase()]) return [];
    const [a, b] = m[3].split('/'), type = m[2].toLowerCase().replace(/ creatures?$/, '').replace(/s$/, '');
    return [{ count: WORDS[m[1].toLowerCase()], cr: b ? +a / +b : +a, ...(type && { type }) }];
  });
  return options.length ? { options } : undefined;
}

/**
 * The creatures as combatants marked with their casting: a spirit (`share`) takes its caster's initiative and goes right after it; a
 * conjured group rolls once for all. Several of one kind are numbered.
 */
export function summonCombatants(caster: Combatant, list: MonsterDef[], o: { spell: string; cast?: number; share: boolean; hpMode: 'average' | 'roll'; rng: () => number }): Combatant[] {
  const many = list.length > 1, init = o.share ? caster.init : rollInit(list[0] ? Math.floor((list[0].scores.dex - 10) / 2) : 0, o.rng);
  return list.map((m, i) => ({ ...monsterCombatant(m, many ? `${m.name} ${i + 1}` : m.name, o.hpMode, o.rng),
    ...(init !== undefined && { init }), tie: o.share ? caster.tie - 0.001 * (i + 1) : 0.5 - 0.001 * i,
    summon: { by: caster.id, spell: o.spell, ...(o.cast !== undefined && { cast: o.cast }) } }));
}

/** Summons whose casting ended (its caster no longer concentrates on that very casting, or left) or that dropped to 0 HP leave the fight. */
export function endedSummons(k: Combat): { combat: Combat; gone: string[] } {
  const gone = k.combatants.filter((x) => {
    if (!x.summon) return false;
    if (x.hp === 0) return true;
    const c = k.combatants.find((y) => y.id === x.summon!.by);
    return !c || (x.summon.cast !== undefined && !(c.concentrating && c.concentratingOn === x.summon.spell && c.concentrationCount === x.summon.cast));
  }).map((x) => x.id);
  return { combat: gone.length ? { ...k, combatants: k.combatants.filter((x) => !gone.includes(x.id)) } : k, gone };
}
