import { strToU8, Zip, ZipDeflate, zipSync, type Zippable } from 'fflate';
import { expect, test } from 'vitest';
import { readDataZip, ZIP_ENTRY_MAX_BYTES } from '../../src/lib/import/zip.ts';

// Zips built here from invented content. `level: 0` entries are stored, the rest deflated, so both decoders run.
const json = (o: unknown) => strToU8(JSON.stringify(o));
async function* once(b: Uint8Array) { yield b; }
async function* pieces(b: Uint8Array, sizes: number[]) {
  for (let at = 0, i = 0; at < b.length; i++) { const n = sizes[i % sizes.length]; yield b.slice(at, at + n); at += n; }
}
const paths = (r: Awaited<ReturnType<typeof readDataZip>>) => r.files.map(f => f.path).sort();

const top = '5etools-src-x/data/';
const dataZip = () => zipSync({
  [top + 'races.json']: json({ race: [{ name: 'Testling', source: 'TST' }] }),
  [top + 'feats.json']: [json({ feat: [] }), { level: 0 }],
  [top + 'books.json']: json({ book: [] }),
  [top + 'bestiary/bestiary-xyz.json']: json({ monster: [{ name: 'Glimmerfang', source: 'TST' }] }),
  [top + 'bestiary/fluff-bestiary-xyz.json']: json({ monsterFluff: [] }),
  [top + 'adventure/x.json']: json({ data: ['A long adventure.'] }),
  [top + 'img/a.png']: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
} as Zippable);

test('a zip with a nested data/ folder yields exactly the files the folder import would use; the rest is counted as skipped', async () => {
  const r = await readDataZip(once(dataZip()));
  expect(r.summary.root).toBe('5etools-src-x/data');
  expect(paths(r)).toEqual(['bestiary/bestiary-xyz.json', 'books.json', 'feats.json', 'races.json'].map(p => top + p));
  expect(r.summary.use.sort()).toEqual(paths(r));
  expect(r.summary.skipped).toEqual([{ reason: 'fluff', count: 1 }, { reason: 'adventures/books', count: 1 }]);
  expect(JSON.parse(r.files.find(f => f.path.endsWith('races.json'))!.text)).toEqual({ race: [{ name: 'Testling', source: 'TST' }] });
  expect(JSON.parse(r.files.find(f => f.path.endsWith('feats.json'))!.text)).toEqual({ feat: [] }); // a stored (uncompressed) entry
});

test('entries with .. or an absolute path are ignored', async () => {
  const r = await readDataZip(once(zipSync({ '../evil.json': json({ feat: [] }), '/abs.json': json({}), 'C:/x.json': json({}), 'a/../../b.json': json({}), 'ok.json': json({ feat: [] }) })));
  expect(paths(r)).toEqual(['ok.json']);
});

test('a homebrew zip with two .json files at its root yields both', async () => {
  const r = await readDataZip(once(zipSync({ 'my-feats.json': json({ feat: [] }), 'my-spells.json': json({ spell: [] }), 'readme.txt': strToU8('hi') })));
  expect([r.summary.root, paths(r)]).toEqual([null, ['my-feats.json', 'my-spells.json']]);
});

test('input split at odd byte boundaries gives the same result as one chunk, and progress counts the bytes', async () => {
  const zip = dataZip(), seen: number[] = [];
  const whole = await readDataZip(once(zip));
  const split = await readDataZip(pieces(zip, [1, 7, 13, 3, 101]), done => seen.push(done));
  expect(split).toEqual(whole);
  expect(seen[seen.length - 1]).toBe(zip.length);
});

test('a zip written as a stream (sizes in data descriptors, not the headers) reads the same', async () => {
  const parts: Uint8Array[] = [];
  const z = new Zip((err, chunk) => { if (err) throw err; parts.push(chunk); });
  for (const [name, o] of [['a.json', { feat: [] }], ['b.json', { spell: [1, 2, 3] }]] as const) {
    const f = new ZipDeflate(name);
    z.add(f);
    f.push(json(o), true);
  }
  z.end();
  const r = await readDataZip(pieces(new Uint8Array(parts.flatMap(p => [...p])), [5, 9]));
  expect(r.files).toEqual([{ path: 'a.json', text: '{"feat":[]}' }, { path: 'b.json', text: '{"spell":[1,2,3]}' }]);
});

test('a selected entry over 20 MB uncompressed is skipped and reported', async () => {
  const big = new Uint8Array(ZIP_ENTRY_MAX_BYTES + 1).fill(32); // spaces: deflates to almost nothing
  const r = await readDataZip(once(zipSync({ [top + 'races.json']: json({}), [top + 'feats.json']: json({}), [top + 'books.json']: json({}), [top + 'items.json']: big })));
  expect(paths(r)).toEqual(['books.json', 'feats.json', 'races.json'].map(p => top + p));
  expect(r.summary.skipped).toEqual([{ reason: 'over 20 MB', count: 1 }]);
});
