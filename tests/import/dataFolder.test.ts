import { expect, test } from 'vitest';
import { selectDataFiles, walkEntries, type FsEntry } from '../../src/lib/import/dataFolder.ts';

// A path list shaped like a 5etools data folder (names only; nothing here is real content).
const dataFiles = [
  'races.json', 'backgrounds.json', 'feats.json', 'optionalfeatures.json', 'conditionsdiseases.json', 'books.json', 'adventures.json',
  'items-base.json', 'items.json', 'magicvariants.json',
  'class/index.json', 'class/class-fighter.json', 'class/class-wizard.json',
  'spells/index.json', 'spells/sources.json', 'spells/spells-phb.json', 'spells/spells-xge.json',
  'generated/gendata-spell-source-lookup.json',
];
const unused = [
  'fluff-races.json', 'fluff-items.json', 'class/fluff-class-fighter.json', 'class/fluff-index.json', 'spells/fluff-spells-phb.json',
  'foundry-feats.json', 'foundry-items.json', 'class/foundry.json', 'spells/foundry.json',
  'adventure/adventure-lmop.json', 'adventure/adventure-cos.json', 'book/book-phb.json',
  'bestiary/bestiary-mm.json', 'bestiary/fluff-bestiary-mm.json', 'bestiary/index.json',
  'actions.json', 'deities.json', 'generated/gendata-subclass-lookup.json', 'generated/bookref-quick.json',
];
const under = (prefix: string, list: string[]) => list.map(p => prefix + p);
const reasons = (s: ReturnType<typeof selectDataFiles>) => Object.fromEntries(s.skipped.map(x => [x.reason, x.count]));
const expectedSkips = { fluff: 5, Foundry: 4, 'adventures/books': 3, 'monsters (stage 2)': 3, other: 4 };

test('a data/ folder gives exactly the allowlisted files, and everything else is skipped by reason', () => {
  const s = selectDataFiles(under('data/', [...unused, ...dataFiles]));
  expect(s.root).toBe('data');
  expect([...s.use].sort()).toEqual(under('data/', dataFiles).sort());
  expect(reasons(s)).toEqual(expectedSkips);
});

test('the repo root above data/ is recognised, and non-json files, node_modules and .git are ignored', () => {
  const noise = ['5etools-src/package.json', '5etools-src/js/render.js', '5etools-src/node_modules/x/package.json', '5etools-src/.git/config', '5etools-src/img/a.png'];
  const s = selectDataFiles([...noise, ...under('5etools-src/data/', [...dataFiles, ...unused])]);
  expect(s.root).toBe('5etools-src/data');
  expect([...s.use].sort()).toEqual(under('5etools-src/data/', dataFiles).sort());
  expect(reasons(s)).toEqual({ ...expectedSkips, other: expectedSkips.other + 1 }); // package.json sits outside the data root
});

test('paths that start inside the data folder (root "") work too', () => {
  const s = selectDataFiles([...dataFiles, ...unused]);
  expect(s.root).toBe('');
  expect(s.use).toHaveLength(dataFiles.length);
});

test('a folder with no 5etools layout is homebrew: every .json under 5 MB', () => {
  const paths = ['mybrew/feats.json', 'mybrew/classes/rogue.json', 'mybrew/notes.txt', 'mybrew/huge.json'];
  const s = selectDataFiles(paths, p => (p.endsWith('huge.json') ? 6 * 1024 * 1024 : 100));
  expect(s).toEqual({ use: ['mybrew/feats.json', 'mybrew/classes/rogue.json'], skipped: [{ reason: 'over 5 MB', count: 1 }], root: null });
  expect(selectDataFiles(paths.slice(0, 2)).root).toBeNull(); // one or two marker files are not enough
});

test('an empty selection selects nothing', () => {
  expect(selectDataFiles([])).toEqual({ use: [], skipped: [], root: null });
});

// A fake entry tree: directories hand out their children in batches of 2, then an empty batch.
const file = (name: string): FsEntry => ({ isFile: true, isDirectory: false, name });
const dir = (name: string, kids: FsEntry[], log: string[] = []): FsEntry => ({
  isFile: false, isDirectory: true, name,
  createReader() {
    let at = 0;
    return { readEntries(ok) { log.push(name); const b = kids.slice(at, at + 2); at += 2; ok(b); } };
  },
});

test('walkEntries lists files with webkitRelativePath-style paths, never entering node_modules, and bounds depth', async () => {
  const log: string[] = [];
  const tree = dir('data', [file('a.json'), file('b.json'), file('c.json'), dir('class', [file('x.json')], log), dir('node_modules', [file('n.json')], log)], log);
  expect((await walkEntries([tree])).map(f => f.path)).toEqual(['data/a.json', 'data/b.json', 'data/c.json', 'data/class/x.json']);
  expect(log).not.toContain('node_modules');
  expect(await walkEntries([tree], { maxDepth: 1 })).toHaveLength(3); // class/ is at depth 1, so its files are not listed
  expect((await walkEntries([file('lone.json')])).map(f => f.path)).toEqual(['lone.json']);
  await expect(walkEntries([tree], { maxEntries: 3 })).rejects.toThrow(/more than 3 entries/);
});
