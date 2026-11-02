import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db, resetDb } from '../../src/lib/db.ts';
import { rawFile, upgradedPack, upgradeImports } from '../../src/lib/import/fivetools/upgrade.ts';
import { CONVERTER_5E } from '../../src/lib/import/version.ts';
import type { ItemDef, Pack, RaceDef, SpellDef, SubraceDef } from '../../src/lib/types.ts';
import { readFixture, run, srdIdx } from '../fixtures/import.ts';

beforeEach(resetDb);

test('rawFile groups kept records by their 5etools key', () => {
  expect(rawFile([['race|a|X', { n: 1 }], ['subrace|(a)|X', { n: 2 }], ['race|b|X', { n: 3 }]]).json).toEqual({ race: [{ n: 1 }, { n: 3 }], subrace: [{ n: 2 }] });
});

test('an old import is re-converted from its raw records: fixes land, a doubled variant item goes, the device remembers the version', async () => {
  const res = await run({ 'races.json': readFixture('races-human.json') });
  const fresh = res.packs.find((p) => p.source === 'TST')!;
  // the pack as an older converter stored it: Human without its +1s, plus a doubled variant
  const stale: ItemDef = { kind: 'item', id: 'item:adamantine-adamantine-longsword@TST', name: 'Adamantine Adamantine Longsword', source: 'TST', text: [], type: 'weapon', magic: false, baseItemId: 'item:adamantine-longsword@TST' };
  const old: Pack = {
    ...fresh, homebrew: true, hash: 'old',
    entities: [...fresh.entities.map((e) => (e.kind === 'race' && e.name === 'Testhuman' ? { ...e, abilityBonuses: {} }
      : e.kind === 'subrace' && e.name === 'Variant Testhuman' ? { ...e, choices: e.choices?.filter((c) => c.type !== 'feat') } : e)), stale], // converter 2: no race feat
  };
  await db.packs.put(old);
  await db.raw5e.putMany(res.raw);

  expect(await upgradeImports(async () => srdIdx)).toBe(1);
  const after = (await db.packs.get(fresh.id))!;
  expect((after.entities.find((e) => e.kind === 'race' && e.name === 'Testhuman') as RaceDef).abilityBonuses).toEqual({ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 });
  expect(after.entities.some((e) => e.id === stale.id)).toBe(false);
  expect((after.entities.find((e) => e.kind === 'subrace' && e.name === 'Variant Testhuman') as SubraceDef).choices).toContainEqual({ type: 'feat' });
  expect(after.homebrew).toBe(true);
  expect(await db.meta.get('converter5e')).toBe(CONVERTER_5E);
});

test('a copy shared by the DM is left alone; with no raw records only the version is remembered', async () => {
  const res = await run({ 'races.json': readFixture('races-human.json') });
  const p = { ...res.packs[0], sharedBy: 'c1', hash: 'shared' };
  await db.packs.put(p);
  expect(await upgradeImports(async () => srdIdx)).toBe(0);
  expect((await db.packs.get(p.id))!.hash).toBe('shared');
  expect(await db.meta.get('converter5e')).toBe(CONVERTER_5E);
});

test('an upgrade keeps a spell\'s class lists: they came from the spell-source file, which is not kept raw', async () => {
  const res = await run({
    'spells.json': { spell: [{ name: 'Testpult', source: 'TST', level: 1, school: 'V', time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 60 } }, entries: ['Fling.'] }] },
    'gendata-spell-source-lookup.json': { tst: { testpult: { class: { PHB: { Wizard: true, Sorcerer: true } } } } },
  });
  const p = res.packs.find((x) => x.source === 'TST')!;
  const spellOf = (q: Pack) => q.entities.find((e) => e.name === 'Testpult') as SpellDef;
  expect([...spellOf(p).classes].sort()).toEqual(['sorcerer', 'wizard']);
  await db.packs.put({ ...p, hash: 'old' });
  await db.raw5e.putMany(res.raw);
  await upgradeImports(async () => srdIdx);
  expect([...spellOf((await db.packs.get(p.id))!).classes].sort()).toEqual(['sorcerer', 'wizard']);
});

test('an import keeps the spell-source entries it read, so an upgrade rebuilds class lists from them (a list that changes is followed)', async () => {
  const res = await run({
    'spells.json': { spell: [{ name: 'Testpult', source: 'TST', level: 1, school: 'V', time: [{ number: 1, unit: 'action' }], range: { type: 'point', distance: { type: 'feet', amount: 60 } }, entries: ['Fling.'] }] },
    'gendata-spell-source-lookup.json': { tst: { testpult: { class: { PHB: { Wizard: true } } } } },
  });
  expect(res.raw.find(([k]) => k.startsWith('spellClasses|'))).toEqual(['spellClasses|testpult|TST', { name: 'Testpult', source: 'TST', refs: [{ name: 'Wizard', source: 'PHB' }] }]);
  const p = res.packs.find((x) => x.source === 'TST')!;
  const stale = { ...p, hash: 'old', entities: p.entities.map((e) => (e.name === 'Testpult' ? { ...e, classes: [] } : e)) }; // what the bad upgrade left
  await db.packs.put(stale);
  await db.raw5e.putMany(res.raw);
  await upgradeImports(async () => srdIdx);
  expect(((await db.packs.get(p.id))!.entities.find((e) => e.name === 'Testpult') as SpellDef).classes).toEqual(['wizard']);
});

test('an upgrade never blanks a field the stored copy has filled', () => {
  const spell = (o: object) => ({ kind: 'spell', id: 'spell:x@TST', name: 'X', source: 'TST', text: [{ p: 'T.' }], level: 1, school: 'evocation', castingTime: '', range: '', components: {}, duration: '',
    concentration: false, ritual: false, classes: ['wizard'], ...o });
  const pack = (e: object): Pack => ({ id: 'tst', name: 'T', source: 'TST', importedAt: 0, hash: 'h', patches: [], entities: [e as SpellDef] });
  const out = upgradedPack(pack(spell({ higherLevels: [{ p: 'More.' }] })), pack(spell({ classes: [], text: [], level: 2 })));
  expect(out.entities[0]).toMatchObject({ classes: ['wizard'], text: [{ p: 'T.' }], higherLevels: [{ p: 'More.' }], level: 2 });
});
