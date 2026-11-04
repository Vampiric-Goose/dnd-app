// Walls, doors and cover (DMG corner rule, fixed pieces, creatures in the way) on a 70 px, 5 ft square grid: cell (i, j) centres on (35 + 70i, 35 + 70j).
import { describe, expect, test } from 'vitest';
import { clipRoute, cover, lineBlocked, nearDoor, stepBlocked, toggleDoor, type Wall } from '../../src/lib/map/walls.ts';
import { DEFAULT_GRID, newScene } from '../../src/lib/map/scene.ts';
import { sceneProblem } from '../../src/lib/recordShape.ts';
import type { Grid } from '../../src/lib/types.ts';

const g: Grid = { ...DEFAULT_GRID, size: 70, feet: 5, offsetX: 0, offsetY: 0 };
const at = (i: number, j: number, size: 'M' | 'L' = 'M') => ({ x: 35 + 70 * i, y: 35 + 70 * j, size });
const w = (x0: number, y0: number, x1: number, y1: number, kind: Wall['kind'] = 'wall', open?: boolean): Wall => ({ id: `${kind}${x0}${y0}`, a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, kind, ...(open !== undefined && { open }) });

describe('cover', () => {
  test('a wall on the grid line between two adjacent creatures: total cover; one beside them, not between: none', () => {
    expect(cover(g, [w(70, 0, 70, 70)], at(0, 0), at(1, 0), [])).toBe('total');
    expect(cover(g, [w(70, 70, 70, 140)], at(0, 0), at(1, 0), [])).toBe(0);
    expect(cover(g, [], at(0, 0), at(3, 0), [])).toBe(0);
  });
  test('a wall hiding the lower half of the target: half cover (two lines blocked from the best corner)', () => {
    expect(cover(g, [w(210, 35, 210, 70)], at(0, 0), at(3, 0), [])).toBe(2);
  });
  test('fixed pieces on the line between the centres: a low wall half, an arrow slit three-quarters', () => {
    expect(cover(g, [w(140, 0, 140, 70, 'low')], at(0, 0), at(3, 0), [])).toBe(2);
    expect(cover(g, [w(140, 0, 140, 70, 'slit')], at(0, 0), at(3, 0), [])).toBe(5);
  });
  test('a creature in the way: half cover', () => {
    expect(cover(g, [], at(0, 0), at(3, 0), [at(1, 0)])).toBe(2);
    expect(cover(g, [], at(0, 0), at(3, 0), [at(1, 2)])).toBe(0);
  });
  test('a door: closed is a wall, open is nothing', () => {
    expect(cover(g, [w(70, 0, 70, 70, 'door', false)], at(0, 0), at(1, 0), [])).toBe('total');
    expect(cover(g, [w(70, 0, 70, 70, 'door', true)], at(0, 0), at(1, 0), [])).toBe(0);
  });
  test('from a point (a spell area’s origin): its lines to the target’s corners', () => {
    expect(cover(g, [w(70, 0, 70, 70)], { x: 35, y: 35 }, at(1, 0), [])).toBe('total');
    expect(cover(g, [], { x: 35, y: 35 }, at(1, 0), [])).toBe(0);
  });
});

describe('movement', () => {
  test('a step across a wall, through the corner where walls meet, or through an arrow slit is blocked; a low wall or open door is not', () => {
    expect(stepBlocked([w(70, 0, 70, 70)], at(0, 0), at(1, 0))).toBe(true);
    expect(stepBlocked([w(70, 0, 70, 70), w(0, 70, 70, 70)], at(0, 0), at(1, 1))).toBe(true);
    expect(stepBlocked([w(70, 0, 70, 70, 'slit')], at(0, 0), at(1, 0))).toBe(true);
    expect(stepBlocked([w(70, 0, 70, 70, 'low'), w(70, 0, 70, 70, 'door', true)], at(0, 0), at(1, 0))).toBe(false);
  });
  test('clipRoute keeps the squares before the first blocked step', () => {
    expect(clipRoute([w(140, 0, 140, 70)], at(0, 0), [{ x: 105, y: 35 }, { x: 175, y: 35 }, { x: 245, y: 35 }])).toEqual([{ x: 105, y: 35 }]);
    expect(clipRoute([], at(0, 0), [{ x: 105, y: 35 }])).toEqual([{ x: 105, y: 35 }]);
  });
  test('lineBlocked: walls and closed doors only', () => {
    expect([lineBlocked([w(70, 0, 70, 70)], { x: 35, y: 35 }, { x: 105, y: 35 }), lineBlocked([w(70, 0, 70, 70, 'slit')], { x: 35, y: 35 }, { x: 105, y: 35 })]).toEqual([true, false]);
  });
});

describe('doors', () => {
  test('a token within one square of the door is beside it', () => {
    const d = w(70, 0, 70, 70, 'door');
    expect([nearDoor(g, d, at(0, 0)), nearDoor(g, d, at(1, 0)), nearDoor(g, d, at(3, 0))]).toEqual([true, true, false]);
  });
  test('toggleDoor flips a door only', () => {
    const s = { ...newScene('c', 'S'), walls: [w(70, 0, 70, 70, 'door'), w(0, 0, 0, 70)] };
    expect(toggleDoor(s, 'door700').walls!.map((x) => x.open)).toEqual([true, undefined]);
    expect(toggleDoor(s, 'wall00')).toBe(s);
  });
});

describe('saved walls', () => {
  test('sceneProblem checks each wall', () => {
    const s = { ...newScene('c', 'S'), id: 's' };
    expect(sceneProblem({ ...s, walls: [w(0, 0, 70, 0), w(0, 0, 0, 70, 'door', true)] })).toBeUndefined();
    expect(sceneProblem({ ...s, walls: [{ ...w(0, 0, 70, 0), kind: 'moat' }] })).toBe('has a damaged wall (1)');
    expect(sceneProblem({ ...s, walls: [{ ...w(0, 0, 70, 0), a: { x: NaN, y: 0 } }] })).toBe('has a damaged wall (1)');
    expect(sceneProblem({ ...s, walls: 'x' })).toBe('has a damaged wall list');
  });
});

describe('walls on moves and Opportunity Attacks', () => {
  test('a player’s move route stops before a wall', async () => {
    const { moveRoute } = await import('../../src/lib/sync/scene.ts');
    const t = { id: 't', name: 't', ...at(0, 0), color: '#000000' };
    const m = { x: 245, y: 35, path: [{ x: 105, y: 35 }, { x: 175, y: 35 }, { x: 245, y: 35 }] };
    expect(moveRoute(g, t, m, [w(140, 0, 140, 70)])).toEqual([{ x: 105, y: 35 }]);
    expect(moveRoute(g, t, m)).toHaveLength(3);
  });
  test('a foe across a wall is not asked for an Opportunity Attack', async () => {
    const { leaveStep } = await import('../../src/lib/combat/reactions.ts');
    const scim = { id: 'mon:action:0', name: 'Scimitar', cost: 'action' as const, group: 'monster' as const, text: [{ p: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target.' }] };
    const body = (id: string, pc: boolean, p: { x: number; y: number }) => ({ x: { id, kind: pc ? 'pc' as const : 'monster' as const, name: id, initMod: 0, dex: 10, tie: 0.5, conSave: 0 },
      pt: { ...p, size: 'M' as const }, conditions: [], actions: pc ? [] : [scim], features: [], slots: [], reach: 5, pc, side: pc ? 'party' as const : 'foes' as const, hidden: false, name: id });
    const pc = body('pc', true, at(1, 0)), gob = body('gob', false, at(1, 1));
    const wall = [w(70, 70, 210, 70)]; // along the goblin's top edge, under the PC's way
    const blocked = (f: { pt: { x: number; y: number; size: 'M' | 'L' | 'S' | 'T' | 'H' | 'G' } }, p: { x: number; y: number }) => cover(g, wall, f.pt, { ...p, size: 'M' }, []) === 'total';
    expect(leaveStep(g, '5-5-5', pc, [gob], { x: 315, y: 35 }, false)?.reactors.map((r) => r.id)).toEqual(['gob']);
    expect(leaveStep(g, '5-5-5', pc, [gob], { x: 315, y: 35 }, false, undefined, undefined, blocked)).toBeUndefined();
  });
});

describe('review: room corners', () => {
  const room = [w(70, 70, 140, 70), w(140, 70, 140, 140), w(140, 140, 70, 140), w(70, 140, 70, 70)]; // cell (1, 1) closed on all four sides
  test('a line through the corner where two walls meet is blocked: a closed room is total cover, even diagonally', () => {
    expect(lineBlocked(room, { x: 35, y: 35 }, { x: 105, y: 105 })).toBe(true);
    expect(cover(g, room, at(0, 0), at(1, 1), [])).toBe('total');
    expect(cover(g, [w(70, 70, 140, 70), w(70, 70, 70, 140)], at(0, 0), at(1, 1), [])).toBe('total'); // an L of walls
  });
  test('the tip of a lone wall does not block a line passing it', () => {
    expect(lineBlocked([w(70, 70, 140, 70)], { x: 35, y: 35 }, { x: 105, y: 105 })).toBe(false);
  });
});
