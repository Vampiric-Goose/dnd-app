import { describe, expect, test } from 'vitest';
import { afterDefenses, attackEdge, attackToggles, canTarget, combineMode, finalMode, monsterAttack, reachOf, targetingOn } from '../../src/lib/combat/targeting.ts';
import type { TurnAction } from '../../src/lib/combat/turnActions.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { Attack } from '../../src/lib/types.ts';

// PHB 2014: range (normal/long, disadvantage beyond normal, none beyond long), ranged attacks in close combat, reach; GWM and
// Sharpshooter's -5/+10; damage resistance, immunity and vulnerability.
const atk = (o: Partial<Attack>): TurnAction => ({ id: 'a', name: o.name ?? 'X', cost: 'action', group: 'attack',
  attack: { entryId: 'e', name: o.name ?? 'X', toHit: 5, damage: '1d8+3', damageType: 'slashing', properties: [], ...o } });
const monster = (text: string): TurnAction => ({ id: 'm', name: 'Scimitar', cost: 'action', group: 'monster', text: [{ p: text }] });
const none = { resist: [], immune: [], vulnerable: [] };

describe('targeting', () => {
  test('on unless the DM turned it off (existing campaigns have no key)', () => {
    expect(targetingOn(DEFAULT_SETTINGS)).toBe(true);
    expect(targetingOn({ ...DEFAULT_SETTINGS, targeting: false })).toBe(false);
  });

  test('reach and range of weapons, spells and monster attacks', () => {
    expect(reachOf(atk({}))).toEqual({ melee: 5 });
    expect(reachOf(atk({ properties: ['reach'] }))).toEqual({ melee: 10 });
    expect(reachOf(atk({ ranged: true, range: [150, 600] }))).toEqual({ normal: 150, long: 600 });
    expect(reachOf(atk({ properties: ['thrown'], range: [20, 60] }))).toEqual({ melee: 5, normal: 20, long: 60 });
    const spell = (range: unknown): TurnAction => ({ id: 's', name: 'S', cost: 'action', group: 'spell', cast: { read: { damage: [], range } as never, charLevel: 1, mod: 3 } });
    expect(reachOf(spell({ feet: 60 }))).toEqual({ spell: 60 });
    expect(reachOf(spell('touch'))).toEqual({ melee: 5 });
    expect(reachOf(spell('self'))).toBe('self');
    expect(reachOf(monster('Melee Weapon Attack: +4 to hit, reach 10 ft., one target. Hit: 5 (1d6 + 2) slashing damage.'))).toEqual({ melee: 10 });
    expect(reachOf(monster('Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.'))).toEqual({ normal: 80, long: 320 });
  });

  test('what can be picked: long range gives disadvantage, beyond it nothing; a hostile within 5 ft spoils a ranged attack', () => {
    expect(canTarget({ normal: 150, long: 600 }, 200, false, true)).toEqual({ ok: true, disadvantage: 'long range' });
    expect(canTarget({ normal: 150, long: 600 }, 650, false, true)).toEqual({ ok: false });
    expect(canTarget({ normal: 150, long: 600 }, 30, true, true)).toEqual({ ok: true, disadvantage: 'hostile within 5 ft' });
    expect(canTarget({ melee: 5 }, 10, false, false)).toEqual({ ok: false });
    expect(canTarget({ melee: 10 }, 10, false, false)).toEqual({ ok: true });
    expect(canTarget({ spell: 60 }, 60, false, false)).toEqual({ ok: true });
    expect(canTarget({ spell: 60 }, 65, false, false)).toEqual({ ok: false });
    expect(canTarget({ spell: 60 }, 30, true, true)).toEqual({ ok: true, disadvantage: 'hostile within 5 ft' });
    expect(canTarget({ melee: 5, normal: 20, long: 60 }, 5, true, false)).toEqual({ ok: true }); // a handaxe swung, not thrown
    expect(canTarget({ melee: 5, normal: 20, long: 60 }, 40, false, true)).toEqual({ ok: true, disadvantage: 'long range' });
  });

  test('Great Weapon Master on a heavy melee weapon, Sharpshooter on a ranged one, only with the feat', () => {
    const greatsword = atk({ name: 'Greatsword', properties: ['heavy', 'two-handed'] }), longbow = atk({ name: 'Longbow', ranged: true, properties: ['heavy'] });
    expect(attackToggles(greatsword, ['Great Weapon Master']).map((t) => [t.id, t.toHit, t.damage])).toEqual([['gwm', -5, 10]]);
    expect(attackToggles(longbow, ['Great Weapon Master'])).toEqual([]);
    expect(attackToggles(longbow, ['Sharpshooter']).map((t) => t.id)).toEqual(['ss']);
    expect(attackToggles(greatsword, [])).toEqual([]);
  });

  test('resistance halves (down), immunity zeroes, vulnerability doubles; "nonmagical" clauses only for nonmagical weapons', () => {
    expect(afterDefenses(14, 'cold', { ...none, resist: ['cold'] }, false)).toEqual({ amount: 7, note: 'resistant to cold' });
    const bps = ['bludgeoning, piercing, and slashing from nonmagical attacks'];
    expect(afterDefenses(10, 'slashing', { ...none, resist: bps }, true)).toEqual({ amount: 10 });
    expect(afterDefenses(10, 'slashing', { ...none, resist: bps }, false).amount).toBe(5);
    expect(afterDefenses(10, 'fire', { ...none, immune: ['fire'] }, false).amount).toBe(0);
    expect(afterDefenses(10, 'fire', { ...none, vulnerable: ['fire'] }, false).amount).toBe(20);
    expect(afterDefenses(10, 'fire', none, false)).toEqual({ amount: 10 });
  });

  test('a monster attack read from its text', () => {
    expect(monsterAttack(monster('Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.')))
      .toEqual({ toHit: 4, dmg: [{ expr: '1d6+2', type: 'slashing' }], ranged: false });
    expect(monsterAttack(monster('Ranged Weapon Attack: +6 to hit, range 150/600 ft., one target. Hit: 7 (1d8 + 3) piercing damage plus 7 (2d6) fire damage.')))
      .toEqual({ toHit: 6, dmg: [{ expr: '1d8+3', type: 'piercing' }, { expr: '2d6', type: 'fire' }], ranged: true });
    expect(monsterAttack(monster('The goblin hides.'))).toBeUndefined();
  });

  test('advantage and disadvantage from conditions (PHB Appendix A), Dodge and exhaustion, with the reasons', () => {
    const edge = (o: Partial<Parameters<typeof attackEdge>[0]>) => attackEdge({ attacker: [], target: [], within5: true, ...o });
    expect(edge({ attacker: ['Prone'] }).dis).toEqual(['you are prone']);
    expect(edge({ attacker: ['Poisoned', 'Blinded'] }).dis).toEqual(['you are blinded', 'you are poisoned']);
    expect(edge({ attacker: ['Invisible'] }).adv).toEqual(['you are invisible']);
    expect(edge({ target: ['prone'] })).toMatchObject({ adv: ['target is prone (within 5 ft)'], dis: [] });
    expect(edge({ target: ['prone'], within5: false })).toMatchObject({ adv: [], dis: ['target is prone (beyond 5 ft)'] });
    expect(edge({ target: ['Restrained'] }).adv).toEqual(['target is restrained']);
    expect(edge({ target: ['Invisible'] }).dis).toEqual(['target is invisible']);
    expect(edge({ dodging: true }).dis).toEqual(['target is dodging']);
    expect(edge({ exhaustion: 3 }).dis).toEqual(['exhaustion 3']);
    expect(edge({ exhaustion: 2 }).dis).toEqual([]);
    // a hit on a paralyzed or unconscious creature within 5 ft is a critical hit
    expect(edge({ target: ['Paralyzed'] })).toMatchObject({ adv: ['target is paralyzed'], autoCrit: true });
    expect(edge({ target: ['Unconscious'], within5: false }).autoCrit).toBe(false);
  });

  test('any advantage and any disadvantage cancel out; the roller\'s own pick counts as one of either', () => {
    expect(combineMode({ adv: ['a'], dis: [] })).toBe('adv');
    expect(combineMode({ adv: ['a'], dis: ['b', 'c'] })).toBeUndefined();
    expect(combineMode({ adv: [], dis: [] }, 'dis')).toBe('dis');
    expect(combineMode({ adv: [], dis: ['long range'] }, 'adv')).toBeUndefined();
  });

  test('forced disadvantage meets the player\'s pick: advantage and disadvantage cancel', () => {
    expect(finalMode('adv', 'long range')).toBeUndefined();
    expect(finalMode(undefined, 'long range')).toBe('dis');
    expect(finalMode('adv')).toBe('adv');
  });
});
