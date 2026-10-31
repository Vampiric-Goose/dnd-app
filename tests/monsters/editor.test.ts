import { expect, test } from 'vitest';
import { assembleHp, estimateAttack, estimateDpr, hpModeFor, joinList, rehome, splitList } from '../../src/lib/monsters/editing.ts';
import { blankMonster } from '../../src/lib/monsters/homebrew.ts';
import type { MonsterDef, StoredMonster, Trait } from '../../src/lib/types.ts';

const t = (name: string, p: string): Trait => ({ name, text: [{ p }] });
const m = (actions: Trait[]): MonsterDef => ({ ...blankMonster('c1'), actions });

test('estimateDpr: the best action, times a Multiattack count; raw tags and printed averages both count', () => {
  expect(estimateDpr(m([t('Multiattack', 'The beast makes two attacks.'), t('Bite', 'Melee Weapon Attack: {@hit 5} to hit. Hit: {@damage 2d6 + 3} piercing damage.')]))).toBe(20);
  expect(estimateDpr(m([t('Claw', 'Hit: 7 (1d6 + 4) slashing damage.')]))).toBe(7);
  expect(estimateDpr(m([]))).toBe(0);
});

test('estimateDpr adds "plus" damage and stops at an "or" alternative', () => {
  expect(estimateDpr(m([t('Bite', 'Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.')]))).toBe(26);
  expect(estimateDpr(m([t('Longsword', 'Hit: 6 (1d8 + 2) slashing damage, or 7 (1d10 + 2) slashing damage if used with two hands.')]))).toBe(6);
  expect(estimateDpr(m([t('Multiattack', 'makes three attacks'), t('Breath', 'a DC 21 Dexterity saving throw, taking 90 (20d8) fire damage')]))).toBe(90);
});

// Invented stat blocks in the book's phrasing (I3).
test('estimateDpr: "makes two melee weapon attacks" is 2 × the best attack', () => {
  const sentinel = m([t('Multiattack', 'The sentinel makes two melee weapon attacks.'), t('Maul', 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) bludgeoning damage.')]);
  expect(estimateDpr(sentinel)).toBe(20);
});

test('estimateDpr sums named attacks with their counts, counting save damage that rides on a hit', () => {
  const wyrm = m([
    t('Multiattack', 'The wyrm makes two attacks: one with its bite and one with its stinger. While flying, it can use its claws in place of one other attack.'),
    t('Bite', 'Melee Weapon Attack: +7 to hit, reach 10 ft., one creature. Hit: 11 (2d6 + 4) piercing damage.'),
    t('Claws', 'Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) slashing damage.'),
    t('Stinger', 'Melee Weapon Attack: +7 to hit, reach 10 ft., one creature. Hit: 11 (2d6 + 4) piercing damage. The target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much damage on a successful one.'),
  ]);
  expect(estimateDpr(wyrm)).toBe(46); // 11 + (11 + 24)
  const fiend = m([
    t('Multiattack', 'The fiend makes three attacks: two with its claws and one with its sting.'),
    t('Claw', 'Melee Weapon Attack: +8 to hit, reach 10 ft., one target. Hit: 8 (1d8 + 4) slashing damage.'),
    t('Sting', 'Melee Weapon Attack: +8 to hit, reach 10 ft., one target. Hit: 13 (2d8 + 4) piercing damage plus 17 (5d6) poison damage, and the target must succeed on a DC 14 Constitution saving throw or become poisoned for 1 minute.'),
  ]);
  expect(estimateDpr(fiend)).toBe(46); // 2 × 8 + (13 + 17)
  const drake = m([
    t('Multiattack', 'The drake can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.'),
    t('Bite', '+14 to hit. Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.'),
    t('Claw', '+14 to hit. Hit: 15 (2d6 + 8) slashing damage.'),
    t('Fire Breath', 'Each creature must make a DC 21 Dexterity saving throw, taking 45 (13d6) fire damage on a failed save.'),
  ]);
  expect(estimateDpr(drake)).toBe(56); // 26 + 2 × 15 beats the 45 breath
  drake.actions[3] = t('Fire Breath', 'Each creature must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save.');
  expect(estimateDpr(drake)).toBe(63); // a stronger single action wins
});

test('number words one to six count attacks', () => {
  const words = ['one', 'two', 'three', 'four', 'five', 'six'];
  words.forEach((w, i) => expect(estimateDpr(m([t('Multiattack', `It makes ${w} attacks.`), t('Slam', '+4 to hit. Hit: 5 (1d6 + 2) bludgeoning damage.')]))).toBe(5 * (i + 1)));
});

test('I2: an HP average with no formula is saved untouched; dice and special as before', () => {
  expect(hpModeFor({ average: 52 })).toBe('fixed');
  expect(hpModeFor({ average: 7, formula: '2d6' })).toBe('dice');
  expect(hpModeFor({ special: 'varies' })).toBe('special');
  expect(assembleHp('fixed', { formula: '1d8', fixed: '52', special: '' })).toEqual({ average: 52 });
  expect(assembleHp('dice', { formula: '4d6 + 8', fixed: '52', special: '' })).toEqual({ average: 22, formula: '4d6 + 8' });
  expect(assembleHp('special', { formula: '', fixed: '', special: ' varies ' })).toEqual({ special: 'varies' });
});

test('I4: dice mode keeps the printed HP while the built formula is the starting one; a change re-derives it', () => {
  const start = { hp: { average: 30, formula: '9d8 + 18' }, formula: '9d8 + 9' }; // printed off the hit-die rule
  expect(assembleHp('dice', { formula: '9d8 + 9', fixed: '', special: '' }, start)).toEqual({ average: 30, formula: '9d8 + 18' });
  expect(assembleHp('dice', { formula: '10d8 + 10', fixed: '', special: '' }, start)).toEqual({ average: 55, formula: '10d8 + 10' });
  expect(assembleHp('dice', { formula: '2d6', fixed: '', special: '' }, { hp: { average: 9 }, formula: '2d6' })).toEqual({ average: 7, formula: '2d6' });
});

test('M1/M6: a "constructor" count is 0; an unclosed {@damage tag is read quickly', () => {
  expect(estimateDpr(m([t('Multiattack', 'It makes constructor attacks.'), t('Slam', '+4 to hit. Hit: 5 (1d6 + 2) bludgeoning damage.')]))).toBe(5);
  const t0 = performance.now();
  expect(estimateDpr(m([t('Slam', `{@damage ${'1'.repeat(20_000)}`)]))).toBe(0);
  expect(performance.now() - t0).toBeLessThan(500);
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
