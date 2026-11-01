import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { openDB } from 'idb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { applyBackup, exportBackup, exportRecord, importRecord, readBackup } from '../../src/lib/backup.ts';
import { db, onUpgradeBlocked, resetDb } from '../../src/lib/db.ts';
import { blankMonster, duplicateMonster, newMonsterId, soundMonster } from '../../src/lib/monsters/homebrew.ts';
import type { MonsterDef, Pack, StoredMonster } from '../../src/lib/types.ts';
import { camp, char, item } from '../fixtures/records.ts';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const mon = (id: string, campaignId = 'c1'): StoredMonster => ({ ...blankMonster(campaignId), id, name: id });
const backup = (o: object) => new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, ...o })]);
const restore = async (file: Blob) => { const plan = await readBackup(file); await applyBackup(plan); return plan.counts; };

test('a version 1 database upgrades to version 2 keeping its data, with an empty monsters store', async () => {
  const v1 = await openDB('dnd-app', 1, {
    upgrade(d) {
      d.createObjectStore('campaigns', { keyPath: 'id' });
      d.createObjectStore('characters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      d.createObjectStore('items', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      for (const n of ['packMeta', 'packs']) d.createObjectStore(n, { keyPath: 'id' });
      d.createObjectStore('raw5e'); d.createObjectStore('blobs', { keyPath: 'hash' }); d.createObjectStore('meta');
    },
  });
  await v1.put('campaigns', camp('c1'));
  await v1.put('characters', char('a', 'c1'));
  await v1.put('items', item('i', 'c1'));
  await v1.put('meta', 'kept', 'k');
  v1.close();

  expect((await db.characters.get('a'))?.name).toBe('a');
  expect((await db.items.list('c1')).map((i) => i.id)).toEqual(['i']);
  expect((await db.campaigns.get('c1'))?.name).toBe('c1');
  expect(await db.meta.get('k')).toBe('kept');
  expect(await db.monsters.list('c1')).toEqual([]);
  await db.monsters.put(mon('m'));
  expect((await db.monsters.list('c1')).map((m) => m.id)).toEqual(['m']);
});

test('monsters: put, list by campaign, get, delete; put stamps updatedAt', async () => {
  await db.monsters.put(mon('a', 'c1')); await db.monsters.put(mon('b', 'c2')); await db.monsters.put(mon('c', 'c1'));
  expect((await db.monsters.list('c1')).map((m) => m.id).sort()).toEqual(['a', 'c']);
  expect((await db.monsters.get('b'))?.campaignId).toBe('c2');
  expect((await db.monsters.get('a'))!.updatedAt).toBeGreaterThan(0);
  await db.monsters.delete('a');
  expect(await db.monsters.get('a')).toBeUndefined();
});

test('deleting a campaign deletes its monsters', async () => {
  await db.campaigns.put(camp('c1')); await db.monsters.put(mon('a', 'c1')); await db.monsters.put(mon('b', 'c2'));
  await db.campaigns.delete('c1');
  expect(await db.monsters.get('a')).toBeUndefined();
  expect(await db.monsters.get('b')).toBeDefined();
});

test('R60: a stored 2024 monster is hidden by list and get, not deleted', async () => {
  await db.monsters.put(mon('ok', 'c1'));
  await db.monsters.put(mon('monster:x@XMM', 'c1'));
  expect((await db.monsters.list('c1')).map((m) => m.id)).toEqual(['ok']);
  expect(await db.monsters.get('monster:x@XMM')).toBeUndefined();
  const raw = await openDB('dnd-app');
  expect(await raw.get('monsters', 'monster:x@XMM')).toBeDefined();
  raw.close();
});

test('duplicateMonster: new homebrew id, same stats, no srd flag', () => {
  const d = duplicateMonster(goblin, 'c1');
  expect(d.id).toMatch(/^monster:homebrew-[0-9a-f]{8}@HOMEBREW$/);
  expect(d.id).not.toBe(newMonsterId());
  expect(d).toMatchObject({ kind: 'monster', source: 'HOMEBREW', name: 'Goblin', campaignId: 'c1', cr: '1/4', scores: goblin.scores, ac: goblin.ac, hp: goblin.hp, actions: goblin.actions });
  expect(d.srd).toBeUndefined();
  expect(d.aliases).toBeUndefined();
  d.actions[0].name = 'changed';
  expect(goblin.actions[0].name).toBe('Scimitar'); // a deep copy
  expect(() => duplicateMonster({ ...goblin, id: 'monster:x@XMM', source: 'XMM' }, 'c1')).toThrow('2024');
  expect(soundMonster(d)).toBe(true);
});

test('soundMonster', () => {
  const blank = blankMonster('c');
  expect(blank).toMatchObject({ cr: '0', size: ['M'], hp: { average: 4, formula: '1d8' }, scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  expect(soundMonster(blank)).toBe(true);
  expect(soundMonster(goblin)).toBe(true);
  expect(soundMonster({})).toBe(false);
  expect(soundMonster(null)).toBe(false);
  const { scores: _s, ...noScores } = blank;
  expect(soundMonster(noScores)).toBe(false);
  expect(soundMonster({ ...blank, actions: 'bite' })).toBe(false);
  expect(soundMonster({ ...blank, actions: [{ name: 'Bite' }] })).toBe(false); // a trait without text
  expect(soundMonster({ ...blank, scores: { ...blank.scores, dex: '10' } })).toBe(false);
  expect(soundMonster({ ...blank, size: [] })).toBe(false);
  expect(soundMonster({ ...blank, name: ' ' })).toBe(false);
  expect(soundMonster({ ...blank, hp: {} })).toBe(false);
});

test('export then importRecord round-trips a monster; taken says the id exists', async () => {
  const m = { ...blankMonster('c1'), name: 'Grub' };
  const file = exportRecord('monster', m);
  expect(JSON.parse(await file.text())).toMatchObject({ format: 'dnd-app-monster', version: 1 });
  const first = await importRecord(file);
  expect(first).toEqual({ kind: 'monster', data: m, taken: false, playerView: false });
  await db.monsters.put(m);
  expect((await importRecord(file)).taken).toBe(true);
});

test('importRecord refuses a damaged or 2024 monster file', async () => {
  const rec = (data: object) => new Blob([JSON.stringify({ format: 'dnd-app-monster', version: 1, data })]);
  await expect(importRecord(rec({ id: 'x', kind: 'monster' }))).rejects.toThrow('Record file is damaged: monster');
  await expect(importRecord(rec({ ...blankMonster('c'), kind: 'item' }))).rejects.toThrow('is not an monster');
  await expect(importRecord(rec({ ...blankMonster('c'), id: 'monster:x@XMM' }))).rejects.toThrow('2024');
  await expect(importRecord(rec({ ...blankMonster('c'), source: 'XMM' }))).rejects.toThrow('2024');
});

test('a backup with two monsters restores both; its campaign backup carries them', async () => {
  await db.campaigns.put(camp('c1')); await db.campaigns.put(camp('c2'));
  await db.monsters.put(mon('a', 'c1')); await db.monsters.put(mon('b', 'c2'));
  const whole = await exportBackup({ includePacks: false });
  const one = JSON.parse(await (await exportBackup({ campaignId: 'c1', includePacks: false })).text());
  expect(one.monsters.map((m: StoredMonster) => m.id)).toEqual(['a']);
  await resetDb();
  expect(await restore(whole)).toEqual({ campaigns: 2, characters: 0, items: 0, monsters: 2, encounters: 0, packs: 0 });
  expect((await db.monsters.list('c1')).map((m) => m.id)).toEqual(['a']);
  expect((await db.monsters.list('c2')).map((m) => m.id)).toEqual(['b']);
});

test('a backup monster from 2024 or unreadable is skipped and reported', async () => {
  const monsters = [mon('ok'), mon('monster:x@XMM'), { ...mon('broken'), scores: undefined }];
  const r = await restore(backup({ campaigns: [camp('c1')], monsters }));
  expect(r).toMatchObject({ monsters: 1, skippedMonsters: ['monster:x@XMM', 'broken'] });
  expect((await db.monsters.list('c1')).map((m) => m.id)).toEqual(['ok']);
  await db.restore({ campaigns: [], characters: [], items: [], packs: [], blobs: [], monsters: [mon('monster:y@XMM')] }); // restore refuses them too
  const raw = await openDB('dnd-app');
  expect(await raw.get('monsters', 'monster:y@XMM')).toBeUndefined();
  raw.close();
});

test('a backup with no monsters key still restores', async () => {
  const r = await restore(backup({ campaigns: [camp('c1')], characters: [char('a', 'c1')] }));
  expect(r).toEqual({ campaigns: 1, characters: 1, items: 0, monsters: 0, encounters: 0, packs: 0 });
  expect(await db.monsters.list('c1')).toEqual([]);
  await expect(restore(backup({ monsters: {} }))).rejects.toThrow('monsters is not a list');
  await expect(restore(backup({ monsters: [{ kind: 'item', id: 'q' }] }))).rejects.toThrow('monsters[0] is not an monster');
});

test('soundMonster: hp formula, speed values, save and skill keys', () => {
  const b = blankMonster('c');
  const bad = (patch: object) => expect(soundMonster({ ...b, ...patch })).toBe(false);
  expect(soundMonster({ ...b, hp: { average: 9, formula: '2d6 + 2' }, speed: { walk: 30, fly: 60, hover: true, note: 'in animal form' }, saves: { dex: 3 }, skills: { stealth: 5, 'sleight-of-hand': 4 } })).toBe(true);
  bad({ hp: { average: 9, formula: 7 } });
  bad({ speed: { walk: 30, fly: '60 ft.' } });
  bad({ speed: { walk: 30, swim: NaN } });
  bad({ speed: { walk: 30, hover: 'yes' } });
  bad({ speed: { walk: 30, note: 5 } });
  bad({ saves: { luck: 3 } });
  bad({ skills: { stealthy: 3 } });
  bad({ skills: { stealth: '5' } });
});

test('soundMonster: mythicIntro is rich text and xp a finite number >= 0 when present', () => {
  const b = blankMonster('c');
  expect(soundMonster({ ...b, mythicIntro: [{ p: 'For one hour…' }], xp: 0 })).toBe(true);
  for (const patch of [{ mythicIntro: 5 }, { mythicIntro: 'text' }, { xp: 'x' }, { xp: -5 }, { xp: Infinity }, { xp: NaN }])
    expect(soundMonster({ ...b, ...patch })).toBe(false);
});

test('opening while an older tab holds version 1 reports it, then completes once that tab closes', async () => {
  const v1 = await openDB('dnd-app', 1, { upgrade(d) { d.createObjectStore('campaigns', { keyPath: 'id' }); } }); // no versionchange handler: it stays open
  const hook = vi.fn();
  onUpgradeBlocked(hook);
  const pending = db.monsters.list('c1');
  await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1));
  v1.close();
  expect(await pending).toEqual([]);
  onUpgradeBlocked(undefined);
});

test('this tab steps aside when a newer version wants to upgrade', async () => {
  await db.monsters.put(mon('a'));
  let blocked = false;
  const v3 = await openDB('dnd-app', 3, { blocked() { blocked = true; } });
  expect(blocked).toBe(false); // our connection closed on versionchange, so nothing waited
  v3.close();
  await resetDb();
});
