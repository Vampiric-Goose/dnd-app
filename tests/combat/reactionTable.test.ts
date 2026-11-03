import { describe, expect, test } from 'vitest';
import { amount, enterOptions, resourceOf, tableReactors, type Trigger } from '../../src/lib/combat/reactionTable.ts';
import type { Body } from '../../src/lib/combat/reactions.ts';
import type { TurnAction } from '../../src/lib/combat/turnActions.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import type { Combatant, Grid } from '../../src/lib/types.ts';

const g: Grid = { ...DEFAULT_GRID, size: 50, feet: 5, offsetX: 0, offsetY: 0 };
const cb = (id: string, kind: Combatant['kind'], o: Partial<Combatant> = {}): Combatant => ({ id, kind, name: id, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const mods = { str: 0, dex: 3, con: 1, int: 2, wis: 2, cha: 4 };
const pc = (id: string, x: number, features: string[], o: Partial<Body> & { levels?: Record<string, number>; left?: Record<string, number> } = {}): Body => {
  const { levels = {}, left = {}, ...rest } = o;
  return { x: cb(id, 'pc'), pt: { x, y: 0, size: 'M' }, conditions: [], actions: [], features, slots: [], reach: 5, pc: true, side: 'party', hidden: false, name: id,
    stats: { prof: 2, mods, levels, left, dc: 13 }, ...rest };
};
const orc: Body = { x: cb('orc', 'monster'), pt: { x: 0, y: 0, size: 'M' }, conditions: [], actions: [], features: [], slots: [], reach: 5, pc: false, side: 'foes', hidden: false, name: 'Orc' };
const opts = (r: ReturnType<typeof tableReactors>) => r.flatMap((x) => x.options.map((o) => `${x.id}:${o.label}`));
const hit = (target: Body, o: Partial<Trigger> = {}): Trigger => ({ window: 'hit', actor: orc, target, melee: true, damage: 8, type: 'slashing', ...o });

describe('tableReactors', () => {
  test('Protection: an ally within 5 ft of the target, when the attack is declared', () => {
    const wren = pc('wren', 50, []), guard = pc('guard', 100, ['Protection']), far = pc('far', 300, ['Protection']);
    expect(opts(tableReactors(g, '5-5-5', { window: 'declared', actor: orc, target: wren, melee: true }, [wren, guard, far, orc]))).toEqual(['guard:Protection (disadvantage)']);
  });
  test('Protection is not for yourself', () => {
    const guard = pc('guard', 50, ['Protection']);
    expect(tableReactors(g, '5-5-5', { window: 'declared', actor: orc, target: guard }, [guard, orc])).toEqual([]);
  });
  test('Parry (Battle Master): melee hits only, superiority die by Fighter level plus Dex', () => {
    const f3 = pc('f', 50, ['Parry'], { levels: { Fighter: 3 } }), f10 = pc('f', 50, ['Maneuvers: Parry'], { levels: { Fighter: 10 } });
    expect(opts(tableReactors(g, '5-5-5', hit(f3), [f3, orc]))).toEqual(['f:Parry (−1d8+3)']);
    expect(opts(tableReactors(g, '5-5-5', hit(f10), [f10, orc]))).toEqual(['f:Parry (−1d10+3)']);
    expect(tableReactors(g, '5-5-5', hit(f3, { melee: false, ranged: true }), [f3, orc])).toEqual([]);
  });
  test('Interception: an ally within 5 ft cuts 1d10 + proficiency', () => {
    const wren = pc('wren', 50, []), ally = pc('ally', 100, ['Interception']);
    expect(opts(tableReactors(g, '5-5-5', hit(wren), [wren, ally, orc]))).toEqual(['ally:Interception (−1d10+2)']);
  });
  test('Deflect Missiles only against a ranged hit', () => {
    const monk = pc('monk', 50, ['Deflect Missiles'], { levels: { Monk: 4 } });
    expect(tableReactors(g, '5-5-5', hit(monk), [monk, orc])).toEqual([]);
    expect(opts(tableReactors(g, '5-5-5', hit(monk, { melee: false, ranged: true }), [monk, orc]))).toEqual(['monk:Deflect Missiles (−1d10+7)']);
  });
  test('Defensive Duelist needs a finesse weapon and a melee attack', () => {
    const rapier: TurnAction = { id: 'react:opportunity', name: 'Opportunity Attack', cost: 'reaction', group: 'attack', attack: { entryId: 'e', name: 'Rapier', toHit: 5, damage: '1d8+3', damageType: 'piercing', properties: ['finesse'] } };
    const duelist = pc('d', 50, ['Defensive Duelist'], { actions: [rapier] }), clumsy = pc('d', 50, ['Defensive Duelist']);
    expect(opts(tableReactors(g, '5-5-5', hit(duelist), [duelist, orc]))).toEqual(['d:Defensive Duelist (+2 AC)']);
    expect(tableReactors(g, '5-5-5', hit(clumsy), [clumsy, orc])).toEqual([]);
  });
  test('a tracked resource with none left is not offered; an untracked one is', () => {
    const t: Trigger = { window: 'declared', actor: orc, target: undefined as unknown as Body };
    const spent = pc('c', 50, ['Warding Flare'], { left: { 'Warding Flare': 0 } }), fresh = pc('c', 50, ['Warding Flare']);
    expect(tableReactors(g, '5-5-5', { ...t, target: spent }, [spent, orc])).toEqual([]);
    expect(opts(tableReactors(g, '5-5-5', { ...t, target: fresh }, [fresh, orc]))).toEqual(['c:Warding Flare (disadvantage)']);
    expect(resourceOf(pc('c', 50, ['Parry'], { left: { 'Superiority Dice': 2 } }), 'Parry')).toBe('Superiority Dice');
    expect(resourceOf(fresh, 'Warding Flare')).toBeUndefined();
  });
  test('Song of Defense: one option per free slot, 5 per slot level', () => {
    const blade = pc('b', 50, ['Song of Defense'], { slots: [1, 3] });
    expect(tableReactors(g, '5-5-5', hit(blade), [blade, orc])[0].options).toEqual([
      { id: 'more', key: 'Song of Defense', label: 'Song of Defense 1 (−5)', slot: 1 }, { id: 'more', key: 'Song of Defense', label: 'Song of Defense 3 (−15)', slot: 3 }]);
  });
  test('Cutting Words: a bard within 60 ft of the attacker, Bardic die by level', () => {
    const wren = pc('wren', 50, []), bard = pc('bard', 500, ['Cutting Words'], { levels: { Bard: 5 } });
    expect(opts(tableReactors(g, '5-5-5', hit(wren), [wren, bard, orc]))).toEqual(['bard:Cutting Words (−1d8 to the roll)']);
    expect(tableReactors(g, '5-5-5', hit(wren), [wren, { ...bard, pt: { ...bard.pt, x: 700 } }, orc])).toEqual([]);
  });
  test('Absorb Elements only against acid, cold, fire, lightning or thunder', () => {
    const ae: TurnAction = { id: 'spell:ae', name: 'Absorb Elements', cost: 'reaction', group: 'spell', spell: { id: 'ae', level: 1, concentration: false } };
    const wiz = pc('w', 50, [], { actions: [ae], slots: [1] });
    expect(tableReactors(g, '5-5-5', hit(wiz), [wiz, orc])).toEqual([]);
    expect(opts(tableReactors(g, '5-5-5', hit(wiz, { type: 'fire' }), [wiz, orc]))).toEqual(['w:Absorb Elements (half damage)']);
    expect(tableReactors(g, '5-5-5', hit({ ...wiz, slots: [] }, { type: 'fire' }), [{ ...wiz, slots: [] }, orc])).toEqual([]);
  });
  test('a used reaction, or a Blinded reactor that must see, gets nothing', () => {
    const wren = pc('wren', 50, []), guard = pc('guard', 100, ['Protection']);
    const t: Trigger = { window: 'declared', actor: orc, target: wren };
    expect(tableReactors(g, '5-5-5', t, [wren, { ...guard, x: { ...guard.x, reactionUsed: true } }, orc])).toEqual([]);
    expect(tableReactors(g, '5-5-5', t, [wren, { ...guard, conditions: ['Blinded'] }, orc])).toEqual([]);
  });
  test('a monster’s other reaction traits: a reminder when it is the one hit', () => {
    const trait: TurnAction = { id: 'mon:reaction:0', name: 'Shadow Step', cost: 'reaction', group: 'monster', text: [{ p: 'The creature teleports.' }] };
    const parry: TurnAction = { ...trait, name: 'Parry', text: [{ p: 'The knight adds 2 to its AC against one melee attack.' }] };
    const knight: Body = { ...orc, x: cb('knight', 'monster'), name: 'Knight', actions: [trait, parry], pt: { x: 50, y: 0, size: 'M' } };
    const wren = pc('wren', 0, []);
    expect(opts(tableReactors(g, '5-5-5', { window: 'hit', actor: wren, target: knight, melee: true }, [knight, wren]))).toEqual(['knight:Shadow Step (settle by hand)']);
    expect(tableReactors(g, '5-5-5', { window: 'miss', actor: wren, target: knight, melee: true }, [knight, wren])).toEqual([]);
  });
  test('save damage: a damage cutter is a reminder after it lands', () => {
    const blade = pc('b', 50, ['Spirit Shield'], { levels: { Barbarian: 6 } }), wren = pc('wren', 100, []);
    expect(opts(tableReactors(g, '5-5-5', { window: 'damaged', actor: orc, target: wren, save: true, damage: 10 }, [wren, blade, orc]))).toEqual(['b:Spirit Shield (settle by hand)']);
  });
});

describe('amount and enterOptions', () => {
  test('die sizes from class levels', () => {
    expect(amount('Riposte', pc('f', 0, [], { levels: { Fighter: 18 } }))).toBe('1d12');
    expect(amount('Cutting Words', pc('b', 0, [], { levels: { Bard: 15 } }))).toBe('1d12');
    expect(amount('Protective Field', pc('p', 0, [], { levels: { Fighter: 11 } }))).toBe('1d10+2');
    expect(amount('Spirit Shield', pc('b', 0, [], { levels: { Barbarian: 14 } }))).toBe('4d6');
  });
  test('entering reach: Polearm Master with a polearm, Brace, Halo of Spores at 10 ft', () => {
    const glaive: TurnAction = { id: 'react:opportunity', name: 'Opportunity Attack', cost: 'reaction', group: 'attack', attack: { entryId: 'e', name: 'Glaive', toHit: 5, damage: '1d10+3', damageType: 'slashing', properties: ['reach', 'heavy'] } };
    expect(enterOptions(pc('p', 0, ['Polearm Master'], { actions: [glaive], reach: 10 }))).toEqual([{ feet: 10, option: { id: 'more', key: 'Polearm Master', label: 'Polearm Master (attack)', strike: true } }]);
    expect(enterOptions(pc('p', 0, ['Polearm Master'], { actions: [{ ...glaive, attack: { ...glaive.attack!, name: 'Longsword', properties: [] } }] }))).toEqual([]);
    expect(enterOptions(pc('d', 0, ['Halo of Spores'], { levels: { Druid: 2 } }))).toEqual([{ feet: 10, option: { id: 'more', key: 'Halo of Spores', label: 'Halo of Spores (1d4 necrotic)' } }]);
  });
});

describe('review fixes', () => {
  test('the attacker is never offered a reaction to its own attack, even as a fresh copy', () => {
    const halfling = pc('h', 50, ['Bountiful Luck']);
    expect(tableReactors(g, '5-5-5', { window: 'miss', actor: halfling, target: orc, nat1: true }, [{ ...halfling }, orc])).toEqual([]);
  });
  test('save damage offers no attack-only reminder (Second Chance)', () => {
    const lucky = pc('l', 50, ['Second Chance']);
    expect(tableReactors(g, '5-5-5', { window: 'damaged', actor: orc, target: lucky, save: true, damage: 5 }, [lucky, orc])).toEqual([]);
  });
});
