import { expect, test } from 'vitest';
import { richToPlain } from '../../src/lib/content/richtext.ts';
import { mergePack } from '../../src/lib/import/fivetools/index.ts';
import type { BackgroundDef, FeatDef, ItemDef, Pack, RaceDef, SpellDef, SubraceDef } from '../../src/lib/types.ts';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { import5etools } from '../../src/lib/import/fivetools/index.ts';
import { asTst, readFixture, run } from '../fixtures/import.ts';
import { srdPackFixture } from '../fixtures/srdPack.ts';

test('races, subraces, choices', async () => {
  const r = await run({ 'races.json': readFixture('races.json') });
  const tst = r.packs.find(p => p.source === 'TST')!;
  expect(tst.entities.find(e => e.id === 'race:testfolk@TST')).toMatchObject({ abilityBonuses: { str: 2 }, choices: [{ type: 'ability', count: 1, amount: 1, from: ['dex', 'con'] }] });
  expect(tst.entities.find(e => e.id === 'subrace:hill-testfolk@TST')).toMatchObject({ raceId: 'race:testfolk@TST' });
});

test('race details: speed, proficiencies, traits; nameless subrace skipped', async () => {
  const r = await run({ 'races.json': readFixture('races.json') });
  const tst = r.packs.find(p => p.source === 'TST')!;
  const race = tst.entities.find(e => e.id === 'race:testfolk@TST') as RaceDef;
  expect(race).toMatchObject({
    size: 'M', speed: { walk: 30, climb: 30 }, darkvision: 60, resist: ['fire'],
    proficiencies: { skills: ['perception'], languages: ['Common', 'Deep Speech'], tools: ["tinker's tools"], weapons: ['battleaxe'], armor: ['light'] },
  });
  expect(race.traits).toEqual([{ name: 'Climber', text: [{ p: 'You can climb at your walking speed. See prone.' }] }]);
  expect(tst.entities.filter(e => e.kind === 'subrace')).toHaveLength(1);
  expect((tst.entities.find(e => e.kind === 'subrace') as SubraceDef).abilityBonuses).toEqual({ wis: 1 });
  expect(r.raw.map(([k]) => k)).toContain('race|testfolk|TST');
  expect(r.errors).toEqual([]);
});

test('subrace overwrite: explicit (5etools `overwrite`, trait `data.overwrite`) and implicit (the race has no ability of its own, like PHB Human)', async () => {
  const r = await run({ 'races.json': readFixture('races-human.json') });
  const subs = r.packs.flatMap(p => p.entities).filter(e => e.kind === 'subrace') as SubraceDef[];
  const by = (name: string) => subs.find(s => s.name === name)!;
  expect(subs.map(s => s.name).sort()).toEqual(['Testelf (Variant; Testdrow Descent)', 'Testhuman (Variant; Mark of Testing)', 'Variant Testhuman', 'Wood Testelf']);
  expect(by('Variant Testhuman')).toMatchObject({ overwrite: ['ability'], choices: [{ type: 'ability', count: 2, amount: 1 }, { type: 'skill', count: 1 }, { type: 'feat' }] }); // its 5etools `feats: [{ any: 1 }]`
  expect(by('Testhuman (Variant; Mark of Testing)')).toMatchObject({ overwrite: ['ability', 'languages'], overwriteTraits: ['Languages'], abilityBonuses: { con: 1, wis: 2 } });
  expect(by('Testelf (Variant; Testdrow Descent)')).toMatchObject({ overwrite: ['ability', 'skills'], overwriteTraits: ['Skill Versatility'], speed: { walk: 35 } });
  expect(by('Wood Testelf').overwrite).toBeUndefined();
  expect(r.errors).toEqual([]);
});

test('a nameless subrace (PHB Human standard) becomes its race own: the race carries the +1s, no unnamed subrace, and it is kept raw', async () => {
  const r = await run({ 'races.json': readFixture('races-human.json') });
  const human = r.packs.flatMap(p => p.entities).find(e => e.kind === 'race' && e.name === 'Testhuman') as RaceDef;
  expect(human.abilityBonuses).toEqual({ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 });
  expect(r.packs.flatMap(p => p.entities).filter(e => e.kind === 'subrace' && !e.name.trim())).toEqual([]);
  expect(r.raw.map(([k]) => k)).toContain('subrace|(testhuman)|TST');
});

test('SRD overlap becomes a patch; 2024 is dropped', async () => {
  const r = await run({ 'x.json': { race: [{ name: 'Dwarf', source: 'PHB', srd: true, size: ['M'], speed: 25, entries: ['Full text.'] }], spell: [{ name: 'Fireball', source: 'XPHB', level: 3 }] } });
  const phb = r.packs.find(p => p.source === 'PHB')!;
  expect(phb.patches).toEqual([{ targetId: 'race:dwarf@SRD', alias: 'PHB', text: [{ p: 'Full text.' }] }]);
  expect(phb.entities.some(e => e.id === 'race:dwarf@PHB')).toBe(false);
  expect(r.skipped2024).toBe(1);
  expect(r.skipped.rules2024).toEqual({ XPHB: 1 });
});

test('an empty-text SRD overlap patches only the alias; lineage races get the custom-lineage choice', async () => {
  const r = await run({ 'x.json': { baseitem: [{ name: 'Longsword', source: 'PHB', srd: true, type: 'M', weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S' }],
    race: [{ name: 'Linefolk', source: 'TST', lineage: 'VRGR', size: ['S', 'M'], speed: 30, entries: [] }] } });
  expect(r.packs.find(p => p.source === 'PHB')!.patches).toEqual([{ targetId: 'item:longsword@SRD', alias: 'PHB' }]);
  expect(r.packs.find(p => p.source === 'TST')!.entities[0].choices).toEqual([
    { type: 'ability', count: 1, amount: 2, from: ['str', 'dex', 'con', 'int', 'wis', 'cha'] },
    { type: 'ability', count: 1, amount: 1, from: ['str', 'dex', 'con', 'int', 'wis', 'cha'] },
  ]);
});

test('edition "one" is dropped; pack names come from books.json', async () => {
  const r = await run({ 'books.json': { book: [{ id: 'TST', name: 'The Test Book' }] },
    'f.json': { feat: [{ name: 'Newfeat', source: 'TST', edition: 'one', entries: [] }, { name: 'Oldfeat', source: 'TST', entries: [] }] } });
  expect(r.skipped2024).toBe(1);
  expect(r.packs).toHaveLength(1);
  expect(r.packs[0]).toMatchObject({ id: 'pack:TST', name: 'The Test Book', source: 'TST' });
  expect(r.packs[0].entities.map(e => e.name)).toEqual(['Oldfeat']);
});

test('schema drift: piped codes, both spell-class styles', async () => {
  const r = await run({ 'items-base.json': { baseitem: [{ name: 'Testblade', source: 'TST', type: 'M|XPHB', weaponCategory: 'martial', property: ['F|XPHB', 'L'], dmg1: '1d6', dmgType: 'S|XPHB', weight: 2, value: 1000 }] },
    'spells-tst.json': { spell: [{ name: 'Testball', source: 'TST', level: 3, school: 'V', time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 150 } }, components: { v: true, s: true, m: 'a pinch of sulfur' }, duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }], entries: ['Boom.'], classes: { fromClassList: [{ name: 'Wizard', source: 'PHB' }] } },
      { name: 'Testlight', source: 'TST', level: 0, school: 'E', time: [{ number: 1, unit: 'bonus' }], range: { type: 'point', distance: { type: 'touch' } }, components: { v: true }, duration: [{ type: 'instant' }], entries: ['Glow.'] }] },
    'sources.json': { TST: { Testlight: { class: [{ name: 'Cleric', source: 'PHB' }] } } } });
  const all = r.packs.flatMap(p => p.entities);
  expect(all.find(e => e.name === 'Testblade')).toMatchObject({ type: 'weapon', weapon: { properties: ['finesse', 'light'], damageType: 'slashing' }, costCp: 1000 });
  expect(all.find(e => e.name === 'Testball')).toMatchObject({ range: '150 feet', duration: 'Concentration, up to 1 minute', concentration: true, castingTime: '1 action', classes: ['wizard'], school: 'evocation' });
  expect(all.find(e => e.name === 'Testlight')).toMatchObject({ classes: ['cleric'], castingTime: '1 bonus action', range: 'Touch', duration: 'Instantaneous' });
  expect(r.errors).toEqual([]);
});

test('spells keep their book mechanics', async () => {
  const r = await run({ 'spells.json': { spell: [
    { name: 'Testgrip', source: 'TST', level: 2, school: 'E', range: { type: 'radius', distance: { type: 'feet', amount: 10 } }, entries: ['Grip.'],
      savingThrow: ['wisdom'], spellAttack: ['R'], damageInflict: ['fire', 'cold'], conditionInflict: ['paralyzed'],
      scalingLevelDice: { label: 'x', scaling: { 1: '1d6', 5: '2d6' } } },
    { name: 'Testplain', source: 'TST', level: 1, school: 'A', range: { type: 'point', distance: { type: 'feet', amount: 30 } }, entries: ['Plain.'] },
  ] } });
  const of = (n: string) => r.packs.flatMap(p => p.entities).find(e => e.name === n) as SpellDef;
  expect(of('Testgrip').mech).toEqual({ save: ['wis'], attack: 'ranged', types: ['fire', 'cold'], conditions: ['Paralyzed'], scaling: { 1: '1d6', 5: '2d6' }, area: { shape: 'sphere', feet: 10 } });
  expect('mech' in of('Testplain')).toBe(false);
});

test('an SRD-overlap patch carries the mechanics onto the SRD spell', async () => {
  const srd: Pack = JSON.parse((await import('node:fs')).readFileSync('src/data/srd.json', 'utf8'));
  const r = await import5etools([{ name: 'spells.json', json: { spell: [{ name: 'Fireball', source: 'PHB', srd: true, level: 3, school: 'V', entries: ['Boom.'], savingThrow: ['dexterity'] }] } }],
    { index: new ContentIndex([srd]), rawLookup: async () => undefined });
  const phb = r.packs.find(p => p.source === 'PHB')!;
  expect(phb.patches[0]).toMatchObject({ targetId: 'spell:fireball@SRD', mech: { save: ['dex'] } });
  expect((new ContentIndex([srd, phb]).get('spell:fireball@SRD') as SpellDef).mech).toEqual({ save: ['dex'] });
});

test('spells: generated spell-source lookup shape, reaction, area range, ritual, higher levels', async () => {
  const r = await run({
    'spells.json': { spell: [{ name: 'Testward', source: 'TST', level: 1, school: 'A', time: [{ number: 1, unit: 'reaction', condition: 'which you take when you are hit' }],
      range: { type: 'cone', distance: { type: 'feet', amount: 60 } }, components: { s: true, m: { text: 'a gem worth 50 gp', cost: 5000 } },
      duration: [{ type: 'permanent', ends: ['dispel'] }], meta: { ritual: true }, entries: ['Ward.'],
      entriesHigherLevel: [{ type: 'entries', name: 'At Higher Levels', entries: ['More {@dice 1d6}.'] }] }] },
    'gendata-spell-source-lookup.json': { tst: { testward: { class: { PHB: { Wizard: true, Sorcerer: true }, XPHB: { Druid: true } } } } },
  });
  const s = r.packs.flatMap(p => p.entities).find(e => e.name === 'Testward') as SpellDef;
  expect(s).toMatchObject({ castingTime: '1 reaction, which you take when you are hit', range: 'Self (60-foot cone)', duration: 'Until dispelled', ritual: true,
    school: 'abjuration', components: { s: true, m: 'a gem worth 50 gp' }, higherLevels: [{ p: 'More 1d6.' }] });
  expect([...s.classes].sort()).toEqual(['sorcerer', 'wizard']);
});

test('items: armor, shield, category, magic fields, base item', async () => {
  const r = await run({ 'items-base.json': { baseitem: [
    { name: 'Testmail', source: 'TST', type: 'MA', ac: 14, value: 5000, weight: 20, stealth: true },
    { name: 'Testplate', source: 'TST', type: 'HA', ac: 18, strength: '15' },
    { name: 'Testleather', source: 'TST', type: 'LA', ac: 11 },
    { name: 'Testshield', source: 'TST', type: 'S|XPHB' },
    { name: 'Testorb', source: 'TST', type: 'SCF', scfType: 'arcane' },
    { name: 'Testlute', source: 'TST', type: 'INS' },
    { name: 'Testbow', source: 'TST', type: 'R', weaponCategory: 'simple', property: ['A', '2H'], range: '80/320', dmg1: '1d6', dmgType: 'P' },
  ] }, 'items.json': { item: [
    { name: 'Testwand', source: 'TST', type: 'WD', rarity: 'rare', reqAttune: 'by a wizard', charges: 7, recharge: 'dawn', rechargeAmount: '{@dice 1d6 + 1}', bonusSpellAttack: '+2', entries: ['Zap.'] },
    { name: 'Testcloak', source: 'TST', wondrous: true, rarity: 'uncommon', bonusAc: '+1', bonusSavingThrow: '+1', reqAttune: true },
    { name: 'Testlongsword', source: 'TST', baseItem: 'longsword|phb', type: 'M', weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S', rarity: 'none' },
  ] } });
  const by = (n: string) => r.packs.flatMap(p => p.entities).find(e => e.name === n) as ItemDef;
  expect(by('Testmail')).toMatchObject({ type: 'armor', costCp: 5000, armor: { category: 'medium', ac: 14, dexCap: 2, stealthDisadvantage: true } });
  expect(by('Testplate').armor).toEqual({ category: 'heavy', ac: 18, dexCap: 0, strReq: 15 });
  expect(by('Testleather').armor).toEqual({ category: 'light', ac: 11 });
  expect(by('Testshield')).toMatchObject({ type: 'shield', armor: { category: 'shield', ac: 2 } });
  expect(by('Testorb')).toMatchObject({ type: 'gear', category: 'arcane-foci' });
  expect(by('Testlute')).toMatchObject({ type: 'tool', category: 'musical-instruments' });
  expect(by('Testbow').weapon).toEqual({ category: 'simple', ranged: true, damage: '1d6', damageType: 'piercing', properties: ['ammunition', 'two-handed'], range: [80, 320] });
  expect(by('Testwand')).toMatchObject({ type: 'wand', magic: true, rarity: 'rare', attunement: 'by a wizard', charges: { max: 7, recharge: 'dawn', rechargeAmount: '1d6 + 1' }, bonuses: { spellAttack: 2 } });
  expect(by('Testcloak')).toMatchObject({ type: 'wondrous', attunement: true, bonuses: { ac: 1, save: 1 } });
  expect(by('Testlongsword')).toMatchObject({ magic: false, baseItemId: 'item:longsword@SRD' });
});

test('magic variants expand; excludes respected', async () => {
  const base = { name: 'Testsword', source: 'TST', type: 'M', weapon: true, weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S' };
  const variant = (excludes?: object) => ({ magicvariant: [{ name: '+1 Weapon', requires: [{ weapon: true }], excludes, inherits: { namePrefix: '+1 ', source: 'TST', rarity: 'uncommon', bonusWeapon: '+1', entries: ['A +1 {=baseName}.'] } }] });
  const ok = (await run({ 'b.json': { baseitem: [base] }, 'v.json': variant() })).packs.flatMap(p => p.entities);
  expect(ok.find(e => e.name === '+1 Testsword')).toMatchObject({ bonuses: { attack: 1, damage: 1 }, rarity: 'uncommon', magic: true });
  const no = (await run({ 'b.json': { baseitem: [base] }, 'v.json': variant({ name: ['Testsword'] }) })).packs.flatMap(p => p.entities);
  expect(no.some(e => e.name === '+1 Testsword')).toBe(false);
});

test('a generated variant is never a base for another variant (no "Adamantine Adamantine Longsword")', async () => {
  const base = { name: 'Testsword', source: 'TST', type: 'M', weapon: true, weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S' };
  const adamantine = { name: 'Adamantine Weapon', requires: [{ weapon: true }], inherits: { namePrefix: 'Adamantine ', source: 'TST', rarity: 'unknown', entries: ['Hard.'] } };
  const plus3 = { name: '+3 Weapon', requires: [{ weapon: true }], inherits: { namePrefix: '+3 ', source: 'TST', rarity: 'very rare', bonusWeapon: '+3', entries: ['Sharp.'] } };
  const first = await run({ 'b.json': { baseitem: [base] }, 'v.json': { magicvariant: [adamantine] } });
  expect(first.packs.flatMap(p => p.entities).find(e => e.name === 'Adamantine Testsword')).toMatchObject({ magic: false, baseItemId: 'item:testsword@TST' });
  // Importing again (another book, or the same one) runs the variants against the stored items too.
  const index = new ContentIndex([srdPackFixture, ...first.packs]);
  const again = await import5etools([{ name: 'v.json', json: asTst({ magicvariant: [adamantine, plus3] }) }], { index, rawLookup: async () => undefined });
  const names = again.packs.flatMap(p => p.entities).map(e => e.name);
  expect(names).toContain('+3 Testsword');
  expect(names.filter(n => /Adamantine.*Adamantine|\+3 Adamantine/.test(n))).toEqual([]);
});

test('magic variant details: text, base stats, index bases, type requirement', async () => {
  const r = await run({ 'v.json': { magicvariant: [{ name: 'Flame Weapon', requires: [{ type: 'M' }], inherits: { nameSuffix: ' of Flame', source: 'TST', rarity: 'rare', reqAttune: true, entries: ['This {=baseName/l} burns.'] } }] } });
  const flame = r.packs.flatMap(p => p.entities).find(e => e.name === 'Longsword of Flame') as ItemDef;
  expect(flame).toMatchObject({ id: 'item:longsword-of-flame@TST', source: 'TST', baseItemId: 'item:longsword@SRD', attunement: true, weapon: { damage: '1d8', damageType: 'slashing' } });
  expect(flame.text).toEqual([{ p: 'This longsword burns.' }]);
});

test('backgrounds, feats, optional features, conditions', async () => {
  const r = await run({
    'backgrounds.json': { background: [{ name: 'Tester', source: 'TST', skillProficiencies: [{ insight: true, 'sleight of hand': true }], languageProficiencies: [{ anyStandard: 2 }],
      toolProficiencies: [{ "thieves' tools": true }],
      startingEquipment: [{ _: ['common clothes|phb', { item: 'pouch|phb', containsValue: 1500 }], a: [{ special: 'a lucky coin' }], b: [{ value: 500 }] }],
      entries: [{ type: 'entries', name: 'Feature: Test Access', data: { isFeature: true }, entries: ['You can get in.'] }, { type: 'entries', name: 'Suggested Characteristics', entries: ['Be testy.'] }] }] },
    'feats.json': { feat: [
      { name: 'Testy', source: 'TST', prerequisite: [{ ability: [{ str: 13 }], race: [{ name: 'testfolk' }] }, { spellcasting: true }], ability: [{ con: 1 }], entries: ['Gain stuff.'] },
      { name: 'Choosy', source: 'TST', prerequisite: [{ level: 4, other: 'a test' }], ability: [{ choose: { from: ['int', 'wis'], amount: 1 } }], entries: [] },
    ] },
    'optionalfeatures.json': { optionalfeature: [{ name: 'Test Invocation', source: 'TST', featureType: ['EI'], prerequisite: [{ level: { level: 5, class: { name: 'Warlock' } }, spell: ['eldritch blast#c'] }], entries: ['Zap more.'] }] },
    'conditionsdiseases.json': { condition: [{ name: 'Testy', source: 'TST', entries: [{ type: 'list', items: ['You test.'] }] }], disease: [{ name: 'Testpox', source: 'TST', entries: [] }] },
  });
  const all = r.packs.flatMap(p => p.entities);
  const bg = all.find(e => e.kind === 'background') as BackgroundDef;
  expect(bg.proficiencies).toMatchObject({ skills: ['insight', 'sleight-of-hand'], tools: ["thieves' tools"] });
  expect(bg.choices).toEqual([{ type: 'language', count: 2 }]);
  expect(bg.feature).toEqual({ name: 'Test Access', text: [{ p: 'You can get in.' }] });
  expect(bg.equipment.text).toEqual([{ list: ['common clothes', 'pouch containing 15 gp', '(a) a lucky coin or (b) 5 gp'] }]);
  const testy = all.find(e => e.id === 'feat:testy@TST') as FeatDef;
  expect(testy).toMatchObject({ prerequisite: { abilities: [{ str: 13 }], races: ['testfolk'], spellcasting: true }, abilityBonus: { con: 1 } });
  const choosy = all.find(e => e.id === 'feat:choosy@TST') as FeatDef;
  expect(choosy.choices).toEqual([{ type: 'ability', count: 1, amount: 1, from: ['int', 'wis'] }]);
  expect(choosy.prerequisite?.text).toBe('Level 4, a test');
  expect(all.find(e => e.kind === 'optionalFeature')).toMatchObject({ featureTypes: ['EI'], prerequisite: 'Level 5 Warlock, eldritch blast cantrip' });
  expect(all.find(e => e.kind === 'condition')).toMatchObject({ id: 'condition:testy@TST', text: [{ list: ['You test.'] }] });
  expect(r.errors).toEqual([]);
});

test('_copy with appendArr', async () => {
  const r = await run({ 'races.json': readFixture('races.json'), 'more.json': { race: [{ name: 'Copyfolk', source: 'TST', _copy: { name: 'Testfolk', source: 'TST', _mod: { entries: { mode: 'appendArr', items: 'Extra.' } } } }] } });
  const cf = r.packs.flatMap(p => p.entities).find(e => e.name === 'Copyfolk')!;
  expect((cf as RaceDef).abilityBonuses).toEqual({ str: 2 });
  expect(richToPlain(cf.text)).toContain('Extra.');
});

test('_copy from rawLookup with replaceArr, removeArr, replaceTxt, setProp', async () => {
  const { import5etools } = await import('../../src/lib/import/fivetools/index.ts');
  const { srdIdx, asTst } = await import('../fixtures/import.ts');
  const stored = { name: 'Oldfolk', source: 'TST', srd: true, size: ['S'], speed: 25, entries: ['Old text.', { type: 'entries', name: 'A', entries: ['a'] }, { type: 'entries', name: 'B', entries: ['b'] }] };
  const r = await import5etools([{ name: 'n.json', json: asTst({ race: [{ name: 'Newfolk', source: 'TST', _copy: { name: 'Oldfolk', source: 'TST', _mod: {
    entries: [{ mode: 'replaceArr', replace: 'A', items: { type: 'entries', name: 'A2', entries: ['a2'] } }, { mode: 'removeArr', names: 'B' }, { mode: 'replaceTxt', replace: 'Old', with: 'New' }],
    _: { mode: 'setProp', prop: 'speed', value: 35 } } } }] }) }],
  { index: srdIdx, rawLookup: async k => (k === 'race|oldfolk|TST' ? stored : undefined), homebrewSources: ['TST'] });
  const nf = r.packs.flatMap(p => p.entities).find(e => e.name === 'Newfolk') as RaceDef;
  expect(nf).toMatchObject({ size: 'S', speed: { walk: 35 }, traits: [{ name: 'A2' }] });
  expect(richToPlain(nf.text)).toContain('New text.');
  expect(nf.srd).toBeUndefined();
});

test('bad input never throws and keeps the good parts', async () => {
  const r = await run({ 'junk.json': { foo: 1 }, 'half.json': { race: [{ source: 'TST', size: ['M'], speed: 30 }, { name: 'Goodfolk', source: 'TST', size: ['M'], speed: 30, entries: [] }] },
    'mods.json': { race: [{ name: 'Oddfolk', source: 'TST', _copy: { name: 'Goodfolk', source: 'TST', _mod: { entries: { mode: 'calculateProp' } } } }] } });
  expect(r.errors).toContainEqual({ file: 'junk.json', message: 'No recognised 5etools content' });
  expect(r.errors.some(e => e.file === 'half.json' && e.message.startsWith('race "?"'))).toBe(true);
  expect(r.packs.flatMap(p => p.entities).map(e => e.name)).toEqual(expect.arrayContaining(['Goodfolk', 'Oddfolk']));
  expect(r.warnings.some(w => w.includes('calculateProp'))).toBe(true);
});

test.each([
  ['non-string name', { 'bad.json': { race: [{ name: 5, source: 'TST' }] } }, 'race "5": name is not a string'],
  ['non-string source', { 'bad.json': { race: [{ name: 'X', source: 5 }] } }, 'race "X": source is not a string'],
  ['null class entry (sources.json shape)', { 'bad.json': { TST: { Sp: { class: [null] } } } }, undefined],
  ['null class source map (gendata shape)', { 'bad.json': { TST: { Sp: { class: { PHB: null } } } } }, undefined],
])('malformed input never rejects: %s', async (_, bad, error) => {
  const r = await run({ ...bad, 'good.json': { feat: [{ name: 'Goodfeat', source: 'TST', entries: ['Fine.'] }], spell: [{ name: 'Sp', source: 'TST', level: 1, school: 'V', entries: [] }] } });
  expect(r.packs.flatMap(p => p.entities).map(e => e.name)).toEqual(expect.arrayContaining(['Goodfeat', 'Sp']));
  if (error) expect(r.errors).toContainEqual({ file: 'bad.json', message: error });
  else expect(r.errors).toEqual([]);
});

test('_mod paths cannot pollute Object.prototype', async () => {
  const r = await run({ 'races.json': readFixture('races.json'), 'evil.json': { race: [{ name: 'Evilfolk', source: 'TST', _copy: { name: 'Testfolk', source: 'TST', _mod: {
    '__proto__.polluted': { mode: 'setProp', value: 'yes' },
    _: { mode: 'setProp', prop: 'constructor.prototype.polluted2', value: 'yes' },
    entries: { mode: 'appendArr', items: 'Still fine.' },
  } } }] } });
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
  expect(r.warnings.some(w => w.includes('__proto__.polluted'))).toBe(true);
  expect(r.warnings.some(w => w.includes('constructor.prototype.polluted2'))).toBe(true);
  expect(richToPlain(r.packs.flatMap(p => p.entities).find(e => e.name === 'Evilfolk')!.text)).toContain('Still fine.');
});

test('_mod walks own properties only: inherited builtins are never descended into', async () => {
  const toStringCall = Object.prototype.toString.call;
  const r = await run({ 'races.json': readFixture('races.json'), 'evil.json': { race: [{ name: 'Builtinfolk', source: 'TST', _copy: { name: 'Testfolk', source: 'TST', _mod: {
    'toString.call': { mode: 'setProp', value: 'pwned' },
    _: { mode: 'setProp', prop: 'valueOf.polluted3', value: 'yes' },
    hasOwnProperty: 'remove',
  } } }] } });
  expect(typeof Object.prototype.toString.call).toBe('function');
  expect(Object.prototype.toString.call).toBe(toStringCall);
  expect(((({}) as any).valueOf as any).polluted3).toBeUndefined();
  expect(typeof Object.prototype.hasOwnProperty).toBe('function');
  expect(r.errors).toEqual([]);
  const stored = new Map(r.raw).get('race|builtinfolk|TST') as any;
  expect(Object.hasOwn(stored, 'toString') && stored.toString).toEqual({ call: 'pwned' });
  expect(Object.hasOwn(stored, 'valueOf') && stored.valueOf).toEqual({ polluted3: 'yes' });
});

test('user-supplied codes that name Object.prototype members map to nothing', async () => {
  const r = await run({ 'i.json': { baseitem: [{ name: 'Protoblade', source: 'TST', type: 'constructor', property: ['__proto__'], dmgType: 'toString' }] },
    's.json': { spell: [{ name: 'Protospell', source: 'TST', level: 1, school: 'constructor', time: [{ number: 1, unit: 'toString' }], entries: [] }] } });
  const all = r.packs.flatMap(p => p.entities);
  expect(all.find(e => e.name === 'Protoblade')).toMatchObject({ type: 'other' });
  expect(all.find(e => e.name === 'Protospell')).toMatchObject({ school: 'constructor', castingTime: '1 toString' });
});

test('Foundry overlay files are not content', async () => {
  const r = await run({ 'feats.json': { feat: [{ name: 'Realfeat', source: 'TST', entries: ['Real.'] }] },
    'foundry-feats.json': { feat: [{ name: 'Realfeat', source: 'TST', activities: [], migrationVersion: 3 }] } });
  expect(r.errors).toEqual([{ file: 'foundry-feats.json', message: 'No recognised 5etools content' }]);
  expect(r.packs[0].entities[0].text).toEqual([{ p: 'Real.' }]);
});

test('mergePack replaces by id, dedupes patches, refreshes hash and time', () => {
  const race = (text: string) => ({ kind: 'condition' as const, id: 'condition:x@TST', name: 'X', source: 'TST', text: [{ p: text }] });
  const pack = (entities: Pack['entities'], patches: Pack['patches']): Pack => ({ id: 'pack:TST', name: 'TST', source: 'TST', importedAt: 1, hash: 'old', entities, patches });
  const old = pack([race('old'), { ...race('keep'), id: 'condition:y@TST', name: 'Y' }], [{ targetId: 'race:dwarf@SRD', alias: 'TST', text: [{ p: 'a' }] }]);
  const merged = mergePack(old, pack([race('new')], [{ targetId: 'race:dwarf@SRD', alias: 'TST', text: [{ p: 'b' }] }]));
  expect(merged.entities.map(e => e.text)).toEqual([[{ p: 'new' }], [{ p: 'keep' }]]);
  expect(merged.patches).toEqual([{ targetId: 'race:dwarf@SRD', alias: 'TST', text: [{ p: 'b' }] }]);
  expect(merged.hash).not.toBe('old');
  expect(merged.importedAt).toBeGreaterThan(1);
  expect(mergePack(undefined, old).hash).not.toBe('old');
});
