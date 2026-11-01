import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { attacksPerAction, castingCost, costOfText, monsterActions, offhandDamage, pcActions, primaryAction } from '../../src/lib/combat/turnActions.ts';
import type { Attack, Character, MonsterDef, Pack, Sheet, SpellDef } from '../../src/lib/types.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const atk = (name: string, o: Partial<Attack> = {}): Attack => ({ entryId: name, name, toHit: 5, damage: '1d8+3', damageType: 'slashing', properties: [], ...o });
const spell = (id: string, level: number, castingTime: string, concentration = false): SpellDef =>
  ({ kind: 'spell', id, name: id, source: 'SRD', text: [], level, school: 'evocation', castingTime, range: '60 feet', components: {}, duration: 'Instantaneous', concentration, ritual: false, classes: [] });
const feat = (name: string, text: string) => ({ source: 'Class', name, text: [{ p: text }] });

function character(spells: SpellDef[] = [], prepared: string[] = [], used: Record<string, number> = {}): Character {
  return {
    build: { levels: [{ classId: 'class:wizard@SRD' }], subclasses: {}, spells: { 'class:wizard@SRD': { known: spells.map((s) => s.id), prepared } } },
    embedded: Object.fromEntries([...spells.map((s) => [s.id, s]), ['class:wizard@SRD', { kind: 'class', id: 'class:wizard@SRD', name: 'Wizard', spellcasting: { preparation: 'prepared' } }]]),
    state: { resourcesUsed: used },
  } as unknown as Character;
}
const sheet = (o: Partial<Sheet> = {}): Sheet => ({ attacks: [atk('Longsword'), atk('Unarmed Strike', { entryId: 'unarmed', damage: '4', damageType: 'bludgeoning' })], resources: [], spellcasting: [], slots: [], ...o }) as unknown as Sheet;

describe('costs from text', () => {
  test('feature text and casting times', () => {
    expect(costOfText('On your turn, you can use a bonus action to regain hit points')).toBe('bonus');
    expect(costOfText('As an action, you can present your holy symbol')).toBe('action');
    expect(costOfText('You can use your reaction to halve the damage')).toBe('reaction');
    expect(costOfText('You can push yourself beyond your normal limits')).toBe('none');
    expect(castingCost('1 action')).toBe('action');
    expect(castingCost('1 bonus action')).toBe('bonus');
    expect(castingCost('1 reaction, which you take when…')).toBe('reaction');
    expect(castingCost('1 minute')).toBeUndefined();
  });
  test('Extra Attack: the highest wins', () => {
    expect(attacksPerAction([])).toBe(1);
    expect(attacksPerAction([{ name: 'Extra Attack' }, { name: 'Extra Attack (2)' }])).toBe(3);
    expect(attacksPerAction([{ name: 'Extra Attack (3)' }])).toBe(4);
  });
  test('off-hand damage drops a positive modifier, keeps a negative one', () => {
    expect(offhandDamage('1d6+3')).toBe('1d6');
    expect(offhandDamage('1d4-1')).toBe('1d4-1');
    expect(offhandDamage('1d6')).toBe('1d6');
  });
});

describe('pcActions', () => {
  test('a fighter: attacks, every standard action, Second Wind as bonus, Action Surge grants an Action, no Cunning Action', () => {
    const list = pcActions(character(), sheet({ resources: [{ name: 'Second Wind', max: 1, recharge: 'short' }, { name: 'Action Surge', max: 1, recharge: 'short' }] }),
      [feat('Second Wind', 'On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level.'), feat('Action Surge', 'You can push yourself beyond your normal limits for a moment.')]);
    const by = (id: string) => list.find((a) => a.id === id);
    expect(primaryAction(list)?.name).toBe('Longsword');
    expect(by('attack:unarmed')?.cost).toBe('action');
    for (const s of ['dash', 'disengage', 'dodge', 'help', 'hide', 'ready', 'search', 'use-an-object']) expect(by(`std:${s}`)?.cost).toBe('action');
    expect(by('std:dash')?.grants).toBe('dash');
    expect(by('res:Second Wind')).toMatchObject({ cost: 'bonus', uses: { left: 1, max: 1 } });
    expect(by('res:Action Surge')).toMatchObject({ cost: 'none', grants: 'action' });
    expect(list.some((a) => a.id.startsWith('cunning:'))).toBe(false);
  });
  test('a rogue: Dash under action, Cunning Action: Dash under bonus, separate entries', () => {
    const list = pcActions(character(), sheet(), [feat('Cunning Action', 'You can take a bonus action on each of your turns in combat. This action can be used only to take the Dash, Disengage, or Hide action.')]);
    expect(list.find((a) => a.id === 'std:dash')?.cost).toBe('action');
    expect(list.find((a) => a.id === 'cunning:dash')).toMatchObject({ name: 'Cunning Action: Dash', cost: 'bonus', grants: 'dash' });
    expect(list.filter((a) => a.id.startsWith('cunning:')).map((a) => a.id)).toEqual(['cunning:dash', 'cunning:disengage', 'cunning:hide']);
  });
  test('two light melee weapons offer an off-hand attack for the bonus action', () => {
    const list = pcActions(character(), sheet({ attacks: [atk('Shortsword', { properties: ['finesse', 'light'], damage: '1d6+3' }), atk('Dagger', { properties: ['finesse', 'light', 'thrown'], damage: '1d4+3' })] }), []);
    const off = list.filter((a) => a.id.startsWith('offhand:'));
    expect(off.length).toBeGreaterThan(0);
    expect(off[0]).toMatchObject({ cost: 'bonus' });
    expect(off[0].attack?.damage).toBe('1d6');
  });
  test('spells: cantrips and prepared ones, under their casting cost; long casts left out; uses left on resources', () => {
    const s = [spell('spell:fire-bolt@SRD', 0, '1 action'), spell('spell:healing-word@SRD', 1, '1 bonus action'), spell('spell:shield@SRD', 1, '1 reaction'), spell('spell:identify@SRD', 1, '1 minute'), spell('spell:sleep@SRD', 1, '1 action')];
    const list = pcActions(character(s, ['spell:healing-word@SRD', 'spell:shield@SRD', 'spell:identify@SRD'], { Rage: 2 }), sheet({ resources: [{ name: 'Rage', max: 3, recharge: 'long' }], spellcasting: [{ classId: 'class:wizard@SRD' }] as Sheet['spellcasting'] }), [feat('Rage', 'On your turn, you can enter a rage as a bonus action.')]);
    const ids = list.filter((a) => a.group === 'spell').map((a) => [a.id, a.cost]);
    expect(ids).toEqual([['spell:spell:fire-bolt@SRD', 'action'], ['spell:spell:healing-word@SRD', 'bonus'], ['spell:spell:shield@SRD', 'reaction']]);
    expect(list.find((a) => a.id === 'res:Rage')).toMatchObject({ cost: 'bonus', uses: { left: 1, max: 3 } });
  });
});

test('monsterActions: a goblin attacks with its Action', () => {
  const list = monsterActions(goblin);
  expect(list.map((a) => a.name)).toEqual(expect.arrayContaining(['Scimitar', 'Shortbow']));
  expect(list.every((a) => a.cost === 'action' || a.cost === 'bonus' || a.cost === 'reaction')).toBe(true);
  expect(list.find((a) => a.name === 'Scimitar')?.cost).toBe('action');
});
