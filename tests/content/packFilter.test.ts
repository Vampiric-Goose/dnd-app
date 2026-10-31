// R52: a stored pack from a 2024 or unknown source never reaches the index; removing one unlinks it from campaigns atomically.
import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { db, resetDb } from '../../src/lib/db.ts';
import type { Pack } from '../../src/lib/types.ts';
import { srdPackFixture } from '../fixtures/srdPack.ts';
import { camp } from '../fixtures/records.ts';

vi.mock('../../src/lib/content/srd.ts', async () => ({ loadSrd: async () => (await import('../fixtures/srdPack.ts')).srdPackFixture }));
const { getFullIndex, getIndex } = await import('../../src/lib/store.svelte.ts');

const pack = (source: string, homebrew?: boolean): Pack => ({
  id: `pack:${source}`, name: source, source, ...(homebrew && { homebrew }), importedAt: 1, hash: `h-${source}`,
  entities: [{ kind: 'condition', id: `condition:x@${source}`, name: `X ${source}`, source, text: [] }], patches: [],
});
const ids = [pack('PHB'), pack('FRHOF'), pack('MYBREW', true), pack('ZZZ')];

beforeEach(async () => {
  await resetDb();
  for (const p of ids) await db.packs.put(p);
  await db.packs.put(srdPackFixture);
});

test('getIndex and getFullIndex ignore a stored 2024 or unknown pack', async () => {
  await db.campaigns.put({ ...camp('c1'), enabledPacks: ids.map(p => p.id) });
  for (const index of [await getFullIndex(), await getIndex('c1')]) {
    expect(index.get('condition:x@PHB')).toBeDefined();
    expect(index.get('condition:x@MYBREW')).toBeDefined();
    expect(index.label('MYBREW')).toBe('Homebrew (MYBREW)');
    expect(index.get('condition:x@FRHOF')).toBeUndefined(); // 2024
    expect(index.get('condition:x@ZZZ')).toBeUndefined(); // unknown, not declared homebrew
    expect(index.all('condition').map(c => c.source).sort()).toEqual(['MYBREW', 'PHB']);
  }
});

test('a crafted pack cannot bring in a 2024 entity or replace an SRD one, whatever its own source says', async () => {
  const hack: Pack = { id: 'pack:NOPE', name: 'NOPE', source: 'NOPE', homebrew: true, importedAt: 1, hash: 'h-nope', patches: [{ targetId: 'race:dwarf@SRD', alias: 'XPHB', text: [{ p: 'Hacked.' }] }],
    entities: [{ kind: 'condition', id: 'condition:y@XPHB', name: 'Y', source: 'XPHB', text: [] },
      { kind: 'race', id: 'race:dwarf@SRD', name: 'Hacked Dwarf', source: 'SRD', text: [], size: 'M', speed: { walk: 25 }, abilityBonuses: {}, traits: [],
        proficiencies: { armor: [], weapons: [], tools: [], skills: [], languages: [] } },
      { kind: 'condition', id: 'condition:ok@NOPE', name: 'Fine', source: 'NOPE', text: [] }] };
  await db.packs.put(hack);
  await db.packs.put({ ...hack, id: 'pack:SRD', source: 'SRD', name: 'SRD' }); // a second pack claiming to be the SRD
  const index = await getFullIndex();
  expect(index.get('condition:y@XPHB')).toBeUndefined();
  expect(index.get('race:dwarf@SRD')?.name).toBe('Dwarf'); // still the built-in one
  expect(index.get('race:dwarf@SRD')?.aliases ?? []).not.toContain('XPHB');
  expect(index.get('condition:ok@NOPE')).toBeDefined(); // the rest of a homebrew pack is kept
});

test('an entity whose id suffix is not its own source, or is 2024 or reserved, never reaches the index', async () => {
  const dwarf = { kind: 'race' as const, text: [], size: 'M' as const, speed: { walk: 25 }, abilityBonuses: {}, traits: [],
    proficiencies: { armor: [], weapons: [], tools: [], skills: [], languages: [] } };
  const cond = (id: string, source: string) => ({ kind: 'condition' as const, id, name: id, source, text: [] });
  const crafted: Pack = { id: 'pack:NOPE', name: 'NOPE', source: 'NOPE', homebrew: true, importedAt: 1, hash: 'h-crafted', patches: [], entities: [
    { ...dwarf, id: 'race:dwarf@SRD', name: 'Hacked Dwarf', source: 'NOPE' }, // replaces the built-in dwarf by id
    cond('condition:x@XPHB', 'NOPE'), cond('condition:y@XPHB', 'PHB'), cond('condition:z@HOMEBREW', 'HOMEBREW'),
    cond('condition:other@SOMEONE', 'NOPE'), cond('no-at-sign', 'NOPE'),
    cond('condition:fine@nope', 'NOPE'), // same source, different case: fine
  ] };
  await db.packs.put(crafted);
  const index = await getFullIndex();
  expect(index.get('race:dwarf@SRD')?.name).toBe('Dwarf');
  for (const id of ['condition:x@XPHB', 'condition:y@XPHB', 'condition:z@HOMEBREW', 'condition:other@SOMEONE', 'no-at-sign']) expect(index.get(id), id).toBeUndefined();
  expect(index.get('condition:fine@nope')).toBeDefined();
});

test('only official packs can patch: a homebrew pack patch has no effect, a PHB pack patch applies', async () => {
  const patch = (alias: string, text: string) => ({ targetId: 'race:dwarf@SRD', alias, text: [{ p: text }] });
  await db.packs.put({ ...pack('MYBREW', true), patches: [patch('MYBREW', 'Brewed text.')] });
  await db.packs.put({ ...pack('NOPE', true), hash: 'h-nope2', patches: [patch('NOPE', 'Nope text.')] });
  let index = await getFullIndex();
  expect(index.get('race:dwarf@SRD')).toMatchObject({ text: [{ p: 'Short SRD text.' }] });
  expect(index.get('race:dwarf@SRD')?.aliases).toBeUndefined();
  await db.packs.put({ ...pack('PHB'), hash: 'h-phb2', patches: [patch('PHB', 'Book text.'), patch('XPHB', 'Sneaky 2024 text.')] });
  index = await getFullIndex();
  expect(index.get('race:dwarf@SRD')).toMatchObject({ text: [{ p: 'Book text.' }], aliases: ['PHB'] });
});

test('the homebrew flag survives into the stored pack meta', async () => {
  const meta = await db.packs.listMeta();
  expect(meta.find(m => m.id === 'pack:MYBREW')?.homebrew).toBe(true);
  expect(meta.find(m => m.id === 'pack:PHB')?.homebrew).toBeUndefined();
});

test('remove deletes the pack, its raw entities and its place in every campaign, together', async () => {
  await db.campaigns.put({ ...camp('c1'), enabledPacks: ['pack:FRHOF', 'pack:PHB'] });
  await db.campaigns.put({ ...camp('c2'), enabledPacks: ['pack:FRHOF'] });
  await db.campaigns.put({ ...camp('c3'), enabledPacks: ['pack:PHB'] });
  await db.raw5e.putMany([['feat|alert|FRHOF', { a: 1 }], ['classFeature|x|fighter|PHB|1|FRHOF', { b: 1 }], ['feat|alert|PHB', { c: 1 }]]);
  await db.packs.remove('pack:FRHOF');
  expect(await db.packs.get('pack:FRHOF')).toBeUndefined();
  expect((await db.packs.listMeta()).map(m => m.id).sort()).toEqual(['pack:MYBREW', 'pack:PHB', 'pack:ZZZ', 'srd']);
  expect((await db.campaigns.get('c1'))!.enabledPacks).toEqual(['pack:PHB']);
  expect((await db.campaigns.get('c2'))!.enabledPacks).toEqual([]);
  expect((await db.campaigns.get('c3'))!.enabledPacks).toEqual(['pack:PHB']);
  expect(await db.raw5e.getMany(['feat|alert|FRHOF', 'classFeature|x|fighter|PHB|1|FRHOF', 'feat|alert|PHB'])).toEqual([undefined, undefined, { c: 1 }]);
});

test('a failed remove commits nothing', async () => {
  await db.campaigns.put({ ...camp('c1'), enabledPacks: ['pack:FRHOF'] });
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  await expect(db.packs.remove('pack:FRHOF')).rejects.toThrow(/Could not save/);
  vi.restoreAllMocks();
  expect(await db.packs.get('pack:FRHOF')).toBeDefined();
  expect((await db.campaigns.get('c1'))!.enabledPacks).toEqual(['pack:FRHOF']);
});
