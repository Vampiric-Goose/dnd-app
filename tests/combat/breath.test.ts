// Breath weapons: a stat block's (and its Recharge), a dragonborn's.
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { aimPlan } from '../../src/lib/combat/aiming.ts';
import { dragonbornBreath, readBreath, recharge, rechargeOf } from '../../src/lib/combat/breath.ts';
import { counterable, monsterActions, pcActions } from '../../src/lib/combat/turnActions.ts';
import { featureList } from '../../src/lib/character/play.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import type { Combatant, MonsterDef, Pack } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const mon = (name: string) => srd.entities.find((e) => e.kind === 'monster' && e.name === name) as MonsterDef;
const act = (m: MonsterDef, start: string) => m.actions.find((a) => a.name.startsWith(start))!;

describe('readBreath', () => {
  test('a dragon’s cone: its area from itself, the save and DC, the dice, half on a success', () => {
    const a = act(mon('Adult Red Dragon'), 'Fire Breath');
    expect(readBreath(a.name, a.text)).toEqual([{ name: a.name, dc: 21,
      read: expect.objectContaining({ save: 'Dex', onSave: 'half', damage: [{ dice: '18d6', type: 'fire' }], range: 'self', area: { shape: 'cone', feet: 60, self: true } }) }]);
  });
  test('a line 5 feet wide', () => {
    const a = act(mon('Young Black Dragon'), 'Acid Breath');
    expect(readBreath(a.name, a.text)[0].read.area).toEqual({ shape: 'line', feet: 30, width: 5, self: true });
  });
  test('several breath weapons: one use each, by its own name; a condition-only one deals nothing', () => {
    const a = act(mon('Young Brass Dragon'), 'Breath Weapons');
    const b = readBreath(a.name, a.text);
    expect(b.map((x) => [x.name, x.read.save, x.read.damage, x.read.onSave])).toEqual([['Fire Breath', 'Dex', [{ dice: '12d6', type: 'fire' }], 'half'], ['Sleep Breath', 'Con', [], 'none']]);
    expect(b[1].read.conditions).toEqual(['Unconscious']);
  });
  test('not a breath: nothing', () => {
    const a = act(mon('Adult Red Dragon'), 'Bite');
    expect(readBreath(a.name, a.text)).toEqual([]);
  });
  test('rechargeOf reads the name', () => {
    expect([rechargeOf('Fire Breath (Recharge 5–6)'), rechargeOf('Steam Breath (Recharge 6)'), rechargeOf('Bite')]).toEqual([5, 6, undefined]);
  });
});

describe('monster breath actions', () => {
  test('an action of its own, spent until it recharges, aimed as a cone from the dragon', () => {
    const m = mon('Adult Red Dragon'), key = 'recharge:5:Fire Breath (Recharge 5–6)';
    const fresh = monsterActions(m).find((a) => a.name.startsWith('Fire Breath'))!;
    expect(fresh).toMatchObject({ cost: 'action', group: 'monster', breath: true, spend: key, uses: { left: 1, max: 1 }, cast: { dc: 21 } });
    expect(monsterActions(m, { used: { [key]: 1 } }).find((a) => a.name.startsWith('Fire Breath'))!.uses).toEqual({ left: 0, max: 1 });
    expect(aimPlan(fresh)).toMatchObject({ reach: 'self', area: { shape: 'cone', feet: 60, on: 'self' }, dice: [{ expr: '18d6', type: 'fire' }] });
  });
  test('two breath weapons share one recharge', () => {
    const list = monsterActions(mon('Young Brass Dragon')).filter((a) => a.breath);
    expect(list.map((a) => [a.name, a.spend])).toEqual([['Fire Breath', 'recharge:5:Breath Weapons (Recharge 5–6)'], ['Sleep Breath', 'recharge:5:Breath Weapons (Recharge 5–6)']]);
  });
  test('a breath is never open to Counterspell; a spell is', () => {
    const breath = monsterActions(mon('Adult Red Dragon')).find((a) => a.breath)!;
    expect([counterable(breath), counterable({ ...breath, breath: undefined })]).toEqual([false, true]);
  });
});

describe('recharge', () => {
  const x = (used: Record<string, number>): Combatant => ({ id: 'd', kind: 'monster', name: 'd', initMod: 0, dex: 10, tie: 0.5, conSave: 0, spellsUsed: used });
  test('a spent breath comes back on a d6 of its number or more; other uses stay spent', () => {
    const used = { 'recharge:5:Fire Breath (Recharge 5–6)': 1, 'slot:1': 1 };
    expect(recharge(x(used), () => 5).spellsUsed).toEqual({ 'slot:1': 1 });
    expect(recharge(x(used), () => 4).spellsUsed).toEqual(used);
  });
  test('nothing spent: no roll', () => {
    let rolled = 0;
    recharge(x({ 'slot:1': 1 }), () => { rolled++; return 6; });
    expect(rolled).toBe(0);
  });
});

describe('dragonborn Breath Weapon', () => {
  test('ancestry sets the shape, type and save; level the dice', () => {
    expect(dragonbornBreath(['Breath Weapon', 'Draconic Ancestry (Red)'], { level: 1, dc: 12 })).toMatchObject({ breath: true, spell: { level: 0 },
      cast: { dc: 12, read: { save: 'Dex', onSave: 'half', damage: [{ dice: '2d6', type: 'fire' }], area: { shape: 'cone', feet: 15, self: true } } } });
    expect(dragonbornBreath(['Breath Weapon', 'Draconic Ancestry (Black)'], { level: 6, dc: 13 })?.cast?.read).toMatchObject({ damage: [{ dice: '3d6', type: 'acid' }], area: { shape: 'line', feet: 30, width: 5 } });
    expect(dragonbornBreath(['Breath Weapon', 'Draconic Ancestry (Silver)'], { level: 16, dc: 15 })?.cast?.read).toMatchObject({ save: 'Con', damage: [{ dice: '5d6', type: 'cold' }] });
    expect(dragonbornBreath(['Breath Weapon'], { level: 1, dc: 12 })).toBeUndefined(); // no ancestry picked
  });
  test('a character with the trait gets a once-per-short-rest use that breathes', () => {
    const c = mkChar({ race: 'human', base: { con: 14 }, levels: ['fighter'] }), race = c.embedded[c.build.raceId] as { traits: { name: string; text: unknown }[] };
    const ch = { ...c, embedded: { ...c.embedded, [c.build.raceId]: { ...race, traits: [...race.traits, { name: 'Breath Weapon', text: [{ p: 'x' }] }, { name: 'Draconic Ancestry (Gold)', text: [{ p: 'x' }] }] } } } as typeof c;
    const sheet = computeSheet(ch, { settings: DEFAULT_SETTINGS, viewer: 'dm' });
    expect(sheet.resources).toContainEqual({ name: 'Breath Weapon', max: 1, recharge: 'short' });
    const a = pcActions(ch, sheet, featureList(ch, DEFAULT_SETTINGS)).find((x) => x.id === 'res:Breath Weapon');
    expect(a).toMatchObject({ cost: 'action', breath: true, resource: 'Breath Weapon', uses: { left: 1, max: 1 }, cast: { dc: 8 + 2 + 2, read: { damage: [{ dice: '2d6', type: 'fire' }] } } });
  });
});
