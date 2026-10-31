import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { beforeEach, expect, test } from 'vitest';
import { importRecord } from '../src/lib/backup.ts';
import { effectOk } from '../src/lib/character/customEffect.ts';
import { resetDb } from '../src/lib/db.ts';
import { importedItem, soundItem } from '../src/lib/items/homebrew.ts';
import { makeEntry } from '../src/lib/items/inventory.ts';
import { campaignProblem, characterListProblem, characterProblem } from '../src/lib/recordShape.ts';
import { computeSheet } from '../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';
import type { Character, Effect, ItemDef, Pack } from '../src/lib/types.ts';
import { mkChar } from './fixtures/content.ts';
import { camp, char, importBackup, item } from './fixtures/records.ts';

beforeEach(resetDb);

const badProf = { type: 'proficiency', category: 'foo', value: 'x' } as unknown as Effect;
const rec = (data: unknown) => new Blob([JSON.stringify({ format: 'dnd-app-character', version: 1, data })]);
const backup = (o: object) => new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, ...o })]);

test('characterProblem checks what the sheet and the lists read', () => {
  expect(characterProblem(char('a'))).toBeUndefined();
  const c = char('a');
  const cases: [unknown, string][] = [
    [{ ...c, build: {} }, 'has no build.levels list'],
    [{ ...c, build: { ...c.build, choices: [] } }, 'has no build.choices'],
    [{ ...c, name: 3 }, 'has no name'],
    [{ ...c, embedded: null }, 'has no embedded'],
    [{ ...c, currency: undefined }, 'has no currency'],
    [{ ...c, customEffects: {} }, 'has no customEffects list'],
    [{ ...c, customEffects: [badProf] }, 'has a damaged custom effect (1)'],
    [{ ...c, inventory: [{ id: 'e', quantity: 1 }] }, 'has a damaged inventory entry (1)'],
    [{ ...c, inventory: [{ ...makeEntry(item('i', 'c')), quantity: '2' }] }, 'has a damaged inventory entry (1)'],
    [{ ...c, inventory: [makeEntry({ ...item('i', 'c'), effects: [badProf] })] }, 'has a damaged inventory entry (1)'],
  ];
  for (const [bad, why] of cases) expect(characterProblem(bad), why).toBe(why);
  // R60/4: the list hides only what it can't show; a bad custom effect or currency is still listed
  expect(characterListProblem({ ...c, customEffects: [badProf], currency: undefined })).toBeUndefined();
  for (const i of [0, 2, 3]) expect(characterListProblem(cases[i][0]), cases[i][1]).toBe(cases[i][1]);
  expect(characterListProblem(cases[1][0])).toBeUndefined();
  expect(campaignProblem(camp('c1'))).toBeUndefined();
  expect(campaignProblem({ ...camp('c1'), loot: [{ id: 'e', quantity: 1 }] })).toBe('has a damaged loot entry (1)');
});

test('a character file with build: {} is rejected', async () => {
  await expect(importRecord(rec({ ...char('a'), build: {} }))).rejects.toThrow('Record file is damaged: character has no build.levels list');
});

test('a backup whose campaign loot holds an entry with no item is rejected', async () => {
  await expect(importBackup(backup({ campaigns: [{ ...camp('c1'), loot: [{ id: 'e', quantity: 1 }] }] }))).rejects.toThrow('Backup file is damaged: campaigns[0] has a damaged loot entry (1)');
  await expect(importBackup(backup({ characters: [{ ...char('a'), build: {} }] }))).rejects.toThrow('Backup file is damaged: characters[0] has no build.levels list');
});

test('effects are validated by type', () => {
  for (const good of [
    { type: 'bonus', target: 'ac', value: 1 }, { type: 'bonus', target: 'save.all', value: 'prof', when: 'armored' },
    { type: 'acBase', base: 13, abilities: ['dex'], shieldAllowed: true }, { type: 'halfProficiency' }, { type: 'halfProficiency', abilities: ['str'], roundUp: true },
    { type: 'proficiency', category: 'weapon', value: 'longsword' }, { type: 'resource', name: 'Ki', max: 'level', recharge: 'short' }, { type: 'note', text: 'x' },
  ]) expect(effectOk(good), JSON.stringify(good)).toBe(true);
  for (const bad of [
    badProf, { type: 'nope' }, { type: 'bonus', target: 'luck', value: 1 }, { type: 'bonus', target: 'ac' }, { type: 'acBase', base: 13, shieldAllowed: true },
    { type: 'setScore', ability: 'str', value: '19' }, { type: 'damage', kind: 'resistance' }, { type: 'flag', flag: 'fly' }, { type: 'bonus', target: 'ac', value: 1, when: 'always' }, null, 'x',
  ]) expect(effectOk(bad), JSON.stringify(bad)).toBe(false);
});

test('every effect in the shipped SRD passes the effect check', () => {
  const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
  const found: unknown[] = [];
  const walk = (v: unknown, key?: string) => {
    if (Array.isArray(v)) { if (key === 'effects') found.push(...v); else v.forEach((x) => walk(x)); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(srd.entities);
  expect(found.length).toBeGreaterThan(50);
  expect(found.filter((e) => !effectOk(e))).toEqual([]);
});

test('an item with a proficiency effect of category foo is rejected; the sheet does not throw on one already stored', () => {
  const bad: ItemDef = { ...item('i', 'c'), effects: [badProf] };
  expect(soundItem(bad)).toBe(false);
  expect(soundItem({ ...bad, effects: [{ type: 'proficiency', category: 'tool', value: 'x' }] })).toBe(true);
  expect(importedItem(bad, 'c').ignored).toContain('effects'); // a malformed optional block is dropped and named, like the others
  expect(importedItem(bad, 'c').item.effects).toBeUndefined();
  const c: Character = { ...mkChar({ race: 'human', base: {}, levels: ['fighter'] }), customEffects: [badProf, { type: 'acBase', base: 13 } as unknown as Effect] };
  expect(() => computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'dm' })).not.toThrow();
});
