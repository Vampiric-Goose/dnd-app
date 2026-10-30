import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import srdUrl from '../../src/data/srd.json?url';
import { loadSrd } from '../../src/lib/content/srd.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import type { ClassDef, OptionalFeatureDef, Pack, RaceDef, SpellDef, SubraceDef } from '../../src/lib/types.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const by = (id: string) => srd.entities.find(e => e.id === id)!;
const count = (k: string) => srd.entities.filter(e => e.kind === k).length;
test('counts', () => {
  expect([count('class'), count('subclass'), count('race'), count('subrace'), count('background'), count('feat'), count('spell'), count('condition')])
    .toEqual([12, 12, 9, 4, 1, 1, 319, 15]);
});
test('classes', () => {
  const f = by('class:fighter@SRD') as ClassDef;
  expect([f.hitDie, f.saves, f.subclassLevel, f.asiLevels]).toEqual([10, ['str', 'con'], 3, [4, 6, 8, 12, 14, 16, 19]]);
  expect(f.multiclassPrereq).toEqual({ any: { str: 13, dex: 13 } });
  expect(f.table.find(t => t.label === 'Action Surges')!.values[16]).toBe(2);
  expect((by('class:paladin@SRD') as ClassDef).multiclassPrereq).toEqual({ all: { str: 13, cha: 13 } });
  const w = (by('class:wizard@SRD') as ClassDef).spellcasting!;
  expect([w.ability, w.progression, w.preparation, w.spellbook, w.cantrips![4], w.preparedFormula]).toEqual(['int', 'full', 'prepared', true, 4, 'level+mod:int']);
  const wl = by('class:warlock@SRD') as ClassDef;
  expect(wl.spellcasting!.progression).toBe('pact');
  expect(wl.optionalFeatureProgression.find(p => p.featureTypes[0] === 'EI')!.counts[1]).toBe(2);
  expect((by('optionalFeature:defense@SRD') as OptionalFeatureDef).featureTypes.sort()).toEqual(['FS:F', 'FS:P', 'FS:R']);
});
test('races', () => {
  expect((by('subrace:hill-dwarf@SRD') as SubraceDef)).toMatchObject({ raceId: 'race:dwarf@SRD', abilityBonuses: { wis: 1 } });
  expect((by('race:half-elf@SRD') as RaceDef).choices).toContainEqual(expect.objectContaining({ type: 'ability', count: 2, amount: 1 }));
});
test('items', () => {
  expect(by('item:longsword@SRD')).toMatchObject({ type: 'weapon', costCp: 1500, weight: 3, weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', versatile: '1d10' } });
  expect(by('item:half-plate-armor@SRD')).toMatchObject({ type: 'armor', armor: { category: 'medium', ac: 15, dexCap: 2, stealthDisadvantage: true } });
  expect(by('item:ring-of-protection@SRD')).toMatchObject({ type: 'ring', rarity: 'rare', attunement: true, magic: true });
  expect(by('item:weapon-2@SRD')).toMatchObject({ bonuses: { attack: 2, damage: 2 }, rarity: 'rare' });
  expect(by('spell:fireball@SRD')).toMatchObject({ level: 3, school: 'evocation', concentration: false });
  expect((by('spell:fireball@SRD') as SpellDef).classes).toEqual(expect.arrayContaining(['sorcerer', 'wizard']));
});

afterEach(async () => { vi.unstubAllGlobals(); await resetDb(); });
test('loadSrd fetches once, then serves the cached pack while the url matches', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(srd)));
  vi.stubGlobal('fetch', fetchMock);
  expect((await loadSrd()).hash).toBe(srdUrl);
  expect((await loadSrd()).entities.length).toBe(srd.entities.length);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await db.packs.put({ ...(await db.packs.get('srd'))!, hash: 'stale' });
  await loadSrd();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
