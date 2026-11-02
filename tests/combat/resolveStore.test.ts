import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addCombatants, monsterCombatant } from '../../src/lib/combat/combat.ts';
import { targetOf } from '../../src/lib/combat/resolve.ts';
import { snapOf } from '../../src/lib/combat/aiming.ts';
import { applyResolution, changeHp, settleSave, turn, undoResolution, updateCombat } from '../../src/lib/combat/store.ts';
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

test('Undo of a killing blow brings the PC back (dead cleared)', async () => {
  await db.characters.put({ ...pc(), state: { ...pc().state, hp: 5 } });
  await applyResolution('c1', res('r1', [{ id: 'pc:p', hit: true, damage: 40 }]), settings); // 35 past 0 >= max 30: dead
  expect((await db.characters.get('p'))!.state.dead).toBe(true);
  await undoResolution('c1', 'r1', settings);
  const s = (await db.characters.get('p'))!.state;
  expect([s.hp, !!s.dead]).toEqual([5, false]);
});

test('a hit on a concentrating creature that stays up keeps its concentration save DC for the DM', async () => {
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g1' ? { ...x, concentrating: true } : x)) }));
  await applyResolution('c1', res('r1', [{ id: 'g1', hit: true, damage: 2 }]), settings);
  expect((await db.combat.get('c1'))!.resolutions![0].applied[0]).toMatchObject({ id: 'g1', conc: 10 });
});

test('Undo puts back the whole state: the pip and slot spent, HP exactly (even above max), lost concentration', async () => {
  await db.characters.put({ ...pc(), state: { ...pc().state, hp: 35, slotsUsed: [0] } }); // above max 30 (a DM's edit)
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g1' ? { ...x, concentrating: true } : x)) }));
  const k = (await db.combat.get('c1'))!, before = snapOf(k, [(await db.characters.get('p'))!], ['pc:p', 'g1']);
  // paying: the PC's Action and a 1st-level slot
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'pc:p' ? { ...x, economy: { used: 1, extra: 0, bonus: false, attacks: 0 } } : x)) }));
  await db.characters.put({ ...(await db.characters.get('p'))!, state: { ...(await db.characters.get('p'))!.state, slotsUsed: [1] } });
  await applyResolution('c1', res('r1', [{ id: 'g1', hit: true, damage: 9 }, { id: 'pc:p', part: 'save', damage: 6 }]), settings, before);
  await undoResolution('c1', 'r1', settings);
  const c = (await db.combat.get('c1'))!, ch = (await db.characters.get('p'))!;
  expect(c.combatants.find((x) => x.id === 'pc:p')!.economy).toBeUndefined();
  expect(c.combatants.find((x) => x.id === 'g1')).toMatchObject({ hp: 7, concentrating: true });
  expect([ch.state.hp, ch.state.slotsUsed]).toEqual([35, [0]]);
});

test('Undo leaves what changed since by other hands, giving back only its own HP', async () => {
  await applyResolution('c1', res('r1', [{ id: 'g1', hit: true, damage: 3 }]), settings);
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g1' ? { ...x, hp: 2, conditions: ['prone'] } : x)) })); // the DM's edits
  await undoResolution('c1', 'r1', settings);
  expect((await db.combat.get('c1'))!.combatants.find((x) => x.id === 'g1')).toMatchObject({ hp: 5, conditions: ['prone'] });
});

test('what a target brings: a monster\'s AC, saves (printed, else its ability modifier) and defenses; a PC\'s from its sheet', () => {
  const m = targetOf(g('g1'), { monster: goblin });
  expect(m).toMatchObject({ id: 'g1', ac: 15, pc: false, save: { dex: 2, str: -1 } });
  const sheet = computeSheet(pc(), { settings, viewer: 'dm' });
  expect(targetOf(pcC, { sheet })).toMatchObject({ id: 'pc:p', ac: sheet.ac, pc: true, save: { dex: sheet.saves.dex.bonus } });
});

const held = (id: string, o: Partial<Resolution> = {}) => res(id, [{ id: 'g1', part: 'save', save: { roll: 2, total: 2, ok: false }, damage: 0, inflict: ['Paralyzed', 'Hold Monster'] }],
  { actor: 'g2', action: 'Hold Monster', lasting: true, dc: 13, ability: 'wis', ...o });
const conds = async (id: string) => (await db.combat.get('c1'))!.combatants.find((x) => x.id === id)!.conditions ?? [];

test('a failed save leaves its conditions, the spell\'s own name too; Undo takes them back', async () => {
  await applyResolution('c1', held('r1'), settings);
  expect(await conds('g1')).toEqual(['Paralyzed', 'Hold Monster']);
  expect((await db.combat.get('c1'))!.resolutions![0].inflicted).toEqual([{ id: 'g1', condition: 'Paralyzed', bonus: 0 }, { id: 'g1', condition: 'Hold Monster', bonus: 0 }]);
  await undoResolution('c1', 'r1', settings);
  expect(await conds('g1')).toEqual([]);
});

test('a PC who fails the save from the pop-up gets the conditions; Undo takes them back', async () => {
  await applyResolution('c1', res('r1', [{ id: 'pc:p', part: 'save', pending: true, damage: 0, owed: [], inflicts: ['Paralyzed', 'Hold Person'] }],
    { actor: 'g2', action: 'Hold Person', lasting: true, dc: 13, ability: 'wis' }), settings);
  await settleSave('c1', 'r1', 'pc:p', 2, settings);
  expect((await db.characters.get('p'))!.state.conditions).toEqual(['Paralyzed', 'Hold Person']);
  await undoResolution('c1', 'r1', settings);
  expect((await db.characters.get('p'))!.state.conditions).toEqual([]);
});

test.each([
  ['the DM unticks Concentrating', () => updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g2' ? { ...x, concentrating: false } : x)) }))],
  ['damage drops the caster', () => changeHp('c1', 'g2', { damage: 20 }, settings)],
  ['the caster starts another concentration spell', () => updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g2' ? { ...x, concentratingOn: 'Fly' } : x)) }))],
])('when %s, the spell\'s conditions end, on monsters and PCs alike', async (_, end) => {
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'g2' ? { ...x, concentrating: true, concentratingOn: 'Hold Monster' } : x)) }));
  await applyResolution('c1', { ...held('r1'), outcomes: [...held('r1').outcomes, { id: 'pc:p', part: 'save', save: { roll: 2, total: 2, ok: false }, damage: 0, inflict: ['Paralyzed'] }] }, settings);
  expect((await db.characters.get('p'))!.state.conditions).toEqual(['Paralyzed']);
  await end();
  expect(await conds('g1')).toEqual([]);
  expect((await db.characters.get('p'))!.state.conditions).toEqual([]);
});

describe('saving again at the end of each turn', () => {
  const holdOn = (who: string, roll: number) => ({ id: who, part: 'save' as const, save: { roll, total: roll, ok: false }, damage: 0, inflict: ['Paralyzed', 'Hold Monster'] });
  const turnOf = (id: string) => updateCombat('c1', (c) => ({ ...c, round: 1, turn: id }));
  afterEach(() => vi.restoreAllMocks());

  test('a held monster saves again when its turn ends: a success frees it, a failure keeps it', async () => {
    await applyResolution('c1', res('r1', [holdOn('g1', 2)], { actor: 'g2', action: 'Hold Monster', lasting: true, dc: 13, ability: 'wis', repeat: true }), settings);
    await turnOf('g1');
    vi.spyOn(Math, 'random').mockReturnValue(0); // a 1
    await turn('c1', 'next');
    expect(await conds('g1')).toEqual(['Paralyzed', 'Hold Monster']);
    await turnOf('g1');
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // a 20
    await turn('c1', 'next');
    expect(await conds('g1')).toEqual([]);
    const last = (await db.combat.get('c1'))!.resolutions!.at(-1)!;
    expect(last).toMatchObject({ action: 'Hold Monster (repeat save)', outcomes: [{ id: 'g1', save: { roll: 20, total: 20, ok: true }, ends: ['Paralyzed', 'Hold Monster'] }] });
  });
  test('a held PC gets the save pop-up when its turn ends; a success frees it', async () => {
    await applyResolution('c1', res('r1', [{ ...holdOn('pc:p', 2), inflict: ['Paralyzed'] }], { actor: 'g2', action: 'Hold Person', lasting: true, dc: 13, ability: 'wis', repeat: true }), settings);
    await turnOf('pc:p');
    await turn('c1', 'next');
    const last = (await db.combat.get('c1'))!.resolutions!.at(-1)!;
    expect(last.outcomes).toEqual([expect.objectContaining({ id: 'pc:p', pending: true, ends: ['Paralyzed'] })]);
    await settleSave('c1', last.id, 'pc:p', 19, settings);
    expect((await db.characters.get('p'))!.state.conditions).toEqual([]);
  });
});

test('a once-only rider (a smite) is spent by a hit, kept after a miss', async () => {
  const smite = { spell: 'Searing Smite', dice: '1d6', type: 'fire', once: true as const };
  await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'pc:p' ? { ...x, rider: smite } : x)) }));
  const rider = async () => (await db.combat.get('c1'))!.combatants.find((x) => x.id === 'pc:p')!.rider;
  await applyResolution('c1', res('r1', [{ id: 'g1', hit: false, damage: 0 }]), settings);
  expect(await rider()).toEqual(smite);
  await applyResolution('c1', res('r2', [{ id: 'g1', hit: true, damage: 5 }], { spent: true }), settings);
  expect(await rider()).toBeUndefined();
  await undoResolution('c1', 'r2', settings);
  expect(await rider()).toEqual(smite);
});
