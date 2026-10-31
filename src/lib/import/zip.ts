// Reads a 5etools zip as downloaded, without unzipping it first. Pure (no DOM): the Packs page streams a File into it, tests pass bytes.
// Lazy-loaded with fflate, so neither is in the first-load bundle.
import { Inflate, strFromU8, Unzip, UnzipPassThrough, type AsyncFlateStreamHandler, type UnzipDecoder } from 'fflate';
import { HOMEBREW_MAX_BYTES, selectDataFiles } from './dataFolder.ts';

/** A selected entry bigger than this, uncompressed, is skipped (zip bombs; no 5etools data file comes close). */
export const ZIP_ENTRY_MAX_BYTES = 20 * 1024 * 1024;
/** All kept entries together, uncompressed. The real 5etools selection is about 25 MB. */
export const ZIP_TOTAL_MAX_BYTES = 200 * 1024 * 1024;
export const ZIP_TOO_BIG = 'This zip holds more data than the app will read (over 200 MB)';
export const ZIP_NO_JSON = "That doesn't look like a 5etools zip (no JSON files found)";

/**
 * A "decoder" that hands deflated bytes over as they are. Which entries are wanted is only known once every path has been seen
 * (the data root depends on them all), so .json entries are kept compressed until then and only the selected ones are inflated.
 */
class KeepDeflated implements UnzipDecoder {
  static compression = 8;
  ondata!: AsyncFlateStreamHandler;
  push(data: Uint8Array, final: boolean) { this.ondata(null, data, final); }
}

/** Zip paths are untrusted: an absolute path or a `..` segment never counts as part of the data. */
const unsafe = (p: string) => p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').includes('..');
const tick = () => new Promise<void>(r => setTimeout(r));

/** The entry's bytes, or undefined when they pass `cap`. Deflated input goes in 16 KB steps, so a bomb overshoots by at most ~16 MB. */
function inflate(chunks: Uint8Array[], compression: number, cap: number): Uint8Array | undefined {
  const out: Uint8Array[] = [];
  let n = 0;
  const take = (d: Uint8Array) => { n += d.length; if (n <= cap) out.push(d); };
  if (compression === 0) chunks.forEach(take);
  else {
    const inf = new Inflate(take);
    for (const c of chunks) for (let i = 0; i < c.length && n <= cap; i += 16384) inf.push(c.subarray(i, i + 16384));
    if (n <= cap) inf.push(new Uint8Array(0), true);
  }
  if (n > cap) return undefined;
  const all = new Uint8Array(n);
  let at = 0;
  for (const d of out) { all.set(d, at); at += d.length; }
  return all;
}

export interface ZipOptions {
  /** Aborting stops the read between chunks or entries; readDataZip then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Test hook: bytes of zip data held in memory after each chunk (kept compressed .json entries plus fflate's own buffers). */
  onBuffered?: (bytes: number) => void;
}

/**
 * The files of a 5etools zip that the importer uses, chosen by `selectDataFiles` over the zip's paths exactly as for a folder
 * (a `data/` root nested in a top-level folder included; no root = homebrew .json under 5 MB). Images and other non-.json entries
 * stream through without being kept; only the selected entries are inflated. `onProgress` gets the bytes read so far.
 * Throws ZIP_NO_JSON for a file with no .json entries at all (or not a zip), and ZIP_TOO_BIG past the total budget.
 */
export async function readDataZip(chunks: AsyncIterable<Uint8Array>, onProgress?: (done: number, total?: number) => void, opts: ZipOptions = {}):
  Promise<{ files: { path: string; text: string }[]; summary: ReturnType<typeof selectDataFiles> }> {
  const { signal, onBuffered } = opts;
  const paths = new Set<string>();
  const json = new Map<string, { compression: number; size?: number; chunks: Uint8Array[]; stored: number; big: boolean }>();
  const unreadable = new Set<string>();
  let duplicates = 0;
  const unzip = new Unzip(file => {
    // ponytail: fflate 0.8.2 unshifts a buffer list per entry into its private `k` and only ever reads k[0] and k[1], so an
    // entry-heavy zip goes quadratic (160k entries: 5 s). Trimming it keeps that linear; fflate is pinned, and a test bounds the time.
    const k = (unzip as unknown as { k: unknown[] }).k;
    if (k.length > 2) k.length = 2;
    const path = file.name.replace(/\\/g, '/');
    const passable = file.compression === 0 || file.compression === 8;
    const skip = () => { if (passable) { file.ondata = () => {}; file.start(); } }; // started, so fflate streams its bytes past instead of buffering them
    if (path.endsWith('/') || unsafe(path)) return skip();
    paths.add(path);
    if (!path.toLowerCase().endsWith('.json')) return skip();
    if (json.has(path)) { duplicates++; return skip(); } // the first complete copy of a name wins
    if (!passable) { unreadable.add(path); return; } // never started: an unknown method would throw inside fflate
    const e = { compression: file.compression, size: file.originalSize, chunks: [] as Uint8Array[], stored: 0, big: false };
    json.set(path, e);
    unreadable.delete(path); // an earlier copy failed; this one may do
    file.ondata = (err, data) => {
      if (err) { unreadable.add(path); json.delete(path); return; }
      e.stored += data.length;
      // Deflate expands incompressible data by a few bytes per 64 KB at most, so this much input holds more than the cap: stop keeping it.
      if (e.stored > ZIP_ENTRY_MAX_BYTES + 65536) { e.big = true; e.chunks = []; }
      else e.chunks.push(new Uint8Array(data)); // a copy: fflate may reuse its buffer (and Buffer.slice would not copy)
    };
    file.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(KeepDeflated);
  const held = () => [...(unzip as unknown as { k: Uint8Array[][] }).k.flat(), ...[...json.values()].flatMap(e => e.chunks)].reduce((n, c) => n + c.length, 0);
  let done = 0;
  for await (const c of chunks) {
    signal?.throwIfAborted();
    unzip.push(c);
    done += c.length;
    onProgress?.(done);
    if (onBuffered) onBuffered(held());
  }
  unzip.push(new Uint8Array(0), true);
  if (!json.size && !unreadable.size) throw new Error(ZIP_NO_JSON);

  const sel = selectDataFiles([...paths], p => json.get(p)?.size);
  const homebrewCap = sel.root === null ? HOMEBREW_MAX_BYTES : ZIP_ENTRY_MAX_BYTES; // header sizes can be missing (streamed zips): check what inflates
  const files: { path: string; text: string }[] = [];
  const extra = new Map<string, number>();
  const note = (reason: string) => extra.set(reason, (extra.get(reason) ?? 0) + 1);
  let total = 0, last = performance.now();
  for (const path of sel.use) {
    signal?.throwIfAborted();
    const e = json.get(path);
    if (!e) { note('unreadable'); continue; }
    let bytes: Uint8Array | undefined;
    try { bytes = e.big ? undefined : inflate(e.chunks, e.compression, Math.min(homebrewCap, ZIP_ENTRY_MAX_BYTES)); } catch { note('unreadable'); continue; }
    e.chunks = [];
    if (!bytes) { note(sel.root === null && !e.big ? 'over 5 MB' : 'over 20 MB'); continue; }
    if ((total += bytes.length) > ZIP_TOTAL_MAX_BYTES) throw new Error(ZIP_TOO_BIG);
    files.push({ path, text: strFromU8(bytes) });
    if (performance.now() - last > 30) { await tick(); last = performance.now(); } // let the page repaint while inflating
  }
  if (duplicates) extra.set('duplicate names (first copy used)', duplicates);
  const skipped = sel.skipped.map(s => ({ ...s, count: s.count + (extra.get(s.reason) ?? 0) }));
  for (const [reason, count] of extra) if (!skipped.some(s => s.reason === reason)) skipped.push({ reason, count });
  return { files, summary: { ...sel, use: files.map(f => f.path), skipped } };
}
