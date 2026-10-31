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
