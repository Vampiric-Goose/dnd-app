import { expect, test } from 'vitest';
import { applyDamage, applyHealing, longRest, rollDeathSave, shortRest } from '../../src/lib/character/rest.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { makeEntry, useCharge } from '../../src/lib/items/inventory.ts';
import { mkChar } from '../fixtures/content.ts';

const dm = { settings: DEFAULT_SETTINGS, viewer: 'dm' as const };
test('long rest', () => {
  const f5 = mkChar({ race: 'human', base: {}, levels: Array(5).fill('fighter') });
  f5.state = { ...f5.state, hp: 3, hitDiceUsed: { 10: 4 }, exhaustion: 2 };
  const r = longRest(f5, computeSheet(f5, dm));
  expect([r.state.hp, r.state.hitDiceUsed[10], r.state.exhaustion]).toEqual([computeSheet(f5, dm).maxHp, 2, 1]);
  const f1 = mkChar({ race: 'human', base: {}, levels: ['fighter'] }); f1.state.hitDiceUsed = { 10: 1 };
  expect(longRest(f1, computeSheet(f1, dm)).state.hitDiceUsed[10]).toBe(0);
});
test('no long rest for the dead or at 0 HP (R26)', () => {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] }), s = computeSheet(c, dm);
  const dead = { ...c, state: { ...c.state, hp: 0, dead: true, exhaustion: 1 } };
  const stable = { ...c, state: { ...c.state, hp: 0, stable: true, exhaustion: 1 } };
  expect(longRest(dead, s)).toBe(dead);
  expect(longRest(stable, s)).toBe(stable);
  expect(longRest({ ...c, state: { ...c.state, hp: 1, stable: true } }, s).state).toMatchObject({ hp: 10, stable: false });
});
test('short rest', () => {
  const w = mkChar({ race: 'human', base: { con: 13 }, levels: ['warlock', 'warlock', 'warlock'] });
  w.state = { ...w.state, hp: 1, pactSlotsUsed: 2 };
  const r = shortRest(w, [{ die: 8, rolls: [3, 5] }], computeSheet(w, dm));
  expect([r.state.hp, r.state.pactSlotsUsed, r.state.hitDiceUsed[8]]).toEqual([1 + 5 + 7, 0, 2]);
});
test('damage, death saves', () => {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] }), s = computeSheet(c, dm); // maxHp 10
  c.state = { ...c.state, hp: 10, tempHp: 5 };
  expect(applyDamage(c, 8, s).state).toMatchObject({ tempHp: 0, hp: 7 });
  const down = applyDamage({ ...c, state: { ...c.state, tempHp: 0, hp: 3 } }, 3, s);
  expect(down.state.deathSaves.fail).toBe(0);
  expect(applyDamage(down, 1, s, true).state.deathSaves.fail).toBe(2);
  expect(applyDamage({ ...c, state: { ...c.state, tempHp: 0, hp: 5 } }, 15, s).state.dead).toBe(true);
  expect(rollDeathSave(down, 20).state).toMatchObject({ hp: 1, deathSaves: { success: 0, fail: 0 } });
  expect(rollDeathSave(rollDeathSave(down, 1), 5).state.dead).toBe(true);
  const failing = rollDeathSave(down, 5);
  expect(applyHealing(failing, 50, s).state).toMatchObject({ hp: 10, deathSaves: { success: 0, fail: 0 } });
  expect(rollDeathSave(rollDeathSave(rollDeathSave(down, 10), 12), 19).state).toMatchObject({ stable: true, deathSaves: { success: 0, fail: 0 } });
});

test('rest recharge: short clears short items; long clears short and long; dawn, dusk and none stay (fix round 1)', () => {
  const wand = (name: string, recharge: 'short' | 'long' | 'dawn' | 'dusk' | 'none') => useCharge(makeEntry({ kind: 'item', id: 'item:' + name + '@t', name, source: 't', text: [], type: 'wand', magic: true, charges: { max: 3, recharge } }), 3);
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] });
  c.inventory = (['short', 'long', 'dawn', 'dusk', 'none'] as const).map(r => wand(r, r));
  const used = (x: typeof c) => x.inventory.map(e => e.chargesUsed);
  expect(used(shortRest(c, [], computeSheet(c, dm)))).toEqual([0, 3, 3, 3, 3]);
  expect(used(longRest(c, computeSheet(c, dm)))).toEqual([0, 0, 3, 3, 3]);
});
test('rest recharge rolls rechargeAmount with the given rng (fix round 1)', () => {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] });
  c.inventory = [useCharge(makeEntry({ kind: 'item', id: 'item:rod@t', name: 'Rod', source: 't', text: [], type: 'rod', magic: true, charges: { max: 6, recharge: 'long', rechargeAmount: '1d6+1' } }), 6)];
  expect(longRest(c, computeSheet(c, dm), () => 0.4).inventory[0].chargesUsed).toBe(2); // d6=3, +1: 4 of 6 restored
});
