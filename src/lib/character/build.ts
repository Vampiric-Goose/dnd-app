import { slug } from '../content/ids.ts';
import type { ContentIndex } from '../content/index.ts';
import { isStandardArray, pointBuyCost } from '../rules/abilities.ts';
import { ABILITIES, POINT_BUY_BUDGET, SKILL_ABILITY, STANDARD_ARRAY } from '../rules/constants.ts';
import { computeSheet } from '../rules/sheet.ts';
import { uid } from '../uid.ts';
import type { Ability, CampaignSettings, Character, ChoiceAnswer, ClassDef, Entity, MulticlassPrereq, Scores, Sheet, SpellDef } from '../types.ts';
import { enumerateChoices, getKind } from './choices.ts';
import type { Lookup, PendingChoice } from './choices.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts. Every function returns a new Character.

export interface Problem { key?: string; step: 'race' | 'class' | 'abilities' | 'background' | 'choices' | 'equipment' | 'spells' | 'details'; message: string; blocking: boolean }
type Step = Problem['step'];

/** The index first, then the character's own snapshot (content from a pack that is no longer loaded). */
const lookupOf = (c: Character, index: ContentIndex): Lookup => id => index.resolve(id) ?? c.embedded[id];
const problem = (step: Step, message: string, key?: string, blocking = true): Problem => ({ ...(key && { key }), step, message, blocking });
const soften = (ps: Problem[], s: CampaignSettings): Problem[] => (s.allowOverrides ? ps.map(p => ({ ...p, blocking: false })) : ps);
const abbr = (a: Ability) => a[0].toUpperCase() + a.slice(1);
const sheetOf = (c: Character, index: ContentIndex, settings: CampaignSettings) => computeSheet(embedContent(c, index), { settings, viewer: 'dm' });

export const listChoices = (c: Character, index: ContentIndex, settings: CampaignSettings): PendingChoice[] => enumerateChoices(c, lookupOf(c, index), settings);

/** Records an answer. A subclass answer also sets `build.subclasses` for the class taken at that choice's level. */
export function answerChoice(c: Character, key: string, answer: ChoiceAnswer): Character {
  const build = { ...c.build, choices: { ...c.build.choices, [key]: answer } };
  // ponytail: the subclass choice sits on a feature gained at that character level, so that level's class owns it (no index needed).
  const classId = c.build.levels[Number(key.split('|')[0]) - 1]?.classId;
  if (classId && answer.type === 'ids' && answer.ids[0]?.startsWith('subclass:')) build.subclasses = { ...c.build.subclasses, [classId]: answer.ids[0] };
  return { ...c, build };
}

/** The first unmet requirement, e.g. "Int 13" or "Str 13 or Dex 13". */
function prereqGap(p: MulticlassPrereq | undefined, s: Scores): string | undefined {
  const all = p?.all ?? {}, any = p?.any ?? {};
  for (const a of ABILITIES) if (all[a] !== undefined && s[a] < all[a]) return `${abbr(a)} ${all[a]}`;
  const alts = ABILITIES.filter(a => any[a] !== undefined);
  if (alts.length && !alts.some(a => s[a] >= any[a]!)) return alts.map(a => `${abbr(a)} ${any[a]}`).join(' or ');
}

/** PHB p.163: the new class's prerequisite and every current class's. */
function multiclassProblems(target: ClassDef, current: ClassDef[], s: Scores, settings: CampaignSettings): Problem[] {
  if (!settings.multiclassing) return [problem('class', 'Multiclassing is off in this campaign')];
  for (const k of [target, ...current]) {
    const gap = prereqGap(k.multiclassPrereq, s);
    if (gap) return [problem('class', `Multiclassing into ${target.name} needs ${gap}`)];
  }
  return [];
}

/** Adds one level of `classId`. With a blocking problem the character comes back unchanged. Unknown classes and level 21 can't be overridden. */
export function addLevel(c: Character, classId: string, index: ContentIndex, settings: CampaignSettings, hpRoll?: number): { character: Character; problems: Problem[] } {
  const lookup = lookupOf(c, index);
  const cls = getKind(lookup, classId, 'class');
  const levels = c.build.levels;
  if (!cls) return { character: c, problems: [problem('class', `Unknown class ${classId}`)] };
  if (levels.length >= 20) return { character: c, problems: [problem('class', 'Already at level 20')] };
  const same = levels.find(l => lookup(l.classId)?.id === cls.id);
  const current = new Map<string, ClassDef>();
  for (const l of levels) { const k = getKind(lookup, l.classId, 'class'); if (k) current.set(k.id, k); }
  const ps: Problem[] = [];
  if (levels.length && !same) ps.push(...multiclassProblems(cls, [...current.values()], sheetOf(c, index, settings).scores, settings));
  const first = levels.length === 0;
  if (!first && hpRoll !== undefined && !(Number.isInteger(hpRoll) && hpRoll >= 1 && hpRoll <= cls.hitDie)) ps.push(problem('class', `HP roll must be 1 to ${cls.hitDie}`));
  const problems = soften(ps, settings);
  if (problems.some(p => p.blocking)) return { character: c, problems };
  const level = { classId: same?.classId ?? classId, ...(!first && hpRoll !== undefined && { hpRoll }) };
  return { character: { ...c, build: { ...c.build, levels: [...levels, level] } }, problems };
}

/** Rebuilds `embedded` with a snapshot of every entity the build uses, keyed by the id the build refers to. */
export function embedContent(c: Character, index: ContentIndex): Character {
  const lookup = lookupOf(c, index), b = c.build;
  const ids = new Set<string>([b.raceId, b.subraceId ?? '', b.backgroundId]);
  const classLevel: Record<string, number> = {};
  for (const { classId } of b.levels) classLevel[classId] = (classLevel[classId] ?? 0) + 1;
  for (const [classId, n] of Object.entries(classLevel)) {
    ids.add(classId);
    const cls = getKind(lookup, classId, 'class');
    const sub = cls && getKind(lookup, b.subclasses[classId], 'subclass');
    if (sub) ids.add(b.subclasses[classId]);
    // Optional features too, whatever the setting: an unused snapshot is harmless.
    for (const r of [...(cls?.features ?? []), ...(sub?.features ?? [])]) if (r.level <= n) ids.add(r.id);
    for (const ap of [...(cls?.spellcasting?.alwaysPrepared ?? []), ...(sub?.spellcasting?.alwaysPrepared ?? []), ...(sub?.alwaysPrepared ?? [])]) if (ap.level <= n) ap.spells.forEach(s => ids.add(s));
  }
  for (const a of Object.values(b.choices)) for (const id of a.type === 'ids' ? a.ids : a.type === 'asi' && a.featId ? [a.featId] : []) ids.add(id);
  for (const s of Object.values(b.spells)) [...s.known, ...s.prepared].forEach(id => ids.add(id));
  const embedded: Record<string, Entity> = {};
  for (const id of ids) { const e = id && lookup(id); if (e) embedded[id] = e; } // skill/tool/option names don't resolve
  return { ...c, embedded };
}

/** Per casting class: cantrips, spells known (a wizard's spellbook: 6 + 2 per level after 1st), prepared, and highest spell level. Reads only `embedded`. */
export function spellLimits(c: Character, settings: CampaignSettings): { classId: string; cantrips: number; known?: number; prepared?: number; maxLevel: number }[] {
  return computeSheet(c, { settings, viewer: 'dm' }).spellcasting.map(({ classId, cantrips, known, prepared, maxLevel }) => {
    const book = getKind(id => c.embedded[id], classId, 'class')?.spellcasting?.spellbook;
    const level = c.build.levels.filter(l => l.classId === classId).length;
    return { classId, cantrips, ...(book ? { known: 6 + 2 * (level - 1) } : known !== undefined && { known }), ...(prepared !== undefined && { prepared }), maxLevel };
  });
}

/** The spells a casting class picks from, up to `maxLevel`: its own list, or every spell for a subclass caster (no data field names its list). */
export function spellPool(spells: SpellDef[], cls: ClassDef | undefined, maxLevel: number): SpellDef[] {
  const list = cls?.spellcasting ? slug(cls.name) : undefined;
  return spells.filter(s => (!list || s.classes.includes(list)) && s.level <= maxLevel);
}

/** What's wrong with one answered (or unanswered) choice, or undefined. */
function choiceProblem(c: Character, p: PendingChoice, lookup: Lookup, sheet: Sheet, settings: CampaignSettings): string | undefined {
  const { choice: ch, answer: a } = p;
  if (!a) return 'not chosen yet';
  const wrong = 'answer is the wrong kind';
  const featProblem = (id: string): string | undefined => {
    if (!settings.feats) return 'feats are off in this campaign';
    const f = getKind(lookup, id, 'feat');
    if (!f) return `${id} isn't a feat`;
    const pre = f.prerequisite;
    if (pre?.abilities?.length && !pre.abilities.some(req => ABILITIES.every(ab => req[ab] === undefined || sheet.scores[ab] >= req[ab])))
      return `${f.name} needs ${pre.abilities.map(req => ABILITIES.filter(ab => req[ab] !== undefined).map(ab => `${abbr(ab)} ${req[ab]}`).join(' and ')).join(' or ')}`;
    if (pre?.spellcasting && !sheet.spellcasting.length) return `${f.name} needs the ability to cast spells`;
    const race = [c.build.raceId, c.build.subraceId].map(id => (id ? lookup(id) : undefined)).filter(e => !!e);
    if (pre?.races?.length && !pre.races.some(r => race.some(e => e.id === r || slug(e.name) === slug(r)))) return `${f.name} needs race ${pre.races.join(' or ')}`;
  };

  if (ch.type === 'asi') {
    if (a.type !== 'asi') return wrong;
    const inc = Object.values(a.abilities ?? {}).filter(n => n);
    if (a.featId) return inc.length ? 'choose an increase or a feat, not both' : featProblem(a.featId);
    return inc.reduce((t, n) => t + n, 0) === 2 && inc.every(n => n === 1 || n === 2) ? undefined : 'increase one score by 2 or two scores by 1';
  }
  if (ch.type === 'ability') {
    if (a.type !== 'abilities') return wrong;
    const picked = ABILITIES.filter(ab => a.abilities[ab]);
    return picked.length === ch.count && picked.every(ab => ch.from.includes(ab) && a.abilities[ab] === ch.amount) ? undefined : `choose ${ch.count} for +${ch.amount}`;
  }
  if (a.type !== 'ids') return wrong;
  const ids = a.ids, n = ch.type === 'subclass' || ch.type === 'feat' ? 1 : ch.count;
  if (new Set(ids).size !== ids.length) return 'the same pick twice';
  if (ids.length !== n) return `choose ${n} (${ids.length} chosen)`;
  const allowed = (id: string): boolean => {
    switch (ch.type) {
      case 'skill': return ch.from === 'any' ? id in SKILL_ABILITY : (ch.from as string[]).includes(id);
      case 'language': case 'tool': return !ch.from || ch.from.includes(id);
      case 'expertise': return !!(sheet.skills as Record<string, { proficient: boolean }>)[id]?.proficient || sheet.proficiencies.tools.includes(id);
      case 'option': return ch.options.some(o => o.name === id);
      case 'optionalFeature': return !!getKind(lookup, id, 'optionalFeature')?.featureTypes.some(t => ch.featureTypes.includes(t));
      case 'subclass': {
        const sub = getKind(lookup, id, 'subclass'), owner = c.build.levels[p.level - 1]?.classId;
        return !!sub && !!owner && lookup(sub.classId)?.id === lookup(owner)?.id;
      }
      case 'feat': return true; // checked below
    }
  };
  const bad = ids.find(id => !allowed(id));
  if (bad) return `${bad} isn't an allowed pick`;
  if (ch.type === 'feat') return featProblem(ids[0]);
}

/** Everything that breaks the rules, by creator step. With `allowOverrides` on, nothing blocks. */
export function validateCharacter(c: Character, index: ContentIndex, settings: CampaignSettings): Problem[] {
  const lookup = lookupOf(c, index), b = c.build, out: Problem[] = [];
  const add = (step: Step, message: string, key?: string, blocking = true) => out.push(problem(step, message, key, blocking));
  const embedded = embedContent(c, index);
  const sheet = computeSheet(embedded, { settings, viewer: 'dm' });

  const race = getKind(lookup, b.raceId, 'race');
  if (!race) add('race', b.raceId ? `Missing race ${b.raceId}` : 'Choose a race');
  // R55: only a subrace from the race's own source makes one required (a PHB Variant or another book's subrace is optional).
  else if (!b.subraceId && index.all('subrace').some(s => s.source === race.source && lookup(s.raceId)?.id === race.id)) add('race', `Choose a ${race.name} subrace`);
  if (b.subraceId && !getKind(lookup, b.subraceId, 'subrace')) add('race', `Missing subrace ${b.subraceId}`);
  if (b.customOrigin && !settings.customOrigin) add('race', 'Customizing your origin is off in this campaign');

  if (!b.levels.length) add('class', 'Choose a class');
  const seen = new Map<string, ClassDef>();
  b.levels.forEach((l, i) => {
    const cls = getKind(lookup, l.classId, 'class');
    if (!cls) return add('class', `Missing class ${l.classId}`);
    if (i > 0 && l.hpRoll !== undefined && !(Number.isInteger(l.hpRoll) && l.hpRoll >= 1 && l.hpRoll <= cls.hitDie)) add('class', `Level ${i + 1}: HP roll must be 1 to ${cls.hitDie}`);
    if (seen.has(cls.id)) return;
    // ponytail: checked against today's scores, not the scores when the class was taken.
    if (seen.size) out.push(...multiclassProblems(cls, [...seen.values()], sheet.scores, settings));
    seen.set(cls.id, cls);
  });
  for (const id of Object.values(b.subclasses)) if (!getKind(lookup, id, 'subclass')) add('class', `Missing subclass ${id}`);

  const s = b.baseScores;
  if (b.abilityMethod === 'pointBuy') {
    const cost = pointBuyCost(s);
    if (cost === null) add('abilities', 'Point buy scores must be 8 to 15');
    else if (cost !== POINT_BUY_BUDGET) add('abilities', `Point buy total is ${cost} of ${POINT_BUY_BUDGET}`, undefined, cost > POINT_BUY_BUDGET);
  } else if (b.abilityMethod === 'standard' && !isStandardArray(s)) add('abilities', `Use each standard array score once (${STANDARD_ARRAY.join(', ')})`);
  else if (b.abilityMethod === 'rolled' && ABILITIES.some(a => s[a] < 3 || s[a] > 18)) add('abilities', 'Rolled scores must be 3 to 18');
  // Typed-in scores (dice rolled at the table, an imported sheet) are a normal method, not an override.
  else if (b.abilityMethod === 'manual' && ABILITIES.some(a => !(s[a] >= 1 && s[a] <= 30))) add('abilities', 'Scores must be 1 to 30');

  if (!b.backgroundId) add('background', 'Choose a background');
  else if (!getKind(lookup, b.backgroundId, 'background')) add('background', `Missing background ${b.backgroundId}`);

  const racial = (sourceId: string) => [b.raceId, b.subraceId].includes(sourceId.split('/')[0]);
  for (const p of enumerateChoices(c, lookup, settings)) {
    if (b.customOrigin && p.choice.type === 'ability' && racial(p.sourceId)) continue; // R24: the custom origin replaces these
    const msg = choiceProblem(c, p, lookup, sheet, settings);
    if (msg) add('choices', `${p.sourceName}: ${msg}`, p.key);
  }

  for (const lim of spellLimits(embedded, settings)) {
    const picked = b.spells[lim.classId] ?? { known: [], prepared: [] };
    const cls = getKind(lookup, lim.classId, 'class');
    if (!cls) continue;
    const spell = (id: string) => getKind(lookup, id, 'spell');
    for (const id of new Set([...picked.known, ...picked.prepared])) {
      const sp = spell(id);
      if (!sp) { add('spells', `Missing spell ${id}`); continue; }
      if (sp.level > lim.maxLevel) add('spells', `${sp.name} is level ${sp.level}; ${cls.name} casts up to level ${lim.maxLevel}`);
      // R25: a warning only. Magical Secrets and expanded spell lists grant off-list spells, and no data field records them.
      // ponytail: subclass casters (Eldritch Knight, Arcane Trickster) borrow another list; only class casters are checked.
      if (cls.spellcasting && sp.classes.length && !sp.classes.includes(slug(cls.name))) add('spells', `${sp.name} isn't on the ${cls.name} spell list`, undefined, false);
    }
    const count = (ids: string[], cantrip: boolean) => ids.filter(id => (spell(id)?.level === 0) === cantrip).length;
    const cantrips = new Set([...picked.known, ...picked.prepared].filter(id => spell(id)?.level === 0)).size;
    if (cantrips > lim.cantrips) add('spells', `${cls.name}: ${cantrips} cantrips of ${lim.cantrips}`);
    const book = !!cls.spellcasting?.spellbook;
    // A wizard may copy found spells beyond the free ones, so an over-full spellbook only warns.
    if (lim.known !== undefined && count(picked.known, false) > lim.known) add('spells', `${cls.name}: ${count(picked.known, false)} ${book ? 'spellbook spells' : 'spells known'} of ${lim.known}`, undefined, !book);
    if (lim.prepared !== undefined && count(picked.prepared, false) > lim.prepared) add('spells', `${cls.name}: ${count(picked.prepared, false)} prepared of ${lim.prepared}`);
    if (book) for (const id of picked.prepared) if (!picked.known.includes(id)) add('spells', `${spell(id)?.name ?? id} must be in the spellbook to prepare it`);
    // R34: too few blocks too (soften() makes it a warning with overrides on). Each target is capped at what can be
    // picked: the class's pool in the index (a wizard prepares from the book), and nothing leveled before 1st-level slots.
    const pool = spellPool(index.all('spell'), cls, lim.maxLevel), poolCantrips = pool.filter(s => s.level === 0).length;
    const short = (have: number, want: number | undefined, most: number, what: string) => {
      const n = want === undefined ? 0 : Math.min(want, most) - have;
      if (n > 0) add('spells', `${cls.name}: pick ${n} more ${n === 1 ? what.slice(0, -1) : what}`);
    };
    short(cantrips, lim.cantrips, poolCantrips, 'cantrips');
    if (lim.maxLevel >= 1) {
      short(count(picked.known, false), lim.known, pool.length - poolCantrips, book ? 'spellbook spells' : 'spells');
      short(count(picked.prepared, false), lim.prepared, book ? count(picked.known, false) : pool.length - poolCantrips, 'prepared spells');
    }
  }

  if (!c.name.trim()) add('details', 'Name your character');
  // ponytail: no equipment checks; attunement over 3 is a sheet warning (spec: warn, don't block).
  return soften(out, settings);
}

/** An empty character: no race/class/background, all scores 10, zeroed play state. */
export function newCharacter(name: string, campaignId?: string): Character {
  return {
    id: uid(), name, ...(campaignId && { campaignId }), updatedAt: Date.now(),
    build: { raceId: '', backgroundId: '', abilityMethod: 'standard', baseScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, levels: [], subclasses: {}, choices: {}, spells: {} },
    embedded: {},
    state: { hp: 0, tempHp: 0, hitDiceUsed: {}, slotsUsed: [], pactSlotsUsed: 0, resourcesUsed: {}, conditions: [], exhaustion: 0, deathSaves: { success: 0, fail: 0 }, inspiration: false },
    inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, overrides: {}, customEffects: [],
    details: { alignment: '', personality: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '', notes: '' },
  };
}
