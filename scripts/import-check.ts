// Dry-runs the 5etools importer over a local data folder and prints what it would import:
//   npm run import-check -- <5etools>/data
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ContentIndex } from '../src/lib/content/index.ts';
import { entityAllowed, is2024Source, packAllowed, sourceLabel } from '../src/lib/content/sources.ts';
import { selectDataFiles } from '../src/lib/import/dataFolder.ts';
import { import5etools } from '../src/lib/import/fivetools/index.ts';
import type { Pack } from '../src/lib/types.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npm run import-check -- <folder with 5etools json>');
  process.exit(2);
}

// The same selection the Packs page makes: only the files the importer uses (or every small .json for a homebrew folder).
const all = readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() && e.name.endsWith('.json'))
  .map(e => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
const sel = selectDataFiles(all, p => statSync(join(dir, p)).size);
console.log(`Found ${all.length} files, importing ${sel.use.length}${sel.root === null ? ' (no 5etools data folder recognised: treated as homebrew)' : ''}; skipped: ${sel.skipped.map(s => `${s.reason} ${s.count}`).join(', ') || 'nothing'}\n`);
const files: { name: string; json: unknown }[] = [];
const unreadable: string[] = [];
for (const name of sel.use) {
  try { files.push({ name, json: JSON.parse(readFileSync(join(dir, name), 'utf8')) }); } catch (err) { unreadable.push(`${name}: ${(err as Error).message}`); }
}

const srd: Pack = JSON.parse(readFileSync(new URL('../src/data/srd.json', import.meta.url), 'utf8'));
// The importer resolves `_copy` from the batch itself; nothing is stored between runs here.
const started = performance.now();
const r = await import5etools(files, { index: new ContentIndex([srd]), rawLookup: async () => undefined });
console.log(`Import took ${((performance.now() - started) / 1000).toFixed(1)} s\n`);

// R52: the importer is a whitelist. What came in, per source, and what was refused and why.
const label = (s: string, hb = false) => `${s.padEnd(12)} ${sourceLabel(s, hb)}`;
const accepted = r.packs.map(p => ({ p, n: p.entities.length + p.patches.length })).sort((a, b) => a.p.source.localeCompare(b.p.source));
console.log(`Accepted per source (entities + SRD patches), ${accepted.length} sources:`);
for (const { p, n } of accepted) console.log(`  ${label(p.source, p.homebrew)}: ${n}${p.homebrew ? ' (homebrew)' : ''}`);
const refused = (by: Record<string, number>, hb = false) => Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([s, n]) => `  ${label(s, hb)}: ${n}`);
console.log(`\nSkipped 2024 per source (${r.skipped2024} total):`);
for (const l of refused(r.skipped.rules2024)) console.log(l);
console.log(`Skipped 2024 by kind: ${Object.entries(r.skipped.rules2024Kinds).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
console.log(`\nSkipped unknown per source (${r.skippedUnknown} total):`);
for (const l of refused(r.skipped.unknown)) console.log(l);
const tainted = r.packs.flatMap(p => [p.source, ...p.entities.map(e => e.source)]).filter(s => is2024Source(s));
const bad = [...r.packs.filter(p => !packAllowed(p)), ...r.packs.flatMap(p => p.entities.filter(e => !entityAllowed(e)).map(() => p))]; // a pack, or an entity whose id does not carry its own source
console.log(`\nAccepted entities from a 2024 source: ${tainted.length}; packs that fail the whitelist: ${bad.length}\n`);
if (tainted.length || bad.length) process.exitCode = 1;

const NONE = 'No recognised 5etools content';
const skipped = r.errors.filter(e => e.message === NONE), errors = r.errors.filter(e => e.message !== NONE);
const total: Record<string, number> = {};
console.log(`Read ${files.length} json files under ${dir}\n\nPacks (entities by kind, SRD patches):`);
for (const p of [...r.packs].sort((a, b) => a.source.localeCompare(b.source))) {
  const counts: Record<string, number> = {};
  for (const e of p.entities) { counts[e.kind] = (counts[e.kind] ?? 0) + 1; total[e.kind] = (total[e.kind] ?? 0) + 1; }
  const kinds = Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`  ${p.source.padEnd(12)} ${p.name}: ${kinds || '-'}${p.patches.length ? `; patches ${p.patches.length}` : ''}`);
}
const patches = r.packs.reduce((n, p) => n + p.patches.length, 0);
console.log(`\nTotal: ${Object.entries(total).map(([k, n]) => `${k} ${n}`).join(', ')}; SRD patches ${patches}`);
console.log(`Raw entities kept: ${r.raw.length}`);
console.log(`Skipped 2024 entities: ${r.skipped2024}; skipped unknown: ${r.skippedUnknown}`);
console.log(`\nSkipped files (${NONE}): ${skipped.length}`);
for (const s of skipped) console.log(`  ${s.file}`);
console.log(`\nUnreadable files: ${unreadable.length}`);
for (const u of unreadable) console.log(`  ${u}`);
console.log(`\nErrors: ${errors.length}`);
for (const e of errors) console.log(`  ${e.file}: ${e.message}`);
console.log(`\nWarnings: ${r.warnings.length}`);
for (const w of r.warnings) console.log(`  ${w}`);
