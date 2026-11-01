import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { budgetFeet } from '../../src/lib/combat/movement.ts';
import { applyUse, characterEffect, monsterActions, pcActions, problemOf, visible, type TurnAction } from '../../src/lib/combat/turnActions.ts';
import type { Character, Combat, Combatant, MonsterDef, Pack, Sheet } from '../../src/lib/types.ts';

// The 2014 basic rules (SRD 5.1, Combat): Grapple and Shove replace an attack of the Attack action; escaping a grapple is an action; one
// free object interaction a turn (drawing a weapon), a second needs an action; dropping prone is free, standing up costs half your
// speed; reactions: an Opportunity Attack (one melee attack), and the action readied with Ready.
const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const goblin = srd.entities.find((e) => e.id === 'monster:goblin@SRD') as MonsterDef;
const weapon = (id: string, name: string, equipped: boolean, ranged = false) =>
  ({ id, item: { kind: 'item', id: `item:${id}`, name, weapon: { category: 'martial', damage: '1d8', damageType: 'slashing', properties: [], ...(ranged && { ranged: true }) } }, quantity: 1, equipped, attuned: false, chargesUsed: 0, notes: '' });
const fighter = { build: { levels: [], subclasses: {}, spells: {} }, embedded: {}, state: { resourcesUsed: {}, slotsUsed: [], conditions: [] },
  inventory: [weapon('bow', 'Longbow', true, true), weapon('sword', 'Longsword', true), weapon('axe', 'Battleaxe', false)] } as unknown as Character;
const sheet = { attacks: [
  { entryId: 'bow', name: 'Longbow', toHit: 5, damage: '1d8+2', damageType: 'piercing', properties: ['ammunition'], ranged: true },
  { entryId: 'sword', name: 'Longsword', toHit: 6, damage: '1d8+3', damageType: 'slashing', properties: [] },
], resources: [], spellcasting: [], slots: [], skills: { athletics: { bonus: 5 }, acrobatics: { bonus: 1 } } } as unknown as Sheet;
const cb = (o: Partial<Combatant> = {}): Combatant => ({ id: 'x', kind: 'pc', name: 'x', init: 10, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (x: Combatant): Combat => ({ campaignId: 'c', combatants: [x], round: 1, turn: x.id, groupMonsters: false, updatedAt: 0 });
const list = pcActions(fighter, sheet, []);
const by = (id: string, l: TurnAction[] = list) => l.find((a) => a.id === id)!;

describe('the basic rules a character always has', () => {
  test('Grapple and Shove: an Athletics check, part of the Attack action; Escape a grapple only while grappled', () => {
    expect(by('special:grapple')).toMatchObject({ cost: 'action', group: 'attack', check: [{ label: 'Athletics', bonus: 5 }] });
    expect(by('special:shove')).toMatchObject({ cost: 'action', group: 'attack' });
    expect(problemOf(cb({ economy: { used: 1, extra: 0, bonus: false, attacks: 1 } }), by('special:shove'), [], true, 2)).toBeUndefined(); // replaces the 2nd attack
    const esc = by('std:escape');
    expect(esc.check).toEqual([{ label: 'Athletics', bonus: 5 }, { label: 'Acrobatics', bonus: 1 }]);
    expect(visible(esc, [])).toBe(false);
    expect(visible(esc, ['Grappled'])).toBe(true);
  });

  test('Draw and Stow: one object interaction each, the first free, the next an Action; drawing needs a free hand', () => {
    // bow and sword in hand: both hands full, so Draw is offered but blocked until something is stowed
    const draw = by('free:draw'), stow = by('free:stow');
    expect(draw).toMatchObject({ cost: 'none', blocked: 'no free hand: stow a weapon first' });
    expect(stow.options).toEqual([{ id: 'bow', name: 'Longbow' }, { id: 'sword', name: 'Longsword' }]);
    let k = applyUse(fight(cb()), cb(), stow);
    const x = k.combatants[0];
    expect(x.economy?.object).toBe(true);
    expect(problemOf({ ...x, economy: { ...x.economy!, used: 1 } }, stow, [], true)).toBe('no Action left'); // the 2nd interaction needs the Action
    k = applyUse(k, x, stow);
    expect(k.combatants[0].economy?.used).toBe(1);
    const stowed = characterEffect(fighter, stow, 'bow');
    expect(stowed.inventory.map((e) => [e.id, e.equipped])).toEqual([['bow', false], ['sword', true], ['axe', false]]);
    const list2 = pcActions(stowed, sheet, []), draw2 = list2.find((a) => a.id === 'free:draw')!;
    expect(draw2.blocked).toBeUndefined();
    expect(characterEffect(stowed, draw2, 'axe').inventory.map((e) => e.equipped)).toEqual([false, true, true]);
    expect(characterEffect(fighter, draw, 'axe')).toBe(fighter); // hands full: nothing drawn
  });

  test('Drop prone is free; Stand up is free but costs half the speed; each only when it applies', () => {
    expect(visible(by('free:prone'), [])).toBe(true);
    expect(visible(by('free:prone'), ['Prone'])).toBe(false);
    expect(visible(by('free:stand'), ['Prone'])).toBe(true);
    expect(characterEffect(fighter, by('free:prone')).state.conditions).toEqual(['Prone']);
    expect(characterEffect({ ...fighter, state: { ...fighter.state, conditions: ['Prone', 'Poisoned'] } }, by('free:stand')).state.conditions).toEqual(['Poisoned']);
    const k = applyUse(fight(cb()), cb(), by('free:stand'));
    expect(budgetFeet(30, k.movement?.x)).toBe(15);
  });

  test('Reactions: an Opportunity Attack with a melee weapon; the readied action only after Ready this turn', () => {
    expect(by('react:opportunity')).toMatchObject({ cost: 'reaction', group: 'attack', attack: { name: 'Longsword' } });
    const readied = by('react:readied');
    expect(problemOf(cb(), readied, [], false)).toBe('nothing readied');
    const k = applyUse(fight(cb()), cb(), by('std:ready'));
    expect(problemOf(k.combatants[0], readied, [], false)).toBeUndefined();
  });

  test('monsters take the same actions: the standard ones, Grapple, Shove, Opportunity Attack', () => {
    const m = monsterActions(goblin);
    for (const id of ['std:dash', 'std:dodge', 'special:grapple', 'special:shove', 'react:opportunity', 'react:readied', 'free:prone']) expect(m.some((a) => a.id === id)).toBe(true);
    expect(by('special:grapple', m).check).toEqual([{ label: 'Athletics', bonus: -1 }]); // Str 8, no Athletics
    expect(m.some((a) => a.id === 'free:draw' || a.id === 'free:stow')).toBe(false);
    const prone = applyUse(fight(cb({ kind: 'monster' })), cb({ kind: 'monster' }), by('free:prone', m));
    expect(prone.combatants[0].conditions).toEqual(['Prone']);
  });
});
