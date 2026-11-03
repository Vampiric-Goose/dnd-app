import { describe, expect, test } from 'vitest';
import { acReaction, canReact, counterReactors, countered, halved, hitReactors, leaveStep, rebukeReactors, rejudge, type Body } from '../../src/lib/combat/reactions.ts';
import { applyUse, type TurnAction } from '../../src/lib/combat/turnActions.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import type { Combat, Combatant, Grid } from '../../src/lib/types.ts';

// Grid size 50 px = 5 ft; cell (i, j) at (50i, 50j).
const g: Grid = { ...DEFAULT_GRID, size: 50, feet: 5, offsetX: 0, offsetY: 0 };
const cb = (id: string, kind: Combatant['kind'], o: Partial<Combatant> = {}): Combatant => ({ id, kind, name: id, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const body = (id: string, pc: boolean, x: number, y: number, o: Partial<Body> = {}): Body =>
  ({ x: cb(id, pc ? 'pc' : 'monster'), pt: { x, y, size: 'M' }, conditions: [], actions: [], features: [], slots: [], reach: 5, pc, name: id, ...o });
const react = (name: string): TurnAction => ({ id: `r:${name}`, name, cost: 'reaction', group: 'spell' });
const scimitar: TurnAction = { id: 'mon:action:0', name: 'Scimitar', cost: 'action', group: 'monster', text: [{ p: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.' }] };
const gob = body('gob', false, 0, 0, { name: 'Goblin', actions: [scimitar] });
const ogre = body('ogre', false, 0, 0, { reach: 10, actions: [{ ...scimitar, name: 'Greatclub' }] });
const pc = body('pc', true, 50, 0);
const to4 = { x: 200, y: 0 };

describe('leaveStep', () => {
  test('leaving a goblin reach stops the move where it is, and the goblin may attack', () => {
    expect(leaveStep(g, '5-5-5', pc, [gob], to4, false)).toEqual({ at: { x: 50, y: 0 }, reactors: [{ id: 'gob', name: 'Goblin', options: [{ id: 'oa', label: 'Attack (Scimitar)' }] }] });
  });
  test('a reach-10 foe gets its attack one cell further', () => {
    expect(leaveStep(g, '5-5-5', pc, [ogre], to4, false)?.at).toEqual({ x: 100, y: 0 });
  });
  test('a PC reactor attacks with its weapon, or plain Attack', () => {
    const wield = (attack?: TurnAction['attack']) => body('ally', true, 0, 0, { actions: [{ id: 'react:opportunity', name: 'Opportunity Attack', cost: 'reaction', group: 'attack', ...(attack && { attack }) }] });
    const mover = body('gob2', false, 50, 0);
    const label = (b: Body) => leaveStep(g, '5-5-5', mover, [b], to4, false)?.reactors[0].options[0].label;
    expect(label(wield({ entryId: 'e', name: 'Rapier', toHit: 5, damage: '1d8', damageType: 'piercing', properties: [] }))).toBe('Attack (Rapier)');
    expect(label(wield())).toBe('Attack (Attack)');
  });
  test('moving around a foe inside its reach, Disengage, an ally, a used reaction, or an invisible mover: no step', () => {
    expect(leaveStep(g, '5-5-5', pc, [gob], { x: 50, y: 50 }, false)).toBeUndefined();
    expect(leaveStep(g, '5-5-5', pc, [gob], to4, true)).toBeUndefined();
    expect(leaveStep(g, '5-5-5', pc, [body('ally', true, 0, 0, { actions: gob.actions })], to4, false)).toBeUndefined();
    expect(leaveStep(g, '5-5-5', pc, [{ ...gob, x: { ...gob.x, reactionUsed: true } }], to4, false)).toBeUndefined();
    expect(leaveStep(g, '5-5-5', { ...pc, conditions: ['Invisible'] }, [gob], to4, false)).toBeUndefined();
    expect(leaveStep(g, '5-5-5', pc, [{ ...gob, conditions: ['Blinded'] }], to4, false)).toBeUndefined();
  });
  test('a downed monster (0 hp) does not react', () => {
    expect(leaveStep(g, '5-5-5', pc, [{ ...gob, x: { ...gob.x, hp: 0 } }], to4, false)).toBeUndefined();
  });
  test('a foe with no melee attack has no Opportunity Attack', () => {
    expect(leaveStep(g, '5-5-5', pc, [{ ...gob, actions: [] }], to4, false)).toBeUndefined();
  });
});

describe('canReact', () => {
  test('a used reaction or an incapacitating condition', () => {
    expect(canReact(gob)).toBe(true);
    expect(canReact({ ...gob, x: { ...gob.x, reactionUsed: true } })).toBe(false);
    expect(canReact({ ...gob, conditions: ['Stunned'] })).toBe(false);
    expect(canReact({ ...gob, conditions: ['Prone'] })).toBe(true);
  });
});

describe('Counterspell', () => {
  const caster = body('caster', false, 0, 0);
  const wiz = (id: string, x: number, slots: number[]) => body(id, true, x, 0, { actions: [react('Counterspell')], slots });
  test('one option per free slot of 3rd or higher, within 60 ft only', () => {
    const near = wiz('near', 600, [1, 3, 4]), far = wiz('far', 650, [3]);
    expect(counterReactors(g, '5-5-5', caster, [near, far]).map((r) => r.options.map((o) => o.slot))).toEqual([[3, 4]]);
    expect(counterReactors(g, '5-5-5', caster, [near])[0].options[0]).toEqual({ id: 'counterspell', label: 'Counterspell 3', slot: 3 });
  });
  test('needs the spell, a reaction, and is not the caster', () => {
    expect(counterReactors(g, '5-5-5', caster, [body('x', true, 50, 0, { slots: [3] }), { ...wiz('used', 50, [3]), x: cb('used', 'pc', { reactionUsed: true }) }, { ...wiz('caster', 50, [3]), x: caster.x }])).toEqual([]);
  });
  test('countered: 3rd or lower always; higher needs the slot or a check of 10 + level', () => {
    expect(countered(3, 3)).toBe(true); expect(countered(5, 5)).toBe(true);
    expect(countered(5, 3)).toBe(false); expect(countered(5, 3, 15)).toBe(true); expect(countered(5, 3, 14)).toBe(false);
  });
});

describe('hit reactions', () => {
  const atk = body('atk', false, 50, 0);
  test('rejudge: Shield turns a 17 against AC 15 into a miss; a natural 20 still hits', () => {
    expect(rejudge({ id: 'a', part: 'hit', hit: true, roll: 17, ac: 15, damage: 8 }, 5)).toMatchObject({ hit: false, damage: 0, ac: 20 });
    expect(rejudge({ id: 'a', part: 'hit', hit: true, nat: 20, roll: 25, ac: 15, damage: 8 }, 5)).toMatchObject({ hit: true, damage: 8 });
    expect(rejudge({ id: 'a', part: 'hit', hit: true, roll: 21, ac: 15, damage: 8 }, 5)).toMatchObject({ hit: true, damage: 8, ac: 20 });
  });
  test('a hit turned into a miss keeps nothing a hit brings (a later hit, a condition, Chaos Bolt)', () => {
    const o = rejudge({ id: 'a', part: 'hit', hit: true, roll: 17, ac: 15, damage: 8, later: 4, inflict: ['Slowed'], leap: true, choose: [{ face: 1, type: 'fire', damage: 8 }] }, 5);
    expect(o).toMatchObject({ hit: false, damage: 0 });
    expect(o).not.toHaveProperty('later'); expect(o).not.toHaveProperty('inflict'); expect(o).not.toHaveProperty('leap'); expect(o).not.toHaveProperty('choose');
  });
  test('a spell that does half damage on a miss keeps it', () => {
    expect(rejudge({ id: 'a', part: 'hit', hit: true, roll: 17, ac: 15, damage: 10 }, 5, true)).toMatchObject({ hit: false, damage: 5 });
  });
  test('halved rounds down, later damage and Chaos Bolt picks too', () => {
    expect(halved({ id: 'a', damage: 9 }).damage).toBe(4);
    expect(halved({ id: 'a', damage: 9, later: 7, choose: [{ face: 1, type: 'fire', damage: 9 }] })).toMatchObject({ damage: 4, later: 3, choose: [{ face: 1, type: 'fire', damage: 4 }] });
  });
  test('acReaction reads Parry', () => {
    expect(acReaction({ name: 'Parry', text: 'The knight adds 2 to its AC against one melee attack that would hit it.' })).toEqual({ bonus: 2, melee: true });
    expect(acReaction({ name: 'Roar', text: 'The beast roars.' })).toBeUndefined();
  });
  test('Shield needs a slot; Uncanny Dodge needs to see the attacker', () => {
    const wizard = (slots: number[]) => body('wiz', true, 0, 0, { actions: [react('shield')], slots });
    expect(hitReactors(wizard([1]), atk, { melee: true })).toEqual([{ id: 'wiz', name: 'wiz', options: [{ id: 'shield', label: 'Shield' }] }]);
    expect(hitReactors(wizard([]), atk, { melee: true })).toEqual([]);
    const rogue = body('rogue', true, 0, 0, { features: ['Uncanny Dodge'] });
    expect(hitReactors(rogue, atk, { melee: false })[0].options).toEqual([{ id: 'uncanny', label: 'Uncanny Dodge' }]);
    expect(hitReactors(rogue, { ...atk, conditions: ['Invisible'] }, { melee: false })).toEqual([]);
    expect(hitReactors({ ...rogue, pc: false }, atk, { melee: false })).toEqual([]);
  });
  test('Parry: melee-only skipped against a ranged attack', () => {
    const parry: TurnAction = { id: 'mon:reaction:0', name: 'Parry', cost: 'reaction', group: 'monster', text: [{ p: 'The knight adds 2 to its AC against one melee attack that would hit it.' }] };
    const knight = body('k', false, 0, 0, { name: 'Knight', actions: [parry] });
    expect(hitReactors(knight, atk, { melee: true })[0].options).toEqual([{ id: 'parry', label: 'Parry (+2 AC)', bonus: 2 }]);
    expect(hitReactors(knight, atk, { melee: false })).toEqual([]);
  });
});

describe('Hellish Rebuke', () => {
  const lock = (o: Partial<Body> = {}) => body('lock', true, 0, 0, { actions: [react('Hellish Rebuke')], slots: [1, 2], ...o });
  const src = body('src', false, 600, 0);
  test('one option per free slot; the source must be seen within 60 ft; the victim up', () => {
    expect(rebukeReactors(g, '5-5-5', lock(), src)[0].options).toEqual([{ id: 'rebuke', label: 'Hellish Rebuke 1', slot: 1 }, { id: 'rebuke', label: 'Hellish Rebuke 2', slot: 2 }]);
    expect(rebukeReactors(g, '5-5-5', lock(), body('far', false, 650, 0))).toEqual([]);
    expect(rebukeReactors(g, '5-5-5', lock(), { ...src, conditions: ['Invisible'] })).toEqual([]);
    expect(rebukeReactors(g, '5-5-5', lock({ x: cb('lock', 'monster', { hp: 0 }) }), src)).toEqual([]);
    expect(rebukeReactors(g, '5-5-5', lock({ slots: [] }), src)).toEqual([]);
  });
});

describe('Disengage', () => {
  test('marks the turn', () => {
    const x = cb('x', 'monster');
    const k: Combat = { campaignId: 'c', combatants: [x], round: 1, turn: 'x', groupMonsters: false, updatedAt: 0 };
    for (const id of ['std:disengage', 'cunning:disengage'])
      expect(applyUse(k, x, { id, name: 'Disengage', cost: 'action', group: 'standard' }, 1).combatants[0].economy?.disengaging).toBe(true);
  });
});
