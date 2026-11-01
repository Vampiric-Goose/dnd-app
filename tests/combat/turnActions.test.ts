import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { applyUse, attacksPerAction, castingCost, costOfText, traitCost, monsterActions, offhandDamage, payment, pcActions, primaryAction, problemOf, slotsLeft, spendOn, type TurnAction } from '../../src/lib/combat/turnActions.ts';
import type { Attack, Character, Combat, Combatant, MonsterDef, Pack, Sheet, SpellDef } from '../../src/lib/types.ts';

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

describe('using an action', () => {
  const cb = (o: Partial<Combatant> = {}): Combatant => ({ id: 'x', kind: 'monster', name: 'x', init: 10, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
  const fight = (x: Combatant): Combat => ({ campaignId: 'c', combatants: [x], round: 1, turn: x.id, groupMonsters: false, updatedAt: 0 });
  const legend = { id: 'mon:legendary:1', name: 'Wing Attack (Costs 2 Actions)', cost: 'none', group: 'monster', legendary: 2 } as TurnAction;

  test('legendary actions: off its turn only, with the uses they cost', () => {
    const x = cb({ legendary: { max: 3, used: 2 } });
    expect(problemOf(x, legend, [], true)).toMatch(/another creature/);
    expect(problemOf(x, legend, [], false)).toBe('no legendary actions left');
    expect(problemOf(cb({ legendary: { max: 3, used: 0 } }), legend, ['Stunned'], false)).toBe('Stunned');
    const k = applyUse(fight(cb({ legendary: { max: 3, used: 0 } })), cb({ legendary: { max: 3, used: 0 } }), legend);
    expect(k.combatants[0].legendary?.used).toBe(2);
  });

  test('a resource with no uses left is refused; Action Surge grants an Action; Dash adds movement', () => {
    const res = { id: 'res:Rage', name: 'Rage', cost: 'bonus', group: 'resource', uses: { left: 0, max: 2 } } as TurnAction;
    expect(problemOf(cb(), res, [], true)).toBe('no Rage left');
    const surge = { id: 'res:Action Surge', name: 'Action Surge', cost: 'none', group: 'resource', grants: 'action' } as TurnAction;
    expect(applyUse(fight(cb()), cb(), surge).combatants[0].economy?.extra).toBe(1);
    const dash = { id: 'cunning:dash', name: 'Cunning Action: Dash', cost: 'bonus', group: 'feature', grants: 'dash' } as TurnAction;
    const k = applyUse(fight(cb()), cb(), dash);
    expect(k.combatants[0].economy?.bonus).toBe(true);
    expect(k.movement?.x?.dashes).toBe(1);
  });

  test('two-weapon fighting: the off-hand attack only after an Attack action with a light melee weapon', () => {
    const list = pcActions(character(), sheet({ attacks: [atk('Shortsword', { properties: ['finesse', 'light'], damage: '1d6+3' }), atk('Dagger', { properties: ['finesse', 'light', 'thrown'], damage: '1d4+3' }), atk('Longsword')] }), []);
    const by = (id: string) => list.find((a) => a.id === id)!;
    expect(problemOf(cb(), by('offhand:Shortsword'), [], true)).toMatch(/light melee weapon first/);
    const afterLong = applyUse(fight(cb()), cb(), by('attack:Longsword')).combatants[0];
    expect(problemOf(afterLong, by('offhand:Dagger'), [], true)).toMatch(/light melee weapon first/);
    const afterShort = applyUse(fight(cb()), cb(), by('attack:Shortsword')).combatants[0];
    expect(problemOf(afterShort, by('offhand:Dagger'), [], true)).toBeUndefined();
  });

  test('Action Surge: once a turn, only on its own turn; other no-cost uses work off-turn', () => {
    const surge = { id: 'res:Action Surge', name: 'Action Surge', cost: 'none', group: 'resource', grants: 'action', uses: { left: 2, max: 2 } } as TurnAction;
    const indomitable = { id: 'res:Indomitable', name: 'Indomitable', cost: 'none', group: 'resource', uses: { left: 1, max: 1 } } as TurnAction;
    expect(problemOf(cb(), surge, [], false)).toBe('not your turn');
    const after = applyUse(fight(cb()), cb(), surge).combatants[0];
    expect(problemOf(after, surge, [], true)).toBe('once a turn');
    expect(problemOf(cb(), indomitable, [], false)).toBeUndefined();
  });

  test('monster traits: only one taken as an action counts (Nimble Escape yes, Reactive no)', () => {
    expect(traitCost('The goblin can take the Disengage or Hide action as a bonus action on each of its turns.')).toBe('bonus');
    expect(traitCost('The marilith can take one reaction on every turn in a combat.')).toBe('none');
    expect(traitCost('When a creature hits it, the knight uses its reaction to add 2 to its AC.')).toBe('reaction');
  });

  test('payment: slot levels at or above the spell, free ones only; spendOn pays a slot and a use', () => {
    const c = character(); c.state.slotsUsed = [2];
    const sh = sheet({ slots: [2, 1] });
    const sleep = { id: 'spell:sleep', name: 'Sleep', cost: 'action', group: 'spell', spell: { id: 's', level: 1, concentration: false } } as TurnAction;
    expect(slotsLeft(sh, c)).toEqual([0, 1]);
    expect(payment(sleep, sh, c, 1)).toEqual({ level: 1, problem: 'no level 1 slot left' });
    expect(payment(sleep, sh, c)).toEqual({ level: 2 }); // the lowest free slot at or above
    expect(payment(sleep, sh, c, 2)).toEqual({ level: 2 });
    const paid = spendOn(c, 2, 'Rage');
    expect(paid.state.slotsUsed).toEqual([2, 1]);
    expect(paid.state.resourcesUsed.Rage).toBe(1);
  });

  test('final review: a warlock casts with Pact Magic slots, at the pact level', () => {
    const c = character(); c.state.pactSlotsUsed = 0; c.state.slotsUsed = [];
    const sh = sheet({ slots: [], pact: { slots: 2, level: 3 } });
    const hex = { id: 'spell:hex', name: 'Hex', cost: 'bonus', group: 'spell', spell: { id: 'h', level: 1, concentration: true } } as TurnAction;
    expect(slotsLeft(sh, c)).toEqual([0, 0, 2]);
    expect(payment(hex, sh, c)).toEqual({ level: 3, pact: true });
    const paid = spendOn(c, 3, undefined, true);
    expect(paid.state.pactSlotsUsed).toBe(1);
    expect(paid.state.slotsUsed).toEqual([]);
    expect(payment(hex, sh, { ...c, state: { ...c.state, pactSlotsUsed: 2 } })).toEqual({ level: 1, problem: 'no level 1 slot left' });
  });
});
