import { slug } from '../content/ids.ts';
import { getKind, raceParts } from '../character/choices.ts';
import { attunedCount, carriedWeight } from '../items/inventory.ts';
import type { Ability, Attack, Character, ClassDef, ItemDef, OverrideKey, Proficiencies, Recharge, Scores, Sheet, Skill, Speeds, Spellcasting, When } from '../types.ts';
import { ABILITIES, ATTUNEMENT_LIMIT, SKILL_ABILITY, abilityMod, averageHp, profBonus } from './constants.ts';
import { gather, ofType } from './effects.ts';
import type { SheetOpts } from './effects.ts';
import { evalFormula } from './formula.ts';
import { maxSpellLevel, multiclassSlots, pactSlots } from './spellcasting.ts';

// Pure (no Svelte/Vite/DOM): shared with Node scripts. Reads entities only from c.embedded.

const SIZE_CAPACITY = { T: 0.5, S: 1, M: 1, L: 2, H: 4, G: 8 };
const signed = (n: number) => (n === 0 ? '' : n > 0 ? `+${n}` : `${n}`);

/** Derives every number on the sheet from the build plus embedded content. Never throws on missing content; it warns. */
export function computeSheet(c: Character, opts: SheetOpts): Sheet {
  const warnings = new Set<string>();
  const lookup = (id: string) => {
    const e = c.embedded[id];
    if (!e) warnings.add(`Missing ${id.slice(0, id.indexOf(':'))}: ${id}`);
    return e;
  };
  const { steps, pending, items, effects } = gather(c, opts, lookup);
  const overridden: OverrideKey[] = [];
  const override = (k: OverrideKey, v: number): number => {
    const o = c.overrides[k];
    if (typeof o !== 'number') return v;
    if (!overridden.includes(k)) overridden.push(k);
    return o;
  };

  const { race, sub } = raceParts(c, lookup);
  const bg = getKind(lookup, c.build.backgroundId, 'background');
  const totalLevel = c.build.levels.length;
  const classLevel: Record<string, number> = {};
  for (const s of steps) classLevel[s.classId] = s.classLevel;
  const classes = steps.filter(s => s.classLevel === 1 && s.cls).map(s => ({ cls: s.cls!, sub: s.sub, level: classLevel[s.classId], first: s.level === 1 }));
  const first = steps[0]?.cls;

  // Scores
  const scores: Scores = { ...c.build.baseScores };
  const raise = (b: Partial<Scores> | undefined, cap = false) => {
    for (const a of ABILITIES) {
      const n = b?.[a];
      if (n) scores[a] = cap ? Math.max(scores[a], Math.min(20, scores[a] + n)) : scores[a] + n;
    }
  };
  if (c.build.customOrigin) raise(c.build.customOrigin);
  else { raise(race?.abilityBonuses); raise(sub?.abilityBonuses); }
  const fromFeat = (sourceId: string) => sourceId.startsWith('feat:');
  // A custom origin replaces every racial increase, including race/subrace ability choices.
  const racial = (sourceId: string) => [c.build.raceId, c.build.subraceId].includes(sourceId.split('/')[0]);
  for (const p of pending) if (p.choice.type === 'ability' && p.answer?.type === 'abilities' && !fromFeat(p.sourceId) && !(c.build.customOrigin && racial(p.sourceId))) raise(p.answer.abilities);
  const featBonus = (id?: string) => raise(getKind(lookup, id, 'feat')?.abilityBonus, true);
  for (const { choice, answer: a, sourceId } of pending) {
    if (choice.type === 'asi' && a?.type === 'asi') { raise(a.abilities, true); featBonus(a.featId); }
    if (choice.type === 'feat' && a?.type === 'ids') a.ids.forEach(featBonus);
    if (choice.type === 'ability' && a?.type === 'abilities' && fromFeat(sourceId)) raise(a.abilities, true);
  }
  for (const { effect: e } of ofType(effects, 'setScore')) scores[e.ability] = Math.max(scores[e.ability], e.value);
  for (const a of ABILITIES) scores[a] = override(`score.${a}`, scores[a]);
  const mods = Object.fromEntries(ABILITIES.map(a => [a, abilityMod(scores[a])])) as Scores;
  const prof = override('prof', profBonus(Math.max(1, totalLevel)));

  // Formulas: `level` and `col[...]` read the owning class; without one, the total level and no table.
  const num = (v: number | string, classId?: string): number => {
    if (typeof v === 'number') return v;
    const lvl = classId ? classLevel[classId] : undefined;
    const cls = classId ? (c.embedded[classId] as ClassDef | undefined) : undefined;
    try {
      return evalFormula(v, {
        level: lvl ?? totalLevel, totalLevel, prof, mods,
        col: cls?.table && lvl ? label => cls.table.find(t => t.label === label)?.values[lvl - 1] : undefined,
      });
    } catch (err) {
      warnings.add((err as Error).message);
      return 0;
    }
  };

  // Worn gear
  const worn = items.filter(i => i.entry.equipped);
  const active = items.filter(i => i.active).map(i => i.item);
  const armor = worn.find(i => i.item.armor && i.item.armor.category !== 'shield')?.item.armor;
  const shield = worn.find(i => i.item.armor?.category === 'shield')?.item.armor;
  // ponytail: 'unarmored' means no armor and no shield (Monk Unarmored Movement); shield-allowing bases use acBase.shieldAllowed.
  const whenOk = (w?: When) => !w || (w === 'armored' ? !!armor : w === 'unarmored' ? !armor && !shield : w === 'noShield' ? !shield : armor?.category !== 'heavy');
  const bonus = (target: string) => ofType(effects, 'bonus').filter(b => b.effect.target === target && whenOk(b.effect.when)).reduce((t, b) => t + num(b.effect.value, b.classId), 0);
  const itemBonus = (k: keyof NonNullable<ItemDef['bonuses']>) => active.reduce((t, i) => t + (i.bonuses?.[k] ?? 0), 0);

  // Proficiencies
  const profs = { armor: new Set<string>(), weapons: new Set<string>(), tools: new Set<string>(), skills: new Set<string>(), languages: new Set<string>() };
  const addProfs = (p?: Proficiencies) => { if (p) for (const k of Object.keys(profs) as (keyof Proficiencies)[]) for (const v of p[k] ?? []) profs[k].add(v); };
  for (const x of classes) addProfs(x.first ? x.cls.proficiencies : x.cls.multiclassProficiencies);
  addProfs(race?.proficiencies); addProfs(sub?.proficiencies); addProfs(bg?.proficiencies);
  const expertise = new Set<string>();
  for (const { choice, answer: a } of pending) {
    if (a?.type !== 'ids') continue;
    const into = choice.type === 'skill' ? profs.skills : choice.type === 'tool' ? profs.tools : choice.type === 'language' ? profs.languages : choice.type === 'expertise' ? expertise : undefined;
    a.ids.forEach(id => into?.add(id));
  }
  const saveProf = new Set<string>(first?.saves);
  const CATEGORY = { skill: profs.skills, tool: profs.tools, weapon: profs.weapons, armor: profs.armor, language: profs.languages, save: saveProf };
  for (const { effect: e } of ofType(effects, 'proficiency')) CATEGORY[e.category]?.add(e.value); // an unknown category is ignored, not a crash
  for (const { effect: e } of ofType(effects, 'expertise')) expertise.add(e.skill);

  // Saves
  const saves = Object.fromEntries(ABILITIES.map(a => {
    const proficient = saveProf.has(a);
    return [a, { proficient, bonus: override(`save.${a}`, mods[a] + (proficient ? prof : 0) + bonus('save.all') + bonus(`save.${a}`) + itemBonus('save')) }];
  })) as Sheet['saves'];

  // Skills
  const halves = ofType(effects, 'halfProficiency');
  const half = (ab: Ability) => Math.max(0, ...halves.filter(h => !h.effect.abilities || h.effect.abilities.includes(ab)).map(h => (h.effect.roundUp ? Math.ceil(prof / 2) : Math.floor(prof / 2))));
  const skills = Object.fromEntries((Object.keys(SKILL_ABILITY) as Skill[]).map(sk => {
    const ab = SKILL_ABILITY[sk], proficient = profs.skills.has(sk), exp = expertise.has(sk);
    const base = Math.max(exp ? 2 * prof : 0, proficient ? prof : 0, half(ab));
    return [sk, { bonus: override(`skill.${sk}`, mods[ab] + base + bonus(`skill.${sk}`) + bonus(`check.${ab}`)), proficient, expertise: exp }];
  })) as Sheet['skills'];
  // Initiative is a Dex check (R21).
  const initiative = override('initiative', mods.dex + half('dex') + bonus('check.dex') + bonus('initiative'));
  const passivePerception = override('passivePerception', 10 + skills.perception.bonus + bonus('passive.perception'));

  // AC
  let base: number;
  if (armor) base = armor.ac + (armor.category === 'light' ? mods.dex : armor.category === 'medium' ? Math.min(mods.dex, armor.dexCap ?? Infinity) : 0);
  else base = Math.max(10 + mods.dex, ...ofType(effects, 'acBase').filter(b => !shield || b.effect.shieldAllowed).map(b => b.effect.base + (b.effect.abilities ?? []).reduce((t, a) => t + mods[a], 0)));
  const ac = override('ac', base + (shield?.ac ?? 0) + itemBonus('ac') + bonus('ac'));

  // HP and hit dice
  // Class-sourced HP bonuses count per level of that class; race/feat/item ones every level (R22).
  const hpPer = ofType(effects, 'bonus').filter(b => b.effect.target === 'hpPerLevel' && whenOk(b.effect.when));
  const maxHp = override('maxHp', steps.reduce((t, s, i) => {
    const die = s.cls?.hitDie ?? 0;
    const roll = i === 0 ? die : (c.build.levels[i].hpRoll ?? (die ? averageHp(die) : 0));
    const extra = hpPer.filter(b => !b.classId || b.classId === s.classId).reduce((n, b) => n + num(b.effect.value, b.classId), 0);
    return t + Math.max(1, roll + mods.con + extra);
  }, 0));
  const dice: Record<number, number> = {};
  for (const s of steps) if (s.cls) dice[s.cls.hitDie] = (dice[s.cls.hitDie] ?? 0) + 1;
  const hitDice = Object.entries(dice).map(([d, total]) => ({ die: Number(d), total })).sort((a, b) => b.die - a.die);

  // Carrying
  const weight = carriedWeight(c.inventory, c.currency);
  const str = scores.str * SIZE_CAPACITY[race?.size ?? 'M'];
  const enc = opts.settings.encumbrance;
  const encumbrance: Sheet['carrying']['encumbrance'] = enc === 'variant' ? (weight > 10 * str ? 'heavy' : weight > 5 * str ? 'encumbered' : 'none')
    : enc === 'standard' && weight > 15 * str ? 'over' : 'none';
  if (encumbrance === 'over') warnings.add(`Carrying ${weight} lb, over the ${15 * str} lb capacity`);

  // Speed
  const speed: Speeds = { walk: 30, ...race?.speed, ...sub?.speed }; // ponytail: 30 ft only when the race itself is missing
  for (const { effect: e, classId } of ofType(effects, 'speed')) if (whenOk(e.when)) speed[e.mode] = (speed[e.mode] ?? 0) + num(e.value, classId);
  const ignoreArmor = ofType(effects, 'flag').some(f => f.effect.flag === 'ignoreHeavyArmorSpeed');
  const penalty = (armor?.strReq && scores.str < armor.strReq && !ignoreArmor ? 10 : 0) + (encumbrance === 'encumbered' ? 10 : encumbrance === 'heavy' ? 20 : 0);
  for (const m of Object.keys(speed) as (keyof Speeds)[]) speed[m] = Math.max(0, speed[m]! - penalty);
  speed.walk = override('speed', speed.walk);

  // Attacks
  const weaponProfs = new Set([...profs.weapons].map(slug));
  // Martial Arts (R23): only while wearing no armor and no shield (PHB).
  const ma = whenOk('unarmored') ? ofType(effects, 'flag').find(f => f.effect.flag === 'martialArts') : undefined;
  const maLevel = ma?.classId ? classLevel[ma.classId] : undefined;
  const maCol = ma?.classId && maLevel ? (c.embedded[ma.classId] as ClassDef | undefined)?.table.find(t => t.label === 'Martial Arts')?.values[maLevel - 1] : undefined;
  const maDie = typeof maCol === 'string' ? maCol : undefined;
  const sides = (d: string) => Number(/d(\d+)/.exec(d)?.[1] ?? 0);
  const withMa = (d: string) => (maDie && sides(maDie) > sides(d) ? maDie : d);
  const attacks: Attack[] = worn.filter(i => i.item.weapon).map(({ entry, item, active: on }) => {
    const w = item.weapon!;
    const names = [item.name, item.baseItemId?.split(':')[1]?.split('@')[0] ?? ''].map(slug);
    const monkWeapon = !!ma && !w.ranged && (names.includes('shortsword') || (w.category === 'simple' && !w.properties.some(p => p === 'two-handed' || p === 'heavy')));
    const mod = monkWeapon || w.properties.includes('finesse') ? Math.max(mods.str, mods.dex) : w.ranged ? mods.dex : mods.str;
    const kind = w.ranged ? 'ranged' : 'melee';
    const proficient = weaponProfs.has(w.category) || names.some(n => weaponProfs.has(n));
    const dmg = mod + (on ? (item.bonuses?.damage ?? 0) : 0) + bonus(`damage.${kind}`);
    const die = (d: string) => (monkWeapon ? withMa(d) : d) + signed(dmg);
    return {
      entryId: entry.id, name: item.name, damageType: w.damageType, properties: w.properties,
      toHit: mod + (proficient ? prof : 0) + (on ? (item.bonuses?.attack ?? 0) : 0) + bonus(`attack.${kind}`),
      damage: die(w.damage), ...(w.versatile && { versatile: die(w.versatile) }),
    };
  });
  const unarmedMod = ma ? Math.max(mods.str, mods.dex) : mods.str, unarmedDmg = unarmedMod + bonus('damage.melee');
  attacks.push({ entryId: 'unarmed', name: 'Unarmed Strike', toHit: unarmedMod + prof + bonus('attack.melee'),
    damage: maDie ? maDie + signed(unarmedDmg) : String(1 + unarmedDmg), damageType: 'bludgeoning', properties: [] });

  // Spellcasting
  const casters = classes.flatMap(x => [x.cls.spellcasting, x.sub?.spellcasting].filter((sc): sc is Spellcasting => !!sc).map(sc => ({ classId: x.cls.id, sc, level: x.level })));
  const spellcasting = casters.map(({ classId, sc, level }) => ({
    classId, ability: sc.ability,
    dc: override('spellDc', 8 + prof + mods[sc.ability] + bonus('spellDc') + itemBonus('spellDc')),
    attack: override('spellAttack', prof + mods[sc.ability] + bonus('attack.spell') + itemBonus('spellAttack')),
    cantrips: sc.cantrips?.[level - 1] ?? 0,
    ...(sc.known && { known: sc.known[level - 1] }),
    ...(sc.preparedFormula && { prepared: Math.max(1, num(sc.preparedFormula, classId)) }),
    maxLevel: maxSpellLevel(sc.progression, level),
  }));
  const slots = multiclassSlots(casters.map(x => ({ progression: x.sc.progression, level: x.level })));
  const pact = pactSlots(casters.filter(x => x.sc.progression === 'pact').reduce((t, x) => t + x.level, 0));

  // Resources
  const recharge = new Map(ofType(effects, 'resourceRecharge').map(r => [r.effect.name, r.effect.recharge]));
  // R27: one entry per name (multiclass Channel Divinity adds no uses): the highest max, the most frequent recharge.
  const OFTEN: Recharge[] = ['short', 'long', 'dawn', 'dusk', 'none'];
  const byName = new Map<string, Sheet['resources'][number]>();
  for (const { effect: e, classId } of ofType(effects, 'resource')) {
    const r = { name: e.name, max: num(e.max, classId), recharge: recharge.get(e.name) ?? e.recharge }, had = byName.get(e.name);
    byName.set(e.name, had ? { name: e.name, max: Math.max(had.max, r.max), recharge: OFTEN.indexOf(r.recharge) < OFTEN.indexOf(had.recharge) ? r.recharge : had.recharge } : r);
  }
  const resources = [...byName.values()];

  // Damage types and notes
  const dmgOf = (kind: 'resistance' | 'immunity' | 'vulnerability') => ofType(effects, 'damage').filter(d => d.effect.kind === kind).map(d => d.effect.damageType);
  const resistances = [...new Set([...(race?.resist ?? []), ...(sub?.resist ?? []), ...dmgOf('resistance')])];
  const notes = ofType(effects, 'note').map(n => ({ source: n.source, text: n.effect.text }));

  const attuned = attunedCount(c.inventory);
  if (attuned > ATTUNEMENT_LIMIT) warnings.add(`Attuned to more than ${ATTUNEMENT_LIMIT} items`);

  return {
    totalLevel, prof, scores, mods, saves, skills, passivePerception, initiative, ac, speed, maxHp, hitDice, attacks,
    spellcasting, slots, ...(pact && { pact }), resources,
    proficiencies: { armor: [...profs.armor], weapons: [...profs.weapons], tools: [...profs.tools], skills: [...profs.skills] as Skill[], languages: [...profs.languages] },
    resistances, immunities: [...new Set(dmgOf('immunity'))], vulnerabilities: [...new Set(dmgOf('vulnerability'))], notes,
    carrying: { weight, capacity: 15 * str, encumbrance }, attunedCount: attuned, overridden, warnings: [...warnings],
  };
}
