// Reads a 5etools zip as downloaded, without unzipping it first. Pure (no DOM): the Packs page streams a File into it, tests pass bytes.
// Lazy-loaded with fflate, so neither is in the first-load bundle.
import { Inflate, strFromU8, Unzip, UnzipPassThrough, type AsyncFlateStreamHandler, type UnzipDecoder } from 'fflate';
import { selectDataFiles } from './dataFolder.ts';

/** A selected entry bigger than this, uncompressed, is skipped (zip bombs; no 5etools data file comes close). */
export const ZIP_ENTRY_MAX_BYTES = 20 * 1024 * 1024;

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

/** The entry's bytes, or undefined when they pass the cap. Deflated input goes in 16 KB steps, so a bomb overshoots by at most ~16 MB. */
function inflate(chunks: Uint8Array[], compression: number): Uint8Array | undefined {
  const out: Uint8Array[] = [];
  let n = 0;
  const take = (d: Uint8Array) => { n += d.length; if (n <= ZIP_ENTRY_MAX_BYTES) out.push(d); };
  if (compression === 0) chunks.forEach(take);
  else {
    const inf = new Inflate(take);
    for (const c of chunks) for (let i = 0; i < c.length && n <= ZIP_ENTRY_MAX_BYTES; i += 16384) inf.push(c.subarray(i, i + 16384));
    if (n <= ZIP_ENTRY_MAX_BYTES) inf.push(new Uint8Array(0), true);
  }
  if (n > ZIP_ENTRY_MAX_BYTES) return undefined;
  const all = new Uint8Array(n);
  let at = 0;
  for (const d of out) { all.set(d, at); at += d.length; }
  return all;
}

/**
 * The files of a 5etools zip that the importer uses, chosen by `selectDataFiles` over the zip's paths exactly as for a folder
 * (a `data/` root nested in a top-level folder included; no root = homebrew .json under 5 MB). Images and other non-.json entries
 * are skipped unread; only the selected entries are inflated. `onProgress` gets the bytes read so far.
 */
export async function readDataZip(chunks: AsyncIterable<Uint8Array>, onProgress?: (done: number, total?: number) => void):
  Promise<{ files: { path: string; text: string }[]; summary: ReturnType<typeof selectDataFiles> }> {
  const paths: string[] = [];
  const json = new Map<string, { compression: number; size?: number; chunks: Uint8Array[]; stored: number; big: boolean }>();
  const unreadable: string[] = [];
  const unzip = new Unzip(file => {
    const path = file.name.replace(/\\/g, '/');
    if (path.endsWith('/') || unsafe(path)) return;
    paths.push(path);
    if (!path.toLowerCase().endsWith('.json')) return; // never started: fflate skips its bytes
    if (file.compression !== 0 && file.compression !== 8) { unreadable.push(path); return; }
    const e = { compression: file.compression, size: file.originalSize, chunks: [] as Uint8Array[], stored: 0, big: false };
    json.set(path, e);
    file.ondata = (err, data) => {
      if (err) { unreadable.push(path); json.delete(path); return; }
      e.stored += data.length;
      // Deflate expands incompressible data by a few bytes per 64 KB at most, so this much input holds more than the cap: stop keeping it.
      if (e.stored > ZIP_ENTRY_MAX_BYTES + 65536) { e.big = true; e.chunks = []; }
      else e.chunks.push(new Uint8Array(data)); // a copy: fflate may reuse its buffer (and Buffer.slice would not copy)
    };
    file.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(KeepDeflated);
  let done = 0;
  for await (const c of chunks) {
    unzip.push(c);
    done += c.length;
    onProgress?.(done);
  }
  unzip.push(new Uint8Array(0), true);

  const sel = selectDataFiles(paths, p => json.get(p)?.size);
  const files: { path: string; text: string }[] = [];
  let tooBig = 0;
  for (const path of sel.use) {
    const e = json.get(path);
    if (!e) continue; // unreadable: counted below
    let bytes: Uint8Array | undefined;
    try { bytes = e.big ? undefined : inflate(e.chunks, e.compression); } catch { unreadable.push(path); continue; }
    if (bytes) files.push({ path, text: strFromU8(bytes) });
    else tooBig++;
    e.chunks = [];
  }
  const bad = sel.use.filter(p => unreadable.includes(p)).length;
  return {
    files,
    summary: { ...sel, use: files.map(f => f.path), skipped: [...sel.skipped, ...(tooBig ? [{ reason: 'over 20 MB', count: tooBig }] : []), ...(bad ? [{ reason: 'unreadable', count: bad }] : [])] },
  };
}
