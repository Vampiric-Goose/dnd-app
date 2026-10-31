import { expect, test } from 'vitest';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { import5etools } from '../../src/lib/import/fivetools/index.ts';
import { entriesToRich, renderTags } from '../../src/lib/content/richtext.ts';
import { crXp, monsterXp } from '../../src/lib/rules/monsters.ts';
import type { MonsterDef, Pack } from '../../src/lib/types.ts';
import { run, runRaw } from '../fixtures/import.ts';
import { srdPackFixture } from '../fixtures/srdPack.ts';

// Every monster here is invented, in 5etools shape. TST is declared homebrew by `run`; runRaw takes official ids as given.
type Raw = Record<string, unknown>;
const mon = (o: Raw): Raw => ({
  source: 'TST', size: ['M'], type: 'giant', alignment: ['U'], ac: [12], hp: { average: 5, formula: '2d4' }, speed: { walk: 30 },
  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, passive: 10, cr: '1', ...o,
});
const monsters = (r: { packs: Pack[] }) => r.packs.flatMap(p => p.entities).filter((e): e is MonsterDef => e.kind === 'monster');
const byName = (r: { packs: Pack[] }, name: string) => monsters(r).find(m => m.name === name);

const glimmerfang = mon({
  name: 'Glimmerfang', size: ['S', 'M'],
  type: { type: 'humanoid', tags: ['goblinoid', { tag: 'shapechanger', prefix: 'Lesser' }] },
  alignmentPrefix: 'typically ', alignment: ['C', 'E'],
  ac: [{ ac: 15, from: ['{@item leather armor|phb}', '{@item shield|phb}'] }, { ac: 17, condition: 'with {@spell barkskin}', braces: true }],
  hp: { average: 22, formula: '4d8 + 4' },
  speed: { walk: 30, fly: { number: 40, condition: '(in bat form)' }, canHover: true },
  str: 10, dex: 14, con: 12, int: 9, wis: 11, cha: 13,
  save: { dex: '+4', wis: '+2' },
  skill: { stealth: '+6', 'sleight of hand': '+4', other: [{ oneOf: { arcana: '+3' } }] },
  vulnerable: ['radiant'],
  resist: ['cold', { resist: ['bludgeoning', 'piercing', 'slashing'], note: 'from nonmagical attacks', cond: true }],
  immune: ['poison'],
  conditionImmune: ['poisoned', { conditionImmune: ['charmed'], note: '(while hidden)', cond: true }],
  senses: ['darkvision 60 ft.', 'tremorsense 10 ft. while {@condition prone}'], passive: 12, languages: ['Common', 'Goblin'],
  cr: { cr: '2', lair: '3' },
  trait: [{ name: 'Sneaky', entries: ['The glimmerfang hides as a bonus action.'] }],
  action: [
    { name: 'Fang', entries: ['{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}5 ({@damage 1d6 + 2}) piercing damage. {@dc 13} Constitution save.'] },
    { name: 'Glow {@recharge 5}', entries: ['It glows.'] },
  ],
  bonus: [{ name: 'Skitter', entries: ['It skitters.'] }],
  reaction: [{ name: 'Flinch', entries: ['It flinches.'] }],
  legendary: [{ name: 'Blink', entries: ['It blinks 10 feet.'] }],
  legendaryActions: 2, legendaryHeader: ['The glimmerfang can take 2 legendary actions.'], mythicHeader: ['After a flare, it can use these.'],
  mythic: [{ name: 'Flare', entries: ['It flares.'] }],
  spellcasting: [
    { name: 'Innate Spellcasting', type: 'spellcasting', headerEntries: ['It casts:'], will: ['{@spell light}'],
      daily: { '1e': ['{@spell sleep}', '{@spell fog cloud}'], 3: ['{@spell blur}'] }, ability: 'cha' },
    { name: 'Spellcasting', type: 'spellcasting', headerEntries: ['A 3rd-level spellcaster.'], ability: 'int', displayAs: 'action',
      spells: { 0: { spells: ['{@spell mage hand}'] }, 1: { slots: 4, spells: ['{@spell shield}', '{@spell magic missile}'] }, 2: { slots: 1, spells: ['{@spell blur}'] } } },
  ],
  legendaryGroup: { name: 'Glimmer Nest', source: 'TST' },
  environment: ['forest'],
});
const nest = { name: 'Glimmer Nest', source: 'TST', lairActions: ['On initiative count 20, the nest glows.'], regionalEffects: ['Nearby milk sours.'] };

test('a full monster converts to a MonsterDef, each 5etools rule applied', async () => {
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [glimmerfang] }, 'bestiary/legendarygroups.json': { legendaryGroup: [nest] } });
  expect(r.errors).toEqual([]);
  const m = byName(r, 'Glimmerfang')!;
  expect(m.id).toBe('monster:glimmerfang@TST');
  expect(m.size).toEqual(['S', 'M']);
  expect(m.type).toBe('humanoid (goblinoid, Lesser shapechanger)');
  expect(m.alignment).toBe('typically chaotic evil');
  expect(m.ac).toEqual([{ value: 15, from: 'leather armor, shield' }, { value: 17, from: 'with barkskin' }]);
  expect(m.hp).toEqual({ average: 22, formula: '4d8 + 4' });
  expect(m.speed).toEqual({ walk: 30, fly: 40, hover: true, note: 'fly 40 ft. (in bat form)' });
  expect(m.scores).toEqual({ str: 10, dex: 14, con: 12, int: 9, wis: 11, cha: 13 });
  expect(m.saves).toEqual({ dex: 4, wis: 2 });
  expect(m.skills).toEqual({ stealth: 6, 'sleight-of-hand': 4 });
  expect(r.warnings.some(w => w.includes('Glimmerfang') && w.includes('"other"'))).toBe(true);
  expect(m.vulnerable).toEqual(['radiant']);
  expect(m.resist).toEqual(['cold', 'bludgeoning, piercing, and slashing from nonmagical attacks']);
  expect(m.immune).toEqual(['poison']);
  expect(m.conditionImmune).toEqual(['poisoned', 'charmed (while hidden)']);
  expect(m.senses).toEqual(['darkvision 60 ft.', 'tremorsense 10 ft. while prone']);
  expect(m.passive).toBe(12);
  expect(m.languages).toEqual(['Common', 'Goblin']);
  expect(m.cr).toBe('2');
  expect(m.traits.map(t => t.name)).toEqual(['Sneaky', 'Innate Spellcasting']);
  expect(m.actions[0].text).toEqual([{ p: '*Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 5 (1d6 + 2) piercing damage. DC 13 Constitution save.' }]);
  expect(m.actions[1].name).toBe('Glow (Recharge 5–6)');
  expect(m.bonusActions.map(t => t.name)).toEqual(['Skitter']);
  expect(m.reactions.map(t => t.name)).toEqual(['Flinch']);
  expect(m.legendary.map(t => t.name)).toEqual(['Blink']);
  expect(m.legendaryCount).toBe(2);
  expect(m.legendaryIntro).toEqual([{ p: 'The glimmerfang can take 2 legendary actions.' }]);
  expect(m.mythic?.map(t => t.name)).toEqual(['Flare']);
  expect(m.mythicIntro).toEqual([{ p: 'After a flare, it can use these.' }]);
  expect([m.xp, monsterXp(m)]).toEqual([undefined, crXp('2')]);
  expect(m.traits[1].text).toEqual([{ p: 'It casts:' }, { list: ['At will: light', '3/day: blur', '1/day each: sleep, fog cloud'] }]);
  // displayAs: 'action' puts the spellcasting among the actions
  expect(m.actions[2]).toEqual({ name: 'Spellcasting', text: [{ p: 'A 3rd-level spellcaster.' },
    { list: ['Cantrips (at will): mage hand', '1st level (4 slots): shield, magic missile', '2nd level (1 slot): blur'] }] });
  expect(m.lair).toEqual([{ p: 'On initiative count 20, the nest glows.' }]);
  expect(m.regional).toEqual([{ p: 'Nearby milk sours.' }]);
  expect(m.environment).toEqual(['forest']);
});

test('other type, alignment, hp, cr and legendary shapes', async () => {
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [
    mon({ name: 'Mote Swarm', type: { type: 'beast', swarmSize: 'T' }, alignment: ['A'], hp: { special: '40 + 5 per level' }, cr: 'Unknown',
      speed: { fly: 30 }, legendary: [{ name: 'Buzz', entries: ['It buzzes.'] }] }),
    mon({ name: 'Plain Ogre', alignment: [{ alignment: ['N', 'E'], chance: 50 }, { alignment: ['C', 'E'], chance: 50 }] }),
    mon({ name: 'Statue', alignment: ['U'], type: { type: { choose: ['construct', 'elemental'] } } }),
  ] } });
  expect(r.errors).toEqual([]);
  const swarm = byName(r, 'Mote Swarm')!;
  expect([swarm.type, swarm.alignment, swarm.hp, swarm.cr, swarm.speed, swarm.legendaryCount]).toEqual(
    ['swarm of Tiny beasts', 'any alignment', { special: '40 + 5 per level' }, '—', { walk: 0, fly: 30 }, 3]);
  expect(byName(r, 'Plain Ogre')!.alignment).toBe('neutral evil (50%) or chaotic evil (50%)');
  expect([byName(r, 'Statue')!.alignment, byName(r, 'Statue')!.type]).toEqual(['unaligned', 'construct or elemental']);
  expect(byName(r, 'Plain Ogre')!.legendaryCount).toBeUndefined();
});

const brute = mon({ name: 'Orc Brute', str: 16, skill: { athletics: '+5' }, action: [{ name: 'Club', entries: ['The orc brute swings a club.'] }] });
const chief = { name: 'Orc Chief', source: 'TST', _copy: { name: 'Orc Brute', source: 'TST', _mod: {
  '*': { mode: 'replaceTxt', replace: 'orc brute', with: 'orc chief', flags: 'gi' },
  action: { mode: 'appendArr', items: { name: 'Roar', entries: ['It roars.'] } },
  _: { mode: 'addSkills', skills: { intimidation: 1, perception: 2, athletics: 1 } },
} } };
const warlord = { name: 'Orc Warlord', source: 'TST', cr: '3', _copy: { name: 'Orc Chief', source: 'TST', _mod: {
  trait: { mode: 'prependArr', items: { name: 'Big', entries: ['It is big.'] } },
} } };

test('_copy with replaceTxt, appendArr and addSkills resolves, and so does a chain of two copies', async () => {
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [warlord, chief, brute] } });
  expect(r.errors).toEqual([]);
  const c = byName(r, 'Orc Chief')!;
  expect(c.actions.map(a => [a.name, a.text])).toEqual([['Club', [{ p: 'The orc chief swings a club.' }]], ['Roar', [{ p: 'It roars.' }]]]);
  // CR 1: proficiency +2. Intimidation 0 + 2, perception (expertise) 0 + 4; athletics +5 is already higher than 3 + 2, so it stays.
  expect(c.skills).toEqual({ athletics: 5, intimidation: 2, perception: 4 });
  const w = byName(r, 'Orc Warlord')!;
  expect([w.cr, w.traits.map(t => t.name), w.actions.map(a => a.name), w.actions[0].text]).toEqual(
    ['3', ['Big'], ['Club', 'Roar'], [{ p: 'The orc chief swings a club.' }]]);
});

test('Review Focus 1: a _copy whose base is not in the import is an error naming the base; the rest of the pack imports', async () => {
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [{ name: 'Lost Orc', source: 'TST', _copy: { name: 'Orc Brute', source: 'MM' } }, brute] } });
  expect(r.errors).toEqual([{ file: 'bestiary/bestiary-tst.json', message: 'monster "Lost Orc": _copy source "Orc Brute" (MM) not found' }]);
  expect(monsters(r).map(m => m.name)).toEqual(['Orc Brute']);
});

test('a missing template fails its monster like a missing _copy base; a missing legendary group only drops the lair text', async () => {
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [
    brute,
    { name: 'Lesser Orc', source: 'TST', _copy: { name: 'Orc Brute', source: 'TST', _templates: [{ name: 'Lesser', source: 'DMG' }] } },
    mon({ name: 'Den Orc', legendaryGroup: { name: 'Orc Den', source: 'MM' } }),
  ] } });
  expect(r.errors).toEqual([{ file: 'bestiary/bestiary-tst.json', message: 'monster "Lesser Orc": template "Lesser" (DMG) not found' }]);
  expect(monsters(r).map(m => m.name)).toEqual(['Orc Brute', 'Den Orc']);
  expect(r.warnings).toContain('bestiary/bestiary-tst.json: monster "Den Orc": legendary group "Orc Den" (MM) not found; ignored');
});

test('Review Focus 2:2024 monsters, bases, templates and legendary groups never produce a monster or text', async () => {
  const r = await runRaw({
    'bestiary/bestiary-xmm.json': { monster: [mon({ name: 'New Ogre', source: 'XMM', action: [{ name: 'Smash', entries: ['NEW-OGRE-TEXT'] }] })] },
    'bestiary/bestiary-mm.json': { monster: [
      { name: 'Old Ogre', source: 'MM', _copy: { name: 'New Ogre', source: 'XMM' } },
      mon({ name: 'Plain Ogre', source: 'MM' }),
      { name: 'Shiny Ogre', source: 'MM', _copy: { name: 'Plain Ogre', source: 'MM', _templates: [{ name: 'Shiny', source: 'XMM' }] } },
      mon({ name: 'Den Ogre', source: 'MM', legendaryGroup: { name: 'Ogre Den', source: 'XMM' } }),
    ] },
    'bestiary/template.json': { monsterTemplate: [{ name: 'Shiny', source: 'XMM', apply: { _root: { type: 'fey' }, _mod: { trait: { mode: 'appendArr', items: { name: 'Shine', entries: ['SHINY-TEXT'] } } } } }] },
    'bestiary/legendarygroups.json': { legendaryGroup: [{ name: 'Ogre Den', source: 'XMM', lairActions: ['DEN-TEXT'] }] },
  });
  expect(r.errors).toEqual([]);
  expect(monsters(r).map(m => m.name).sort()).toEqual(['Den Ogre', 'Plain Ogre', 'Shiny Ogre']);
  expect(r.packs.map(p => p.source)).toEqual(['MM']);
  const all = JSON.stringify(r.packs);
  for (const s of ['NEW-OGRE-TEXT', 'SHINY-TEXT', 'DEN-TEXT', '"fey"']) expect(all).not.toContain(s);
  expect(byName(r, 'Shiny Ogre')!.type).toBe('giant');
  expect(byName(r, 'Den Ogre')!.lair).toBeUndefined();
  expect(r.warnings.some(w => w.includes('Old Ogre') && w.includes('XMM'))).toBe(true);
  expect(r.warnings.some(w => w.includes('Shiny Ogre') && w.includes('"Shiny" (XMM)') && w.includes('ignored'))).toBe(true);
  expect(r.warnings.some(w => w.includes('Den Ogre') && w.includes('"Ogre Den" (XMM)') && w.includes('ignored'))).toBe(true);
  expect(r.skipped.rules2024Kinds.monster).toBe(2); // New Ogre itself and Old Ogre, its copy
});

test('a _templates copy gets the template\'s _root fields and _mod changes; a template may itself be a copy', async () => {
  const r = await run({
    'bestiary/bestiary-tst.json': { monster: [
      mon({ name: 'Plain Ogre', resist: ['fire'] }),
      { name: 'Frost Ogre', source: 'TST', _copy: { name: 'Plain Ogre', source: 'TST', _templates: [{ name: 'Frosty', source: 'TST' }] } },
      { name: 'Deep Frost Ogre', source: 'TST', _copy: { name: 'Plain Ogre', source: 'TST', _templates: [{ name: 'Deep Frosty', source: 'TST' }] } },
    ] },
    'bestiary/template.json': { monsterTemplate: [
      { name: 'Frosty', source: 'TST', apply: { _root: { type: 'elemental' }, _mod: {
        resist: { mode: 'appendIfNotExistsArr', items: ['cold', 'fire'] },
        _: { mode: 'addSenses', senses: { type: 'darkvision', range: 60 } },
      } } },
      { name: 'Deep Frosty', source: 'TST', _copy: { name: 'Frosty', source: 'TST', _mod: { _: { mode: 'setProp', prop: 'apply._root.type', value: 'ooze' } } } },
    ] },
  });
  expect(r.errors).toEqual([]);
  const f = byName(r, 'Frost Ogre')!;
  expect([f.type, f.resist, f.senses]).toEqual(['elemental', ['fire', 'cold'], ['darkvision 60 ft.']]);
  expect(byName(r, 'Deep Frost Ogre')!.type).toBe('ooze');
  expect(monsters(r)).toHaveLength(3); // templates are not monsters
});

test('addSpells adds to the right spellcasting group, removeSpells removes, replaceSpells swaps', async () => {
  const caster = mon({ name: 'Hedge Witch', spellcasting: [{ name: 'Spellcasting', headerEntries: ['It casts:'], will: ['{@spell light}'],
    daily: { '1e': ['{@spell fly}', '{@spell haste}'] }, spells: { 1: { slots: 2, spells: ['{@spell shield}'] } } }] });
  const copy = { name: 'Grand Witch', source: 'TST', _copy: { name: 'Hedge Witch', source: 'TST', _mod: { _: [
    { mode: 'addSpells', spells: { 1: { spells: ['{@spell sleep}'] }, 3: { slots: 1, spells: ['{@spell fireball}'] } }, will: ['{@spell mage hand}'] },
    { mode: 'removeSpells', daily: { '1e': ['{@spell haste}'] } },
    { mode: 'replaceSpells', spells: { 1: [{ replace: '{@spell shield}', with: '{@spell grease}' }] } },
  ] } } };
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [caster, copy] } });
  expect(r.errors).toEqual([]);
  expect(byName(r, 'Grand Witch')!.traits[0].text[1]).toEqual({ list: ['At will: light, mage hand', '1/day each: fly', '1st level (2 slots): grease, sleep', '3rd level (1 slot): fireball'] });
  expect(byName(r, 'Hedge Witch')!.traits[0].text[1]).toEqual({ list: ['At will: light', '1/day each: fly, haste', '1st level (2 slots): shield'] });
});

test('scalar modes and maxSize (as the Reduced Threat template uses them)', async () => {
  const big = mon({ name: 'Big Ogre', size: ['H'], hp: { average: 45, formula: '6d12 + 6' }, save: { con: '+5' }, skill: { athletics: '+6' },
    action: [{ name: 'Slam', entries: ['{@atk mw} {@hit 6} to hit. {@dc 14} Strength save.'] }] });
  const r = await run({
    'bestiary/bestiary-tst.json': { monster: [big, { name: 'Small Ogre', source: 'TST', _copy: { name: 'Big Ogre', source: 'TST', _templates: [{ name: 'Lesser', source: 'TST' }, { name: 'Halved', source: 'TST' }] } }] },
    'bestiary/template.json': { monsterTemplate: [{ name: 'Lesser', source: 'TST', apply: { _mod: {
      _: { mode: 'maxSize', max: 'L' },
      hp: [{ mode: 'scalarMultProp', prop: 'average', scalar: 0.5, floor: true }, { mode: 'prefixSuffixStringProp', prop: 'formula', prefix: 'half of ', suffix: '' }],
      save: { mode: 'scalarAddProp', prop: '*', scalar: -2 }, skill: { mode: 'scalarAddProp', prop: '*', scalar: -2 },
      action: [{ mode: 'scalarAddHit', scalar: -2 }, { mode: 'scalarAddDc', scalar: -2 }],
    } } }, { name: 'Halved', source: 'TST', apply: { _mod: { _: { mode: 'scalarMultXp', scalar: 0.5, floor: true } } } }] },
  });
  expect(r.errors).toEqual([]);
  const s = byName(r, 'Small Ogre')!;
  expect([s.size, s.hp, s.saves, s.skills, s.actions[0].text]).toEqual([['L'], { average: 22, formula: 'half of 6d12 + 6' }, { con: 3 }, { athletics: 4 },
    [{ p: '*Melee Weapon Attack:* +4 to hit. DC 12 Strength save.' }]]);
  expect([s.xp, monsterXp(s), monsterXp(byName(r, 'Big Ogre')!)]).toEqual([100, 100, 200]); // CR 1 is 200 XP; scalarMultXp halves it
});

test('an official monster marked srd and named like an SRD monster patches it (alias) instead of duplicating', async () => {
  const srd: Pack = { ...srdPackFixture, entities: [...srdPackFixture.entities,
    { kind: 'monster', id: 'monster:cave-lurker@SRD', name: 'Cave Lurker', source: 'SRD', srd: true, text: [], size: ['M'], type: 'monstrosity', alignment: 'unaligned',
      ac: [{ value: 12 }], hp: { average: 5, formula: '2d4' }, speed: { walk: 30 }, scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: {},
      vulnerable: [], resist: [], immune: [], conditionImmune: [], senses: [], passive: 10, languages: [], cr: '1', traits: [], actions: [], bonusActions: [], reactions: [], legendary: [] }] };
  const r = await import5etools([{ name: 'bestiary/bestiary-mm.json', json: { monster: [mon({ name: 'Cave Lurker', source: 'MM', srd: true }), mon({ name: 'Cave Shrieker', source: 'MM' })] } }],
    { index: new ContentIndex([srd]), rawLookup: async () => undefined });
  expect(r.errors).toEqual([]);
  const mm = r.packs.find(p => p.source === 'MM')!;
  expect(mm.patches).toEqual([{ targetId: 'monster:cave-lurker@SRD', alias: 'MM' }]);
  expect(mm.entities.map(e => e.id)).toEqual(['monster:cave-shrieker@MM']);

  // M4: the SRD has no lair actions; the book monster's legendary group reaches the SRD monster through its patch.
  const withLair = await import5etools([
    { name: 'bestiary/bestiary-mm.json', json: { monster: [mon({ name: 'Cave Lurker', source: 'MM', srd: true, legendaryGroup: { name: 'Lurker Cave', source: 'MM' } })] } },
    { name: 'bestiary/legendarygroups.json', json: { legendaryGroup: [{ name: 'Lurker Cave', source: 'MM', lairActions: ['Stalactites fall.'], regionalEffects: ['Echoes linger.'] }] } },
  ], { index: new ContentIndex([srd]), rawLookup: async () => undefined });
  const patch = withLair.packs[0].patches[0];
  expect(patch).toEqual({ targetId: 'monster:cave-lurker@SRD', alias: 'MM', lair: [{ p: 'Stalactites fall.' }], regional: [{ p: 'Echoes linger.' }] });
  const lurker = new ContentIndex([srd, ...withLair.packs]).get('monster:cave-lurker@SRD') as MonsterDef;
  expect([lurker.lair, lurker.regional, lurker.aliases]).toEqual([[{ p: 'Stalactites fall.' }], [{ p: 'Echoes linger.' }], ['MM']]);
});

test('template variables are filled from the finished monster; an unknown one is left as written with one warning', async () => {
  const fiendish = { name: 'Fiendish', source: 'TST', apply: { _mod: { trait: { mode: 'appendArr', items: { name: 'Hellish Rebuke', entries: [
    '<$title_short_name$> rebukes; <$short_name$> glows. Save {@dc <$spell_dc__cha$>}. {@hit <$to_hit__str$>} to hit, <$damage_avg__2.5+str$> ({@damage 1d4<$damage_mod__str$>}). <$bogus$>',
  ] } } } } };
  const r = await run({
    'bestiary/bestiary-tst.json': { monster: [
      mon({ name: 'Grim Ogre', cr: '5', str: 14, cha: 16 }),
      mon({ name: 'Vex', isNamedCreature: true, isNpc: true, cr: '1/2', str: 10, cha: 10 }),
      { name: 'Fiendish Ogre', source: 'TST', _copy: { name: 'Grim Ogre', source: 'TST', _templates: [{ name: 'Fiendish', source: 'TST' }] } },
      { name: 'Fiendish Vex', source: 'TST', isNamedCreature: true, _copy: { name: 'Vex', source: 'TST', _templates: [{ name: 'Fiendish', source: 'TST' }] } },
    ] },
    'bestiary/template.json': { monsterTemplate: [fiendish] },
  });
  expect(r.errors).toEqual([]);
  // CR 5: proficiency +3. Cha 16 (+3): DC 8 + 3 + 3 = 14. Str 14 (+2): +5 to hit, 1d4 + 2, average floor(2.5 + 2) = 4.
  expect(byName(r, 'Fiendish Ogre')!.traits[0].text).toEqual([{ p: 'The fiendish ogre rebukes; the fiendish ogre glows. Save DC 14. +5 to hit, 4 (1d4 + 2). <$bogus$>' }]);
  // A named creature takes no "the"; CR 1/2: +2, modifiers 0.
  expect(byName(r, 'Fiendish Vex')!.traits[0].text).toEqual([{ p: 'Fiendish rebukes; Fiendish glows. Save DC 10. +2 to hit, 2 (1d4). <$bogus$>' }]);
  expect(r.warnings.filter(w => w.includes('<$bogus$>'))).toHaveLength(1);
});

test('an explicit cr.xp is kept as the monster\'s XP', async () => {
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [mon({ name: 'Harmless Mote', cr: { cr: '0', xp: 0 } })] } });
  const m = byName(r, 'Harmless Mote')!;
  expect([m.cr, m.xp, monsterXp(m)]).toEqual(['0', 0, 0]);
});

test('attack tags and list-item names render as the book prints them', () => {
  expect(['mw,rw', 'ms,rs', 'm,r', 'ms', 'rs'].map(a => renderTags(`{@atk ${a}}`))).toEqual([
    '*Melee or Ranged Weapon Attack:*', '*Melee or Ranged Spell Attack:*', '*Melee or Ranged Attack:*', '*Melee Spell Attack:*', '*Ranged Spell Attack:*']);
  expect(renderTags('{@hitYourSpellAttack} to hit')).toBe('your spell attack modifier to hit');
  expect(renderTags('{@hitYourSpellAttack Bonus equals your spell attack modifier} to hit')).toBe('Bonus equals your spell attack modifier to hit');
  expect(entriesToRich([{ type: 'list', items: [{ type: 'item', name: 'Charm Ray:', entry: 'Swap it.' }, { type: 'item', name: 'Sleep Ray', entry: 'Doze.' }] }]))
    .toEqual([{ list: ['**Charm Ray:** Swap it.', '**Sleep Ray.** Doze.'] }]);
});

test('untrusted _mod keys cannot reach Object.prototype', async () => {
  const caster = mon({ name: 'Hedge Witch', spellcasting: [{ name: 'Spellcasting', spells: { 1: { slots: 2, spells: ['{@spell shield}'] } } }] });
  const evil = JSON.parse('{"mode":"addSpells","spells":{"__proto__":{"polluted":["x"]}},"daily":{"__proto__":["y"]}}');
  const skills = JSON.parse('{"mode":"addSkills","skills":{"__proto__":1,"constructor":1}}');
  const r = await run({ 'bestiary/bestiary-tst.json': { monster: [caster, { name: 'Evil Witch', source: 'TST', _copy: { name: 'Hedge Witch', source: 'TST', _mod: { _: [evil, skills] } } }] } });
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  expect(byName(r, 'Evil Witch')).toBeDefined();
});
