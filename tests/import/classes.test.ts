import { expect, test } from 'vitest';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { featureId } from '../../src/lib/content/ids.ts';
import { import5etools } from '../../src/lib/import/fivetools/index.ts';
import type { ClassDef, FeatureDef, Pack, SubclassDef } from '../../src/lib/types.ts';
import { asTst, readFixture, run } from '../fixtures/import.ts';
import { srdPackFixture } from '../fixtures/srdPack.ts';

test('Testclass converts', async () => {
  const r = await run({ 'class-testclass.json': readFixture('class-testclass.json') });
  const ents = r.packs.flatMap(p => p.entities);
  const c = ents.find(e => e.id === 'class:testclass@TST') as ClassDef;
  expect([c.hitDie, c.saves, c.subclassLevel, c.asiLevels, c.subclassTitle]).toEqual([10, ['str', 'con'], 3, [4, 8], 'Test Path']);
  expect(c.skillChoice).toEqual({ count: 2, from: ['athletics', 'perception', 'survival'] });
  expect(c.multiclassPrereq).toEqual({ any: { str: 13, dex: 13 } });
  expect(c.spellcasting).toMatchObject({ progression: 'half', ability: 'wis', preparation: 'prepared', preparedFormula: 'level/2+mod:wis' });
  expect(c.table[0]).toMatchObject({ label: 'Tricks' });
  expect(c.optionalFeatureProgression[0].counts.slice(0, 3)).toEqual([0, 1, 1]);
  const f = (n: string, l: number, src = 'TST') => ents.find(e => e.id === featureId('Testclass', undefined, n, l, src)) as FeatureDef;
  expect(f('Ability Score Improvement', 4).choices).toEqual([{ type: 'asi' }]);
  expect(f('Test Path', 3).choices).toEqual([{ type: 'subclass' }]);
  expect(f('Expertise', 6).choices).toEqual([{ type: 'expertise', count: 2 }]);
  expect(f('Variant Trick', 2, 'TCE')).toMatchObject({ optional: true, source: 'TCE' });
  expect(r.packs.find(p => p.source === 'TCE')!.entities.length).toBeGreaterThan(0);
  const sub = ents.find(e => e.kind === 'subclass' && e.name === 'Champion of Tests') as SubclassDef;
  expect([sub.classId, sub.shortName, sub.features.map(x => x.level)]).toEqual(['class:testclass@TST', 'Champ', [3, 7]]);
});

test('subclass optional-feature progression (R28)', async () => {
  const r = await run({ 'class-testclass.json': readFixture('class-testclass.json') });
  const sub = r.packs.flatMap(p => p.entities).find(e => e.kind === 'subclass' && e.name === 'Champion of Tests') as SubclassDef;
  expect(sub.optionalFeatureProgression).toEqual([{ name: 'Test Maneuvers', featureTypes: ['MV:T'], counts: [0, 0, 3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5] }]);
  expect((r.packs.flatMap(p => p.entities).find(e => e.name === 'Battle Master') as SubclassDef).optionalFeatureProgression).toBeUndefined();
});

test('PHB Fighter merges into SRD; PHB subclasses attach', async () => {
  const r = await run({ 'class-testclass.json': readFixture('class-testclass.json') }); // fixture index has class:fighter@SRD, feature:fighter:second-wind:1@SRD
  const phb = r.packs.find(p => p.source === 'PHB')!;
  expect(phb.patches).toContainEqual(expect.objectContaining({ targetId: 'class:fighter@SRD', alias: 'PHB', addFeatures: [{ level: 4, id: 'feature:fighter:martial-versatility:4@TCE' }] }));
  expect(phb.patches.some(p => p.targetId === 'feature:fighter:second-wind:1@SRD')).toBe(true);
  expect((phb.entities.find(e => e.name === 'Battle Master') as SubclassDef).classId).toBe('class:fighter@SRD');
});

test('class table cells, proficiencies, equipment text; the 2024 class and its subclass copy are dropped', async () => {
  const r = await run({ 'class-testclass.json': readFixture('class-testclass.json') });
  const c = r.packs.flatMap(p => p.entities).find(e => e.id === 'class:testclass@TST') as ClassDef;
  expect(c.table.map(t => t.values.slice(0, 2))).toEqual([[1, 1], ['1d6', '1d6'], ['+2', '+2'], ['+0 ft.', '+10 ft.']]);
  expect(c.table[0].values[19]).toBe('Unlimited');
  expect(c.proficiencies).toMatchObject({ armor: ['light', 'shield'], weapons: ['simple', 'longsword'], tools: ["tinker's tools"] });
  expect(c.multiclassProficiencies.armor).toEqual(['light']);
  expect(c.startingEquipment.gold).toBe('4d4 × 10');
  expect(c.features.map(x => x.id)).toContain('feature:testclass:variant-trick:2@TCE');
  expect(r.errors).toEqual([]);
  expect(r.skipped2024).toBe(2); // Fighter|XPHB and the Battle Master copy for it
  expect(r.packs.flatMap(p => p.entities).filter(e => e.name === 'Battle Master')).toHaveLength(1);
});

// N8 / N11: SRD names with parenthetical suffixes, refSubclassFeature expansion, SRD subclass overlap, `_copy` keyed by parent context.
test('SRD feature matching ignores parenthetical suffixes but never crosses levels; subclass overlap and refs', async () => {
  const srd: Pack = structuredClone(srdPackFixture);
  const feat = (name: string, level: number, sub?: string): FeatureDef => ({ kind: 'feature', id: featureId('Fighter', sub, name, level, 'SRD'), name, source: 'SRD', srd: true, text: [],
    level, classId: 'class:fighter@SRD', ...(sub && { subclassId: `subclass:${sub.toLowerCase()}@SRD` }) });
  srd.entities.push(feat('Action Surge (1 use)', 2), feat('Action Surge (2 uses)', 17), feat('Signature Spell', 20), feat('Improved Critical', 3, 'Champion'),
    { kind: 'subclass', id: 'subclass:champion@SRD', name: 'Champion', source: 'SRD', srd: true, text: [], classId: 'class:fighter@SRD', shortName: 'Champion',
      features: [{ level: 3, id: 'feature:fighter:champion:improved-critical:3@SRD' }] });
  const F = (name: string, level: number, x: object = {}) => ({ name, source: 'PHB', srd: true, className: 'Fighter', classSource: 'PHB', level, entries: [`${name} text.`], ...x });
  const S = (name: string, level: number, x: object = {}) => F(name, level, { subclassShortName: 'Champion', subclassSource: 'PHB', ...x });
  const json = {
    class: [{ name: 'Fighter', source: 'PHB', srd: true, hd: { faces: 10 }, proficiency: ['str', 'con'],
      classFeatures: ['Action Surge|Fighter||2', 'Action Surge (two uses)|Fighter||17', 'Action Surge|Fighter||9', 'Signature Spells|Fighter||20'] }],
    classFeature: [F('Action Surge', 2), F('Action Surge (two uses)', 17), F('Action Surge', 9), F('Signature Spells', 20)],
    subclass: [
      { name: 'Champion', shortName: 'Champion', source: 'PHB', srd: true, className: 'Fighter', classSource: 'PHB', subclassFeatures: ['Champion|Fighter||Champion||3'] },
      { name: 'Champion Copy', shortName: 'Copy', source: 'TST', className: 'Fighter', classSource: 'PHB',
        _copy: { name: 'Champion', source: 'PHB', shortName: 'Champion', className: 'Fighter', classSource: 'PHB' } },
    ],
    subclassFeature: [
      S('Champion', 3, { entries: ['Intro.', { type: 'refSubclassFeature', subclassFeature: 'Improved Critical|Fighter||Champion||3' },
        { type: 'options', count: 1, entries: [{ type: 'refSubclassFeature', subclassFeature: 'Option A|Fighter||Champion||3' }] }] }),
      S('Improved Critical', 3), S('Option A', 3, { srd: undefined }),
    ],
  };
  const r = await import5etools([{ name: 'x.json', json: asTst(json) }], { index: new ContentIndex([srd]), rawLookup: async () => undefined });
  expect(r.errors).toEqual([]);
  const phb = r.packs.find(p => p.source === 'PHB')!;
  const targets = phb.patches.map(p => p.targetId);
  expect(targets).toEqual(expect.arrayContaining(['feature:fighter:action-surge-1-use:2@SRD', 'feature:fighter:action-surge-2-uses:17@SRD',
    'feature:fighter:signature-spell:20@SRD', 'feature:fighter:champion:improved-critical:3@SRD']));
  // level 9 has no SRD counterpart: its own entity, added to the SRD class
  expect(phb.entities.map(e => e.id)).toContain('feature:fighter:action-surge:9@PHB');
  expect(phb.patches.find(p => p.targetId === 'class:fighter@SRD')!.addFeatures).toEqual([{ level: 9, id: 'feature:fighter:action-surge:9@PHB' }]);
  // the SRD Champion gains the book's intro feature; Improved Critical (reached through the ref) is the SRD's own
  expect(phb.patches.find(p => p.targetId === 'subclass:champion@SRD')!.addFeatures).toEqual([{ level: 3, id: 'feature:fighter:champion:champion:3@PHB' }]);
  // a counted options block is a choice on the feature, not granted features
  expect((phb.entities.find(e => e.id === 'feature:fighter:champion:champion:3@PHB') as FeatureDef).choices)
    .toEqual([{ type: 'option', count: 1, options: [{ name: 'Option A', text: [{ p: 'Option A text.' }] }] }]);
  // `_copy` resolved through className/classSource/shortName: the copy inherits the subclass features
  const copy = r.packs.find(p => p.source === 'TST')!.entities.find(e => e.name === 'Champion Copy') as SubclassDef;
  expect(copy).toMatchObject({ classId: 'class:fighter@SRD', shortName: 'Copy' });
  expect(copy.features.map(x => x.id)).toEqual(['feature:fighter:champion:champion:3@PHB', 'feature:fighter:champion:improved-critical:3@SRD']);
});
