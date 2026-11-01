import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { exportBackup } from '../../src/lib/backup.ts';
import { fromBase64, toBase64 } from '../../src/lib/base64.ts';
import { db, onLocalChange, resetDb } from '../../src/lib/db.ts';
import { addTokens, moveTokens, newScene, patchToken } from '../../src/lib/map/scene.ts';
import { editScene, tokenForCharacter, tokenForMonster } from '../../src/lib/map/store.ts';
import type { MonsterDef, Pack, Scene } from '../../src/lib/types.ts';
import { camp, char, importBackup } from '../fixtures/records.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const backup = (o: object) => new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, ...o })]);
const scene = (id: string, campaignId = 'c1'): Scene => ({ ...newScene(campaignId, id), id });

let seen: [string, string][] = [];
beforeEach(async () => {
  await resetDb();
  seen = [];
  onLocalChange((kind, id) => { seen.push([kind, id]); });
});
afterEach(() => onLocalChange(undefined));

test('a version 3 database upgrades to version 4 keeping its encounters, with an empty scenes store', async () => {
  await resetDb();
  const v3 = await openDB('dnd-app', 3, {
    upgrade(d) {
      d.createObjectStore('campaigns', { keyPath: 'id' });
      d.createObjectStore('characters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      d.createObjectStore('items', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      for (const n of ['packMeta', 'packs']) d.createObjectStore(n, { keyPath: 'id' });
      d.createObjectStore('raw5e'); d.createObjectStore('blobs', { keyPath: 'hash' }); d.createObjectStore('meta');
      d.createObjectStore('monsters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      d.createObjectStore('encounters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
    },
  });
  await v3.put('campaigns', camp('c1'));
  await v3.put('encounters', { id: 'e1', campaignId: 'c1', name: 'Ambush', monsters: [], updatedAt: 0 });
  v3.close();

  expect((await db.encounters.list('c1')).map((e) => e.name)).toEqual(['Ambush']);
  expect(await db.scenes.list('c1')).toEqual([]);
});

test('scenes are per campaign, and only one is shown', async () => {
  for (const s of [scene('a'), scene('b'), scene('x', 'c2')]) await db.scenes.put(s);
  await db.scenes.show('c2', 'x');
  expect((await db.scenes.list('c1')).map((s) => s.id).sort()).toEqual(['a', 'b']);
  await db.scenes.show('c1', 'a');
  await db.scenes.show('c1', 'b');
  expect((await db.scenes.shown('c1'))?.id).toBe('b');
  expect((await db.scenes.get('a'))?.shown).toBeUndefined();
  await db.scenes.show('c1', undefined);
  expect(await db.scenes.shown('c1')).toBeUndefined();
  expect((await db.scenes.shown('c2'))?.id).toBe('x');
  // a put never changes which scene is shown
  await db.scenes.put({ ...scene('a'), shown: true });
  expect(await db.scenes.shown('c1')).toBeUndefined();
  await db.scenes.delete('a');
  expect(await db.scenes.get('a')).toBeUndefined();
});

test('only shown-scene writes are reported', async () => {
  await db.scenes.put(scene('a'));
  await db.scenes.put(scene('b'));
  await editScene('a', (s) => ({ ...s, name: 'Prep' }));
  expect(seen).toEqual([]);
  await db.scenes.show('c1', 'b');
  expect(seen).toEqual([['scene', 'c1']]);
  seen = [];
  await editScene('b', (s) => ({ ...s, name: 'Live' }));
  expect(seen).toEqual([['scene', 'c1']]);
  seen = [];
  await db.scenes.update('b', (s) => ({ ...s, name: 'From a player' }), { network: true });
  await db.scenes.update('b', (s) => s);
  expect(seen).toEqual([]);
  expect((await db.scenes.get('b'))?.name).toBe('From a player');
});

test('a network move and a DM edit both survive (Review Focus 3)', async () => {
  const s = addTokens(scene('s'), [{ name: 't1', size: 'M', x: 35, y: 35 }, { name: 't2', size: 'M', x: 105, y: 35 }]);
  await db.scenes.put(s);
  const [t1, t2] = s.tokens;
  const page = s; // the DM page's copy, now stale
  await db.scenes.update(s.id, (x) => moveTokens(x, [t1.id], t1.id, { x: 315, y: 315 }), { network: true });
  await editScene(page.id, (x) => patchToken(x, t2.id, { name: 'Boss' }));
  const out = (await db.scenes.get(s.id))!;
  expect(out.tokens.find((t) => t.id === t1.id)).toMatchObject({ x: 315, y: 315 });
  expect(out.tokens.find((t) => t.id === t2.id)?.name).toBe('Boss');
  expect(out.updatedAt).toBeGreaterThanOrEqual(page.updatedAt);
});

test('deleting a campaign removes its scenes', async () => {
  await db.campaigns.put(camp('c1'));
  await db.scenes.put(scene('a'));
  await db.scenes.put(scene('x', 'c2'));
  await db.campaigns.delete('c1');
  expect(await db.scenes.list('c1')).toEqual([]);
  expect(await db.scenes.get('x')).toBeDefined();
});

describe('backups carry scenes', () => {
  test('a campaign export restores them', async () => {
    await db.campaigns.put(camp('c1'));
    await db.scenes.put(addTokens(scene('a'), [{ name: 'Orc', size: 'M' }]));
    await db.scenes.put(scene('other', 'c2'));
    const file = await exportBackup({ campaignId: 'c1', includePacks: false });
    await resetDb();
    expect((await importBackup(file)).scenes).toBe(1);
    expect((await db.scenes.get('a'))?.tokens.map((t) => t.name)).toEqual(['Orc']);
    expect(await db.scenes.get('other')).toBeUndefined();
  });
  test('I2: only referenced images are exported (a deleted scene\'s image is not)', async () => {
    await db.campaigns.put({ ...camp('c1'), sync: { role: 'dm', code: 'ABCDEFGHJKMN', node: 'dmnode01' } }); // hosted: deletes go to the trash
    const put = (n: number) => db.blobs.put(new Blob([new Uint8Array([n])], { type: 'image/png' }));
    const [kept, gone, token, face, trashed, stray] = await Promise.all([1, 2, 3, 4, 5, 6].map(put));
    await db.scenes.put({ ...scene('a'), image: kept, tokens: [{ id: 't', name: 'Orc', x: 35, y: 35, size: 'M', color: '#000000', portrait: token }] });
    await db.scenes.put({ ...scene('b'), image: gone });
    await db.scenes.delete('b');
    await db.characters.put({ ...char('p', 'c1'), details: { ...char('p').details, portrait: face } });
    await db.characters.put({ ...char('q', 'c1'), details: { ...char('q').details, portrait: trashed } });
    await db.characters.delete('q');
    const hashes = JSON.parse(await (await exportBackup({ includePacks: false })).text()).blobs.map((b: { hash: string }) => b.hash).sort();
    expect(hashes).toEqual([kept, token, face, trashed].sort());
    expect(hashes).not.toContain(gone);
    expect(hashes).not.toContain(stray);
  });
  test('an old backup without scenes restores', async () => {
    expect(await importBackup(backup({ campaigns: [camp('c1')] }))).toMatchObject({ campaigns: 1, scenes: 0 });
  });
  test('a damaged scene fails the import', async () => {
    await expect(importBackup(backup({ scenes: [{ ...scene('a'), width: 5000 }] }))).rejects.toThrow('Backup file is damaged');
    await expect(importBackup(backup({ scenes: [{ ...scene('a'), grid: { ...scene('a').grid, color: 'red' } }] }))).rejects.toThrow('Backup file is damaged');
    await expect(importBackup(backup({ scenes: [{ ...scene('a'), tokens: [{ id: 't', name: 'x', x: 'NaN', y: 0, size: 'M', color: '#000000' }] }] }))).rejects.toThrow('Backup file is damaged');
    // M4: the limits and optional field types
    const t = { id: 't', name: 'x', x: 0, y: 0, size: 'M', color: '#000000' };
    for (const bad of [{ name: 'n'.repeat(101) }, { image: 5 }, { shown: 'yes' }, { tokens: [{ ...t, name: 'n'.repeat(101) }] }, { tokens: [{ ...t, portrait: {} }] },
      { tokens: [{ ...t, hidden: 1 }] }, { tokens: [{ ...t, hp: 'x' }] }, { tokens: [{ ...t, characterId: 3 }] }]) {
      await expect(importBackup(backup({ scenes: [{ ...scene('a'), ...bad }] }))).rejects.toThrow('Backup file is damaged');
    }
    expect(await db.scenes.list('c1')).toEqual([]);
  });
});

test('base64 round-trips 70 000 random bytes', () => {
  const b = new Uint8Array(70_000);
  for (let i = 0; i < b.length; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536));
  expect(fromBase64(toBase64(b))).toEqual(b);
  expect(fromBase64(toBase64(b.buffer))).toEqual(b);
});

test('blobs.has', async () => {
  const hash = await db.blobs.put(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
  expect(await db.blobs.has(hash)).toBe(true);
  expect(await db.blobs.has('nope')).toBe(false);
});

test('token builders', () => {
  expect(tokenForMonster(goblin, 'Goblin 1', 'average')).toEqual({ name: 'Goblin 1', size: 'S', monsterId: 'monster:goblin@SRD', hp: 7, maxHp: 7 });
  const c = { ...char('p', 'c1'), details: { ...char('p').details, portrait: 'abc' } };
  expect(tokenForCharacter(c, 'M')).toEqual({ name: 'p', size: 'M', characterId: 'p' }); // M6: the portrait follows the character
});
