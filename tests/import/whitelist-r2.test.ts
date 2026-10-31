// R52 fix round 2: homebrew parents may live in another file of the batch (or a stored homebrew pack), never a 2024 or unknown one.
import { expect, test } from 'vitest';
import { runRaw } from '../fixtures/import.ts';

const names = (r: Awaited<ReturnType<typeof runRaw>>) => r.packs.flatMap(p => p.entities).map(e => e.name).sort();
const brewClass = { _meta: { sources: [{ json: 'MyBrew' }] }, class: [{ name: 'Mystic', source: 'MyBrew', hd: { faces: 8 }, classFeatures: [] }] };
const sub = (classSource: string) => ({ _meta: { sources: [{ json: 'OtherBrew' }] },
  subclass: [{ name: 'Order', shortName: 'Order', source: 'OtherBrew', className: 'Mystic', classSource, subclassFeatures: [] }] });

test("a subclass in file B of file A's homebrew class is accepted; the same with classSource XPHB is rejected", async () => {
  const ok = await runRaw({ 'a.json': brewClass, 'b.json': sub('MyBrew') });
  expect(names(ok)).toEqual(['Mystic', 'Order']);
  expect(ok.skipped).toEqual({ rules2024: {}, unknown: {} });
  const bad = await runRaw({ 'a.json': brewClass, 'b.json': sub('XPHB') });
  expect(names(bad)).toEqual(['Mystic']);
  expect(bad.skipped.rules2024).toEqual({ XPHB: 1 });
});

test('a parent nobody declares is still unknown, and a reserved id never counts as a declared parent', async () => {
  const unknown = await runRaw({ 'a.json': brewClass, 'b.json': sub('NOPE') });
  expect(names(unknown)).toEqual(['Mystic']);
  expect(unknown.skipped.unknown).toEqual({ NOPE: 1 });
  const reserved = await runRaw({ 'a.json': { _meta: { sources: [{ json: 'SRD' }] }, feat: [] }, 'b.json': sub('SRD') });
  expect(names(reserved)).toEqual([]);
  expect(reserved.skipped.unknown).toEqual({ SRD: 1 });
});

test('a parent from a stored homebrew pack counts', async () => {
  const none = await runRaw({ 'b.json': sub('MyBrew') });
  expect(names(none)).toEqual([]);
  const stored = await runRaw({ 'b.json': sub('MyBrew') }, async () => undefined, ['MyBrew']);
  expect(names(stored)).toEqual(['Order']);
});
