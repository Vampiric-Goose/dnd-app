// Shared helpers for 5etools importer tests (Tasks 11 and 12).
import { readFileSync } from 'node:fs';
import { ContentIndex } from '../../src/lib/content/index.ts';
import { import5etools } from '../../src/lib/import/fivetools/index.ts';
import { srdPackFixture } from './srdPack.ts';

export const srdIdx = new ContentIndex([srdPackFixture]);

/** Runs the importer over `{ fileName: json }` against the tiny SRD fixture, with no stored raw entities. */
export const run = (files: Record<string, unknown>) =>
  import5etools(Object.entries(files).map(([name, json]) => ({ name, json })), { index: srdIdx, rawLookup: async () => undefined });

/** A hand-written 5etools-format fixture from tests/fixtures/5etools/. */
export const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./5etools/${name}`, import.meta.url), 'utf8'));
