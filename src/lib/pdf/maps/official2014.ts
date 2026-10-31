import { addLevel, embedContent, newCharacter } from '../../character/build.ts';
import { ABILITIES } from '../../rules/constants.ts';
import { computeSheet } from '../../rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../settings.ts';
import type { Ability, CampaignSettings, OverrideKey, Scores, Sheet, Skill } from '../../types.ts';
import type { FieldMap } from '../fieldmap.ts';

// Pure (no Svelte/Vite/DOM). Reads the filled-in official 2014 fillable sheet. Every value is the user's input:
// numbers go through parseInt + Number.isSafeInteger, long text is cut, and a bad value is skipped, never thrown on.
//
// Checkbox mapping (from `scripts/dump-pdf-fields.ts`; the checkbox names are numbered, so they were matched to
// their rows by page position, x=101 on page 1, same y as the row's bonus field). Field names are exact, with
// trailing spaces where the sheet has them. Lookups ignore case and extra spaces.
//   saves   'Check Box 11' str, 'Check Box 18' dex, 'Check Box 19' con, 'Check Box 20' int, 'Check Box 21' wis, 'Check Box 22' cha
//   skills  'Check Box 23' acrobatics, 24 animal-handling, 25 arcana, 26 athletics, 27 deception, 28 history, 29 insight,
//           30 intimidation, 31 investigation, 32 medicine, 33 nature, 34 perception, 35 performance, 36 persuasion,
//           37 religion, 38 sleight-of-hand, 39 stealth, 40 survival   (all named 'Check Box N')
// Kept as text: Equipment, Features and Traits, ProficienciesLang, AttacksSpellcasting, Treasure, Allies, FactionName,
//   Feat+Traits (notes); Age, Height, Weight, Eyes, Skin, Hair (appearance).
// Counted, not imported (a note says so): the 'Spells ...', 'SlotsTotal/SlotsRemaining ...', 'Spellcasting...', 'SpellSaveDC',
//   'SpellAtkBonus' and 'Wpn...' fields, and the spell-prepared checkboxes.
// Intentionally ignored (the app derives or does not track them): PlayerName, XP, Inspiration, HD, HDTotal, the death-save
//   and hit-dice boxes ('Check Box 12'..'17'), the two image buttons, 'CharacterName 2'.

const SAVE_FIELDS: Record<Ability, { bonus: string; box: string }> = {
  str: { bonus: 'ST Strength', box: 'Check Box 11' }, dex: { bonus: 'ST Dexterity', box: 'Check Box 18' },
  con: { bonus: 'ST Constitution', box: 'Check Box 19' }, int: { bonus: 'ST Intelligence', box: 'Check Box 20' },
  wis: { bonus: 'ST Wisdom', box: 'Check Box 21' }, cha: { bonus: 'ST Charisma', box: 'Check Box 22' },
};
const SKILL_FIELDS: Record<Skill, { bonus: string; box: string }> = {
  acrobatics: { bonus: 'Acrobatics', box: 'Check Box 23' }, 'animal-handling': { bonus: 'Animal', box: 'Check Box 24' },
  arcana: { bonus: 'Arcana', box: 'Check Box 25' }, athletics: { bonus: 'Athletics', box: 'Check Box 26' },
  deception: { bonus: 'Deception ', box: 'Check Box 27' }, history: { bonus: 'History ', box: 'Check Box 28' },
  insight: { bonus: 'Insight', box: 'Check Box 29' }, intimidation: { bonus: 'Intimidation', box: 'Check Box 30' },
  investigation: { bonus: 'Investigation ', box: 'Check Box 31' }, medicine: { bonus: 'Medicine', box: 'Check Box 32' },
  nature: { bonus: 'Nature', box: 'Check Box 33' }, perception: { bonus: 'Perception ', box: 'Check Box 34' },
  performance: { bonus: 'Performance', box: 'Check Box 35' }, persuasion: { bonus: 'Persuasion', box: 'Check Box 36' },
  religion: { bonus: 'Religion', box: 'Check Box 37' }, 'sleight-of-hand': { bonus: 'SleightofHand', box: 'Check Box 38' },
  stealth: { bonus: 'Stealth ', box: 'Check Box 39' }, survival: { bonus: 'Survival', box: 'Check Box 40' },
};
const SCORE_FIELD: Record<Ability, string> = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const NOTE_SECTIONS: [title: string, field: string][] = [
  ['Equipment', 'Equipment'], ['Features & traits', 'Features and Traits'], ['Proficiencies & languages', 'ProficienciesLang'],
  ['Attacks & spellcasting', 'AttacksSpellcasting'], ['Treasure', 'Treasure'], ['Allies & organizations', 'Allies'],
  ['Faction', 'FactionName'], ['Additional features & traits', 'Feat+Traits'],
];
const APPEARANCE = ['Age', 'Height', 'Weight', 'Eyes', 'Skin', 'Hair'];
// Fields we count but do not import, by their normalised names.
const UNMAPPED: [what: string, test: RegExp][] = [
  ['spells', /^(spells \d|spellcasting|spellsavedc|spellatkbonus)/], ['spell slots', /^slots(total|remaining)/], ['weapon rows', /^wpn/],
];

const MAX_TEXT = 20_000, MAX_CLASS_ENTRIES = 10;
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const one = (s: string) => s.replace(/\s+/g, ' ').slice(0, 80); // a pasted value in a one-line note
const SETTINGS: CampaignSettings = { ...DEFAULT_SETTINGS, allowOverrides: true }; // a sheet can't be held to the creator's rules
const CLASS_LEVEL = /([A-Za-z' ]+?)\s*(\d+)/g;

type Row = [key: OverrideKey, field: string, computed: (s: Sheet) => number];

export const official2014: FieldMap = {
  id: 'official 2014',
  // The three names every character sheet-like PDF might share, plus one that only this sheet has.
  detect: (names) => {
    const have = new Set([...names].map(norm));
    return ['CharacterName', 'ClassLevel', 'STR'].every((n) => have.has(norm(n))) && ['ProficienciesLang', 'ST Strength'].some((n) => have.has(norm(n)));
  },
  toCharacter(raw, index) {
    const f = new Map<string, string | boolean>();
    for (const [k, v] of Object.entries(raw)) f.set(norm(k), v);
    const notes: string[] = [], bad: string[] = [], cut: string[] = [];
    const note = (s: string) => { if (!notes.includes(s)) notes.push(s); };
    const text = (name: string, max = MAX_TEXT): string => {
      const v = f.get(norm(name));
      if (typeof v !== 'string') return '';
      const s = v.replace(/\r\n?/g, '\n').trim();
      if (s.length <= max) return s;
      cut.push(name.trim());
      return s.slice(0, max);
    };
    const int = (name: string, lo = -Infinity, hi = Infinity): number | undefined => {
      const v = f.get(norm(name));
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return undefined;
      const n = s.length > 40 ? NaN : parseInt(s, 10); // a number is never this long
      if (!Number.isSafeInteger(n) || n < lo || n > hi) { bad.push(name.trim()); return undefined; }
      return n;
    };
    const checked = (name: string) => f.get(norm(name)) === true;
    const missing = (what: string, name: string) => { if (index) note(`Not found: ${what} ${one(name)}`); };

    let c = newCharacter(text('CharacterName', 200) || 'Imported character');
    c.imported = 'unverified';

    // Race (a subrace name such as "Hill Dwarf" also works), background.
    const raceName = text('Race');
    const race = raceName ? index?.find('race', raceName) : undefined;
    const sub = raceName && !race ? index?.find('subrace', raceName) : undefined;
    const parent = sub && index?.resolve(sub.raceId);
    const origin = race ?? (parent?.kind === 'race' ? parent : undefined);
    if (race || sub) { c.build.raceId = race?.id ?? sub!.raceId; if (sub) c.build.subraceId = sub.id; }
    else if (raceName) missing('race', raceName);
    const bgName = text('Background');
    const bg = bgName ? index?.find('background', bgName) : undefined;
    if (bg) c.build.backgroundId = bg.id;
    else if (bgName) missing('background', bgName);

    // Scores. The sheet shows final scores, so the fixed racial bonus is taken back out of the base (no double count).
    c.build.abilityMethod = 'manual';
    const shown: Partial<Scores> = {};
    for (const a of ABILITIES) {
      const v = int(SCORE_FIELD[a], 1, 30);
      if (v === undefined) continue;
      shown[a] = v;
      c.build.baseScores[a] = Math.max(1, v - (origin?.abilityBonuses[a] ?? 0) - (sub?.abilityBonuses[a] ?? 0));
    }

    // Levels, e.g. "Fighter 3 / Wizard 2": one addLevel per level, in order. Problems (multiclass prerequisites) are only noted.
    // "(Champion)" and "Champion Fighter 3" name a subclass the map can't set; words that are not a class are reported as such.
    const classRaw = text('ClassLevel');
    const classText = classRaw.replace(/\([^)]*\)/g, ' ');
    const extra = new Set([...classRaw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean));
    const entries = [...classText.matchAll(CLASS_LEVEL)];
    if (entries.length > MAX_CLASS_ENTRIES) note(`ClassLevel has more than ${MAX_CLASS_ENTRIES} entries; the rest were ignored`);
    let resolved = 0, tried = false;
    for (const m of entries.slice(0, MAX_CLASS_ENTRIES)) {
      const name = m[1].trim();
      if (!name) continue;
      const words = name.split(/\s+/);
      let cls = index?.find('class', name);
      if (!cls && index) {
        const w = words.find((x) => index.find('class', x));
        if (w) { cls = index.find('class', w); words.filter((x) => x !== w).forEach((x) => extra.add(x)); }
      }
      if (!cls || !index) { tried = true; missing('class', name); continue; }
      resolved++;
      for (let i = 0, n = Math.min(parseInt(m[2], 10), 21); i < n; i++) { // 21 so that going past level 20 is noted
        const r = addLevel(c, cls.id, index, SETTINGS);
        for (const p of r.problems) note(`Class: ${p.message}`);
        if (r.character === c) break;
        c = r.character;
      }
    }
    for (const w of classText.replace(CLASS_LEVEL, ' ').match(/[A-Za-z']+/g) ?? []) { // text left over: a class without a level, or a subclass
      const cls = index?.find('class', w);
      if (cls) { resolved++; note(`No level given for ${cls.name}`); } else extra.add(w);
    }
    if (classRaw && !resolved && !tried) missing('class', classRaw);
    else if (resolved && extra.size) note(`Subclass not detected: ${one([...extra].join(', '))}`);
    if (!index && (raceName || bgName || classRaw)) note('Content library unavailable; race, class and background were not matched');
    if (index) c = embedContent(c, index);

    // Proficiencies. Skills are always added; a save only when the class doesn't already give it.
    const compute = () => computeSheet(c, { settings: SETTINGS, viewer: 'dm' });
    let s = compute();
    for (const a of ABILITIES) if (checked(SAVE_FIELDS[a].box) && !s.saves[a].proficient) c.customEffects.push({ type: 'proficiency', category: 'save', value: a });
    const skills = Object.keys(SKILL_FIELDS) as Skill[];
    for (const sk of skills) if (checked(SKILL_FIELDS[sk].box)) c.customEffects.push({ type: 'proficiency', category: 'skill', value: sk });

    // Overrides: only where the sheet's number differs from what the engine computes. Each pass sees the one before.
    for (const a of ABILITIES) if (shown[a] !== undefined && shown[a] !== s.scores[a]) c.overrides[`score.${a}`] = shown[a];
    const settle = (rows: Row[]) => {
      s = compute();
      for (const [key, field, computed] of rows) {
        const v = int(field);
        if (v !== undefined && v !== computed(s)) c.overrides[key] = v;
      }
    };
    settle([['prof', 'ProfBonus', (x) => x.prof]]);
    settle([
      ...ABILITIES.map((a): Row => [`save.${a}`, SAVE_FIELDS[a].bonus, (x) => x.saves[a].bonus]),
      ...skills.map((sk): Row => [`skill.${sk}`, SKILL_FIELDS[sk].bonus, (x) => x.skills[sk].bonus]),
      ['ac', 'AC', (x) => x.ac], ['speed', 'Speed', (x) => x.speed.walk], ['maxHp', 'HPMax', (x) => x.maxHp], ['initiative', 'Initiative', (x) => x.initiative],
    ]);
    settle([['passivePerception', 'Passive', (x) => x.passivePerception]]); // reads the skill overrides above

    // Play state (current HP never exceeds the max the character now has), currency, text.
    const max = compute().maxHp, hp = int('HPCurrent', 0);
    c.state.hp = hp === undefined ? max : Math.min(hp, max);
    if (hp !== undefined && hp > max) note(`Current HP ${hp} clamped to max HP ${max}`);
    c.state.tempHp = int('HPTemp', 0) ?? 0;
    for (const k of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) c.currency[k] = int(k.toUpperCase(), 0) ?? 0;
    const d = c.details;
    d.alignment = text('Alignment', 200);
    d.personality = text('PersonalityTraits'); d.ideals = text('Ideals'); d.bonds = text('Bonds'); d.flaws = text('Flaws'); d.backstory = text('Backstory');
    d.appearance = APPEARANCE.flatMap((k) => { const t = text(k, 200); return t ? [`${k}: ${t}`] : []; }).join(', ');

    const sections: string[] = [];
    for (const [title, field] of NOTE_SECTIONS) {
      const t = text(field);
      if (t) sections.push(`${title}:\n${t}`);
    }
    const unmapped = UNMAPPED.filter(([, re]) => [...f].some(([k, v]) => typeof v === 'string' && v.trim() && re.test(k))).map(([what]) => what);
    if (unmapped.length) note(`Not imported (had text): ${unmapped.join(', ')}`);
    if (cut.length) note(`Shortened to ${MAX_TEXT} characters: ${cut.join(', ')}`);
    if (bad.length) note(`Ignored values that are not usable numbers: ${bad.join(', ')}`);
    d.notes = [notes.join('\n'), ...sections].filter(Boolean).join('\n\n');
    return c;
  },
};
