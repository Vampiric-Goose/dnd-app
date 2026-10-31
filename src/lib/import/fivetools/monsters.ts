// 5etools bestiary record (its `_copy` and templates already resolved) -> MonsterDef.
import { slug } from '../../content/ids.ts';
import { renderTags } from '../../content/richtext.ts';
import { SKILL_ABILITY, abilityMod } from '../../rules/constants.ts';
import { CR_LADDER, crProf } from '../../rules/monsters.ts';
import type { Ability, MonsterDef, RichText, Size, Skill, Trait } from '../../types.ts';
import { ABILITIES, arr, base, fail, mapStrings, rich, table, traits, type Ctx, type Raw } from './common.ts';

const SIZES: Size[] = ['T', 'S', 'M', 'L', 'H', 'G'];
const SIZE_NAME = table<string>({ T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan' });
const PLURAL = table<string>({ fey: 'fey', undead: 'undead', monstrosity: 'monstrosities' });
const ALIGN = table<string>({ L: 'lawful', N: 'neutral', NX: 'neutral', NY: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any alignment' });
const MODES = ['walk', 'burrow', 'climb', 'fly', 'swim'] as const;
/** `spellcasting[].displayAs` -> the stat-block section; anything else is a trait. */
const SECTION = table<'actions' | 'bonusActions' | 'reactions' | 'legendary'>({ action: 'actions', bonus: 'bonusActions', reaction: 'reactions', legendary: 'legendary' });

const text = (x: unknown): string => renderTags(String(x ?? ''));
const isObj = (x: Raw) => x !== null && typeof x === 'object' && !Array.isArray(x);
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
/** 'a', 'a and b', 'a, b, and c' (the Monster Manual's damage lists). */
const series = (l: string[]) => (l.length < 3 ? l.join(' and ') : `${l.slice(0, -1).join(', ')}, and ${l[l.length - 1]}`);

function typeText(t: Raw): string {
  if (!isObj(t)) return text(t);
  const main = typeof t.type === 'string' ? t.type : arr(t.type?.choose).map(String).join(' or ');
  const tags = arr(t.tags).map(x => (isObj(x) ? (x.prefix && !x.prefixHidden ? `${x.prefix} ${x.tag}` : String(x.tag ?? '')) : String(x))).filter(Boolean);
  const head = t.swarmSize ? `swarm of ${SIZE_NAME[t.swarmSize] ?? t.swarmSize} ${PLURAL[main] ?? `${main}s`}` : main;
  return tags.length ? `${head} (${tags.join(', ')})` : head;
}

/** Alignment letters as the book prints them: ['C','E'] 'chaotic evil', ['L','NX','C','E'] 'any evil alignment', nested `{alignment, chance}` groups. */
function alignText(list: Raw): string {
  const l = arr(list);
  if (l.some(isObj)) return l.filter(isObj).map(a => a.special !== undefined ? text(a.special)
    : `${alignText(a.alignment)}${a.chance ? ` (${a.chance}%)` : ''}${a.note ? ` (${text(a.note)})` : ''}`).join(' or ');
  const has = (x: string) => l.includes(x);
  if (l.length === 3 && has('NX') && has('NY') && has('N')) return 'any neutral alignment';
  if (l.length === 4 || l.length === 5) {
    const any = (w: string) => `any ${w} alignment`;
    if (l.length === 5) for (const [x, w] of [['G', 'non-good'], ['E', 'non-evil'], ['L', 'non-lawful'], ['C', 'non-chaotic']]) if (!has(x)) return any(w);
    if (!has('L') && !has('NX')) return any('chaotic');
    if (!has('G') && !has('NY')) return any('evil');
    if (!has('C') && !has('NX')) return any('lawful');
    if (!has('E') && !has('NY')) return any('good');
  }
  if (l.length >= 6) return 'any alignment';
  return l.map(a => ALIGN[String(a).toUpperCase()] ?? String(a)).join(' ');
}

/** A damage or condition list: strings, and `{resist: [...], preNote, note}` groups (nested) printed as one entry each. */
function damageList(list: Raw, key: string): string[] {
  return arr(list).map((x): string => {
    if (!isObj(x)) return text(x);
    if (x.special !== undefined) return text(x.special);
    return [x.preNote, series(damageList(x[key], key)), x.note].filter(Boolean).map(s => text(s)).join(' ');
  }).filter(Boolean);
}

/** `save` / `skill` bonuses: '+4' -> 4. Unknown keys (skill `other`) are dropped with a warning. */
function bonuses<K extends string>(o: Raw, known: (k: string) => K | undefined, warn: (k: string) => void): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const [k, v] of Object.entries(isObj(o) ? o : {})) {
    const key = known(k), n = parseInt(String(v), 10);
    if (key && Number.isFinite(n)) out[key] = n;
    else warn(k);
  }
  return out;
}

function speedOf(s: Raw): MonsterDef['speed'] {
  const n = (v: Raw): number | undefined => (typeof v === 'number' ? v : typeof v?.number === 'number' ? v.number : undefined);
  const out: MonsterDef['speed'] = { walk: typeof s === 'number' ? s : 0 }, notes: string[] = [];
  if (!isObj(s)) return out;
  for (const k of MODES) {
    const v = n(s[k]);
    if (v === undefined) continue;
    out[k] = v;
    if (s[k]?.condition && s[k].condition !== '(hover)') notes.push(`${k} ${v} ft. ${text(s[k].condition)}`);
  }
  if (s.canHover) out.hover = true;
  for (const [k, alts] of Object.entries(isObj(s.alternate) ? s.alternate : {})) for (const v of arr(alts)) notes.push(`${k} ${n(v)} ft.${v?.condition ? ` ${text(v.condition)}` : ''}`);
  if (isObj(s.choose)) notes.push(`${arr(s.choose.from).join(' or ')} ${s.choose.amount} ft.${s.choose.note ? ` ${text(s.choose.note)}` : ''}`);
  if (notes.length) out.note = notes.join(', ');
  return out;
}

/** 'At will: …', '3/day each: …', 'Cantrips (at will): …', '1st level (4 slots): …', one line per group the record doesn't hide. */
function spellLines(s: Raw): string[] {
  const hidden = new Set(arr(s.hidden));
  const names = (l: Raw) => arr(l).filter(x => !x?.hidden).map(x => text(isObj(x) ? x.entry : x)).filter(Boolean).join(', ');
  const out: string[] = [];
  const line = (label: string, l: Raw) => { const v = names(l); if (v) out.push(`${label}: ${v}`); };
  if (!hidden.has('constant')) line('Constant', s.constant);
  if (!hidden.has('will')) line('At will', s.will);
  const per: [string, (n: number) => string][] = [
    ['daily', n => `${n}/day`], ['rest', n => `${n}/rest`], ['restLong', n => `${n}/long rest`], ['weekly', n => `${n}/week`], ['monthly', n => `${n}/month`],
    ['yearly', n => `${n}/year`], ['recharge', n => text(`{@recharge ${n}}`)], ['legendary', n => `${n} legendary action${n === 1 ? '' : 's'}`],
    ['charges', n => `${n} charge${n === 1 ? '' : 's'}`],
  ];
  for (const [k, label] of per) {
    if (hidden.has(k) || !isObj(s[k])) continue;
    for (const [key, l] of Object.entries(s[k]).sort(([a], [b]) => parseInt(b) - parseInt(a))) line(`${label(parseInt(key))}${key.endsWith('e') ? ' each' : ''}`, l);
  }
  if (!hidden.has('spells') && isObj(s.spells)) {
    for (const [key, g] of Object.entries<Raw>(s.spells).sort(([a], [b]) => +a - +b)) {
      const lvl = +key, slots = g?.slots, lower = g?.lower;
      line(lvl === 0 ? 'Cantrips (at will)'
        : lower && lower !== lvl ? `${ord(lower)}–${ord(lvl)} level (${slots} ${ord(lvl)}-level slot${slots === 1 ? '' : 's'})`
        : typeof slots === 'number' ? `${ord(lvl)} level (${slots} slot${slots === 1 ? '' : 's'})` : `${ord(lvl)} level`, g?.spells);
    }
  }
  if (!hidden.has('ritual')) line('Rituals', s.ritual);
  return out;
}

const spellTrait = (s: Raw): Trait => {
  const lines = spellLines(s);
  return { name: text(s.name ?? 'Spellcasting'), text: [...rich(s.headerEntries), ...(lines.length ? [{ list: lines }] : []), ...rich(s.footerEntries)] };
};

const warnedVars = new WeakMap<Ctx, Set<string>>(); // one warning per unknown variable per import

/**
 * Fills 5etools template variables (`<$title_short_name$>`, `{@dc <$spell_dc__cha$>}`, …) from the finished monster, as 5etools
 * renders them: proficiency from its CR, modifiers from its scores, "the …" short names unless it is a named creature.
 * An unknown variable is left as written.
 */
function fillVariables(r: Raw, ctx: Ctx, warn: (msg: string) => void): Raw {
  const pb = crProf(String(isObj(r.cr) ? r.cr.cr : r.cr)) ?? 2;
  const mod = (a: string) => abilityMod(typeof r[a] === 'number' ? r[a] : 10);
  const stem = String(r.name).split(',')[0].replace(/(?:adult|ancient|young) \w+ (dragon|dracolich)/gi, '$1');
  const short = typeof r.shortName === 'string' ? r.shortName : r.shortName === true ? String(r.name) : r.isNamedCreature || r.isNpc ? stem.split(' ')[0] : stem.toLowerCase();
  const the = (title: boolean) => (r.isNamedCreature ? '' : title ? 'The ' : 'the ');
  const value = (v: string): string | undefined => {
    if (v === 'name') return String(r.name);
    if (v === 'short_name' || v === 'title_short_name') return the(v !== 'short_name') + short;
    const [k, arg = ''] = v.split('__'), ability = (ABILITIES as string[]).includes(arg);
    if (k === 'spell_dc' && ability) return String(8 + pb + mod(arg));
    if (k === 'to_hit' && ability) return String(pb + mod(arg)); // the template wraps it in {@hit}, which adds the sign
    if (k === 'damage_mod' && ability) { const m = mod(arg); return m === 0 ? '' : ` ${m > 0 ? '+' : '-'} ${Math.abs(m)}`; }
    const avg = k === 'damage_avg' ? /^(\d+(?:\.\d+)?)\+(str|dex|con|int|wis|cha)$/.exec(arg) : null;
    return avg ? String(Math.floor(+avg[1] + mod(avg[2]))) : undefined;
  };
  return mapStrings(r, s => (!s.includes('<$') ? s : s.replace(/<\$([^$]*)\$>/g, (all, v: string) => {
    const out = value(v);
    if (out !== undefined) return out;
    const seen = warnedVars.get(ctx) ?? new Set<string>();
    warnedVars.set(ctx, seen);
    if (!seen.has(v)) { seen.add(v); warn(`unknown template variable ${all} left as written`); }
    return all;
  })));
}

export function monster(raw: Raw, ctx: Ctx, id: string, name: string): MonsterDef {
  const who = `monster "${name}" (${raw.source})`;
  const warn = (msg: string) => ctx.warn?.(`${who}: ${msg}`);
  const r = fillVariables(raw, ctx, warn);
  const size = arr(r.size).filter((s): s is Size => SIZES.includes(s));
  if (!size.length) fail('missing size');
  const ac = arr(r.ac).map(a => {
    if (typeof a === 'number') return { value: a };
    const from = [arr(a?.from).map(text).join(', '), a?.condition && text(a.condition), a?.special && text(a.special)].filter(Boolean).join(' ');
    return { value: typeof a?.ac === 'number' ? a.ac : parseInt(String(a?.special), 10) || 0, ...(from && { from }) };
  });
  if (!ac.length) fail('missing ac');
  const hp: MonsterDef['hp'] = r.hp?.special !== undefined ? { special: text(r.hp.special) }
    : typeof r.hp?.average === 'number' ? { average: r.hp.average, ...(r.hp.formula !== undefined && { formula: String(r.hp.formula) }) }
    : fail('missing hp');
  const scores = Object.fromEntries(ABILITIES.map(k => [k, typeof r[k] === 'number' ? r[k] : 10])) as MonsterDef['scores'];
  const cr = String(isObj(r.cr) ? r.cr.cr : r.cr);
  const sections: Record<'traits' | 'actions' | 'bonusActions' | 'reactions' | 'legendary', Trait[]> = {
    traits: traits(r.trait), actions: traits(r.action), bonusActions: traits(r.bonus), reactions: traits(r.reaction), legendary: traits(r.legendary),
  };
  for (const s of arr(r.spellcasting)) if (isObj(s)) sections[SECTION[s.displayAs] ?? 'traits'].push(spellTrait(s));
  const group = isObj(r.legendaryGroup) ? ctx.legendaryGroup?.(String(r.legendaryGroup.name), String(r.legendaryGroup.source)) : undefined;
  const lair: RichText = rich(group?.lairActions), regional: RichText = rich(group?.regionalEffects), mythic = traits(r.mythic);
  const passive = typeof r.passive === 'number' ? r.passive : parseInt(String(r.passive), 10);
  return {
    ...base('monster', id, name, r),
    // Variant boxes ("Variant: Familiar") print under the stat block; they are the monster's description here.
    text: rich(arr(r.variant).map(v => (isObj(v) ? { ...v, type: 'entries' } : v))),
    size, type: typeText(r.type), alignment: `${r.alignmentPrefix ? text(r.alignmentPrefix) : ''}${alignText(r.alignment)}`,
    ac, hp, speed: speedOf(r.speed), scores,
    saves: bonuses<Ability>(r.save, k => (ABILITIES as string[]).includes(k) ? k as Ability : undefined, k => warn(`save "${k}" dropped`)),
    skills: bonuses<Skill>(r.skill, k => (Object.hasOwn(SKILL_ABILITY, slug(k)) ? slug(k) as Skill : undefined), k => warn(`skill "${k}" dropped`)),
    vulnerable: damageList(r.vulnerable, 'vulnerable'), resist: damageList(r.resist, 'resist'), immune: damageList(r.immune, 'immune'),
    conditionImmune: damageList(r.conditionImmune, 'conditionImmune'),
    senses: arr(r.senses).map(text), passive: Number.isFinite(passive) ? passive : 10 + abilityMod(scores.wis), languages: arr(r.languages).map(text),
    cr: CR_LADDER.includes(cr) ? cr : '—',
    ...sections,
    ...(sections.legendary.length && { legendaryCount: typeof r.legendaryActions === 'number' ? r.legendaryActions : 3 }),
    ...(r.legendaryHeader !== undefined && { legendaryIntro: rich(r.legendaryHeader) }),
    ...(typeof r.cr?.xp === 'number' && { xp: r.cr.xp }),
    ...(mythic.length && { mythic }), ...(r.mythicHeader !== undefined && { mythicIntro: rich(r.mythicHeader) }),
    ...(lair.length && { lair }), ...(regional.length && { regional }),
    ...(arr(r.environment).length && { environment: arr(r.environment).map(String) }),
  };
}
