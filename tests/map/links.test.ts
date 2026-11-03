import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { beforeEach, describe, expect, test } from 'vitest';
import { monsterCombatant, newCombat } from '../../src/lib/combat/combat.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { footprint } from '../../src/lib/map/grid.ts';
import { addTokens, newScene, tokensFromCombat } from '../../src/lib/map/scene.ts';
import { addTokensToCombat, clearFightTokens, combatantsFromTokens, dropTokens, endCombatWriteBack, joinFight, placeCombatants, placeUnplaced, removeCombatant } from '../../src/lib/map/store.ts';
import type { MonsterDef, Pack, Scene, Sheet } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';
import { tokensProblem } from '../../src/lib/recordShape.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const half = () => 0.5;
const lookup = (id: string) => (id === goblin.id ? goblin : undefined);
const sheetOf = () => ({ initiative: 2, scores: { dex: 14 }, saves: { con: { bonus: 1 } }, ac: 15 }) as unknown as Sheet;
const thorin = { ...char('thorin', 'c1'), name: 'Thorin' };

function prepared(): Scene {
  return addTokens(newScene('c1', 'Cave'), [
    { name: 'Thorin', size: 'M', characterId: 'thorin' },
    { name: 'Goblin 1', size: 'S', monsterId: goblin.id, hp: 4, maxHp: 7 },
    { name: 'Goblin 2', size: 'S', monsterId: goblin.id, hidden: true },
  ]);
}

describe('combatantsFromTokens', () => {
  test('tokens join the fight', () => {
    const s = prepared(), ids = s.tokens.map((t) => t.id);
    const r = combatantsFromTokens(s, ids, newCombat('c1'), [thorin], sheetOf, lookup, 'average', half);
    expect(r.missing).toEqual([]);
    const cs = r.combat.combatants;
    expect(cs.map((x) => x.id)).toContain('pc:thorin');
    const g1 = cs.find((x) => x.name === 'Goblin 1')!, g2 = cs.find((x) => x.name === 'Goblin 2')!;
    expect(g1).toMatchObject({ kind: 'monster', hp: 4, maxHp: 7 });
    expect(g1.hidden).toBeUndefined();
    expect(g2).toMatchObject({ hidden: true, hp: 7 });
    expect(r.scene.tokens.find((t) => t.name === 'Goblin 1')!.combatantId).toBe(g1.id);
    expect(r.scene.tokens.find((t) => t.name === 'Goblin 2')!.combatantId).toBe(g2.id);
    expect(cs).toHaveLength(3);
    const again = combatantsFromTokens(r.scene, ids, r.combat, [thorin], sheetOf, lookup, 'average', half);
    expect(again.combat.combatants).toHaveLength(3);
    expect(again.scene.tokens).toEqual(r.scene.tokens);
  });
  test('a deleted monster is reported', () => {
    const s = addTokens(newScene('c1', 'Cave'), [{ name: 'Gone 1', size: 'M', monsterId: 'monster:gone@X' }]);
    const c = newCombat('c1');
    const r = combatantsFromTokens(s, [s.tokens[0].id], c, [], sheetOf, lookup, 'average', half);
    expect(r.missing).toEqual(['Gone 1']);
    expect(r.combat.combatants).toEqual([]);
    expect(r.scene.tokens[0].combatantId).toBeUndefined();
  });
});

test('the fight\'s damage stays on the tokens', () => {
  const s = prepared(), r = combatantsFromTokens(s, s.tokens.map((t) => t.id), newCombat('c1'), [thorin], sheetOf, lookup, 'average', half);
  const g1 = r.combat.combatants.find((x) => x.name === 'Goblin 1')!;
  const hurt = { ...r.combat, combatants: r.combat.combatants.map((x) => (x.id === g1.id ? { ...x, hp: 1 } : x)) };
  const after = tokensFromCombat(r.scene, hurt).tokens.find((t) => t.name === 'Goblin 1')!;
  expect(after).toMatchObject({ hp: 1, maxHp: 7, combatantId: g1.id });
  const gone = tokensFromCombat(r.scene, { ...r.combat, combatants: r.combat.combatants.filter((x) => x.id !== g1.id) }).tokens.find((t) => t.name === 'Goblin 1')!;
  expect(gone.hp).toBe(4);
  expect(gone.combatantId).toBeUndefined();
  expect(tokensFromCombat(s, undefined)).toBe(s); // nothing linked: unchanged
});

describe('with the database', () => {
  beforeEach(async () => {
    await resetDb();
    await db.campaigns.put(camp('c1'));
  });

  test('an encounter\'s monsters are placed', async () => {
    expect(await placeCombatants('c1', [monsterCombatant(goblin, 'Goblin 1', 'average', half)], lookup)).toEqual({ placed: 0, why: 'no scene' });
    const other = { ...newScene('c1', 'Other'), updatedAt: Date.now() + 1000 }, shown = newScene('c1', 'Shown');
    await db.scenes.put(other);
    await db.scenes.put(shown);
    await db.scenes.show('c1', shown.id);
    const added = [1, 2, 3].map((n) => ({ ...monsterCombatant(goblin, `Goblin ${n}`, 'average', half), ...(n === 3 && { hidden: true, hp: 2 }) }));
    expect(await placeCombatants('c1', added, lookup)).toEqual({ placed: 3 });
    const s = (await db.scenes.get(shown.id))!;
    expect(s.tokens.map((t) => t.combatantId)).toEqual(added.map((x) => x.id));
    expect(s.tokens[2]).toMatchObject({ name: 'Goblin 3', size: 'S', hidden: true, hp: 2, maxHp: 7, monsterId: goblin.id });
    expect(new Set(s.tokens.map((t) => `${t.x},${t.y}`)).size).toBe(3);
    const cells = s.tokens.flatMap((t) => footprint(s.grid, t).map((c) => `${c.q},${c.r}`));
    expect(new Set(cells).size).toBe(cells.length);
    expect((await db.scenes.get(other.id))!.tokens).toEqual([]);
    expect(await placeCombatants('c1', added, lookup)).toEqual({ placed: 0 }); // all linked already
    // a full scene (MAX_TOKENS) is told apart from no scene
    await db.scenes.put(addTokens({ ...(await db.scenes.get(shown.id))!, tokens: [] }, Array.from({ length: 199 }, (_, i) => ({ name: `T${i}`, size: 'M' as const, x: 35, y: 35 }))));
    const more = [4, 5].map((n) => monsterCombatant(goblin, `Goblin ${n}`, 'average', half));
    expect(await placeCombatants('c1', more, lookup)).toEqual({ placed: 1, why: 'full' });
  });

  test('Add to combat and End combat write back', async () => {
    const s = prepared();
    await db.scenes.put(s);
    const ids = s.tokens.map((t) => t.id);
    const r = await addTokensToCombat('c1', s.id, ids, { chars: [thorin], sheetOf, lookup, settings: camp('c1').settings });
    expect(r.missing).toEqual([]);
    const combat = (await db.combat.get('c1'))!;
    expect(combat.combatants).toHaveLength(3);
    const g1 = combat.combatants.find((x) => x.name === 'Goblin 1')!;
    expect((await db.scenes.get(s.id))!.tokens.find((t) => t.name === 'Goblin 1')!.combatantId).toBe(g1.id);
    await db.combat.update('c1', (c) => ({ ...c!, combatants: c!.combatants.map((x) => (x.id === g1.id ? { ...x, hp: 2 } : x)) }));
    await endCombatWriteBack('c1');
    expect((await db.scenes.get(s.id))!.tokens.find((t) => t.name === 'Goblin 1')!.hp).toBe(2);
    // final M2: removed mid-fight, it keeps the fight's HP on its token
    await db.combat.update('c1', (c) => ({ ...c!, combatants: c!.combatants.map((x) => (x.id === g1.id ? { ...x, hp: 1 } : x)) }));
    await removeCombatant('c1', g1.id);
    expect((await db.combat.get('c1'))!.combatants.some((x) => x.id === g1.id)).toBe(false);
    expect((await db.scenes.get(s.id))!.tokens.some((t) => t.name === 'Goblin 1')).toBe(false); // one roster: its token goes with it
  });

  // One roster (the user's ruling, 11-02): the fight and the map hold the same creatures.
  test('fighters with no token anywhere are placed on the fight\'s scene; linked ones are not placed again', async () => {
    const [g1, g2] = [1, 2].map((n) => monsterCombatant(goblin, `Goblin ${n}`, 'average', half));
    await db.combat.update('c1', () => ({ ...newCombat('c1'), combatants: [g1, g2] }));
    expect(await placeUnplaced('c1', lookup)).toEqual({ placed: 0, why: 'no scene' });
    const a = addTokens(newScene('c1', 'A'), [{ name: 'Goblin 1', size: 'S', monsterId: goblin.id, combatantId: g1.id }]), b = newScene('c1', 'B');
    await db.scenes.put(a);
    await db.scenes.put(b);
    await db.scenes.show('c1', b.id);
    expect(await placeUnplaced('c1', lookup)).toEqual({ placed: 1 });
    expect((await db.scenes.get(b.id))!.tokens.map((t) => t.combatantId)).toEqual([g2.id]);
    expect(await placeUnplaced('c1', lookup)).toEqual({ placed: 0 });
  });

  test('tokens put on the map join a running fight, and only then', async () => {
    const s = prepared(), o = { chars: [thorin], sheetOf, lookup, settings: camp('c1').settings };
    await db.scenes.put(s);
    await joinFight('c1', s.id, [s.tokens[1].id], o);
    expect(await db.combat.get('c1')).toBeUndefined();
    await db.combat.update('c1', () => newCombat('c1'));
    await joinFight('c1', s.id, [s.tokens[1].id], o);
    const k = (await db.combat.get('c1'))!;
    expect(k.combatants.map((x) => x.name)).toEqual(['Goblin 1']);
    expect((await db.scenes.get(s.id))!.tokens[1].combatantId).toBe(k.combatants[0].id);
  });

  test('a fight that ends takes its monsters off the map; characters and map-only tokens stay', async () => {
    const s = addTokens(prepared(), [{ name: 'Statue', size: 'M' }]);
    await db.scenes.put(s);
    await addTokensToCombat('c1', s.id, s.tokens.slice(0, 3).map((t) => t.id), { chars: [thorin], sheetOf, lookup, settings: camp('c1').settings });
    await clearFightTokens('c1');
    expect((await db.scenes.get(s.id))!.tokens.map((t) => t.name)).toEqual(['Thorin', 'Statue']);
  });

  test('tokens removed from the map leave the fight', async () => {
    const s = prepared();
    await db.scenes.put(s);
    await addTokensToCombat('c1', s.id, s.tokens.map((t) => t.id), { chars: [thorin], sheetOf, lookup, settings: camp('c1').settings });
    const linked = (await db.scenes.get(s.id))!.tokens.find((t) => t.name === 'Goblin 1')!;
    await dropTokens('c1', s.id, [linked.id]);
    expect((await db.scenes.get(s.id))!.tokens.some((t) => t.id === linked.id)).toBe(false);
    expect((await db.combat.get('c1'))!.combatants.map((x) => x.name).sort()).toEqual(['Goblin 2', 'Thorin']);
  });
});

test('library: a token’s AC override and a combatant’s portrait carry across the token ↔ fighter link', async () => {
  const s = addTokens(newScene('c1', 'Cave'), [{ name: 'Snarl', size: 'S', monsterId: goblin.id, ac: 17 }]);
  const r = combatantsFromTokens(s, s.tokens.map((t) => t.id), newCombat('c1'), [], sheetOf, lookup, 'average', half);
  expect(r.combat.combatants[0].ac).toBe(17);
  expect(tokensProblem(s.tokens)).toBeUndefined();
  await db.scenes.put({ ...newScene('c1', 'Cave'), id: 's9', shown: true });
  await placeCombatants('c1', [{ ...monsterCombatant(goblin, 'Snarl', 'average', half), portrait: 'b'.repeat(64) }], lookup);
  expect((await db.scenes.get('s9'))!.tokens[0].portrait).toBe('b'.repeat(64));
});
