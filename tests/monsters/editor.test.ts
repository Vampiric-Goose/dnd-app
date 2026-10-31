import { expect, test } from 'vitest';
import { estimateAttack, estimateDpr, joinList, rehome, splitList } from '../../src/lib/monsters/editing.ts';
import { blankMonster } from '../../src/lib/monsters/homebrew.ts';
import type { MonsterDef, StoredMonster, Trait } from '../../src/lib/types.ts';

const t = (name: string, p: string): Trait => ({ name, text: [{ p }] });
const m = (actions: Trait[]): MonsterDef => ({ ...blankMonster('c1'), actions });

test('estimateDpr: the best action, times a Multiattack count; raw tags and printed averages both count', () => {
  expect(estimateDpr(m([t('Multiattack', 'The beast makes two attacks.'), t('Bite', 'Melee Weapon Attack: {@hit 5} to hit. Hit: {@damage 2d6 + 3} piercing damage.')]))).toBe(20);
  expect(estimateDpr(m([t('Claw', 'Hit: 7 (1d6 + 4) slashing damage.')]))).toBe(7);
  expect(estimateDpr(m([]))).toBe(0);
});

test('estimateDpr adds "plus" damage, skips "or" alternatives, and never multiplies a saving-throw action', () => {
  expect(estimateDpr(m([t('Bite', 'Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.')]))).toBe(26);
  expect(estimateDpr(m([t('Longsword', 'Hit: 6 (1d8 + 2) slashing damage, or 7 (1d10 + 2) slashing damage if used with two hands.')]))).toBe(6);
  const dragon = m([
    t('Multiattack', 'It then makes three attacks: one with its bite and two with its claws.'),
    t('Bite', '+14 to hit. Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.'),
    t('Fire Breath', 'Each creature must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save.'),
  ]);
  expect(estimateDpr(dragon)).toBe(78);
  expect(estimateDpr(m([t('Multiattack', 'makes three attacks'), t('Breath', 'a DC 21 Dexterity saving throw, taking 90 (20d8) fire damage')]))).toBe(90);
});

test('estimateAttack returns the highest attack bonus and save DC', () => {
  expect(estimateAttack(m([t('Bite', '+14 to hit, Hit: 1 (1d2)'), t('Claw', '+9 to hit'), t('Breath', 'DC 21 Dexterity'), t('Fear', 'DC 19 Wisdom')]))).toEqual({ attack: 14, dc: 21 });
  expect(estimateAttack(m([t('Bite', '{@hit 5} to hit, {@dc 12}')]))).toEqual({ attack: 5, dc: 12 });
  expect(estimateAttack(m([]))).toEqual({});
});

test('comma lists: entries holding commas are separated by semicolons both ways', () => {
  expect(splitList('fire, cold ,')).toEqual(['fire', 'cold']);
  const resist = ['acid', 'bludgeoning, piercing, and slashing from nonmagical attacks'];
  expect(joinList(resist)).toBe('acid; bludgeoning, piercing, and slashing from nonmagical attacks');
  expect(splitList(joinList(resist))).toEqual(resist);
});

test('rehome: an imported file joins this campaign; SRD, pack and other-campaign ids get a new homebrew id', () => {
  const file = (id: string, campaignId = 'other'): StoredMonster => ({ ...blankMonster(campaignId), id, source: id.split('@')[1] });
  const srd = rehome(file('monster:goblin@SRD'), 'c1', undefined);
  expect(srd.clash).toBe(false);
  expect(srd.monster.id).toMatch(/^monster:homebrew-.*@HOMEBREW$/);
  expect(srd.monster).toMatchObject({ campaignId: 'c1', source: 'HOMEBREW' });
  expect(rehome(file('monster:beholder@MM'), 'c1', undefined).monster.id).toMatch(/@HOMEBREW$/);

  const mine = file('monster:homebrew-abc@HOMEBREW');
  expect(rehome(mine, 'c1', undefined)).toMatchObject({ clash: false, monster: { id: mine.id, campaignId: 'c1' } });
  expect(rehome(mine, 'c1', { ...mine, campaignId: 'c1' })).toMatchObject({ clash: true, monster: { id: mine.id } });
  const elsewhere = rehome(mine, 'c1', { ...mine, campaignId: 'c2' });
  expect(elsewhere.clash).toBe(false);
  expect(elsewhere.monster.id).not.toBe(mine.id);
});
