import { describe, expect, test } from 'vitest';
import { aimPlan, entersIn, pickableAt, startsIn, workOut, type WorkIn } from '../../src/lib/combat/aiming.ts';
import { targetOf } from '../../src/lib/combat/resolve.ts';
import { readSpell } from '../../src/lib/combat/spellText.ts';
import type { TurnAction } from '../../src/lib/combat/turnActions.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import type { Combat, Combatant, Resolution, Scene, SpellDef } from '../../src/lib/types.ts';

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
    expect(aimPlan(spell({ save: 'Wis' }))).toMatchObject({ dice: [] }); // a save-only spell (Suggestion): Target, so the monster's save is rolled
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
  test('a lasting spell\'s failed save also leaves a condition named after it; an instant one only its own', async () => {
    const at = (read: object) => workOut({ ...base({ ...spell({ save: 'Wis', ...read }), name: 'Hold Monster' }, { dmg: [] }), aim: { target: 'g', rolled: { dmg: [] }, toggles: [] } });
    expect(await at({ conditions: ['Paralyzed'], rounds: 10 })).toMatchObject({ resolution: { outcomes: [{ id: 'g', inflict: ['Paralyzed', 'Hold Monster'] }] } });
    expect(await at({ conditions: ['Prone'] })).toMatchObject({ resolution: { outcomes: [{ id: 'g', inflict: ['Prone'] }] } });
  });
  test('extra damage on hits: one more expression of the rider\'s type (else the weapon\'s); only against a marked target; doubled on a crit', async () => {
    const sword: TurnAction = { id: 'a', name: 'Longsword', cost: 'action', group: 'attack', attack: { entryId: 'e', name: 'Longsword', toHit: 5, damage: '1d8+3', damageType: 'slashing', properties: [] } };
    expect(aimPlan(sword, { rider: { dice: '1d4', type: 'radiant' } })!.dice).toEqual([{ expr: '1d8+3', type: 'slashing' }, { expr: '1d4', type: 'radiant' }]);
    expect(aimPlan(sword, { rider: { dice: '1d6', type: '' } })!.dice[1]).toEqual({ expr: '1d6', type: 'slashing' });
    const hexed = (on: string, rolled: WorkIn['aim']['rolled']) => workOut({ ...base(bow, rolled), actor: { ...k.combatants[0], rider: { spell: 'Hex', dice: '1d6', type: 'necrotic', target: on } } });
    expect(await hexed('pc:thorin', { d20: [18, 18], dmg: [[4], [3]] })).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', hit: true, damage: 9 }] } });
    expect(await hexed('pc:mira', { d20: [18, 18], dmg: [[4], [3]] })).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', hit: true, damage: 6 }] } });
    expect(await hexed('pc:thorin', { d20: [20, 20], dmg: [[4, 4], [3, 3]] })).toMatchObject({ resolution: { outcomes: [{ hit: true, damage: 16 }] } });
  });
  test('a marked rider spell (Hex) is aimed at its creature: no dice; the mark and a condition named after it', async () => {
    const hex = { ...spell({ rider: { dice: '1d6', type: 'necrotic', marked: true }, damage: [{ dice: '1d6', type: 'necrotic' }] }), name: 'Hex' };
    expect(aimPlan(hex)).toMatchObject({ attack: false, dice: [], mark: true });
    expect(await workOut({ ...base(hex, { dmg: [] }), aim: { target: 'g', rolled: { dmg: [] }, toggles: [] } }))
      .toMatchObject({ resolution: { mark: 'g', rider: { spell: 'Hex', dice: '1d6', type: 'necrotic', target: 'g' }, outcomes: [{ id: 'g', damage: 0, inflict: ['Hex'] }] } });
  });
  test('a lasting area that deals damage over time: who starts a turn in it', () => {
    const beam: Resolution = { id: 'r', actor: 'pc:mira', action: 'Moonbeam', outcomes: [], applied: [], at: 0, sceneId: 's1', round: 1, lasting: true,
      area: { shape: 'cylinder', origin: cell(0), aim: cell(0), feet: 5 }, linger: { dice: [{ expr: '2d10', type: 'radiant' }], read: { damage: [], save: 'Con', onSave: 'half' }, dc: 13 } };
    const at = (concentrating: boolean) => ({ ...k, resolutions: [beam], combatants: k.combatants.map((x) => (x.id === 'pc:mira' ? { ...x, concentrating, concentratingOn: 'Moonbeam' } : x)) });
    expect(startsIn(at(true), scene, 'g')).toEqual([beam]);
    expect(startsIn(at(true), scene, 'pc:thorin')).toEqual([]);
    expect(startsIn(at(false), scene, 'g')).toEqual([]);
  });
  test('casting a damage-over-time spell keeps its dice and DC for the turns to come; nothing is rolled now', async () => {
    const moon = { ...spell({ save: 'Con', onSave: 'half', lingering: true, damage: [{ dice: '2d10', type: 'radiant' }], area: { shape: 'cylinder', feet: 5, self: false } }), name: 'Moonbeam' };
    expect(aimPlan(moon)).toMatchObject({ dice: [], linger: { dice: [{ expr: '2d10', type: 'radiant' }] } });
    const r = await workOut({ ...base(moon, { dmg: [] }), aim: { point: cell(0), rolled: { dmg: [] }, toggles: [] } });
    expect(r).toMatchObject({ resolution: { outcomes: [], linger: { dice: [{ expr: '2d10', type: 'radiant' }], read: { save: 'Con' }, dc: 13 } } });
  });
  test('Chaos Bolt cast by a PC: the hit waits for its player to pick a d8; each pick\'s damage is worked out now (resistance and all)', async () => {
    const bolt = spell({ attack: 'ranged', leap: 30, damage: [{ dice: '2d8+1d6', type: '' }], typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] } });
    const rolled = { d20: [18, 18], dmg: [[3, 2, 4]] }; // d8s 3 (fire) and 2 (cold)
    const r = await workOut({ ...base(bolt, rolled), actor: k.combatants[1], aim: { target: 'g', rolled, toggles: [] },
      info: (z: Combatant) => ({ ...targetOf(z, {}), ac: 14, defenses: { resist: ['fire'], immune: [], vulnerable: [] } }) });
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'g', hit: true, damage: 0, choose: [{ face: 3, type: 'fire', damage: 4 }, { face: 2, type: 'cold', damage: 9 }] }] } });
  });
  test('a slowing ray: a hit leaves a condition named after the spell with its speed cut, for one round; a miss leaves nothing', async () => {
    const frost = { ...spell({ attack: 'ranged', slow: { feet: 10 }, damage: [{ dice: '1d8', type: 'cold' }] }), name: 'Ray of Frost' };
    expect(await workOut(base(frost, { d20: [18, 18], dmg: [[4]] }))).toMatchObject({ resolution: { rounds: 1, outcomes: [{ id: 'pc:thorin', hit: true, inflict: ['Ray of Frost (speed −10 ft)'] }] } });
    const miss = await workOut(base(frost, { d20: [2, 2], dmg: [[4]] }));
    expect(typeof miss !== 'string' && miss.resolution.outcomes[0].inflict).toBeFalsy();
  });
  test('Hex on a spell attack: its dice ride each hit on the marked creature', async () => {
    const bolt = spell({ attack: 'ranged', damage: [{ dice: '1d10', type: 'fire' }] });
    const hexed = (on: string) => workOut({ ...base(bolt, { d20: [18, 18], dmg: [[5], [3]] }), actor: { ...k.combatants[0], rider: { spell: 'Hex', dice: '1d6', type: 'necrotic', target: on, anyAttack: true } } });
    expect(await hexed('pc:thorin')).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', hit: true, damage: 8 }] } });
    expect(await hexed('pc:mira')).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', hit: true, damage: 5 }] } });
  });
  test('a concentration spell\'s result knows which casting it is (the caster\'s next)', async () => {
    const hold = { ...spell({ save: 'Wis', conditions: ['Paralyzed'] }), spell: { id: 's', level: 2, concentration: true } };
    const r = await workOut({ ...base(hold, { dmg: [] }), actor: { ...k.combatants[0], concentrationCount: 4 }, aim: { target: 'pc:thorin', rolled: { dmg: [] }, toggles: [] } });
    expect(r).toMatchObject({ resolution: { lasting: true, cast: 5 } });
  });
  test('Chaos Bolt: of the two d8s, the type that hurts more', async () => {
    const bolt = spell({ attack: 'ranged', damage: [{ dice: '2d8+1d6', type: '' }], choices: ['acid', 'cold', 'fire'],
      typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] } });
    const rolled = { d20: [18, 18], dmg: [[3, 2, 4]] }; // d8s 3 (fire) and 2 (cold)
    const r = await workOut({ ...base(bolt, rolled), info: (z: Combatant) => ({ ...targetOf(z, {}), ac: 14, defenses: { resist: ['fire'], immune: [], vulnerable: [] } }) });
    expect(r).toMatchObject({ resolution: { outcomes: [{ hit: true, damage: 9, note: 'cold (d8 2)' }] } });
  });
  test('darts that always hit: a target per dart (repeats allowed), each its own damage', async () => {
    const darts = spell({ auto: { count: 3, above: 1 }, damage: [{ dice: '1d4+1', type: 'force' }] });
    expect(aimPlan(darts)).toMatchObject({ attack: false, count: 3, dice: [{ expr: '1d4+1' }] });
    expect(aimPlan(darts, { level: 3 })!.count).toBe(5);
    const r = await workOut({ ...base(darts, { dmg: [[1], [2], [3]] }), aim: { targets: ['g', 'g', 'pc:thorin'], rolled: { dmg: [[1], [2], [3]] }, toggles: [] } });
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'g', damage: 2 }, { id: 'g', damage: 3 }, { id: 'pc:thorin', damage: 4 }] }, outcome: { hit: true, hits: [true, true, true] } });
    expect(await workOut({ ...base(darts, { dmg: [[1], [2]] }), aim: { targets: ['g', 'g'], rolled: { dmg: [[1], [2]] }, toggles: [] } })).toBe('pick a target');
  });
  test('rays: each its own d20 against its own target; the wrong number of d20s is refused', async () => {
    const rays = { ...spell({ attack: 'ranged', rays: { count: 3, above: 2 }, damage: [{ dice: '2d6', type: 'fire' }] }), spell: { id: 's', level: 2, concentration: false } };
    expect(aimPlan(rays, { level: 3 })!.count).toBe(4);
    const rolled = { d20: [18, 18, 2, 2, 18, 18], dmg: [[3, 3], [3, 3], [3, 3]] };
    const r = await workOut({ ...base(rays, rolled), level: 2, aim: { targets: ['pc:thorin', 'pc:thorin', 'pc:mira'], rolled, toggles: [] } });
    expect(r).toMatchObject({ resolution: { outcomes: [{ id: 'pc:thorin', hit: true }, { id: 'pc:thorin', hit: false }, { id: 'pc:mira', hit: true }] }, outcome: { hits: [true, false, true] } });
    expect(await workOut({ ...base(rays, rolled), level: 2, aim: { targets: ['pc:thorin', 'pc:thorin', 'pc:mira'], rolled: { ...rolled, d20: [18, 18] }, toggles: [] } })).toBe('bad d20');
  });
  test('Chaos Bolt\'s leap: from the first target, within 30 ft of it, never a creature already hit; no new payment', async () => {
    const bolt = spell({ attack: 'ranged', leap: 30, damage: [{ dice: '2d8+1d6', type: '' }], typeFromDie: { sides: 8, types: ['acid', 'cold', 'fire', 'force', 'lightning', 'poison', 'psychic', 'thunder'] } });
    const rolled = { d20: [18, 18], dmg: [[3, 3, 4]] };
    expect(await workOut(base(bolt, rolled))).toMatchObject({ resolution: { outcomes: [{ hit: true, leap: true }] }, outcome: { leap: 'r1' } });
    const leap = (target: string, a = bolt) => workOut({ ...base(a, { d20: [18, 18], dmg: [[1, 2, 4]] }), aim: { target, rolled: { d20: [18, 18], dmg: [[1, 2, 4]] }, toggles: [] }, leapFrom: { from: 'pc:thorin', exclude: ['pc:thorin'] } });
    expect(await leap('pc:mira')).toMatchObject({ resolution: { outcomes: [{ id: 'pc:mira', hit: true }], chain: ['pc:thorin', 'pc:mira'] } });
    expect(await leap('pc:thorin')).toBe('pick another creature');
    expect(await leap('pc:mira', { ...bolt, cast: { ...bolt.cast!, read: { ...bolt.cast!.read, leap: 5 } } })).toBe('out of range'); // Mira is 10 ft from Thorin
  });
  test('a ranged spell attack gets the close-combat disadvantage too', async () => {
    const r = await workOut(base(spell({ attack: 'ranged', damage: [{ dice: '1d10', type: 'fire' }] }), { d20: [19, 3], dmg: [[5]] }));
    expect(r).toMatchObject({ resolution: { outcomes: [{ hit: false, roll: 8 }] } });
  });
});

test('a lasting area of a chosen type asks for it and keeps it for the turns to come (Spirit Guardians)', () => {
  const read = { save: 'Wis', onSave: 'half', damage: [{ dice: '3d8', type: '' }], choices: ['radiant', 'necrotic'], area: { shape: 'sphere', feet: 15, self: true }, lingering: true, range: 'self' };
  const a = { id: 's', name: 'S', cost: 'action', group: 'spell', spell: { id: 's', level: 3, concentration: true }, cast: { read, attack: 5, dc: 13, charLevel: 5, mod: 3 } } as never;
  expect(aimPlan(a)!.choices).toEqual(['radiant', 'necrotic']);
  expect(aimPlan(a, { dtype: 'necrotic' })!.linger!.dice[0].type).toBe('necrotic');
});

// Every Spell, Task 6: helpful spells (buffs, healing, temp HP) land on allies, the caster included.
describe('helpful spells', () => {
  const k: Combat = { campaignId: 'c1', round: 1, turn: 'a', groupMonsters: false, updatedAt: 0, combatants: [cb({ id: 'a', kind: 'monster', name: 'A' }), ...['b', 'c', 'd', 'e', 'f'].map((id) => cb({ id, kind: 'monster', name: id.toUpperCase() }))] };
  const sc: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 1400, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
    tokens: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, q) => ({ id: `t-${id}`, name: id, ...cell(q), size: 'M' as const, color: '#000000', combatantId: id })) };
  const cast = (name: string, read: object, level = 1, concentration = false): TurnAction => ({ id: 's', name, cost: 'action', group: 'spell', spell: { id: 's', level, concentration },
    cast: { read: { damage: [], range: { feet: 30 }, ...read } as never, attack: 5, dc: 13, charLevel: 3, mod: 3 } });
  const run = (a: TurnAction, aim: Partial<WorkIn['aim']>, level?: number) => workOut({ a, ...(level && { level }), features: [], actor: k.combatants[0], combat: k, scene: sc, diagonal: '5-5-5',
    aim: { rolled: { dmg: [] }, toggles: [], ...aim }, findTarget: (id) => k.combatants.find((z) => z.id === id), info: (z) => targetOf(z, {}), nameOf: (z) => z.name, magical: false, id: 'r', now: 0, rng: () => 0.5 });
  const bless = cast('Bless', { targets: { count: 3, above: 1 }, rounds: 10 }, 1, true);
  test('Bless takes three at 1st level, four at 2nd, never five; each gets the condition, kept while concentrating', async () => {
    expect(aimPlan(bless)!.helps).toEqual({ max: 3 });
    expect(aimPlan(bless, { level: 2 })!.helps).toEqual({ max: 4 });
    const r = await run(bless, { targets: ['a', 'b', 'c', 'd'] }, 2);
    if (typeof r === 'string') throw new Error(r);
    expect(r.resolution.outcomes.map((o) => [o.id, o.inflict])).toEqual([['a', ['Bless']], ['b', ['Bless']], ['c', ['Bless']], ['d', ['Bless']]]);
    expect(r.resolution.lasting).toBe(true);
    expect(await run(bless, { targets: ['a', 'b', 'c', 'd', 'e'] }, 2)).toBe('too many targets');
  });
  test('Shield (range Self) lands on the caster with no pick, until the start of its next turn', async () => {
    const r = await run(cast('Shield', { range: 'self', rounds: 1 }), {});
    if (typeof r === 'string') throw new Error(r);
    expect([r.resolution.outcomes[0].id, r.resolution.outcomes[0].inflict, r.resolution.rounds]).toEqual(['a', ['Shield'], 1]);
  });
  test('healing heals its target its dice plus the modifier; temp HP the same', async () => {
    const cure = cast('Cure Wounds', { range: 'touch', heal: { dice: '1d8', mod: true }, perSlot: { dice: '1d8', above: 1, step: 1 } });
    expect(aimPlan(cure)!.dice).toEqual([{ expr: '1d8+3', type: 'healing' }]);
    const r = await run(cure, { target: 'b', rolled: { dmg: [[6]] } });
    if (typeof r === 'string') throw new Error(r);
    expect(r.resolution.outcomes).toEqual([{ id: 'b', damage: 0, heal: 9 }]);
    const life = await run(cast('False Life', { range: 'self', temp: { dice: '1d4+4', perSlot: 5 } }), { rolled: { dmg: [[3]] } }, 2);
    if (typeof life === 'string') throw new Error(life);
    expect(life.resolution.outcomes).toEqual([{ id: 'a', damage: 0, temp: 12 }]); // 3 + 4, +5 at 2nd level
  });
});

// Final review: a save spell on "up to N creatures" (Bane) takes that many at its slot, each once, and may take fewer.
describe('save spells on several creatures', () => {
  const k: Combat = { campaignId: 'c1', round: 1, turn: 'a', groupMonsters: false, updatedAt: 0, combatants: ['a', 'b', 'c', 'd', 'e'].map((id) => cb({ id, kind: 'monster', name: id.toUpperCase() })) };
  const sc: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 1400, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
    tokens: ['a', 'b', 'c', 'd', 'e'].map((id, q) => ({ id: `t-${id}`, name: id, ...cell(q), size: 'M' as const, color: '#000000', combatantId: id })) };
  const bane: TurnAction = { id: 's', name: 'Bane', cost: 'action', group: 'spell', spell: { id: 's', level: 1, concentration: true },
    cast: { read: { damage: [], range: { feet: 30 }, save: 'Cha', onSave: 'none', targets: { count: 3, above: 1 } } as never, attack: 5, dc: 13, charLevel: 3, mod: 3 } };
  const run = (targets: string[], level = 1) => workOut({ a: bane, level, features: [], actor: k.combatants[0], combat: k, scene: sc, diagonal: '5-5-5',
    aim: { targets, rolled: { dmg: [] }, toggles: [] }, findTarget: (id) => k.combatants.find((z) => z.id === id), info: (z) => targetOf(z, {}), nameOf: (z) => z.name, magical: false, id: 'r', now: 0, rng: () => 0.01 });
  test('three at 1st level, four at 2nd; fewer is fine, the same creature twice is not', async () => {
    expect([aimPlan(bane)!.count, aimPlan(bane)!.upTo]).toEqual([3, true]);
    expect(aimPlan(bane, { level: 2 })!.count).toBe(4);
    const r = await run(['b', 'c']);
    if (typeof r === 'string') throw new Error(r);
    expect(r.resolution.outcomes.map((o) => o.id)).toEqual(['b', 'c']);
    expect(await run(['b', 'b'])).toBe('pick each creature once');
    expect(await run(['b', 'c', 'd', 'e'])).toBe('too many targets');
  });
});

// Final-review minors: True Strike is the caster's own (no enemy to pick); Aid heals 5 as it raises maximum HP.
test('True Strike goes on the caster; Aid heals 5 with its condition', () => {
  const sp = (name: string, p: string, level: number): TurnAction => {
    const read = readSpell({ name, level, range: '30 feet', text: [{ p }] } as unknown as SpellDef);
    return { id: 's', name, cost: 'action', group: 'spell', spell: { id: 's', level, concentration: false }, cast: { read, attack: 5, dc: 13, charLevel: 3, mod: 3 } };
  };
  const ts = aimPlan(sp('True Strike', 'You point a finger at a target in range.', 0))!;
  expect([ts.reach, ts.helps]).toEqual(['self', { max: 1 }]);
  expect(aimPlan(sp('Aid', 'Choose up to three creatures within range. Each target\'s hit point maximum and current hit points increase by 5 for the duration.', 2))!.dice).toEqual([{ expr: '5', type: 'healing' }]);
});

// Toll the Dead end to end (paraphrased wording): the d8 against an unhurt target, the d12 instead against a hurt one, from one roll of both.
test('Toll the Dead deals its d12 only to a target missing hit points', async () => {
  const read = readSpell({ name: 'Toll the Dead', level: 0, range: '60 feet', text: [{ p: 'The target must succeed on a Wisdom saving throw or take 1d8 necrotic damage. If the target is missing any of its hit points, it instead takes 1d12 necrotic damage.' }] } as unknown as SpellDef);
  const a: TurnAction = { id: 's', name: 'Toll the Dead', cost: 'action', group: 'spell', spell: { id: 's', level: 0, concentration: false }, cast: { read, attack: 5, dc: 13, charLevel: 1, mod: 3 } };
  const plan = aimPlan(a)!;
  expect(plan.dice.map((d) => [d.expr, d.part])).toEqual([['1d8', undefined], ['1d12', 'alt']]);
  const k = (hp: number): Combat => ({ campaignId: 'c1', round: 1, turn: 'a', groupMonsters: false, updatedAt: 0, combatants: [cb({ id: 'a', kind: 'monster', name: 'A' }), cb({ id: 'b', kind: 'monster', name: 'B', hp, maxHp: 10 })] });
  const sc: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 1400, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
    tokens: ['a', 'b'].map((id, q) => ({ id: `t-${id}`, name: id, ...cell(q), size: 'M' as const, color: '#000000', combatantId: id })) };
  const dealt = async (hp: number) => {
    const f = k(hp), r = await workOut({ a, features: [], actor: f.combatants[0], combat: f, scene: sc, diagonal: '5-5-5', aim: { target: 'b', rolled: { dmg: [[5], [11]] }, toggles: [] },
      findTarget: (id) => f.combatants.find((z) => z.id === id), info: (z) => targetOf(z, {}), nameOf: (z) => z.name, magical: false, id: 'r', now: 0, rng: () => 0.01 });
    if (typeof r === 'string') throw new Error(r);
    return r.resolution.outcomes[0].damage;
  };
  expect([await dealt(10), await dealt(6)]).toEqual([5, 11]);
});

// Entering a damage-over-time area (Cloudkill, Moonbeam): a creature whose token now stands in it but whose turn began outside it.
test('who has entered a lasting area this turn', () => {
  const k0: Combat = { campaignId: 'c1', round: 2, turn: 'g', groupMonsters: false, updatedAt: 0,
    combatants: [cb({ id: 'pc:mira', kind: 'pc', name: 'Mira', concentrating: true, concentratingOn: 'Cloudkill' }), cb({ id: 'g', kind: 'monster', name: 'Goblin' })] };
  const sc: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 1400, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
    tokens: [{ id: 't-g', name: 'G', ...cell(3), size: 'M', color: '#000000', combatantId: 'g' }, { id: 't-m', name: 'M', ...cell(9), size: 'M', color: '#000000', characterId: 'mira' }] };
  const fog = (enters: boolean): Resolution => ({ id: 'r', actor: 'pc:mira', action: 'Cloudkill', outcomes: [], applied: [], at: 0, sceneId: 's1', round: 1, lasting: true,
    area: { shape: 'cylinder', origin: cell(3), aim: cell(3), feet: 5 }, linger: { dice: [{ expr: '5d8', type: 'poison' }], read: { damage: [], save: 'Con', onSave: 'half', ...(enters && { enters: true }) }, dc: 13 } });
  const from = (q: number, enters = true) => ({ ...k0, resolutions: [fog(enters)], movement: { g: { from: cell(q), dashes: 0 } } });
  expect(entersIn(from(0), sc, 'g').map((r) => r.id)).toEqual(['r']); // walked in
  expect(entersIn(from(3), sc, 'g')).toEqual([]); // began its turn there: the start of its turn already counted
  expect(entersIn(from(0, false), sc, 'g')).toEqual([]); // a spell that hurts only at the start of a turn
  // where its turn began decides the start of its turn: walked in, it didn't start there; walked out, it did
  expect(startsIn(from(0), sc, 'g')).toEqual([]);
  const cloud = { ...from(3), resolutions: [{ ...fog(true), linger: { ...fog(true).linger!, read: { ...fog(true).linger!.read, noStart: true as const } } }] };
  expect(startsIn(cloud, sc, 'g')).toEqual([]); // Incendiary Cloud: the end of a turn, not its start
  expect(startsIn({ ...from(3), movement: { g: { from: cell(3), dashes: 0 } } }, { ...sc, tokens: sc.tokens.map((t) => (t.id === 't-g' ? { ...t, ...cell(6) } : t)) }, 'g').map((r) => r.id)).toEqual(['r']);
});
