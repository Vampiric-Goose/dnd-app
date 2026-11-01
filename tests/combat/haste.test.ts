import { expect, test } from 'vitest';
import { next, start } from '../../src/lib/combat/combat.ts';
import { budgetFeet } from '../../src/lib/combat/movement.ts';
import { applyUse, pcActions, problemOf, type TurnAction } from '../../src/lib/combat/turnActions.ts';
import type { Character, Combat, Combatant, Sheet, SpellDef } from '../../src/lib/types.ts';

// Haste (2014): the spell text flags it; the Hasted condition gives the target an extra Action each turn, limited to one weapon attack,
// Dash, Disengage, Hide or Use an Object, and doubles its speed; when it ends the target can't move or act on its next turn.
const HASTE_TEXT = 'Choose a willing creature that you can see within range. Until the spell ends, the target\'s speed is doubled, it gains a +2 bonus to AC, it has advantage on Dexterity saving throws, and it gains an additional action on each of its turns. That action can be used only to take the Attack (one weapon attack only), Dash, Disengage, Hide, or Use an Object action.';
const haste: SpellDef = { kind: 'spell', id: 'spell:haste@SRD', name: 'Haste', source: 'SRD', text: [{ p: HASTE_TEXT }], level: 3, school: 'transmutation', castingTime: '1 action',
  range: '30 feet', components: {}, duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, classes: [] };
const wizard = {
  build: { levels: [{ classId: 'class:wizard@SRD' }], subclasses: {}, spells: { 'class:wizard@SRD': { known: [haste.id], prepared: [haste.id] } } },
  embedded: { [haste.id]: haste, 'class:wizard@SRD': { kind: 'class', id: 'class:wizard@SRD', name: 'Wizard', spellcasting: { preparation: 'prepared' } } },
  state: { resourcesUsed: {}, slotsUsed: [] },
} as unknown as Character;
const sheet = { attacks: [{ entryId: 'sword', name: 'Longsword', toHit: 5, damage: '1d8+3', damageType: 'slashing', properties: [] }], resources: [], spellcasting: [{ classId: 'class:wizard@SRD' }], slots: [4, 3, 3] } as unknown as Sheet;
const cb = (id: string, init: number, o: Partial<Combatant> = {}): Combatant => ({ id, kind: 'monster', name: id, init, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (): Combat => start({ campaignId: 'c', combatants: [cb('wiz', 20), cb('ftr', 15), cb('orc', 10)], round: 0, groupMonsters: false, updatedAt: 0 }).combat;
const std = (n: string) => ({ id: `std:${n}`, name: n, cost: 'action', group: 'standard' }) as TurnAction;
const sword = { id: 'attack:sword', name: 'Longsword', cost: 'action', group: 'attack', attack: sheet.attacks[0] } as TurnAction;

test('the interpreter flags Haste from its text: casting it needs a target', () => {
  expect(pcActions(wizard, sheet, []).find((a) => a.id === `spell:${haste.id}`)).toMatchObject({ cost: 'action', target: 'haste' });
});

test('cast on the fighter: Hasted; its next turn has an extra Action and doubled speed', () => {
  let k = fight();
  const cast = pcActions(wizard, sheet, []).find((a) => a.id === `spell:${haste.id}`)!;
  k = applyUse(k, k.combatants[0], cast, 1, 'ftr');
  expect(k.combatants.find((x) => x.id === 'ftr')!.hasted).toEqual({ by: 'wiz', round: 1 });
  expect(k.combatants[0].concentrating).toBe(true);
  k = next(k).combat; // the fighter's turn
  const f = k.combatants.find((x) => x.id === 'ftr')!;
  expect(f.economy).toMatchObject({ extra: 1, haste: true });
  expect(budgetFeet(30, k.movement?.ftr)).toBe(60);
});

test('the Hasted condition limits the extra Action: one weapon attack, Dash, Disengage, Hide or Use an Object', () => {
  const x = cb('ftr', 15, { hasted: { by: 'wiz', round: 1 }, economy: { used: 1, extra: 1, bonus: false, attacks: 0, haste: true } });
  expect(problemOf(x, std('dodge'), [], true)).toMatch(/Hasted/);
  expect(problemOf(x, std('dash'), [], true)).toBeUndefined();
  expect(problemOf(x, sword, [], true, 2)).toBeUndefined();
  const k = applyUse({ campaignId: 'c', combatants: [x], round: 1, turn: 'ftr', groupMonsters: false, updatedAt: 0 }, x, sword, 2);
  expect(problemOf(k.combatants[0], sword, [], true, 2)).toBe('no Action left'); // one weapon attack only, even with Extra Attack
  const fresh = cb('ftr', 15, { hasted: { by: 'wiz', round: 1 }, economy: { used: 0, extra: 1, bonus: false, attacks: 0, haste: true } });
  expect(problemOf(fresh, std('dodge'), [], true)).toBeUndefined(); // its own Action is unlimited
});

test('when the caster stops concentrating, the target loses Haste and can neither move nor act on its next turn', () => {
  let k = fight();
  k = applyUse(k, k.combatants[0], pcActions(wizard, sheet, []).find((a) => a.id === `spell:${haste.id}`)!, 1, 'ftr');
  k = { ...k, combatants: k.combatants.map((x) => (x.id === 'wiz' ? { ...x, concentrating: false } : x)) };
  k = next(k).combat;
  const f = k.combatants.find((x) => x.id === 'ftr')!;
  expect(f.hasted).toBeUndefined();
  expect(problemOf(f, std('dash'), [], true)).toBe('no Action left');
  expect(problemOf(f, { ...std('x'), cost: 'bonus' }, [], true)).toBe('no Bonus action left');
  expect(budgetFeet(30, k.movement?.ftr)).toBe(0);
});

test('casting another concentration spell ends the Haste too; it lasts at most 10 rounds', () => {
  let k = fight();
  const cast = pcActions(wizard, sheet, []).find((a) => a.id === `spell:${haste.id}`)!;
  k = applyUse(k, k.combatants[0], cast, 1, 'ftr');
  const bless = { id: 'spell:bless', name: 'Bless', cost: 'action', group: 'spell', spell: { id: 'b', level: 1, concentration: true } } as TurnAction;
  k = applyUse(k, { ...k.combatants[0], economy: undefined }, bless);
  expect(k.combatants.find((x) => x.id === 'ftr')!.hasted?.ended).toBe(true);
  const late = applyUse(fight(), fight().combatants[0], cast, 1, 'ftr');
  const k2 = next({ ...late, round: 11 }).combat;
  expect(k2.combatants.find((x) => x.id === 'ftr')!.hasted).toBeUndefined();
});
