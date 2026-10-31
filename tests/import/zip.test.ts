import { strToU8, Zip, ZipDeflate, zipSync, type Zippable } from 'fflate';
import { expect, test } from 'vitest';
import { readDataZip, ZIP_ENTRY_MAX_BYTES, ZIP_NO_JSON, ZIP_TOO_BIG } from '../../src/lib/import/zip.ts';

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

/** A zip written as a stream (fflate `Zip`): sizes go in data descriptors, and the same name may appear twice. */
function streamZip(entries: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const z = new Zip((err, chunk) => { if (err) throw err; parts.push(chunk); });
  for (const [name, data] of entries) { const f = new ZipDeflate(name); z.add(f); f.push(data, true); }
  z.end();
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
}
const markers = { [top + 'races.json']: json({}), [top + 'feats.json']: json({}), [top + 'books.json']: json({}) };

test('B1: a large non-.json entry streams past without being held in memory', async () => {
  const png = new Uint8Array(8 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24); // stored, so it is 8 MB inside the zip too
  const zip = zipSync({ ...markers, [top + 'img/big.png']: [png, { level: 0 }] } as Zippable);
  let peak = 0;
  const r = await readDataZip(pieces(zip, [65536]), undefined, { onBuffered: n => { peak = Math.max(peak, n); } });
  expect(paths(r)).toHaveLength(3);
  expect(peak).toBeLessThan(256 * 1024); // only the small JSON entries (and at most a chunk in flight), never the image
});

test('B2: kept entries over 200 MB in total are refused', async () => {
  const fifteen = new Uint8Array(15 * 1024 * 1024).fill(32);
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${top}bestiary/bestiary-${i}.json`, fifteen]));
  await expect(readDataZip(once(zipSync({ ...markers, ...many })))).rejects.toThrow(ZIP_TOO_BIG);
});

test('B3: the homebrew 5 MB cap holds when sizes are only in data descriptors', async () => {
  const six = new Uint8Array(6 * 1024 * 1024).fill(32);
  const r = await readDataZip(once(streamZip([['small.json', json({ feat: [] })], ['huge.json', six]])));
  expect([r.summary.root, paths(r), r.summary.skipped]).toEqual([null, ['small.json'], [{ reason: 'over 5 MB', count: 1 }]]);
});

test('B4: a zip with 160,000 entries reads in linear time', async () => {
  const files: Zippable = { 'only.json': json({ feat: [] }) };
  for (let i = 0; i < 160_000; i++) files[`f/${i}.txt`] = [new Uint8Array(0), { level: 0 }];
  const zip = zipSync(files);
  const t = performance.now();
  const r = await readDataZip(pieces(zip, [65536]));
  expect(paths(r)).toEqual(['only.json']);
  expect(performance.now() - t).toBeLessThan(2500); // ~0.3 s linear; fflate's own per-entry unshift made this ~5 s
});

test('B5: a file that is not a zip, or a zip with no .json, is an error', async () => {
  await expect(readDataZip(once(new Uint8Array(4096).map((_, i) => (i * 7919) & 255)))).rejects.toThrow(ZIP_NO_JSON);
  await expect(readDataZip(once(new Uint8Array(0)))).rejects.toThrow(ZIP_NO_JSON);
  await expect(readDataZip(once(zipSync({ 'img/a.png': new Uint8Array([1, 2, 3]) })))).rejects.toThrow(ZIP_NO_JSON);
});

test('B6: an aborted read stops and rejects', async () => {
  const ac = new AbortController();
  const zip = zipSync({ ...markers, 'x/data/items.json': new Uint8Array(1 << 20).fill(32) });
  let chunksRead = 0;
  const read = readDataZip(pieces(zip, [1024]), () => { if (++chunksRead === 2) ac.abort(new Error('cancelled')); }, { signal: ac.signal });
  await expect(read).rejects.toThrow('cancelled');
  expect(chunksRead).toBe(2);
});

test('B7: with a repeated name the first copy wins and a note says so', async () => {
  const r = await readDataZip(once(streamZip([['a.json', json({ n: 1 })], ['a.json', json({ n: 2 })], ['b.json', json({ n: 3 })]])));
  expect(r.files).toEqual([{ path: 'a.json', text: '{"n":1}' }, { path: 'b.json', text: '{"n":3}' }]);
  expect(r.summary.skipped).toEqual([{ reason: 'duplicate names (first copy used)', count: 1 }]);
});
