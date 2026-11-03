import { expect, test } from 'vitest';
import { natD20, roll, rollLog, rollViewer, rollVisibility, shownRolls } from '../src/lib/rolls.svelte.ts';

test('R6: a stat-block roll is private whatever the toggle says, and Player view hides it', () => {
  rollViewer.value = 'player';
  rollVisibility.player = true;
  const table = roll('Table roll', '1d6');
  const monster = roll('Goblin: Scimitar attack', '1d20+4', { public: false }); // what StatBlock passes
  expect(table.public).toBe(true);
  expect(monster.public).toBe(false);
  const ids = (v: 'dm' | 'player') => shownRolls(rollLog, v).map((r) => r.id);
  expect(ids('player')).toContain(table.id);
  expect(ids('player')).not.toContain(monster.id);
  expect(ids('dm')).toContain(monster.id);
});

test('natD20 reads the kept d20', () => {
  expect(natD20('1d20 (20) + 5')).toBe('nat20');
  expect(natD20('1d20 (1)')).toBe('nat1');
  expect(natD20('1d20 (13) + 5')).toBeUndefined();
  expect(natD20('2d20kh1 (1, 20) + 5')).toBe('nat20'); // advantage keeps the 20
  expect(natD20('2d20kh1 (1, 7) + 5')).toBeUndefined(); // advantage kept the 7, so the 1 is not a nat 1
  expect(natD20('2d20kl1 (1, 20)')).toBe('nat1'); // disadvantage keeps the 1
  expect(natD20('2d6 (6, 6) + 3')).toBeUndefined(); // no d20
  expect(natD20('1d100 (20)')).toBeUndefined(); // 'd100' is not a d20
});

test('house rule: a crit roll doubles its total while the campaign has it on (the default); off, its dice', async () => {
  const { critRule } = await import('../src/lib/rolls.svelte.ts');
  expect(critRule.all).toBe(true);
  expect(roll('Damage', '1d4+2', { crit: true }).detail).toMatch(/^\(1d4 \(\d\) \+ 2\) ×2$/);
  critRule.all = false;
  expect(roll('Damage', '1d4+2', { crit: true }).detail).toMatch(/^2d4 \(\d, \d\) \+ 2$/);
  critRule.all = true;
});
