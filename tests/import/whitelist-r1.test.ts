// R52/R53 fix round 1: paths a crafted or homebrew file could use to bring 2024 content in.
import { expect, test } from 'vitest';
import { runRaw } from '../fixtures/import.ts';

const feat = (name: string, source: string, x: object = {}) => ({ name, source, entries: [`${name} text.`], ...x });
const plus = (r: Awaited<ReturnType<typeof runRaw>>) => r.packs.flatMap(p => p.entities).map(e => e.name).filter(n => n.startsWith('+1')).sort();
const names = (r: Awaited<ReturnType<typeof runRaw>>) => r.packs.flatMap(p => p.entities).map(e => e.name).sort();
const sword = { name: 'Testsword', source: 'PHB', type: 'M', weapon: true, weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S' };
const variant = (x: object, inherits: object = {}) => ({ name: '+1 Weapon', requires: [{ weapon: true }], ...x,
  inherits: { namePrefix: '+1 ', source: 'DMG', rarity: 'uncommon', bonusWeapon: '+1', entries: ['A +1 weapon.'], ...inherits } });

test('R53: a Tales from the Yawning Portal item is accepted; a UA Mystic entity is still rejected', async () => {
  const r = await runRaw({ 'items.json': { item: [{ name: 'Portal Key', source: 'TftYP', wondrous: true, rarity: 'rare', entries: ['Opens.'] }] },
    'mystic.json': { feat: [feat('Mystic Talent', 'UATheMysticClass')] } });
  expect(names(r)).toEqual(['Portal Key']);
  expect(r.packs[0]).toMatchObject({ source: 'TFTYP' });
  expect(r.skipped.unknown).toEqual({ UATHEMYSTICCLASS: 1 });
});

test('a magic variant is refused when its own source is 2024, even if inherits.source is 2014', async () => {
  const r = await runRaw({ 'b.json': { baseitem: [sword] }, 'v.json': { magicvariant: [variant({ source: 'XDMG' })] } });
  expect(plus(r)).toEqual([]);
  expect(r.skipped.rules2024).toEqual({ XDMG: 1 });
  expect(r.raw.map(([k]) => k)).not.toContain('magicvariant|+1 weapon|DMG');
});

test('a magic variant is refused for an unknown own source, a 2024 inherits.source, or edition "one" on either side', async () => {
  const run = (v: object) => runRaw({ 'b.json': { baseitem: [sword] }, 'v.json': { magicvariant: [v] } });
  const unknown = await run(variant({ source: 'NOPE' }));
  expect([plus(unknown), unknown.skipped.unknown]).toEqual([[], { NOPE: 1 }]);
  const inh = await run(variant({ source: 'DMG' }, { source: 'XDMG' }));
  expect([plus(inh), inh.skipped.rules2024]).toEqual([[], { XDMG: 1 }]);
  const own = await run(variant({ source: 'DMG', edition: 'one' }));
  expect([plus(own), own.skipped2024]).toEqual([[], 1]);
  const inhEd = await run(variant({ source: 'DMG' }, { edition: 'one' }));
  expect([plus(inhEd), inhEd.skipped2024]).toEqual([[], 1]);
  const ok = await run(variant({ source: 'DMG' }));
  expect(plus(ok)).toContain('+1 Testsword');
});

const reparented = { name: 'Battle Master', shortName: 'Battle Master', source: 'PHB', className: 'Fighter', classSource: 'XPHB', subclassFeatures: [] };
const copyOf = { name: 'Copy', shortName: 'Copy', source: 'PHB', className: 'Fighter', classSource: 'PHB',
  _copy: { name: 'Battle Master', source: 'PHB', shortName: 'Battle Master', className: 'Fighter', classSource: 'XPHB' } };

test('a PHB subclass that copies the XPHB-reparented record is rejected (batch and stored)', async () => {
  const inBatch = await runRaw({ 's.json': { subclass: [reparented, copyOf] } });
  expect(inBatch.packs).toEqual([]);
  expect(inBatch.skipped.rules2024).toEqual({ XPHB: 2 });
  // the reparented record has PHB in its raw key, so only its classSource gives it away
  const stored = await runRaw({ 's.json': { subclass: [copyOf] } }, async k => (k === 'subclass|fighter|XPHB|battle master|PHB' ? reparented : undefined));
  expect(stored.packs).toEqual([]);
  expect(stored.skipped.rules2024).toEqual({ XPHB: 1 });
});

test('a subclassFeature with subclassSource XPHB is rejected', async () => {
  const r = await runRaw({ 'f.json': { subclassFeature: [{ name: 'Maneuvers', source: 'PHB', className: 'Fighter', classSource: 'PHB', subclassShortName: 'Battle Master', subclassSource: 'XPHB', level: 3, entries: ['x'] }] } });
  expect(r.packs).toEqual([]);
  expect(r.skipped.rules2024).toEqual({ XPHB: 1 });
});

test('a subrace with raceSource XPHB is rejected', async () => {
  const r = await runRaw({ 'r.json': { subrace: [{ name: 'Hill', raceName: 'Dwarf', raceSource: 'XPHB', source: 'PHB', entries: ['x'] }] } });
  expect(r.packs).toEqual([]);
  expect(r.skipped.rules2024).toEqual({ XPHB: 1 });
});

test('a subclass whose classSource is unknown is rejected; a declared homebrew parent is allowed', async () => {
  const r = await runRaw({ 's.json': { subclass: [{ name: 'Order', shortName: 'Order', source: 'PHB', className: 'Mystic', classSource: 'NOPE', subclassFeatures: [] }] } });
  expect(r.packs).toEqual([]);
  expect(r.skipped.unknown).toEqual({ NOPE: 1 });
  const hb = await runRaw({ 'h.json': { _meta: { sources: [{ json: 'MyBrew' }] },
    subclass: [{ name: 'Order', shortName: 'Order', source: 'MyBrew', className: 'Mystic', classSource: 'MyBrew', subclassFeatures: [] }] } });
  expect(names(hb)).toEqual(['Order']);
});

test('a homebrew file cannot declare a reserved id (SRD, HOMEBREW, HIDDEN)', async () => {
  const r = await runRaw({ 'h.json': { _meta: { sources: [{ json: 'SRD' }, { json: 'HOMEBREW' }, { json: 'HIDDEN' }] },
    feat: [feat('Grappler', 'SRD'), feat('Mine', 'HOMEBREW'), feat('Sneaky', 'HIDDEN')] } });
  expect(r.packs).toEqual([]);
  expect(r.skipped.unknown).toEqual({ SRD: 1, HOMEBREW: 1, HIDDEN: 1 });
});

test('stored raw records are judged like batch records: 2024 edition, 2024 parent, unknown source', async () => {
  const copy = (src: string, name = 'Old') => ({ 'f.json': { feat: [feat('Copycat', 'PHB', { entries: undefined, _copy: { name, source: src } })] } });
  // key source PHB, but the stored record itself says edition "one"
  const ed = await runRaw(copy('PHB'), async k => (k === 'feat|old|PHB' ? feat('Old', 'PHB', { edition: 'one' }) : undefined));
  expect([ed.packs, ed.skipped.rules2024, ed.errors]).toEqual([[], { PHB: 1 }, []]);
  // key source PHB, but the stored record's own source is 2024
  const own = await runRaw(copy('PHB'), async k => (k === 'feat|old|PHB' ? feat('Old', 'XPHB') : undefined));
  expect([own.packs, own.skipped.rules2024]).toEqual([[], { XPHB: 1 }]);
  // an unknown source is refused unless it belongs to a stored homebrew pack
  const stored = (k: string) => (k === 'feat|old|MYBREW' ? feat('Old', 'MyBrew') : undefined);
  const unknown = await runRaw(copy('MyBrew'), async k => stored(k));
  expect([unknown.packs, unknown.skipped.unknown]).toEqual([[], { MYBREW: 1 }]);
  const hb = await runRaw(copy('MyBrew'), async k => stored(k), ['MyBrew']);
  expect(names(hb)).toEqual(['Copycat']);
  // a stored class-family record whose parent is 2024 never reaches a class conversion either
  expect(hb.errors).toEqual([]);
});
