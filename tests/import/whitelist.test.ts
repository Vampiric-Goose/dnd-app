// R52: the importer is a whitelist of official 2014 sources (plus a file's own declared homebrew); 2024 never gets in.
import { expect, test } from 'vitest';
import type { SpellDef } from '../../src/lib/types.ts';
import { run, runRaw } from '../fixtures/import.ts';

const feat = (name: string, source: string, x: object = {}) => ({ name, source, entries: [`${name} text.`], ...x });
const names = (r: Awaited<ReturnType<typeof runRaw>>) => r.packs.flatMap(p => p.entities).map(e => e.name).sort();

test('an official 2014 entity is accepted', async () => {
  const r = await runRaw({ 'feats.json': { feat: [feat('Alert', 'PHB')] } });
  expect(names(r)).toEqual(['Alert']);
  expect(r.packs[0]).toMatchObject({ source: 'PHB' });
  expect(r.packs[0].homebrew).toBeUndefined();
  expect([r.skipped2024, r.skippedUnknown, r.errors, r.warnings]).toEqual([0, 0, [], []]);
});

test('an XPHB entity is rejected, and counted by source', async () => {
  const r = await runRaw({ 'feats.json': { feat: [feat('Alert', 'XPHB'), feat('Lucky', 'FRHoF'), feat('Tough', 'PHB')] } });
  expect(names(r)).toEqual(['Tough']);
  expect(r.skipped2024).toBe(2);
  expect(r.skipped.rules2024).toEqual({ XPHB: 1, FRHOF: 1 });
  expect(r.skippedUnknown).toBe(0);
});

test('an edition "one" entity in a 2014 source is rejected', async () => {
  const r = await runRaw({ 'feats.json': { feat: [feat('Alert', 'PHB', { edition: 'one' }), feat('Tough', 'PHB')] } });
  expect(names(r)).toEqual(['Tough']);
  expect(r.skipped.rules2024).toEqual({ PHB: 1 });
});

test('an undeclared unknown source is rejected with a per-file warning', async () => {
  const r = await runRaw({ 'feats.json': { feat: [feat('Mine', 'NOPE'), feat('Yours', 'ALSONOPE'), feat('Mine2', 'NOPE'), feat('Tough', 'PHB')] } });
  expect(names(r)).toEqual(['Tough']);
  expect(r.skippedUnknown).toBe(3);
  expect(r.skipped.unknown).toEqual({ NOPE: 2, ALSONOPE: 1 });
  expect(r.warnings).toEqual(['feats.json: Skipped 3 entries from unrecognised sources: NOPE, ALSONOPE (not 2014 official books, and not declared as homebrew)']);
  expect(r.errors).toEqual([]);
});

test('a homebrew file that declares its source in _meta.sources is accepted as homebrew', async () => {
  const r = await runRaw({ 'brew.json': { _meta: { sources: [{ json: 'MyBrew', abbreviation: 'MB', full: 'My Brew' }] }, feat: [feat('Brewed', 'MyBrew')] } });
  expect(names(r)).toEqual(['Brewed']);
  expect(r.packs[0]).toMatchObject({ source: 'MYBREW', homebrew: true });
  expect(r.raw.map(([k]) => k)).toEqual(['feat|brewed|MYBREW']);
  expect(r.warnings).toEqual([]);
  // the declaration belongs to its own file only
  const other = await runRaw({ 'brew.json': { _meta: { sources: [{ json: 'MyBrew' }] }, feat: [] }, 'x.json': { feat: [feat('Stray', 'MyBrew')] } });
  expect(names(other)).toEqual([]);
  expect(other.skipped.unknown).toEqual({ MYBREW: 1 });
});

test('a homebrew file cannot smuggle in edition "one" or a 2024 source, and cannot relabel an official one', async () => {
  const r = await runRaw({ 'brew.json': { _meta: { sources: [{ json: 'MyBrew' }, { json: 'XPHB' }, { json: 'PHB' }] },
    feat: [feat('NewRules', 'MyBrew', { edition: 'one' }), feat('Claimed2024', 'XPHB'), feat('Claimed2014', 'PHB'), feat('Fine', 'MyBrew')] } });
  expect(names(r)).toEqual(['Claimed2014', 'Fine']);
  expect(r.skipped.rules2024).toEqual({ MYBREW: 1, XPHB: 1 });
  expect(r.packs.find(p => p.source === 'PHB')!.homebrew).toBeUndefined(); // official content is never labelled homebrew
  expect(r.packs.find(p => p.source === 'MYBREW')!.homebrew).toBe(true);
});

test('a class list from XPHB adds nothing; 2014 lists still count', async () => {
  const spell = (name: string, classes: object) => ({ name, source: 'PHB', level: 1, school: 'V', entries: [], classes });
  const r = await runRaw({
    'spells.json': { spell: [
      spell('Only2024', { fromClassList: [{ name: 'Wizard', source: 'XPHB' }] }),
      spell('Mixed', { fromClassList: [{ name: 'Wizard', source: 'PHB' }, { name: 'Druid', source: 'XPHB' }] }),
      spell('Looked', {}),
      spell('Unknown', { fromClassList: [{ name: 'Bard', source: 'NOPE' }] }),
    ] },
    'sources.json': { PHB: { Looked: { class: [{ name: 'Cleric', source: 'PHB' }, { name: 'Paladin', source: 'XPHB' }] }, Only2024: { class: [{ name: 'Sorcerer', source: 'XPHB' }] } } },
  });
  const by = (n: string) => (r.packs.flatMap(p => p.entities).find(e => e.name === n) as SpellDef).classes;
  expect(by('Only2024')).toEqual([]);
  expect(by('Mixed')).toEqual(['wizard']);
  expect(by('Looked')).toEqual(['cleric']);
  expect(by('Unknown')).toEqual([]);
});

test('a class list from a declared homebrew source counts', async () => {
  const r = await runRaw({ 'b.json': { _meta: { sources: [{ json: 'MyBrew' }] }, spell: [{ name: 'Brewbolt', source: 'MyBrew', level: 1, school: 'V', entries: [], classes: { fromClassList: [{ name: 'Mystic', source: 'MyBrew' }] } }] } });
  expect((r.packs[0].entities[0] as SpellDef).classes).toEqual(['mystic']);
});

test('a _copy from an XPHB entity is rejected, whether the source is in the batch or stored', async () => {
  const files = { 'feats.json': { feat: [feat('Alert', 'XPHB', { entries: ['2024 text.'] }), feat('Copycat', 'PHB', { entries: undefined, _copy: { name: 'Alert', source: 'XPHB' } })] } };
  const inBatch = await runRaw(files);
  expect(names(inBatch)).toEqual([]);
  expect(inBatch.skipped.rules2024).toEqual({ XPHB: 2 });
  expect(inBatch.errors).toEqual([]);
  // an XPHB raw entity kept by an older import must not resolve either
  const storedAlert = feat('Alert', 'XPHB', { entries: ['2024 text.'] });
  const stored = await runRaw({ 'f.json': { feat: [files['feats.json'].feat[1]] } }, async k => (k === 'feat|alert|XPHB' ? storedAlert : undefined));
  expect(names(stored)).toEqual([]);
  expect(stored.skipped.rules2024).toEqual({ XPHB: 1 });
  expect(stored.warnings.some(w => w.includes('copy of XPHB'))).toBe(true);
  expect(stored.raw).toEqual([]); // nothing from the 2024 book is kept for later copies
});

test('a _copy from a 2014 entity still works, and one from an unknown source is rejected', async () => {
  const r = await runRaw({ 'f.json': { feat: [feat('Alert', 'PHB'), feat('Alert Too', 'PHB', { _copy: { name: 'Alert', source: 'PHB' } }),
    feat('Mystery', 'NOPE'), feat('Mystery Too', 'PHB', { _copy: { name: 'Mystery', source: 'NOPE' } })] } });
  expect(names(r)).toEqual(['Alert', 'Alert Too']);
  expect(r.skipped.unknown).toEqual({ NOPE: 2 });
});

test('a subclass or feature of a rejected class is rejected with it (unknown class too)', async () => {
  const r = await runRaw({ 'c.json': {
    class: [{ name: 'Mystic', source: 'NOPE', hd: { faces: 8 }, classFeatures: [] }],
    subclass: [{ name: 'Order', shortName: 'Order', source: 'PHB', className: 'Mystic', classSource: 'NOPE', subclassFeatures: [] }],
    classFeature: [{ name: 'Trance', source: 'PHB', className: 'Mystic', classSource: 'NOPE', level: 1, entries: [] }],
  } });
  expect(r.packs).toEqual([]);
  expect(r.skipped.unknown).toEqual({ NOPE: 3 });
});

test('reprintedAs, otherSources and additionalSources are references: they never pull content in', async () => {
  const r = await runRaw({ 'f.json': { feat: [feat('Alert', 'PHB', { reprintedAs: ['Alert|XPHB'], otherSources: [{ source: 'XPHB', page: 1 }, { source: 'NOPE' }], additionalSources: [{ source: 'XPHB' }] })] } });
  expect(r.packs.map(p => p.source)).toEqual(['PHB']);
  expect(r.packs[0].entities).toHaveLength(1);
  expect([r.skipped2024, r.skippedUnknown, r.warnings]).toEqual([0, 0, []]);
  expect(JSON.stringify(r.packs)).not.toMatch(/XPHB|NOPE/);
});

test('the fixtures helper declares TST as homebrew, so TST content imports as a homebrew pack', async () => {
  const r = await run({ 'f.json': { feat: [feat('Testy', 'TST')] } });
  expect(r.packs[0]).toMatchObject({ source: 'TST', homebrew: true });
});
