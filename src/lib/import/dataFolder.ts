// Picks the files of a 5etools `data/` folder that the stage-1 importer can use. Pure (no DOM, no Node): the Packs page and scripts/import-check.ts share it.

/** Files at the data root the importer reads (races, feats, ... and the book/adventure lists that carry pack names). */
const TOP = ['races', 'backgrounds', 'feats', 'optionalfeatures', 'conditionsdiseases', 'books', 'adventures', 'items-base', 'items', 'magicvariants'].map(n => `${n}.json`);
/** The only `generated/` file the importer reads: spell -> class lists (see spellLookup). gendata-subclass-lookup.json is not used, so it is not selected. */
const GENERATED = ['generated/gendata-spell-source-lookup.json'];
/** Files that identify a data root. Three distinct hits are needed, so one homebrew `feats.json` is not mistaken for a 5etools folder. */
const MARKERS = [...TOP, 'class/index.json', 'spells/index.json', ...GENERATED];
const ALLOWED_DIR = /^(class|spells)\/[^/]+\.json$/;

export const HOMEBREW_MAX_BYTES = 5 * 1024 * 1024;
export const IGNORED_DIRS = new Set(['node_modules', '.git']);
/** Skip reasons in display order; the strings are shown to the user as is. */
const REASONS = ['fluff', 'Foundry', 'adventures/books', 'monsters (stage 2)', 'other', 'over 5 MB'] as const;
type Reason = (typeof REASONS)[number];

export interface DataSelection { use: string[]; skipped: { reason: string; count: number }[]; root: string | null }

const isJson = (p: string) => p.toLowerCase().endsWith('.json');
const ignored = (p: string) => p.split('/').some(s => IGNORED_DIRS.has(s));

/** The folder (possibly '') that holds the most marker files, at least three of them; the shallowest on a tie. */
function findRoot(paths: string[]): string | null {
  const hits = new Map<string, Set<string>>();
  for (const p of paths) for (const m of MARKERS) {
    if (p !== m && !p.endsWith('/' + m)) continue;
    const root = p.slice(0, Math.max(0, p.length - m.length - 1));
    hits.set(root, (hits.get(root) ?? new Set()).add(m));
  }
  const best = [...hits].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size || a[0].length - b[0].length)[0];
  return best ? best[0] : null;
}

function why(rel: string): Reason | undefined {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (rel.startsWith('adventure/') || rel.startsWith('book/')) return 'adventures/books';
  if (rel.startsWith('bestiary/')) return 'monsters (stage 2)';
  if (base.startsWith('foundry')) return 'Foundry';
  if (base.startsWith('fluff-')) return 'fluff';
  return TOP.includes(rel) || GENERATED.includes(rel) || ALLOWED_DIR.test(rel) ? undefined : 'other';
}

/**
 * Which of these relative paths (`webkitRelativePath` style, `/`-separated) to read.
 * With a recognised 5etools data root: the stage-1 allowlist. Without one the folder is homebrew: every .json under 5 MB
 * (`sizeOf` gives bytes; unknown sizes pass), and the importer's own source rules decide what is accepted.
 * `root` is the data folder's path prefix ('' when the paths start inside it), or null for homebrew. Non-.json files and node_modules/.git are ignored.
 */
export function selectDataFiles(paths: string[], sizeOf?: (path: string) => number | undefined): DataSelection {
  const json = paths.filter(p => isJson(p) && !ignored(p));
  const root = findRoot(json);
  const use: string[] = [], counts = new Map<Reason, number>();
  const skip = (r: Reason) => counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const p of json) {
    const rel = root ? (p.startsWith(root + '/') ? p.slice(root.length + 1) : undefined) : p; // undefined: outside the data root
    const reason = root === null ? ((sizeOf?.(p) ?? 0) > HOMEBREW_MAX_BYTES ? 'over 5 MB' : undefined) : rel === undefined ? 'other' : why(rel);
    if (reason) skip(reason); else use.push(p);
  }
  return { use, skipped: REASONS.filter(r => counts.has(r)).map(reason => ({ reason, count: counts.get(reason)! })), root };
}

/** The slice of the File System Entry API the tree walk needs (the real `FileSystemEntry` fits; tests use a fake). */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  createReader?(): { readEntries(ok: (entries: FsEntry[]) => void, fail?: (e: unknown) => void): void };
}

/**
 * Every file under dropped entries, as `{ path, entry }` with paths like `webkitRelativePath` (the dropped folder's name first).
 * Lists directories only: file contents are never read. Bounded in depth, and in total entries (it throws past `maxEntries`).
 * node_modules and .git are not entered.
 */
export async function walkEntries(roots: FsEntry[], { maxDepth = 8, maxEntries = 50_000 } = {}): Promise<{ path: string; entry: FsEntry }[]> {
  const out: { path: string; entry: FsEntry }[] = [];
  let seen = 0;
  const visit = async (e: FsEntry, path: string, depth: number): Promise<void> => {
    if (++seen > maxEntries) throw new Error(`That folder has more than ${maxEntries} entries; pick the data folder itself.`);
    if (e.isFile) { out.push({ path, entry: e }); return; }
    if (!e.isDirectory || !e.createReader || depth >= maxDepth || IGNORED_DIRS.has(e.name)) return;
    const reader = e.createReader();
    // readEntries returns a batch at a time (about 100 in Chrome); an empty batch means done.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) break;
      for (const c of batch) await visit(c, `${path}/${c.name}`, depth + 1);
    }
  };
  for (const r of roots) await visit(r, r.name, 0);
  return out;
}
