// Shared helpers for 5etools importer tests (Tasks 11 and 12).
import { readFileSync } from 'node:fs';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { import5etools } from '../../src/lib/import/fivetools/index.ts';
import { srdPackFixture } from './srdPack.ts';

export const srdIdx = new ContentIndex([srdPackFixture]);

/**
 * The importer is a whitelist (R52): the fixtures' fictional source TST is accepted only as homebrew, which a file declares in
 * `_meta.sources`. This adds that declaration to a content file that has none (arrays at the top level; lookup files are left alone).
 */
export const asTst = (json: unknown): unknown => {
  const o = json as Record<string, unknown>;
  return o && typeof o === 'object' && !Array.isArray(o) && !('_meta' in o) && Object.values(o).some(Array.isArray)
    ? { ...o, _meta: { sources: [{ json: 'TST' }] } } : json;
};

/** Runs the importer over `{ fileName: json }` against the tiny SRD fixture, with no stored raw entities. TST is declared homebrew. */
export const run = (files: Record<string, unknown>) =>
  import5etools(Object.entries(files).map(([name, json]) => ({ name, json: asTst(json) })), { index: srdIdx, rawLookup: async () => undefined });

/** Like `run`, but the files are taken exactly as given (no TST declaration). */
export const runRaw = (files: Record<string, unknown>, rawLookup: (key: string) => Promise<unknown | undefined> = async () => undefined, homebrewSources: string[] = []) =>
  import5etools(Object.entries(files).map(([name, json]) => ({ name, json })), { index: srdIdx, rawLookup, homebrewSources });

/** A hand-written 5etools-format fixture from tests/fixtures/5etools/. */
export const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./5etools/${name}`, import.meta.url), 'utf8'));
