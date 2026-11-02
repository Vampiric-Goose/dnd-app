import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test } from 'vitest';
import { endedSummons, scaleSummon, summonCombatants, summonOptions } from '../../src/lib/combat/summons.ts';
import { updateCombat } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { newScene } from '../../src/lib/map/scene.ts';
import { summon } from '../../src/lib/map/store.ts';
import type { Combat, Combatant, MonsterDef } from '../../src/lib/types.ts';
import { camp } from '../fixtures/records.ts';

// Every Spell, Task 7 (synthetic stat block with the import's formula wording, no book text): summons join the fight and leave with the spell.
const spirit = {
  kind: 'monster', id: 'monster:test-spirit@FIX', name: 'Test Spirit', source: 'FIX', text: [], size: ['M'], type: 'beast', alignment: 'unaligned',
  ac: [{ value: 11, from: '11 + the level of the spell (natural armor)' }], hp: { special: '20 (Air only) or 30 (Land and Water only) + 5 for each spell level above 2nd' },
  speed: { walk: 30 }, scores: { str: 18, dex: 11, con: 16, int: 4, wis: 14, cha: 5 }, saves: {}, skills: {}, vulnerable: [], resist: [], immune: [], conditionImmune: [],
  senses: [], passive: 12, languages: [], cr: '0', traits: [], bonusActions: [], reactions: [], legendary: [],
  actions: [{ name: 'Multiattack', text: [{ p: 'The beast makes a number of attacks equal to half this spell\'s level (rounded down).' }] },
    { name: 'Maul', text: [{ p: '*Melee Weapon Attack:* your spell attack modifier to hit, reach 5 ft., one target. *Hit:* 1d8 + 4 + summonSpellLevel piercing damage.' }] }],
} as unknown as MonsterDef;
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });

test('a spirit scaled to its spell: AC, HP by variant, attack and damage, attack count', () => {
  const m = scaleSummon(spirit, { level: 4, attack: 7, variant: 'Land' });
  expect([m.ac[0].value, m.hp]).toEqual([15, { average: 40 }]);
  expect(m.actions[1].text[0]).toEqual({ p: expect.stringContaining('+7 to hit') });
  expect(m.actions[1].text[0]).toEqual({ p: expect.stringContaining('12 (1d8 + 8) piercing damage') });
  expect(m.actions[0].text[0]).toEqual({ p: expect.stringContaining('makes 2 attacks') });
  expect(scaleSummon(spirit, { level: 2, attack: 5, variant: 'Air' }).hp).toEqual({ average: 20 });
});

test('what a spell summons: a named stat block and its choices, or options by count and challenge rating', () => {
  expect(summonOptions([{ p: 'This corporeal form uses the Test Spirit stat block. When you cast the spell, choose an environment: Air, Land, or Water.' }]))
    .toEqual({ creature: 'Test Spirit', variants: ['Air', 'Land', 'Water'] });
  expect(summonOptions([{ p: 'Choose one of the following options for what appears:' }, { list: ['One beast of challenge rating 2 or lower', 'Two beasts of challenge rating 1 or lower', 'Four beasts of challenge rating 1/2 or lower', 'Eight beasts of challenge rating 1/4 or lower'] }]))
    .toEqual({ options: [{ count: 1, cr: 2, type: 'beast' }, { count: 2, cr: 1, type: 'beast' }, { count: 4, cr: 0.5, type: 'beast' }, { count: 8, cr: 0.25, type: 'beast' }] });
  expect(summonOptions([{ p: 'A bolt of light.' }])).toBeUndefined();
});

describe('in the fight', () => {
  const caster = cb({ id: 'pc:m', kind: 'pc', name: 'Mira', characterId: 'm', init: 15, tie: 0.6, concentrating: true, concentratingOn: 'Summon Test', concentrationCount: 3 });
  test('a spirit shares its caster\'s initiative, right after; a conjured group rolls its own', () => {
    const [s] = summonCombatants(caster, [scaleSummon(spirit, { level: 2, attack: 5 })], { spell: 'Summon Test', cast: 3, share: true, hpMode: 'average', rng: () => 0.5 });
    expect([s.init, s.tie < caster.tie, s.summon]).toEqual([15, true, { by: 'pc:m', spell: 'Summon Test', cast: 3 }]);
    const group = summonCombatants(caster, [spirit, spirit], { spell: 'Conjure Test', share: false, hpMode: 'average', rng: () => 0.5 });
    expect(group[0].init).toBe(group[1].init);
  });
  test('summons leave when their casting ends or they drop to 0 HP; other monsters stay', () => {
    const [s] = summonCombatants(caster, [scaleSummon(spirit, { level: 2, attack: 5 })], { spell: 'Summon Test', cast: 3, share: true, hpMode: 'average', rng: () => 0.5 });
    const orc = cb({ id: 'o', kind: 'monster', name: 'Orc', hp: 0 });
    const k: Combat = { campaignId: 'c1', round: 1, turn: 'pc:m', groupMonsters: false, updatedAt: 0, combatants: [caster, s, orc] };
    expect(endedSummons(k).gone).toEqual([]);
    expect(endedSummons({ ...k, combatants: [{ ...caster, concentrating: false }, s, orc] }).gone).toEqual([s.id]);
    expect(endedSummons({ ...k, combatants: [caster, { ...s, hp: 0 }, orc] }).gone).toEqual([s.id]);
  });
});

describe('with the database (one roster)', () => {
  beforeEach(async () => { await resetDb(); await db.campaigns.put(camp('c1')); });
  test('a summon gets a token beside its caster; dropping concentration takes both away', async () => {
    const sc = newScene('c1', 'Field');
    await db.scenes.put({ ...sc, tokens: [{ id: 't-m', name: 'Mira', x: 35, y: 35, size: 'M', color: '#000000', characterId: 'm' }] });
    await db.scenes.show('c1', sc.id);
    const caster = cb({ id: 'pc:m', kind: 'pc', name: 'Mira', characterId: 'm', init: 15, concentrating: true, concentratingOn: 'Summon Test', concentrationCount: 1 });
    await updateCombat('c1', () => ({ campaignId: 'c1', round: 1, turn: 'pc:m', groupMonsters: false, updatedAt: 0, combatants: [caster] }));
    const added = await summon('c1', 'pc:m', [scaleSummon(spirit, { level: 2, attack: 5 })], { spell: 'Summon Test', cast: 1, share: true, hpMode: 'average' });
    const s = (await db.scenes.get(sc.id))!, t = s.tokens.find((x) => x.combatantId === added[0].id)!;
    expect(Math.hypot(t.x - 35, t.y - 35)).toBeLessThanOrEqual(2 * s.grid.size); // beside the caster
    await updateCombat('c1', (c) => ({ ...c, combatants: c.combatants.map((x) => (x.id === 'pc:m' ? { ...x, concentrating: false } : x)) }));
    expect((await db.combat.get('c1'))!.combatants.map((x) => x.id)).toEqual(['pc:m']);
    expect((await db.scenes.get(sc.id))!.tokens.map((x) => x.name)).toEqual(['Mira']);
  });
});
