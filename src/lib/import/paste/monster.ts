import { hpAverage, crXp, CR_LADDER } from '../../rules/monsters.ts';
import { ABILITIES, abilityMod, SKILL_ABILITY } from '../../rules/constants.ts';
import { blankMonster, newMonsterId } from '../../monsters/homebrew.ts';
import { spellLine } from '../../monsters/library.ts';
import { splitList } from '../../monsters/editing.ts';
import type { MonsterDef, Size, Skill, Trait } from '../../types.ts';
import { cleanPasted, refusal, rich } from './clean.ts';

// Pure (no Svelte/Vite/DOM), loaded lazily by the paste dialog. Reads a 2014 stat block in the book's layout into a draft
// MonsterDef. Never throws: what it can't read becomes a note, and unrecognised lines go into the nearest trait's text.

const SIZES: Record<string, Size> = { tiny: 'T', small: 'S', medium: 'M', large: 'L', huge: 'H', gargantuan: 'G' };
const SIZE_LINE = /^(tiny|small|medium|large|huge|gargantuan)(?: or (tiny|small|medium|large|huge|gargantuan))? (.+?),\s*(.+)$/i;
const SECTIONS: Record<string, 'traits' | 'actions' | 'bonusActions' | 'reactions' | 'legendary' | 'mythic' | 'lair' | 'regional'> = {
  actions: 'actions', 'bonus actions': 'bonusActions', reactions: 'reactions', 'legendary actions': 'legendary', 'mythic actions': 'mythic', 'lair actions': 'lair', 'regional effects': 'regional',
};
const SMALL = new Set(['of', 'the', 'and', 'or', 'a', 'an', 'in', 'on', 'with', 'to', 'per', 'at', 'from', 'by', 'for']);
const ABBR: Record<string, (typeof ABILITIES)[number]> = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };

/** "Name. text" with a Title Case name (small words and "(Recharge 5-6)"-style groups allowed) → [name, text]. */
function traitStart(l: string): [string, string] | undefined {
  const m = /^([A-Z][^.]{0,70}?(?:\([^)]*\))?)\.\s+(.*)$/.exec(l) ?? /^([A-Z][^.]{0,70}?\([^)]*\))\.?$/.exec(l);
  if (!m) return undefined;
  const words = m[1].replace(/\([^)]*\)/g, ' ').trim().split(/\s+/);
  if (!words.length || words.length > 7 || !words.every((w) => /^[A-Z0-9'’-]/.test(w) || SMALL.has(w))) return undefined;
  return [m[1].trim(), m[2] ?? ''];
}

const signedNum = (s: string) => Number(s.replace(/\s/g, ''));

// A line of the score row: ability names, scores and "(+2)" / "(+ 2)" modifiers only. The `\b`s keep the digits unambiguous.
const SCORE_LINE = /^(?:\s*(?:(?:STR|DEX|CON|INT|WIS|CHA)\b|\d{1,2}\b|\(\s*[+-]?\s*\d+\s*\)))+\s*$/i;
const scoresIn = (l: string): number[] => (l.replace(/\(\s*[+-]?\s*\d+\s*\)/g, ' ').match(/\b\d{1,2}\b/g) ?? []).map(Number);

function speed(s: string, notes: string[]): MonsterDef['speed'] {
  const out: MonsterDef['speed'] = { walk: Number(/^(\d+)/.exec(s)?.[1] ?? 0) };
  let rest = s.replace(/^\d+ ?ft\.?,?\s*/, '');
  rest = rest.replace(/\b(fly|swim|climb|burrow) (\d+) ?ft\.?( \(hover\))?,?\s*/gi, (_, k: string, n: string, hover?: string) => {
    out[k.toLowerCase() as 'fly'] = Number(n);
    if (hover) out.hover = true;
    return '';
  }).trim().replace(/,$/, '');
  if (rest) out.note = rest;
  if (!/^\d/.test(s)) notes.push(`Speed "${s}" has no walking speed; 0 ft. was used.`);
  return out;
}

/** `refused`: the paste was not read (see `refusal`); the dialog shows it instead of opening the editor. */
export function parseMonsterText(s: string): { draft: MonsterDef; notes: string[]; refused?: string } {
  const notes: string[] = [];
  const { campaignId: _c, updatedAt: _u, ...blank } = blankMonster('');
  const m: MonsterDef = { ...blank, id: newMonsterId(), name: '' };
  const refused = refusal(s, 'monster');
  if (refused) return { draft: { ...m, name: 'Pasted monster' }, notes, refused };
  try {
    read(s, m, notes);
  } catch (e) { // defence in depth: a parser bug must not lose the paste
    notes.push(`Stopped reading early: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!m.name.trim()) m.name = 'Pasted monster';
  return { draft: m, notes };
}

function read(s: string, m: MonsterDef, notes: string[]): void {
  let lines = cleanPasted(s).split('\n').filter(Boolean);
  if (!lines.length) { notes.push('Nothing to read: paste a stat block.'); return; }
  // Pasted twice: the name line comes back followed by its size line. Keep the first copy.
  const again = lines.findIndex((l, i) => i > 0 && l === lines[0] && SIZE_LINE.test(lines[i + 1] ?? ''));
  if (again > 0) { lines = lines.slice(0, again); notes.push('The stat block appears twice; only the first copy was read.'); }

  let i = 0;
  if (!SIZE_LINE.test(lines[0])) m.name = lines[i++];
  const size = SIZE_LINE.exec(lines[i] ?? '');
  if (size) {
    m.size = [SIZES[size[1].toLowerCase()], ...(size[2] ? [SIZES[size[2].toLowerCase()]] : [])];
    m.type = size[3].trim();
    m.alignment = size[4].trim();
    i++;
  } else notes.push('No size, type and alignment line (such as "Medium humanoid, neutral evil"); Medium humanoid, unaligned was used.');

  const seen = new Set<string>();
  const unread: string[] = [];
  // Header fields, up to the first trait or section heading.
  for (; i < lines.length; i++) {
    const l = lines[i];
    let x: RegExpExecArray | null;
    if ((x = /^Armor Class (\d+)\s*(?:\((.+)\))?/i.exec(l))) { m.ac = [{ value: +x[1], ...(x[2] && { from: x[2].trim() }) }]; seen.add('ac'); }
    else if ((x = /^Hit Points (\d+)\s*(?:\(([^)]+)\))?/i.exec(l))) {
      const f = x[2]?.replace(/\s*([+-])\s*/g, ' $1 ').trim();
      m.hp = f && hpAverage(f) !== undefined ? { average: +x[1], formula: f } : { average: +x[1] };
      seen.add('hp');
    } else if ((x = /^Hit Points (.+)$/i.exec(l))) { m.hp = { special: x[1] }; seen.add('hp'); }
    else if ((x = /^Speed (.+)$/i.exec(l))) { m.speed = speed(x[1], notes); seen.add('speed'); }
    else if (/^STR\b/i.test(l)) {
      // One line or several: the first six scores after the header, skipping the "(+2)" modifiers. I2: only lines made of ability
      // names, scores and modifiers belong to the row; the first other line ends it and is read as a header.
      const nums = scoresIn(l);
      while (nums.length < 6 && SCORE_LINE.test(lines[i + 1] ?? '')) nums.push(...scoresIn(lines[++i]));
      nums.slice(0, 6).forEach((n, k) => (m.scores[ABILITIES[k]] = n));
      seen.add('scores');
      if (nums.length < 6) notes.push('The ability score row (STR … CHA) has fewer than six scores; 10 was used for the rest. Check which score is missing.');
    }
    else if ((x = /^Saving Throws (.+)$/i.exec(l))) {
      for (const [, a, n] of x[1].matchAll(/\b(str|dex|con|int|wis|cha)\w*\s*([+-]\s?\d+)/gi)) m.saves[ABBR[a.toLowerCase()]] = signedNum(n);
    } else if ((x = /^Skills (.+)$/i.exec(l))) {
      // One anchored match per comma-separated part: an unanchored search backtracked quadratically on a long line (I3).
      for (const part of x[1].split(',')) {
        const hit = /^\s*([A-Za-z][A-Za-z ]*?)\s*([+-]\s?\d+)/.exec(part);
        if (!hit) continue;
        const [, name, n] = hit;
        const k = name.trim().toLowerCase().replace(/\s+/g, '-') as Skill;
        if (Object.hasOwn(SKILL_ABILITY, k)) m.skills[k] = signedNum(n); // M1: not "constructor" and friends
        else notes.push(`Unknown skill "${name.trim()}" was left out.`);
      }
    } else if ((x = /^Damage Vulnerabilities (.+)$/i.exec(l))) m.vulnerable = splitList(x[1]);
    else if ((x = /^Damage Resistances (.+)$/i.exec(l))) m.resist = splitList(x[1]);
    else if ((x = /^Damage Immunities (.+)$/i.exec(l))) m.immune = splitList(x[1]);
    else if ((x = /^Condition Immunities (.+)$/i.exec(l))) m.conditionImmune = splitList(x[1]);
    else if ((x = /^Senses (.+)$/i.exec(l))) {
      const all = splitList(x[1]);
      const p = all.find((v) => /^passive Perception/i.test(v));
      m.senses = all.filter((v) => v !== p);
      if (p) m.passive = Number(/\d+/.exec(p)?.[0] ?? 10);
      seen.add(p ? 'senses+passive' : 'senses');
    } else if ((x = /^Languages\s*(.*)$/i.exec(l))) { m.languages = /^[-—–]?$/.test(x[1].trim()) ? [] : splitList(x[1]); seen.add('languages'); }
    else if ((x = /^Challenge (\S+)(?:\s*\(([\d,]+) XP\))?/i.exec(l))) {
      if (CR_LADDER.includes(x[1])) {
        m.cr = x[1];
        const xp = x[2] ? Number(x[2].replace(/,/g, '')) : undefined;
        if (xp !== undefined && xp !== crXp(m.cr)) m.xp = xp; // the book's own figure (Reduced Threat, CR 0 with 0 XP)
        seen.add('cr');
      } else notes.push(`Challenge "${x[1]}" is not a CR this app knows; CR 0 was used.`);
    } else if (/^Proficiency Bonus/i.test(l)) { /* derived from CR */ }
    else if (SECTIONS[l.toLowerCase()] || traitStart(l)) break;
    else unread.push(l);
  }

  for (const [k, label] of [['ac', 'Armor Class'], ['hp', 'Hit Points'], ['speed', 'Speed'], ['scores', 'ability scores (STR … CHA)'], ['languages', 'Languages'], ['cr', 'Challenge']] as const) {
    if (!seen.has(k)) notes.push(`No ${label} line was found; the default was used.`);
  }
  if (!seen.has('senses') && !seen.has('senses+passive')) notes.push('No Senses line was found; passive Perception was worked out from Wisdom.');
  if (!seen.has('senses+passive')) m.passive = 10 + (m.skills.perception ?? abilityMod(m.scores.wis));

  // Traits and the sections after them.
  let section: (typeof SECTIONS)[string] = 'traits';
  const prose: Record<'lair' | 'regional', string[]> = { lair: [], regional: [] };
  const intro: string[] = [];
  let current: { name: string; lines: string[] } | undefined;
  const lists: Record<string, { name: string; lines: string[] }[]> = { traits: [], actions: [], bonusActions: [], reactions: [], legendary: [], mythic: [] };
  for (; i < lines.length; i++) {
    const l = lines[i];
    const heading = SECTIONS[l.toLowerCase()];
    if (heading) { section = heading; current = undefined; continue; }
    if (section === 'lair' || section === 'regional') { prose[section].push(l); continue; }
    const t = traitStart(l);
    if (t && !spellLine(l)) { current = { name: t[0], lines: t[1] ? [t[1]] : [] }; lists[section].push(current); }
    else if (current) current.lines.push(l);
    else if (section === 'legendary' || section === 'mythic') intro.push(l);
    else unread.push(l);
  }
  const toTraits = (xs: { name: string; lines: string[] }[]): Trait[] => xs.map((x) => ({ name: x.name, text: rich(x.lines) }));
  m.traits = toTraits(lists.traits);
  m.actions = toTraits(lists.actions);
  m.bonusActions = toTraits(lists.bonusActions);
  m.reactions = toTraits(lists.reactions);
  m.legendary = toTraits(lists.legendary);
  if (lists.mythic.length) m.mythic = toTraits(lists.mythic);
  if (intro.length && m.legendary.length) {
    const count = /take (\w+) legendary actions?/i.exec(intro.join(' '))?.[1];
    const n = count && ({ one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[count.toLowerCase()] || Number(count);
    if (n) m.legendaryCount = n;
    m.legendaryIntro = rich(intro);
  }
  if (prose.lair.length) m.lair = rich(prose.lair);
  if (prose.regional.length) m.regional = rich(prose.regional);

  if (unread.length) {
    const home = m.traits[0] ?? m.actions[0];
    if (home) home.text.push(...rich(unread));
    else m.traits.push({ name: 'Unread text', text: rich(unread) });
    notes.push(`${unread.length} line${unread.length === 1 ? ' was' : 's were'} not recognised and went into “${home?.name ?? 'Unread text'}”: ${unread.map((l) => `"${l.slice(0, 40)}"`).join(', ')}.`);
  }
}
