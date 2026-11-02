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
    expect(aimPlan(spell({ save: 'Dex' }))).toBeUndefined(); // a save that does nothing here (Light): no Target
    expect(aimPlan(spell({ save: 'Wis', conditions: ['Paralyzed'] }))).toBeDefined();
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
  test('advantage against a prone PC within 5 ft: the higher d20 counts', async () => {
    const claws = monster('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.');
    const r = await workOut({ ...base(claws, { d20: [3, 18], dmg: [[4]] }), aim: { target: 'pc:mira', rolled: { d20: [3, 18], dmg: [[4]] }, toggles: [] },
      conditionsOf: (z) => (z.id === 'pc:mira' ? ['Prone'] : []) });
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'pc:mira', hit: true, roll: 22, edge: 'advantage: target is prone (within 5 ft)' }] } });
  });
  test('a hit on a paralyzed creature within 5 ft is a critical: its dice come doubled', async () => {
    const claws = monster('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.');
    const r = await workOut({ ...base(claws, { d20: [12, 5], dmg: [[4, 6]] }), aim: { target: 'pc:mira', rolled: { d20: [12, 5], dmg: [[4, 6]] }, toggles: [] },
      conditionsOf: (z) => (z.id === 'pc:mira' ? ['Paralyzed'] : []) });
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'pc:mira', hit: true, damage: 12 }] } });
  });
  test('a chosen damage type: needed before it is worked out, and it is the type the target\'s defenses see', async () => {
    const orb = spell({ attack: 'ranged', damage: [{ dice: '3d8', type: '' }], choices: ['acid', 'fire'] });
    expect(aimPlan(orb)).toMatchObject({ choices: ['acid', 'fire'], dice: [{ type: '' }] });
    expect(aimPlan(orb, { dtype: 'fire' })).toMatchObject({ dice: [{ type: 'fire' }] });
    expect(aimPlan(orb, { dtype: 'cold' })).toMatchObject({ dice: [{ type: '' }] });
    const at = (dtype?: string) => ({ ...base(orb, { d20: [18, 18], dmg: [[4, 4, 4]] }), aim: { target: 'pc:thorin', rolled: { d20: [18, 18], dmg: [[4, 4, 4]] }, toggles: [], ...(dtype && { dtype }) },
      info: (z: Combatant) => ({ ...targetOf(z, {}), ac: 14, defenses: { resist: ['fire'], immune: [], vulnerable: [] } }) });
    expect(await workOut(at())).toBe('pick a damage type');
    expect(await workOut(at('fire'))).toMatchObject({ resolution: { outcomes: [{ hit: true, damage: 6 }] } });
    expect(await workOut(at('acid'))).toMatchObject({ resolution: { outcomes: [{ hit: true, damage: 12 }] } });
  });
  test('Chaos Bolt: of the two d8s, the type that hurts more', async () => {
    const bolt = spell({ attack: 'ranged', damage: [{ dice: '2d8+1d6', type: '' }], choices: ['acid', 'cold', 'fire'],
      typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] } });
    const rolled = { d20: [18, 18], dmg: [[3, 2, 4]] }; // d8s 3 (fire) and 2 (cold)
    const r = await workOut({ ...base(bolt, rolled), info: (z: Combatant) => ({ ...targetOf(z, {}), ac: 14, defenses: { resist: ['fire'], immune: [], vulnerable: [] } }) });
    expect(r).toMatchObject({ resolution: { outcomes: [{ hit: true, damage: 9, note: 'cold (d8 2)' }] } });
  });
  test('darts that always hit: no d20, all the damage to the one target', async () => {
    const darts = spell({ auto: { count: 3, above: 1 }, damage: [{ dice: '1d4+1', type: 'force' }] });
    expect(aimPlan(darts)).toMatchObject({ attack: false, dice: [{ expr: '3d4+3' }] });
    const r = await workOut(base(darts, { dmg: [[1, 2, 3]] }));
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', part: 'hit', hit: true, damage: 9 }] }, outcome: { hit: true } });
  });
  test('a ranged spell attack gets the close-combat disadvantage too', async () => {
    const r = await workOut(base(spell({ attack: 'ranged', damage: [{ dice: '1d10', type: 'fire' }] }), { d20: [19, 3], dmg: [[5]] }));
    expect(r).toMatchObject({ resolution: { outcomes: [{ hit: false, roll: 8 }] } });
  });
});
