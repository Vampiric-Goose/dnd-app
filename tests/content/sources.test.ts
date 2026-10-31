import { expect, test } from 'vitest';
import { OFFICIAL_2014, RULES_2024, classifySource, entityAllowed, is2024Source, packAllowed, patchAllowed, sourceInfo, sourceLabel } from '../../src/lib/content/sources.ts';

test('lookups are case-insensitive and keep the 5etools display form', () => {
  expect(sourceInfo('phb')).toEqual({ name: "Player's Handbook (2014)", kind: 'core', official: true });
  expect(sourceInfo('XGE')?.kind).toBe('supplement');
  expect(sourceInfo('tftyp-tsc')?.name).toMatch(/Sunless Citadel/);
  expect(OFFICIAL_2014['TFTYP-TSC'].id).toBe('TftYP-TSC');
  expect(OFFICIAL_2014['AITFR-ISF'].id).toBe('AitFR-ISF');
  expect(sourceInfo('PSZ')?.kind).toBe('setting');
  expect(sourceInfo('SAC')).toBeDefined(); // Sage Advice (2014) stays in
  expect(sourceInfo('toString')).toBeUndefined(); // untrusted ids never hit Object.prototype
  expect(sourceInfo('__proto__')).toBeUndefined();
});

test('a source used by a book and an adventure is one entry that keeps the book kind', () => {
  expect(sourceInfo('MOT')?.kind).toBe('setting');
});

test('kinds follow the 5etools group; screens and recipe books are other', () => {
  expect(sourceInfo('MM')?.kind).toBe('core');
  expect(sourceInfo('VGM')?.kind).toBe('supplement');
  expect(sourceInfo('LMoP')?.kind).toBe('adventure');
  expect(sourceInfo('Screen')?.kind).toBe('other');
  expect(sourceInfo('HF')?.kind).toBe('other');
  expect(sourceInfo('TD')?.kind).toBe('other');
});

test('nothing published on or after 2024-09-17 and no Unearthed Arcana is official', () => {
  for (const [k, e] of Object.entries(OFFICIAL_2014)) {
    expect(e.published < '2024-09-17', k).toBe(true);
    expect(k.startsWith('UA'), k).toBe(false);
    expect(RULES_2024.has(k), k).toBe(false);
  }
  for (const id of ['XPHB', 'XDMG', 'XMM', 'FRHoF', 'XSAC', 'AU', 'DrDe-DaS']) expect(sourceInfo(id), id).toBeUndefined();
});

test('is2024Source names the 2024 era, in any case', () => {
  for (const id of ['XPHB', 'xphb', 'FRHoF', 'XSAC', 'XScreen', 'UtHftLH', 'DrDe-DaS', 'UA2022GiantOptions', 'UA2024Bastions']) expect(is2024Source(id), id).toBe(true);
  for (const id of ['PHB', 'SAC', 'TCE', 'SRD', 'HOMEBREW', 'UATheMysticClass', 'UA2020Feats']) expect(is2024Source(id), id).toBe(false);
});

test('labels: full name, special ids, 2024, homebrew, unknown', () => {
  expect(sourceLabel('XGE')).toBe("Xanathar's Guide to Everything");
  expect(sourceLabel('srd')).toBe('System Reference Document 5.1');
  expect(sourceLabel('HOMEBREW')).toBe('Homebrew');
  expect(sourceLabel('HIDDEN')).toBe('Hidden item');
  expect(sourceLabel('MyBrew', true)).toBe('Homebrew (MyBrew)');
  expect(sourceLabel('MyBrew')).toBe('Unknown source (MyBrew)');
  expect(sourceLabel('FRHoF')).toBe('2024 rules (FRHoF)');
  expect(sourceLabel('PHB', true)).toBe("Player's Handbook (2014)"); // official is never labelled homebrew
});

test('classifySource: 2024 beats a declaration, official beats a declaration', () => {
  const declared = new Set(['XPHB', 'PHB', 'MYBREW']);
  expect(classifySource('XPHB', declared)).toBe('2024');
  expect(classifySource('PHB', declared)).toBe('official');
  expect(classifySource('mybrew', declared)).toBe('homebrew');
  expect(classifySource('other', declared)).toBe('unknown');
});

test('R53: the 12 extra WotC sources are official; UA, Generic and HFDoMM are not', () => {
  const extra: [string, string, string][] = [['TftYP', 'adventure', '2017-04-04'], ['EEPC', 'supplement', '2015-03-10'], ['EET', 'supplement', '2015-03-10'],
    ['RoTOS', 'supplement', '2014-11-04'], ['ESK', 'adventure', '2019-06-24'], ['MCV2DC', 'supplement', '2022-12-06'], ['MCV3MC', 'supplement', '2023-07-18'],
    ['MFF', 'supplement', '2018-09-20'], ['HAT-LMI', 'supplement', '2023-03-31'], ['SADS', 'supplement', '2023-01-24'], ['MisMV1', 'supplement', '2023-10-31'],
    ['VD', 'supplement', '2024-04-16']];
  for (const [id, kind, published] of extra) expect([id, sourceInfo(id)?.kind, OFFICIAL_2014[id.toUpperCase()]?.published]).toEqual([id, kind, published]);
  for (const id of ['UATheMysticClass', 'UA2020Feats', 'Generic', 'HFDoMM']) expect(sourceInfo(id), id).toBeUndefined();
});

test('reserved ids (SRD, HOMEBREW, HIDDEN) can never be declared homebrew', () => {
  const declared = new Set(['SRD', 'HOMEBREW', 'HIDDEN', 'MYBREW']);
  for (const id of ['SRD', 'homebrew', 'Hidden']) expect(classifySource(id, declared), id).toBe('unknown');
  expect(classifySource('MyBrew', declared)).toBe('homebrew');
});

test('only the built-in SRD pack may carry the SRD source', () => {
  expect(packAllowed({ id: 'srd', source: 'SRD' })).toBe(true);
  expect(packAllowed({ id: 'pack:SRD', source: 'SRD', homebrew: true })).toBe(false);
  expect(packAllowed({ id: 'pack:X', source: 'HOMEBREW', homebrew: true })).toBe(false);
  expect(packAllowed({ id: 'pack:X', source: 'hidden', homebrew: true })).toBe(false);
});

test('packAllowed: SRD, official, homebrew; never 2024 or unknown', () => {
  expect(packAllowed({ id: 'srd', source: 'SRD' })).toBe(true);
  expect(packAllowed({ source: 'PHB' })).toBe(true);
  expect(packAllowed({ source: 'MYBREW', homebrew: true })).toBe(true);
  expect(packAllowed({ source: 'MYBREW' })).toBe(false); // an old pack with no flag is judged by its source alone
  expect(packAllowed({ source: 'FRHOF' })).toBe(false);
  expect(packAllowed({ source: 'XPHB', homebrew: true })).toBe(false);
});

test('I7: entityAllowed and patchAllowed refuse non-string ids and sources instead of throwing', () => {
  expect(entityAllowed({ id: 'spell:x@PHB', source: 'PHB' })).toBe(true);
  for (const bad of [{ id: 5, source: 'PHB' }, { id: 'spell:x@PHB', source: null }, { id: undefined, source: undefined }, {}]) {
    expect(entityAllowed(bad as never), JSON.stringify(bad)).toBe(false);
  }
  expect(patchAllowed({ alias: 'PHB', targetId: 'spell:x@SRD' })).toBe(true);
  for (const bad of [{ alias: 1, targetId: 'spell:x@SRD' }, { alias: 'PHB', targetId: {} }, {}]) expect(patchAllowed(bad as never), JSON.stringify(bad)).toBe(false);
});
