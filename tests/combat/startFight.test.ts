import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { beforeEach, expect, test } from 'vitest';
import { applyInitiative } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { addTokens, newScene } from '../../src/lib/map/scene.ts';
import { startFight, startNow } from '../../src/lib/map/store.ts';
import type { Character, MonsterDef, Pack, Sheet } from '../../src/lib/types.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { camp, char } from '../fixtures/records.ts';

// The map's Start combat: everyone on the scene joins, monsters and the DM's own characters roll, round 1 starts once players have rolled.
const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const sheetOf = () => ({ initiative: 2, scores: { dex: 12 }, saves: { con: { bonus: 1 } }, ac: 14 }) as unknown as Sheet;
const pc = (id: string, ownerId?: string): Character => ({ ...char(id, 'c1'), name: id, ...(ownerId && { ownerId }) });

async function setup() {
  await db.campaigns.put(camp('c1'));
  const chars = [pc('ana', 'A1'), pc('dmc')];
  for (const c of chars) await db.characters.put(c);
  const s = addTokens(newScene('c1', 'Field'), [
    { name: 'ana', size: 'M', characterId: 'ana' }, { name: 'dmc', size: 'M', characterId: 'dmc' }, { name: 'Goblin 1', size: 'S', monsterId: goblin.id },
  ]);
  await db.scenes.put(s);
  const o = { chars, sheetOf, lookup: (id: string) => (id === goblin.id ? goblin : undefined), settings: structuredClone(DEFAULT_SETTINGS) };
  return { s, o };
}

beforeEach(async () => { await resetDb(); });

test('Start combat: all tokens join and the scene is shown; the goblin and the DM character roll; it waits for the player, then round 1 starts', async () => {
  const { s, o } = await setup();
  const r = await startFight('c1', s.id, o);
  expect(r.waiting).toEqual(['ana']);
  let k = (await db.combat.get('c1'))!;
  expect(k.round).toBe(0);
  expect(k.combatants.map((x) => [x.name, x.init !== undefined])).toEqual(expect.arrayContaining([['ana', false], ['dmc', true], ['Goblin 1', true]]));
  expect((await db.scenes.get(s.id))!.shown).toBe(true);
  expect(await applyInitiative('c1', 'ana', 15)).toBe(true);
  k = (await db.combat.get('c1'))!;
  expect(k.round).toBe(1);
  expect(k.autoStart).toBeUndefined();
});

test('with no players to wait for, round 1 starts at once; Start now rolls for anyone still missing', async () => {
  const { s, o } = await setup();
  await db.characters.put({ ...pc('ana'), updatedAt: 1 }); // ana is the DM's too now
  const r = await startFight('c1', s.id, { ...o, chars: [pc('ana'), pc('dmc')] });
  expect(r.waiting).toEqual([]);
  expect((await db.combat.get('c1'))!.round).toBe(1);

  await resetDb();
  const again = await setup();
  await startFight('c1', again.s.id, again.o);
  await startNow('c1');
  const k = (await db.combat.get('c1'))!;
  expect(k.round).toBe(1);
  expect(k.combatants.every((x) => x.init !== undefined)).toBe(true);
});
