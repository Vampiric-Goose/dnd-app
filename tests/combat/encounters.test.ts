import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { addCombatants, monsterCombatant, newCombat, start } from '../../src/lib/combat/combat.ts';
import { restoreCombat, restoreScene, snapshotFight } from '../../src/lib/combat/encounters.ts';
import { deleteEncounter, resumeFight, saveFight, saveFightAs, updateCombat } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { addTokens, newScene } from '../../src/lib/map/scene.ts';
import { encounterProblem } from '../../src/lib/recordShape.ts';
import type { Combat, Combatant, Encounter, MonsterDef, Pack, SavedFight } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const half = () => 0.5;
const pcC = (characterId: string, o: Partial<Combatant> = {}): Combatant =>
  ({ id: `pc:${characterId}`, kind: 'pc', name: characterId, characterId, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });

/** Round 2, a's turn; goblin 1 hurt, poisoned for 2 rounds, with legendary uses; PCs a and b with combatant-level timers. */
function fight(): Combat {
  const g1 = { ...monsterCombatant(goblin, 'Goblin 1', 'average', half), id: 'g1', init: 20, hp: 3, conditions: ['Poisoned'],
    durations: { Poisoned: { rounds: 2, at: 'end' as const, of: 'g1' } }, legendary: { max: 3, used: 1 } };
  const g2 = { ...monsterCombatant(goblin, 'Goblin 2', 'average', half), id: 'g2', init: 5 };
  const a = pcC('a', { init: 15, durations: { Blinded: { rounds: 1, at: 'end', of: 'g1' } }, concentrating: true, reactionUsed: true, notes: 'flank' });
  const b = pcC('b', { init: 10, hidden: true });
  const c = start(addCombatants(newCombat('c1'), [g1, a, b, g2])).combat;
  return { ...c, round: 2, turn: 'pc:a', encounterId: 'old', movement: { g1: { feet: 10, dashes: 0 } } } as Combat;
}

describe('snapshot and restore', () => {
  test('round trip keeps the monsters, order, round, turn and movement', () => {
    const c = fight();
    const f = snapshotFight(c, undefined);
    expect(f.combat.encounterId).toBeUndefined();
    expect(f.map).toBeUndefined();
    const { combat, dropped } = restoreCombat(f, 'e1', [char('a', 'c1'), char('b', 'c1')], 'c1');
    expect(dropped).toEqual([]);
    expect(combat.combatants.map((x) => x.id)).toEqual(c.combatants.map((x) => x.id));
    expect(combat.combatants.filter((x) => x.kind === 'monster')).toEqual(c.combatants.filter((x) => x.kind === 'monster'));
    expect(combat).toMatchObject({ round: 2, turn: 'pc:a', encounterId: 'e1', campaignId: 'c1', movement: { g1: { feet: 10, dashes: 0 } } });
    c.combatants[0].hp = 0; // a deep copy
    expect(f.combat.combatants[0].hp).toBe(3);
  });

  test('PCs lose their timers, concentration and reaction; order, initiative, hidden and notes stay', () => {
    const { combat } = restoreCombat(snapshotFight(fight(), undefined), 'e1', [char('a', 'c1'), char('b', 'c1')], 'c1');
    const a = combat.combatants.find((x) => x.id === 'pc:a')!;
    expect(a.durations).toBeUndefined();
    expect(a.concentrating).toBeUndefined();
    expect(a.reactionUsed).toBeUndefined();
    expect(a).toMatchObject({ init: 15, notes: 'flank' });
    expect(combat.combatants.find((x) => x.id === 'pc:b')?.hidden).toBe(true);
  });

  test('a deleted character is dropped and named; holding the turn, it passes to the next combatant', () => {
    const { combat, dropped } = restoreCombat(snapshotFight(fight(), undefined), 'e1', [char('b', 'c1')], 'c1');
    expect(dropped).toEqual(['a']);
    expect(combat.combatants.map((x) => x.id)).toEqual(['g1', 'pc:b', 'g2']);
    expect(combat).toMatchObject({ turn: 'pc:b', round: 2 });
    expect(combat.combatants[0].durations).toEqual({ Poisoned: { rounds: 2, at: 'end', of: 'g1' } }); // nothing ticked
  });

  test('the last one in the order dropped on its turn wraps to a new round', () => {
    const c = { ...fight(), turn: 'g2' };
    const { combat } = restoreCombat(snapshotFight({ ...c, combatants: [...c.combatants, pcC('z', { init: 1 })], turn: 'pc:z' }, undefined), 'e1', [char('a', 'c1'), char('b', 'c1')], 'c1');
    expect(combat).toMatchObject({ turn: 'g1', round: 3 });
  });

  test('restoreScene drops deleted characters\' tokens and tokens off a smaller scene, and keeps the current fog when none was saved', () => {
    const s = addTokens(newScene('c1', 'Cave'), [
      { name: 'a', size: 'M', characterId: 'a', x: 100, y: 100 },
      { name: 'gone', size: 'M', characterId: 'gone', x: 100, y: 200 },
      { name: 'Goblin 1', size: 'S', combatantId: 'g1', x: 1300, y: 100 },
      { name: 'Goblin 2', size: 'S', combatantId: 'g2', x: 300, y: 300 },
    ]);
    const f = snapshotFight(fight(), s);
    expect(f.map?.sceneId).toBe(s.id);
    const now = { ...s, width: 1000, tokens: [], fog: 'current' };
    const out = restoreScene(now, f, new Set(['a']));
    expect(out.tokens.map((t) => t.name)).toEqual(['a', 'Goblin 2']);
    expect(out.fog).toBe('current');
    expect(restoreScene(now, { ...f, map: { ...f.map!, fog: 'saved' } }, new Set(['a'])).fog).toBe('saved');
  });
});

describe('validation', () => {
  const base: Encounter = { id: 'e1', campaignId: 'c1', name: 'Ambush', monsters: [], updatedAt: 0 };
  const saved = (f: Partial<SavedFight> = {}): Encounter => ({ ...base, fight: { combat: fight(), savedAt: 1, ...f } });
  test('old records and saved fights pass', () => {
    expect(encounterProblem({ ...base, monsters: [{ monsterId: goblin.id, count: 2 }] })).toBeUndefined();
    expect(encounterProblem(saved({ map: { sceneId: 's', tokens: [{ id: 't', name: 'a', x: 1, y: 1, size: 'M', color: '#000000' }], fog: 'f' } }))).toBeUndefined();
  });
  test('201 combatants or a token with a bad size fail', () => {
    const many = Array.from({ length: 201 }, (_, i) => pcC(`p${i}`));
    expect(encounterProblem(saved({ combat: { ...fight(), combatants: many } }))).toBeDefined();
    expect(encounterProblem(saved({ map: { sceneId: 's', tokens: [{ id: 't', name: 'a', x: 1, y: 1, size: 'X' as 'M', color: '#000000' }] } }))).toBeDefined();
    expect(encounterProblem(saved({ combat: { ...fight(), round: -1 } }))).toBeDefined();
  });
});

describe('store flows', () => {
  beforeEach(async () => {
    await resetDb();
    await db.campaigns.put(camp('c1'));
    for (const id of ['a', 'b']) await db.characters.put(char(id, 'c1'));
  });

  test('saveFightAs links the fight and saveFight updates the same encounter', async () => {
    const { encounterId: _, ...c } = fight();
    await updateCombat('c1', () => c);
    const e = await saveFightAs('c1', 'Ambush');
    expect((await db.combat.get('c1'))?.encounterId).toBe(e.id);
    expect((await db.encounters.get(e.id))?.fight?.combat.round).toBe(2);
    await updateCombat('c1', (x) => ({ ...x, round: 4 }));
    expect((await saveFight('c1'))?.id).toBe(e.id);
    expect((await db.encounters.list('c1')).map((x) => [x.id, x.fight?.combat.round])).toEqual([[e.id, 4]]);
  });

  test('saveFight on an unlinked fight is undefined', async () => {
    await updateCombat('c1', () => newCombat('c1'));
    expect(await saveFight('c1')).toBeUndefined();
  });

  test('resumeFight restores the scene and shows it; with the scene deleted it still loads the combat', async () => {
    const s = addTokens(newScene('c1', 'Cave'), [{ name: 'a', size: 'M', characterId: 'a', x: 100, y: 100 }]);
    await db.scenes.put(s);
    const e: Encounter = { id: 'e1', campaignId: 'c1', name: 'Ambush', monsters: [], fight: snapshotFight(fight(), s), updatedAt: 0 };
    await db.scenes.update(s.id, (x) => ({ ...x, tokens: [] }));
    expect(await resumeFight('c1', e)).toEqual({ dropped: [], sceneMissing: false });
    expect((await db.scenes.get(s.id))?.tokens.map((t) => t.name)).toEqual(['a']);
    expect((await db.scenes.shown('c1'))?.id).toBe(s.id);
    await db.scenes.delete(s.id);
    await updateCombat('c1', () => newCombat('c1'));
    expect(await resumeFight('c1', e)).toEqual({ dropped: [], sceneMissing: true });
    expect(await db.combat.get('c1')).toMatchObject({ round: 2, encounterId: 'e1' });
  });

  test('deleteEncounter on the linked one unlinks the live fight, which goes on', async () => {
    await updateCombat('c1', () => newCombat('c1'));
    const e = await saveFightAs('c1', 'Ambush');
    await deleteEncounter('c1', e.id);
    expect(await db.encounters.get(e.id)).toBeUndefined();
    const c = await db.combat.get('c1');
    expect(c).toBeDefined();
    expect(c?.encounterId).toBeUndefined();
  });
});
