import { expect, test } from 'vitest';
import { blankMonster } from '../../src/lib/monsters/homebrew.ts';
import { filterMonsters, legendaryIntro, monsterType, rollParts, spellLine } from '../../src/lib/monsters/library.ts';
import type { MonsterDef, Size } from '../../src/lib/types.ts';

const m = (name: string, o: Partial<MonsterDef> = {}): MonsterDef => ({ ...blankMonster('c1'), id: `monster:${name}@X`, name, ...o });

const all = [
  m('Goblin', { cr: '1/4', type: 'humanoid (goblinoid)', size: ['S'], source: 'SRD' }),
  m('Bugbear', { cr: '1', type: 'humanoid (goblinoid)', size: ['M'], source: 'SRD' }),
  m('Ogre', { cr: '2', type: 'giant', size: ['L'], source: 'SRD' }),
  m('Éclair Wraith', { cr: '1/2', type: 'undead', size: ['M'], source: 'MM' }),
  m('Odd', { cr: '—', type: 'beast', size: ['S', 'M'], source: 'MM' }),
];
const names = (f: Parameters<typeof filterMonsters>[1]) => filterMonsters(all, f).map((x) => x.name);

test('search folds case and accents; results are sorted by name', () => {
  expect(names({ q: 'ECLAIR' })).toEqual(['Éclair Wraith']);
  expect(names({ q: 'gob' })).toEqual(['Goblin']);
  expect(names({ q: '' })).toEqual(['Bugbear', 'Éclair Wraith', 'Goblin', 'Odd', 'Ogre']);
});

test('CR range [0.25, 1] keeps 1/4, 1/2 and 1 but not 2 or an unrated monster', () => {
  expect(names({ q: '', cr: [0.25, 1] })).toEqual(['Bugbear', 'Éclair Wraith', 'Goblin']);
});

test('type, size and source filters', () => {
  expect(names({ q: '', type: 'humanoid' })).toEqual(['Bugbear', 'Goblin']);
  expect(names({ q: '', size: 'M' as Size })).toEqual(['Bugbear', 'Éclair Wraith', 'Odd']);
  expect(names({ q: '', source: 'MM' })).toEqual(['Éclair Wraith', 'Odd']);
});

test('monsterType is the first word of the type', () => {
  expect(monsterType({ type: 'swarm of Tiny beasts' })).toBe('swarm');
  expect(monsterType({ type: 'Humanoid (goblinoid)' })).toBe('humanoid');
});

test('Review Focus 3: filtering 5,000 monsters by q + CR takes under 50 ms', () => {
  const crs = ['0', '1/8', '1/4', '1/2', '1', '5', '10', '20'];
  const big = Array.from({ length: 5000 }, (_, i) => m(`Monster ${i} ${'abcdefghij'[i % 10]}`, { cr: crs[i % crs.length] }));
  filterMonsters(big, { q: 'x' }); // warm the folded-name cache, as the page does on first render
  const t = performance.now();
  const out = filterMonsters(big, { q: 'monster 1', cr: [0.25, 5] });
  expect(performance.now() - t).toBeLessThan(50);
  expect(out.length).toBeGreaterThan(0);
});

test('rollParts makes attack bonuses and dice rollable', () => {
  const parts = rollParts('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage plus 7 (2d6) fire, or 3 (1d4 − 1).');
  expect(parts.filter((p) => 'expr' in p)).toEqual([
    { t: '+4', expr: '1d20+4', hit: true },
    { t: '1d6 + 2', expr: '1d6+2', hit: false },
    { t: '2d6', expr: '2d6', hit: false },
    { t: '1d4 − 1', expr: '1d4-1', hit: false },
  ]);
  expect(parts.map((p) => p.t).join('')).toBe('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage plus 7 (2d6) fire, or 3 (1d4 − 1).');
  expect(rollParts('no dice here')).toEqual([{ t: 'no dice here' }]);
});

test('spellLine splits the book spell groups and leaves prose alone', () => {
  expect(spellLine('At will: detect magic, fog cloud')).toEqual({ label: 'At will', spells: 'detect magic, fog cloud' });
  expect(spellLine('3/day each: fly, misty step')).toEqual({ label: '3/day each', spells: 'fly, misty step' });
  expect(spellLine('1st level (4 slots): shield')).toEqual({ label: '1st level (4 slots)', spells: 'shield' });
  expect(spellLine('Cantrips (at will): light')).toEqual({ label: 'Cantrips (at will)', spells: 'light' });
  expect(spellLine('The mage is a 9th-level spellcaster. Its ability: Int')).toBeUndefined();
});

test('the default legendary intro names the monster and the count', () => {
  expect(legendaryIntro({ name: 'Adult Red Dragon', legendaryCount: 3 })).toMatch(/^The adult red dragon can take 3 legendary actions, .* The adult red dragon regains spent legendary actions at the start of its turn\.$/);
});
