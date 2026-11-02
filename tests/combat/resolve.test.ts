import { describe, expect, test } from 'vitest';
import { checkFaces, keptD20, resolveAttack, resolveSpell, settle, totalOf, type TargetInfo } from '../../src/lib/combat/resolve.ts';
import type { SpellRead } from '../../src/lib/combat/spellText.ts';

// PHB 2014 p.194-196: an attack hits when d20 + bonus >= AC; a natural 20 always hits (a critical: damage dice twice), a natural 1
// always misses; advantage keeps the higher d20. p.205: a save against the spell's DC; an area's damage is rolled once for everyone.
const save = { str: 0, dex: 2, con: 0, int: 0, wis: 0, cha: 0 };
const goblin = (id: string, o: Partial<TargetInfo> = {}): TargetInfo => ({ id, ac: 15, save, defenses: { resist: [], immune: [], vulnerable: [] }, pc: false, hidden: false, ...o });
const always = (n: number) => () => (n - 1) / 20 + 0.001; // a d20 that always shows n

describe('dice sent by another device', () => {
  test('totals only faces that fit the expression (count, doubled on a crit, each within its sides)', () => {
    expect(totalOf('2d6+3', [3, 4], false)).toBe(10);
    expect(totalOf('2d6+3', [7, 1], false)).toBeUndefined();
    expect(totalOf('2d6+3', [3], false)).toBeUndefined();
    expect(totalOf('2d6+3', [1, 2, 3, 4], true)).toBe(13);
    expect(totalOf('10', [], false)).toBe(10);
    expect(checkFaces([{ expr: '1d8+3' }], { d20: [25], dmg: [[4]] })).toBe('bad d20');
    expect(checkFaces([{ expr: '1d8+3' }], { d20: [12], dmg: [[4, 4]] })).toBe('bad damage dice');
    expect(checkFaces([{ expr: '1d8+3' }], { d20: [12], dmg: [[4]] })).toBeUndefined();
    expect(checkFaces([{ expr: '1d8+3', crit: true }], { d20: [20], dmg: [[4, 5]] })).toBeUndefined();
  });
  test('advantage keeps the higher, disadvantage the lower, neither the first', () => {
    expect(keptD20({ d20: [4, 18], mode: 'adv', dmg: [] })).toBe(18);
    expect(keptD20({ d20: [4, 18], mode: 'dis', dmg: [] })).toBe(4);
    expect(keptD20({ d20: [4, 18], dmg: [] })).toBe(4);
  });
});

describe('an attack against AC 15', () => {
  const sword = [{ expr: '2d6+3', type: 'slashing' }];
  test('15 hits, 14 misses with no damage', () => {
    expect(resolveAttack(goblin('g'), 5, sword, { d20: [10], dmg: [[3, 4]] }, false)).toMatchObject({ id: 'g', hit: true, roll: 15, damage: 10 });
    expect(resolveAttack(goblin('g'), 5, sword, { d20: [9], dmg: [[3, 4]] }, false)).toMatchObject({ hit: false, roll: 14, damage: 0 });
  });
  test('a natural 1 misses and a natural 20 hits whatever the numbers', () => {
    expect(resolveAttack(goblin('g', { ac: 2 }), 5, sword, { d20: [1], dmg: [[3, 4]] }, false)).toMatchObject({ hit: false, nat: 1 });
    expect(resolveAttack(goblin('g', { ac: 30 }), 0, sword, { d20: [20], dmg: [[1, 2, 3, 4]] }, false)).toMatchObject({ hit: true, nat: 20, damage: 13 });
  });
  test('Great Weapon Master: -5 to hit and +10 damage, passed by the caller', () => {
    expect(resolveAttack(goblin('g'), 0, [...sword, { expr: '10', type: 'slashing' }], { d20: [16], dmg: [[3, 4], []] }, false)).toMatchObject({ hit: true, damage: 20 });
  });
  test('resistance halves the damage and says why', () => {
    const resistant = goblin('g', { defenses: { resist: ['slashing'], immune: [], vulnerable: [] } });
    expect(resolveAttack(resistant, 5, sword, { d20: [12], dmg: [[3, 4]] }, false)).toMatchObject({ damage: 5, note: 'resistant to slashing' });
  });
});

describe('rounding (the table ruling): modify the total, round once, in the enemy favour', () => {
  const fire = (o: Partial<TargetInfo>) => goblin('x', { defenses: { resist: ['fire'], immune: [], vulnerable: [] }, ...o });
  test('a resisted 7 is 3 for a monster, 4 for a PC', () => {
    const r = { d20: [15], dmg: [[4]] }, dice = [{ expr: '1d4+3', type: 'fire' }];
    expect(resolveAttack(fire({}), 5, dice, r, false).damage).toBe(3);
    expect(resolveAttack(fire({ pc: true }), 5, dice, r, false).damage).toBe(4);
  });
  test('half on a save halves the total, not each type: 7 cold + 6 fire saved is 6 for a monster, 7 for a PC', () => {
    const owed = [{ amount: 7, type: 'cold' }, { amount: 6, type: 'fire' }], none = { resist: [], immune: [], vulnerable: [] };
    expect(settle({ defenses: none }, owed, true, 'half').damage).toBe(6);
    expect(settle({ defenses: none, pc: true }, owed, true, 'half').damage).toBe(7);
    // resistance stays with its type, still rounded once: 3.5 cold + 1.5 fire = 5
    expect(settle({ defenses: { ...none, resist: ['fire'] } }, owed, true, 'half').damage).toBe(5);
  });
});

describe('a spell', () => {
  const knife: SpellRead = { attack: 'ranged', save: 'Dex', onSave: 'none', burst: 5, damage: [{ dice: '1d10', type: 'piercing', on: 'hit' }, { dice: '2d6', type: 'cold', on: 'save' }] };
  const dice = [{ expr: '1d10', type: 'piercing', on: 'hit' as const }, { expr: '2d6', type: 'cold', on: 'save' as const }];
  test('attack plus burst: the knife hits its target; each creature in the burst saves; a PC waits for its own roll', () => {
    const out = resolveSpell(knife, dice, 13, 5, goblin('g2'), [goblin('g2'), goblin('g3'), goblin('pc', { pc: true })], { d20: [12], dmg: [[6], [3, 4]] }, always(5));
    expect(out).toEqual([
      expect.objectContaining({ id: 'g2', part: 'hit', hit: true, damage: 6 }),
      expect.objectContaining({ id: 'g2', part: 'save', save: { roll: 5, total: 7, ok: false }, damage: 7 }),
      expect.objectContaining({ id: 'g3', part: 'save', damage: 7 }),
      expect.objectContaining({ id: 'pc', part: 'save', pending: true, damage: 0, owed: [{ amount: 7, type: 'cold' }] }),
    ]);
  });
  test('a missed knife still bursts; a successful save takes nothing (onSave none)', () => {
    const out = resolveSpell(knife, dice, 13, 5, goblin('g2'), [goblin('g2')], { d20: [2], dmg: [[6], [3, 4]] }, always(15));
    expect(out).toEqual([expect.objectContaining({ part: 'hit', hit: false, damage: 0 }), expect.objectContaining({ part: 'save', save: { roll: 15, total: 17, ok: true }, damage: 0 })]);
  });
  test('Fireball: half (rounded down) on a success; no attack, everyone in the area saves', () => {
    const fireball: SpellRead = { save: 'Dex', onSave: 'half', damage: [{ dice: '8d6', type: 'fire' }] };
    const out = resolveSpell(fireball, [{ expr: '8d6', type: 'fire' }], 15, undefined, undefined, [goblin('a'), goblin('b')], { dmg: [[1, 2, 3, 4, 5, 6, 1, 1]] }, always(18));
    expect(out.map((o) => [o.id, o.save?.ok, o.damage])).toEqual([['a', true, 11], ['b', true, 11]]);
  });
});

describe('conditions on a failed save', () => {
  const hold: SpellRead = { damage: [], save: 'Wis', onSave: 'none', conditions: ['Paralyzed'] };
  const one = (t: TargetInfo, d20: number) => resolveSpell(hold, [], 13, undefined, t, [], { dmg: [] }, always(d20))[0];
  test('a failed save inflicts them; a success or an immunity does not', () => {
    expect(one(goblin('g'), 2)).toMatchObject({ id: 'g', save: { ok: false }, inflict: ['Paralyzed'] });
    expect(one(goblin('g'), 19).inflict).toBeUndefined();
    expect(one(goblin('g', { conditionImmune: ['paralyzed'] }), 2).inflict).toBeUndefined();
  });
  test('a PC\'s pending save carries what a failure would inflict', () => {
    expect(one(goblin('p', { pc: true }), 2)).toMatchObject({ pending: true, inflicts: ['Paralyzed'] });
  });
});

test('damage over time with no save just lands; with a save, the usual save', () => {
  const daggers: SpellRead = { damage: [{ dice: '4d4', type: 'slashing' }], lingering: true };
  expect(resolveSpell(daggers, [{ expr: '4d4', type: 'slashing' }], undefined, undefined, goblin('g'), [], { dmg: [[1, 2, 3, 4]] }, always(10)))
    .toEqual([expect.objectContaining({ id: 'g', hit: true, damage: 10 })]);
  const moon: SpellRead = { damage: [{ dice: '2d10', type: 'radiant' }], lingering: true, save: 'Con', onSave: 'half' };
  expect(resolveSpell(moon, [{ expr: '2d10', type: 'radiant' }], 13, undefined, goblin('g'), [], { dmg: [[5, 5]] }, always(2))[0]).toMatchObject({ save: { ok: false }, damage: 10 });
});

// Every Spell, Task 3: alternative and later parts, half on a miss.
describe('damage parts when resolved', () => {
  test('the alternative die hurts a hurt target instead of the first', () => {
    const read = { save: 'Wis', onSave: 'none', damage: [{ dice: '1d8', type: 'necrotic' }, { dice: '1d12', type: 'necrotic', part: 'alt' }] } as never;
    const dice = [{ expr: '1d8', type: 'necrotic' }, { expr: '1d12', type: 'necrotic', part: 'alt' as const }];
    const fresh = resolveSpell(read, dice, 13, undefined, goblin('g'), [], { dmg: [[5], [11]] }, always(2));
    const hurt = resolveSpell(read, dice, 13, undefined, goblin('g', { hurt: true }), [], { dmg: [[5], [11]] }, always(2));
    expect([fresh[0].damage, hurt[0].damage]).toEqual([5, 11]);
  });
  test('a later part waits on the outcome; a miss with half deals half the first part only', () => {
    const read = { attack: 'ranged', missHalf: true, damage: [{ dice: '4d4', type: 'acid' }, { dice: '2d4', type: 'acid', part: 'later' }] } as never;
    const dice = [{ expr: '4d4', type: 'acid' }, { expr: '2d4', type: 'acid', part: 'later' as const }];
    const hit = resolveSpell(read, dice, undefined, 5, goblin('g'), [], { d20: [15], dmg: [[4, 4, 4, 4], [3, 3]] }, always(1));
    const miss = resolveSpell(read, dice, undefined, 5, goblin('g'), [], { d20: [2], dmg: [[4, 4, 4, 4], [3, 3]] }, always(1));
    expect([hit[0].damage, hit[0].later, miss[0].damage, miss[0].later]).toEqual([16, 6, 8, undefined]);
  });
});
