import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { workOut, type WorkIn } from '../../src/lib/combat/aiming.ts';
import { resolveSpell, targetOf } from '../../src/lib/combat/resolve.ts';
import { spellMods } from '../../src/lib/combat/spellEffects.ts';
import { applyResolution, settleSave, updateCombat } from '../../src/lib/combat/store.ts';
import { attackEdge } from '../../src/lib/combat/targeting.ts';
import type { TurnAction } from '../../src/lib/combat/turnActions.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { Combat, Combatant, Scene } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';

// Every Spell, Task 5: a spell's named condition carries its numbers (SPELL_EFFECTS) for whoever holds it, PC or monster.
const dm = { settings: DEFAULT_SETTINGS, viewer: 'dm' as const };
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const withConds = (names: string[], o: Parameters<typeof mkChar>[0] = { race: 'human', base: { dex: 15 }, levels: ['fighter'] }) => { const c = mkChar(o); return { ...c, state: { ...c.state, conditions: names } }; };

test('spellMods adds up what the named spells give', () => {
  const m = spellMods(['Bless', 'Shield', 'Faerie Fire', 'Poisoned']);
  expect(m.ac).toBe(5);
  expect(m.dice).toEqual([{ on: 'attack', dice: '1d4', from: 'Bless' }, { on: 'save', dice: '1d4', from: 'Bless' }]);
  expect(m.edges).toEqual([{ on: 'attacksAgainst', mode: 'adv', from: 'Faerie Fire' }]);
});

describe('on a character sheet', () => {
  const base = computeSheet(withConds([]), dm);
  test('AC bonuses and a floor, max HP, speed', () => {
    expect(computeSheet(withConds(['Shield of Faith']), dm).ac).toBe(base.ac + 2);
    expect(computeSheet(withConds(['Barkskin']), dm).ac).toBe(16); // 10 + Dex 3 = 13 → 16
    expect(computeSheet(withConds(['Barkskin'], { race: 'human', base: { dex: 17 }, levels: ['fighter'], inventory: [['half-plate', true]] }), dm).ac).toBe(17);
    expect(computeSheet(withConds(['Aid']), dm).maxHp).toBe(base.maxHp + 5);
    expect(computeSheet(withConds(['Longstrider']), dm).speed.walk).toBe(base.speed.walk + 10);
  });
});

describe('in a fight', () => {
  test('a monster holding Shield has +5 AC; Stoneskin resists nonmagical slashing; ending it brings the AC back', () => {
    const x = cb({ id: 'm', kind: 'monster', name: 'M', ac: 12, conditions: ['Shield', 'Stoneskin'] });
    const t = targetOf(x, {});
    expect(t.ac).toBe(17);
    expect(t.defenses.resist.join('; ')).toMatch(/slashing from nonmagical/);
    expect(targetOf({ ...x, conditions: [] }, {}).ac).toBe(12);
  });
  test('advantage against Faerie Fire, disadvantage against Blur', () => {
    const sides = { attacker: [], within5: false };
    expect(attackEdge({ ...sides, target: ['Faerie Fire'] }).adv).toContain('target has Faerie Fire');
    expect(attackEdge({ ...sides, target: ['Blur'] }).dis).toContain('target has Blur');
  });
  test('a Hasted monster saves on Dex with advantage', () => {
    const rolls = [0.05, 0.95]; // 2, then 20: the higher is kept
    const out = resolveSpell({ save: 'Dex', onSave: 'none', damage: [] } as never, [], 15, undefined, targetOf(cb({ id: 'm', kind: 'monster', name: 'M', conditions: ['Haste'] }), {}), [], { dmg: [] }, () => rolls.shift() ?? 0.5);
    expect(out[0].save).toMatchObject({ roll: 20, ok: true });
  });

  const cell = (q: number) => ({ x: 35 + 70 * q, y: 35 });
  const scene: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 1400, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0, tokens: [
    { id: 't-a', name: 'A', ...cell(0), size: 'M', color: '#000000', combatantId: 'a' }, { id: 't-b', name: 'B', ...cell(1), size: 'M', color: '#000000', combatantId: 'b' }] };
  const bow: TurnAction = { id: 'm', name: 'Claw', cost: 'action', group: 'monster', text: [{ p: 'Melee Weapon Attack: +3 to hit, reach 5 ft., one target. Hit: 4 (1d4 + 2) slashing damage.' }] };
  const work = (attacker: string[], rng: () => number) => {
    const k: Combat = { campaignId: 'c1', round: 1, turn: 'a', groupMonsters: false, updatedAt: 0, combatants: [cb({ id: 'a', kind: 'monster', name: 'A', conditions: attacker }), cb({ id: 'b', kind: 'monster', name: 'B', ac: 14 })] };
    const i: WorkIn = { a: bow, features: [], actor: k.combatants[0], combat: k, scene, diagonal: '5-5-5', aim: { target: 'b', rolled: { d20: [10, 1], dmg: [[3]] }, toggles: [] },
      findTarget: (id) => k.combatants.find((z) => z.id === id), info: (z) => targetOf(z, {}), nameOf: (z) => z.name, magical: false, id: 'r', now: 0, rng };
    return workOut(i);
  };
  test('Bless adds a d4 to an attack, rolled on the DM\'s device; Bane takes one off', async () => {
    const plain = await work([], () => 0.99), blessed = await work(['Bless'], () => 0.99), baned = await work(['Bane'], () => 0.99);
    if (typeof plain === 'string' || typeof blessed === 'string' || typeof baned === 'string') throw new Error('not worked out');
    expect([plain.resolution.outcomes[0].hit, blessed.resolution.outcomes[0].hit]).toEqual([false, true]); // 10+3 = 13 vs AC 14; +4 → 17
    expect(blessed.resolution.outcomes[0].note).toMatch(/Bless \+4/);
    expect(baned.resolution.outcomes[0].roll).toBe(9);
    expect(Object.keys(blessed.outcome)).not.toContain('ac'); // Review Focus 5: the roller hears hit or miss only
  });
});

describe('a PC\'s save', () => {
  beforeEach(async () => { await resetDb(); await db.campaigns.put(camp('c1')); });
  test('Bless adds its d4 to a player\'s pending save', async () => {
    await db.characters.put({ ...char('p', 'c1'), state: { ...char('p').state, hp: 20, conditions: ['Bless'] } });
    await updateCombat('c1', (c) => ({ ...c, combatants: [cb({ id: 'pc:p', kind: 'pc', name: 'p', characterId: 'p' })] }));
    await applyResolution('c1', { id: 'r1', actor: 'x', action: 'Fear', dc: 15, ability: 'wis', outcomes: [{ id: 'pc:p', part: 'save', pending: true, damage: 0, owed: [] }], at: 0 }, camp('c1').settings);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const k = await settleSave('c1', 'r1', 'pc:p', 12, camp('c1').settings);
    vi.restoreAllMocks();
    expect(k!.resolutions![0].outcomes[0].save).toMatchObject({ roll: 12, total: 12 + computeSheet((await db.characters.get('p'))!, dm).saves.wis.bonus + 4 });
  });
});

test('a Hasted creature (kept on the combatant) has +2 AC and saves on Dex with advantage', () => {
  const t = targetOf(cb({ id: 'm', kind: 'monster', name: 'M', ac: 12, hasted: { by: 'c', round: 1 } }), {});
  expect([t.ac, t.conditions]).toEqual([14, ['Haste']]);
  expect(targetOf(cb({ id: 'm', kind: 'monster', name: 'M', ac: 12, hasted: { by: 'c', round: 1, ended: true } }), {}).ac).toBe(12);
});
