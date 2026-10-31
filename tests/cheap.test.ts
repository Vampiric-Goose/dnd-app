// Final fix pass, item 11: the cheap batch.
import { afterEach, expect, test, vi } from 'vitest';
import { shortRest } from '../src/lib/character/rest.ts';
import { sha256Hex } from '../src/lib/db.ts';
import { makeEntry, rechargeEntry } from '../src/lib/items/inventory.ts';
import { computeSheet } from '../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';
import type { ItemDef } from '../src/lib/types.ts';
import { uid } from '../src/lib/uid.ts';
import { mkChar } from './fixtures/content.ts';
import { run } from './fixtures/import.ts';

afterEach(() => vi.unstubAllGlobals());
const real = globalThis.crypto;

test('uid works where crypto.randomUUID does not exist (plain http off localhost)', () => {
  expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T) => real.getRandomValues(a as never) as T });
  const a = uid(), b = uid();
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a).not.toBe(b);
});

test('hashing without crypto.subtle says it needs https', async () => {
  vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
  await expect(sha256Hex(new ArrayBuffer(1))).rejects.toThrow(/secure connection \(https\)/);
});

test('a homebrew file\'s srd flag does not make it a patch on the SRD: only official books overlap the SRD', async () => {
  const r = await run({ 'x.json': { race: [{ name: 'Dwarf', source: 'TST', srd: true, size: ['M'], speed: 25, entries: ['Mine.'] }] } });
  const tst = r.packs.find(p => p.source === 'TST')!;
  expect(tst.patches).toEqual([]);
  expect(tst.entities.map(e => e.id)).toEqual(['race:dwarf@TST']);
});

test('a recharge roll below zero restores nothing instead of spending charges', () => {
  const wand: ItemDef = { kind: 'item', id: 'item:w@T', name: 'W', source: 'T', text: [], type: 'wand', magic: true, charges: { max: 7, recharge: 'dawn', rechargeAmount: '1d4-10' } };
  expect(rechargeEntry({ ...makeEntry(wand), chargesUsed: 2 }, 'dawn').chargesUsed).toBe(2);
});

test('a dead character gets nothing from a short rest', () => {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] });
  const dead = { ...c, state: { ...c.state, hp: 0, dead: true } };
  expect(shortRest(dead, [{ die: 10, rolls: [5] }], computeSheet(dead, { settings: DEFAULT_SETTINGS, viewer: 'dm' }))).toBe(dead);
});
