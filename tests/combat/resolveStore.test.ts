import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { beforeEach, expect, test } from 'vitest';
import { addCombatants, monsterCombatant } from '../../src/lib/combat/combat.ts';
import { targetOf } from '../../src/lib/combat/resolve.ts';
import { applyResolution, settleSave, undoResolution, updateCombat } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import type { Character, Combatant, MonsterDef, Pack, Resolution } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';

// The DM's device applies a targeted use's damage through changeHp (temp HP, PC dying, concentration), keeps it with what it changed,
// and Undo puts back exactly that change, even after later hits on the same creature.
const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const settings = camp('c1').settings;
const g = (id: string, o: Partial<Combatant> = {}): Combatant => ({ ...monsterCombatant(goblin, 'Goblin', 'average', () => 0.5), id, hp: 7, maxHp: 7, ...o });
const pcC: Combatant = { id: 'pc:p', kind: 'pc', name: 'p', characterId: 'p', initMod: 0, dex: 10, tie: 0.5, conSave: 0 };
const pc = (): Character => ({ ...char('p', 'c1'), state: { ...char('p').state, hp: 20 }, overrides: { maxHp: 30 } });
const res = (id: string, outcomes: Resolution['outcomes'], o: Partial<Resolution> = {}): Omit<Resolution, 'applied'> =>
  ({ id, actor: 'pc:p', action: 'Greatsword', outcomes, at: 0, ...o });
const hp = async (id: string) => (await db.combat.get('c1'))!.combatants.find((x) => x.id === id)!.hp;

beforeEach(async () => {
  await resetDb();
  await db.campaigns.put(camp('c1'));
  await db.characters.put(pc());
  await updateCombat('c1', (c) => addCombatants(c, [g('g1'), g('g2', { tempHp: 3, hp: 7 }), pcC]));
});

test('applying takes the damage off and keeps the result; Undo restores it and drops it', async () => {
  await applyResolution('c1', res('r1', [{ id: 'g1', hit: true, damage: 5 }]), settings);
  expect(await hp('g1')).toBe(2);
  expect((await db.combat.get('c1'))!.resolutions).toEqual([expect.objectContaining({ id: 'r1', applied: [{ id: 'g1', hp: 5, temp: 0 }] })]);
  await undoResolution('c1', 'r1', settings);
  expect(await hp('g1')).toBe(7);
  expect((await db.combat.get('c1'))!.resolutions).toEqual([]);
});

test('Undo of an earlier result after a later hit restores only its own damage (temp HP too)', async () => {
  await applyResolution('c1', res('r1', [{ id: 'g2', hit: true, damage: 5 }]), settings); // 3 temp + 2 hp
  await applyResolution('c1', res('r2', [{ id: 'g2', hit: true, damage: 1 }]), settings);
  await undoResolution('c1', 'r1', settings);
  const x = (await db.combat.get('c1'))!.combatants.find((y) => y.id === 'g2')!;
  expect([x.hp, x.tempHp]).toEqual([6, 3]);
});

test('a concentrating monster dropped to 0 loses concentration (through changeHp)', async () => {
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g1' ? { ...x, concentrating: true } : x)) }));
  await applyResolution('c1', res('r1', [{ id: 'g1', hit: true, damage: 9 }]), settings);
  expect((await db.combat.get('c1'))!.combatants.find((x) => x.id === 'g1')!.concentrating).toBe(false);
});

test('a PC\'s pending save: its roll settles it against the DC, half on a success; it settles once', async () => {
  await applyResolution('c1', res('r1', [{ id: 'pc:p', part: 'save', pending: true, damage: 0, owed: [{ amount: 9, type: 'fire' }] }], { dc: 30, ability: 'dex', onSave: 'half' }), settings);
  expect((await db.characters.get('p'))!.state.hp).toBe(20);
  await settleSave('c1', 'r1', 'pc:p', 5, settings);
  expect((await db.characters.get('p'))!.state.hp).toBe(11); // failed: all 9
  await settleSave('c1', 'r1', 'pc:p', 20, settings);
  expect((await db.characters.get('p'))!.state.hp).toBe(11);
  const o = (await db.combat.get('c1'))!.resolutions![0].outcomes[0];
  expect(o).toMatchObject({ damage: 9, save: { roll: 5, ok: false } });
  expect(o).not.toHaveProperty('pending');
  await undoResolution('c1', 'r1', settings);
  expect((await db.characters.get('p'))!.state.hp).toBe(20);
});

test('what a target brings: a monster\'s AC, saves (printed, else its ability modifier) and defenses; a PC\'s from its sheet', () => {
  const m = targetOf(g('g1'), { monster: goblin });
  expect(m).toMatchObject({ id: 'g1', ac: 15, pc: false, save: { dex: 2, str: -1 } });
  const sheet = computeSheet(pc(), { settings, viewer: 'dm' });
  expect(targetOf(pcC, { sheet })).toMatchObject({ id: 'pc:p', ac: sheet.ac, pc: true, save: { dex: sheet.saves.dex.bonus } });
});
