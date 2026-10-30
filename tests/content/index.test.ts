import { expect, test } from 'vitest';
import { baseKey, entityId, featureId, slug } from '../../src/lib/content/ids.ts';
import { ContentIndex } from '../../src/lib/content/index.ts';
import type { ClassDef, Entity, OptionalFeatureDef, Pack, SpellDef, SubclassDef } from '../../src/lib/types.ts';

const noProf = { armor: [], weapons: [], tools: [], skills: [], languages: [] };
const pack = (source: string, entities: Entity[] = []): Pack =>
  ({ id: source, name: source, source, importedAt: 0, hash: '', entities, patches: [] });
const fighter = (source: string): ClassDef => ({
  kind: 'class', id: entityId('class', 'Fighter', source), name: 'Fighter', source, text: [],
  hitDie: 10, saves: ['str', 'con'], proficiencies: noProf, skillChoice: { count: 2, from: 'any' },
  multiclassProficiencies: noProf, startingEquipment: { text: [], choices: [] }, subclassLevel: 3,
  subclassTitle: 'Martial Archetype', asiLevels: [4], features: [{ level: 1, id: 'feature:fighter:second-wind:1@SRD' }],
  table: [], optionalFeatureProgression: [],
});
const spell = (name: string, source: string): SpellDef => ({
  kind: 'spell', id: entityId('spell', name, source), name, source, text: [], level: 1, school: 'evocation',
  castingTime: '1 action', range: 'Self', components: { v: true }, duration: 'Instantaneous',
  concentration: false, ritual: false, classes: ['wizard'],
});
const subclass = (name: string, classId: string, source: string): SubclassDef => ({
  kind: 'subclass', id: entityId('subclass', name, source), name, source, text: [], classId, shortName: name, features: [],
});
const optFeature = (name: string, featureTypes: string[]): OptionalFeatureDef => ({
  kind: 'optionalFeature', id: entityId('optionalFeature', name, 'SRD'), name, source: 'SRD', text: [], featureTypes,
});
const srdPack = pack('SRD', [fighter('SRD')]);

test('ids', () => {
  expect(slug("Tasha's Hideous Laughter")).toBe('tashas-hideous-laughter');
  expect(slug('Zoë')).toBe('zoe');
  expect(entityId('spell', 'Fireball', 'phb')).toBe('spell:fireball@PHB');
  expect(featureId('Fighter', undefined, 'Fighting Style', 1, 'SRD')).toBe('feature:fighter:fighting-style:1@SRD');
  expect(featureId('Fighter', 'Champion', 'Improved Critical', 3, 'SRD')).toBe('feature:fighter:champion:improved-critical:3@SRD');
  expect(baseKey('spell:fireball@PHB')).toBe('spell:fireball');
});

test('patches alias and extend SRD entities', () => {
  const idx = new ContentIndex([srdPack,
    { ...pack('TCE'), patches: [{ targetId: 'class:fighter@SRD', alias: 'PHB', addFeatures: [{ level: 4, id: 'feature:fighter:martial-versatility:4@TCE' }] }] }]);
  expect(idx.find('class', 'Fighter', 'PHB')?.id).toBe('class:fighter@SRD');
  expect(idx.resolve('class:fighter@PHB')?.id).toBe('class:fighter@SRD');
  expect((idx.get('class:fighter@SRD') as ClassDef).features.map(f => f.id)).toContain('feature:fighter:martial-versatility:4@TCE');
  expect(srdPack.entities[0]).not.toHaveProperty('aliases'); // patched copy, pack untouched
});

test('same-name entities from different sources coexist; search ranks prefix first', () => {
  const idx = new ContentIndex([
    pack('SRD', [spell('Shield', 'SRD'), spell('Fireball', 'SRD'), spell('Fire Bolt', 'SRD'), spell('Delayed Blast Fireball', 'SRD')]),
    pack('TST', [spell('Shield', 'TST')]),
  ]);
  expect(idx.find('spell', 'Shield', 'TST')?.id).toBe('spell:shield@TST');
  expect(idx.find('spell', 'Shield')?.id).toBe('spell:shield@SRD'); // SRD preferred without source
  const names = idx.search('fire', ['spell']).map(e => e.name);
  expect(names.indexOf('Delayed Blast Fireball')).toBeGreaterThan(names.indexOf('Fireball'));
});

test('patch text replacement, subclassesOf follows aliases, optionalFeatures by type', () => {
  const idx = new ContentIndex([
    pack('SRD', [fighter('SRD'), subclass('Champion', 'class:fighter@SRD', 'SRD'), optFeature('Dueling', ['FS:F']), optFeature('Agonizing Blast', ['EI'])]),
    { ...pack('PHB', [subclass('Battle Master', 'class:fighter@PHB', 'PHB')]), patches: [{ targetId: 'class:fighter@SRD', alias: 'PHB', text: [{ p: 'Full text' }] }] },
  ]);
  expect(idx.get('class:fighter@SRD')?.text).toEqual([{ p: 'Full text' }]);
  expect(idx.subclassesOf('class:fighter@SRD').map(s => s.name)).toEqual(['Champion', 'Battle Master']);
  expect(idx.optionalFeatures(['FS:F']).map(e => e.name)).toEqual(['Dueling']);
});
