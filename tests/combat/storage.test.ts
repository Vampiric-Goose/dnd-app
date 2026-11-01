import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { exportBackup } from '../../src/lib/backup.ts';
import { addCombatants, monsterCombatant, newCombat, start } from '../../src/lib/combat/combat.ts';
import { applyInitiative, changeHp, deathSave, setCondition, turn, updateCombat } from '../../src/lib/combat/store.ts';
import { db, onLocalChange, resetDb } from '../../src/lib/db.ts';
import { blankMonster } from '../../src/lib/monsters/homebrew.ts';
import type { Campaign, Character, Combat, Combatant, Encounter, MonsterDef, Pack } from '../../src/lib/types.ts';
import { camp, char, importBackup } from '../fixtures/records.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const half = () => 0.5;
const enc = (id: string, campaignId = 'c1', monsters = [{ monsterId: goblin.id, count: 2 }]): Encounter => ({ id, campaignId, name: id, monsters, updatedAt: 0 });
const backup = (o: object) => new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, ...o })]);
const pcC = (characterId: string, o: Partial<Combatant> = {}): Combatant =>
  ({ id: `pc:${characterId}`, kind: 'pc', name: characterId, characterId, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const synced = (): Campaign => ({ ...camp('c1'), sync: { role: 'dm', code: 'ABCDEFGHJKLM', node: 'dmnode01' } });
const pc = (hp = 20): Character => ({ ...char('p', 'c1'), state: { ...char('p').state, hp }, overrides: { maxHp: 30 } });
const settings = camp('c1').settings;

let seen: [string, string][] = [];
beforeEach(async () => {
  await resetDb();
  seen = [];
  onLocalChange((kind, id) => { seen.push([kind, id]); });
});
afterEach(() => onLocalChange(undefined));

test('a version 2 database upgrades to version 3 keeping its data, with an empty encounters store', async () => {
  await resetDb();
  const v2 = await openDB('dnd-app', 2, {
    upgrade(d) {
      d.createObjectStore('campaigns', { keyPath: 'id' });
      d.createObjectStore('characters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      d.createObjectStore('items', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
      for (const n of ['packMeta', 'packs']) d.createObjectStore(n, { keyPath: 'id' });
      d.createObjectStore('raw5e'); d.createObjectStore('blobs', { keyPath: 'hash' }); d.createObjectStore('meta');
      d.createObjectStore('monsters', { keyPath: 'id' }).createIndex('campaignId', 'campaignId');
    },
  });
  await v2.put('campaigns', camp('c1'));
  await v2.put('characters', char('a', 'c1'));
  await v2.put('monsters', { ...blankMonster('c1'), id: 'm1', name: 'Grue' });
  await v2.put('meta', 'kept', 'k');
  v2.close();

  expect((await db.campaigns.list()).map((c) => c.id)).toEqual(['c1']);
  expect((await db.monsters.list('c1')).map((m) => m.name)).toEqual(['Grue']);
  expect((await db.characters.get('a'))?.name).toBe('a');
  expect(await db.meta.get('k')).toBe('kept');
  expect(await db.encounters.list('c1')).toEqual([]);
});

test('encounters are per campaign', async () => {
  for (const e of [enc('e1'), enc('e2'), enc('e3', 'c2')]) await db.encounters.put(e);
  expect((await db.encounters.list('c1')).map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  expect((await db.encounters.get('e3'))?.campaignId).toBe('c2');
  await db.encounters.delete('e1');
  expect((await db.encounters.list('c1')).map((e) => e.id)).toEqual(['e2']);
});

test('the combat survives a reload and reports the change', async () => {
  const combat: Combat = { ...newCombat('c1'), combatants: [pcC('p', { init: 12 })], round: 1, turn: 'pc:p' };
  await db.combat.update('c1', () => combat);
  expect(await db.combat.get('c1')).toEqual(combat);
  expect(seen).toContainEqual(['combat', 'c1']);
  await db.combat.update('c1', () => undefined);
  expect(await db.combat.get('c1')).toBeUndefined();
});

test('deleting a campaign removes its encounters and its combat', async () => {
  await db.campaigns.put(camp('c1'));
  await db.encounters.put(enc('e1'));
  await db.encounters.put(enc('e2', 'c2'));
  await updateCombat('c1', (c) => c);
  await db.campaigns.delete('c1');
  expect(await db.encounters.list('c1')).toEqual([]);
  expect(await db.combat.get('c1')).toBeUndefined();
  expect((await db.encounters.list('c2')).length).toBe(1);
});

describe('backups carry encounters', () => {
  test('a campaign export restores them', async () => {
    await db.campaigns.put(camp('c1'));
    await db.encounters.put(enc('e1'));
    await db.encounters.put(enc('other', 'c2'));
    const file = await exportBackup({ campaignId: 'c1', includePacks: false });
    await resetDb();
    expect((await importBackup(file)).encounters).toBe(1);
    expect((await db.encounters.get('e1'))?.monsters).toEqual([{ monsterId: goblin.id, count: 2 }]);
    expect(await db.encounters.get('other')).toBeUndefined();
  });
  test('an old backup without encounters restores', async () => {
    expect(await importBackup(backup({ campaigns: [camp('c1')] }))).toMatchObject({ campaigns: 1, encounters: 0 });
    expect(await db.campaigns.get('c1')).toBeDefined();
  });
  test('a damaged encounter fails the import', async () => {
    await expect(importBackup(backup({ encounters: [enc('e1', 'c1', [{ monsterId: goblin.id, count: 0 }])] }))).rejects.toThrow('Backup file is damaged');
    await expect(importBackup(backup({ encounters: [enc('e1', 'c1', [{ monsterId: goblin.id, count: 2.5 }])] }))).rejects.toThrow('Backup file is damaged');
    const lines = Array.from({ length: 51 }, () => ({ monsterId: goblin.id, count: 1 }));
    await expect(importBackup(backup({ encounters: [enc('e1', 'c1', lines)] }))).rejects.toThrow('Backup file is damaged');
    expect(await db.encounters.list('c1')).toEqual([]);
  });
});

test('PC damage from the tracker goes through characters.put', async () => {
  await db.campaigns.put(synced());
  await db.characters.put(pc());
  await updateCombat('c1', (c) => addCombatants(c, [pcC('p')]));
  seen = [];
  await changeHp('c1', 'pc:p', { damage: 5 }, settings);
  const once = (await db.characters.get('p'))!;
  expect(once.state.hp).toBe(15);
  expect(once.sync?.clock['state.hp']).toBeTruthy();
  expect(seen).toContainEqual(['character', 'p']);
  // the player edits their notes in between
  await db.characters.put({ ...once, details: { ...once.details, notes: 'kept' } });
  await changeHp('c1', 'pc:p', { damage: 5 }, settings);
  const twice = (await db.characters.get('p'))!;
  expect(twice.state.hp).toBe(10);
  expect(twice.details.notes).toBe('kept');
  // two quick hits from the same page both land
  await Promise.all([changeHp('c1', 'pc:p', { damage: 1 }, settings), changeHp('c1', 'pc:p', { damage: 1 }, settings)]);
  expect((await db.characters.get('p'))!.state.hp).toBe(8);
});

test('concentration', async () => {
  const g = { ...monsterCombatant(goblin, 'Goblin', 'average', half), id: 'g', concentrating: true };
  await updateCombat('c1', (c) => addCombatants(c, [g, { ...g, id: 'h', concentrating: false }]));
  const r = await changeHp('c1', 'g', { damage: 25 }, settings);
  expect(r.concentrationDc).toBe(12);
  expect(r.combat.combatants.find((x) => x.id === 'g')!.hp).toBe(0);
  expect((await changeHp('c1', 'h', { damage: 25 }, settings)).concentrationDc).toBeUndefined();
});

describe('death saves and expiry write the character', () => {
  test('a death save', async () => {
    await db.characters.put(pc(0));
    await updateCombat('c1', (c) => addCombatants(c, [pcC('p')]));
    await deathSave('c1', 'pc:p', 15);
    expect((await db.characters.get('p'))!.state.deathSaves.success).toBe(1);
  });
  test('an expired condition leaves the character', async () => {
    await db.campaigns.put(synced());
    await db.characters.put(pc());
    await updateCombat('c1', (c) => addCombatants(c, [pcC('p', { init: 25 }), { ...monsterCombatant(goblin, 'Goblin', 'average', half), id: 'g' }]));
    await turn('c1', 'start');
    await setCondition('c1', 'pc:p', 'Poisoned', true, { rounds: 1, at: 'end', of: 'pc:p' });
    expect((await db.characters.get('p'))!.state.conditions).toEqual(['Poisoned']);
    const s = await turn('c1', 'next');
    expect(s.expired).toEqual([{ combatantId: 'pc:p', condition: 'Poisoned' }]);
    expect((await db.characters.get('p'))!.state.conditions).toEqual([]);
    expect(s.combat.turn).toBe('g');
  });
  test('a monster condition lives on the combatant; off drops its duration', async () => {
    await updateCombat('c1', (c) => start(addCombatants(c, [{ ...monsterCombatant(goblin, 'Goblin', 'average', half), id: 'g' }])).combat);
    let c = await setCondition('c1', 'g', 'Prone', true, { rounds: 2, at: 'start', of: 'g' });
    expect(c.combatants[0]).toMatchObject({ conditions: ['Prone'], durations: { Prone: { rounds: 2 } } });
    c = await setCondition('c1', 'g', 'Prone', false);
    expect(c.combatants[0].conditions).toEqual([]);
    expect(c.combatants[0].durations?.Prone).toBeUndefined();
  });
});

test('applyInitiative', async () => {
  await updateCombat('c1', (c) => addCombatants(c, [
    { ...monsterCombatant(goblin, 'Goblin', 'average', half), id: 'g', init: 13 },
    { ...monsterCombatant(goblin, 'Boss', 'average', half), id: 'b', init: 20 },
    pcC('p'),
  ]));
  expect(await applyInitiative('c1', 'p', 17)).toBe(true);
  let c = (await db.combat.get('c1'))!;
  expect(c.combatants.map((x) => x.id)).toEqual(['b', 'pc:p', 'g']);
  expect(c.combatants[1].init).toBe(17);
  seen = [];
  expect(await applyInitiative('c1', 'p', 3)).toBe(false);
  c = (await db.combat.get('c1'))!;
  expect(c.combatants[1].init).toBe(17);
  expect(await applyInitiative('c1', 'nobody', 12)).toBe(false);
  expect(await db.combat.get('c1')).toEqual(c);
  expect(await applyInitiative('c2', 'p', 12)).toBe(false); // no fight at all
  expect(seen).toEqual([]);
});
