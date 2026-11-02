import { describe, expect, test } from 'vitest';
import { aimPlan, pickableAt, workOut, type WorkIn } from '../../src/lib/combat/aiming.ts';
import { targetOf } from '../../src/lib/combat/resolve.ts';
import type { TurnAction } from '../../src/lib/combat/turnActions.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import type { Combat, Combatant, Scene } from '../../src/lib/types.ts';

// What an action needs to be aimed, and the DM's own monster attack worked out on the scene (the host's player path is in sync tests).
const cell = (q: number, r = 0) => ({ x: 35 + 70 * q, y: 35 + 70 * r });
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const monster = (text: string): TurnAction => ({ id: 'm', name: 'Shortbow', cost: 'action', group: 'monster', text: [{ p: text }] });
const spell = (read: object, range = { feet: 60 }): TurnAction => ({ id: 's', name: 'S', cost: 'action', group: 'spell', spell: { id: 's', level: 1, concentration: false },
  cast: { read: { damage: [], range, ...read } as never, attack: 5, dc: 13, charLevel: 1, mod: 3 } });

describe('aimPlan', () => {
  test('a weapon with Great Weapon Master on: -5 to hit, +10 damage as one more expression', () => {
    const a: TurnAction = { id: 'a', name: 'Greatsword', cost: 'action', group: 'attack', attack: { entryId: 'e', name: 'Greatsword', toHit: 7, damage: '2d6+4', damageType: 'slashing', properties: ['heavy'] } };
    expect(aimPlan(a, { toggles: [{ id: 'gwm', name: 'GWM', toHit: -5, damage: 10 }] })).toMatchObject({ attack: true, toHit: 2, line: false, dice: [{ expr: '2d6+4' }, { expr: '10' }] });
  });
  test('a monster bow draws a line; a breath weapon (no to-hit) is not aimed', () => {
    expect(aimPlan(monster('Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.'))).toMatchObject({ line: true, toHit: 4, reach: { normal: 80, long: 320 } });
    expect(aimPlan(monster('The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 21 Dexterity saving throw.'))).toBeUndefined();
  });
  test('a burst lands on its creature; a pure area (Sleep) on any point in range; a self cone from the caster', () => {
    expect(aimPlan(spell({ attack: 'ranged', save: 'Dex', burst: 5 }))!.area).toEqual({ shape: 'sphere', feet: 5, on: 'creature' });
    expect(aimPlan(spell({ area: { shape: 'sphere', feet: 20, self: false } }, { feet: 90 }))!.area).toEqual({ shape: 'sphere', feet: 20, on: 'point', range: 90 });
    expect(aimPlan(spell({ save: 'Dex', area: { shape: 'cone', feet: 15, self: true } }, 'self' as never))!.area).toEqual({ shape: 'cone', feet: 15, on: 'self' });
    expect(aimPlan(spell({}))).toBeUndefined();
  });
});

describe('reach and range by the book', () => {
  const g = { ...DEFAULT_GRID };
  const sword: TurnAction = { id: 'a', name: 'Longsword', cost: 'action', group: 'attack', attack: { entryId: 'e', name: 'Longsword', toHit: 5, damage: '1d8+3', damageType: 'slashing', properties: [] } };
  const bow: TurnAction = { id: 'b', name: 'Longbow', cost: 'action', group: 'attack', attack: { entryId: 'b', name: 'Longbow', toHit: 5, damage: '1d8+3', damageType: 'piercing', properties: ['heavy'], ranged: true, range: [150, 600] } };
  test('reach counts from the nearest square a big creature fills: a Huge one beside you is 5 ft away', () => {
    expect(pickableAt(aimPlan(sword)!, g, '5-5-5', { ...cell(0), size: 'M' }, false, { ...cell(2), size: 'H' })).toEqual({ ok: true });
    expect(pickableAt(aimPlan(sword)!, g, '5-5-5', { ...cell(0), size: 'M' }, false, { x: 35 + 70 * 1.5, y: 35 + 35, size: 'L' })).toEqual({ ok: true });
  });
  test('Sharpshooter: no disadvantage at long range; Crossbow Expert: none with a hostile within 5 ft', () => {
    const far = { ...cell(40), size: 'M' as const }, me = { ...cell(0), size: 'M' as const };
    expect(pickableAt(aimPlan(bow)!, g, '5-5-5', me, false, far)).toEqual({ ok: true, disadvantage: 'long range' });
    expect(pickableAt(aimPlan(bow, { features: ['Sharpshooter'] })!, g, '5-5-5', me, false, far)).toEqual({ ok: true });
    expect(pickableAt(aimPlan(bow, { features: ['Crossbow Expert'] })!, g, '5-5-5', me, true, { ...cell(4), size: 'M' })).toEqual({ ok: true });
  });
  test('an area that hurts only those who enter it or start a turn in it (Moonbeam): placed and listed, nothing rolled now', () => {
    const p = aimPlan(spell({ save: 'Con', damage: [{ dice: '2d10', type: 'radiant' }], area: { shape: 'cylinder', feet: 5, self: false }, lingering: true }, { feet: 120 }))!;
    expect(p.area).toMatchObject({ shape: 'cylinder', on: 'point' });
    expect([p.dice, p.read?.save, p.attack]).toEqual([[], undefined, false]);
  });
});

describe('workOut on the DM\'s map', () => {
  const scene: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 1400, height: 1400, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0, tokens: [
    { id: 't-g', name: 'Goblin', ...cell(0), size: 'M', color: '#000000', combatantId: 'g' },
    { id: 't-p', name: 'Thorin', ...cell(3), size: 'M', color: '#000000', characterId: 'thorin' },
    { id: 't-q', name: 'Mira', ...cell(1), size: 'M', color: '#000000', characterId: 'mira' },
  ] };
  const k: Combat = { campaignId: 'c1', round: 1, turn: 'g', groupMonsters: false, updatedAt: 0, combatants: [
    cb({ id: 'g', kind: 'monster', name: 'Goblin' }), cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin' }), cb({ id: 'pc:mira', kind: 'pc', name: 'Mira', characterId: 'mira' }),
  ] };
  const base = (a: TurnAction, rolled: WorkIn['aim']['rolled']): WorkIn => ({ a, features: [], actor: k.combatants[0], combat: k, scene, diagonal: '5-5-5',
    aim: { target: 'pc:thorin', rolled, toggles: [] }, findTarget: (id) => k.combatants.find((z) => z.id === id),
    info: (z) => ({ ...targetOf(z, {}), ac: 14 }), nameOf: (z) => z.name, magical: false, id: 'r1', now: 0, rng: () => 0.5 });
  const bow = monster('Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.');

  test('a goblin\'s bow at a PC 15 ft away, with a PC beside it: disadvantage (close combat), so the lower d20 counts', async () => {
    const r = await workOut(base(bow, { d20: [18, 6], dmg: [[4]] }));
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', hit: false, roll: 10 }] } });
  });
  test('one d20 when disadvantage is forced is refused', async () => {
    expect(await workOut(base(bow, { d20: [18], dmg: [[4]] }))).toBe('bad d20');
  });
  test('a ranged spell attack gets the close-combat disadvantage too', async () => {
    const r = await workOut(base(spell({ attack: 'ranged', damage: [{ dice: '1d10', type: 'fire' }] }), { d20: [19, 3], dmg: [[5]] }));
    expect(r).toMatchObject({ resolution: { outcomes: [{ hit: false, roll: 8 }] } });
  });
});
