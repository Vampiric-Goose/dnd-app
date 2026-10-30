import { expect, test } from 'vitest';
import { splitImportErrors } from '../../src/lib/import/summary.ts';

test('files with no recognised content are skipped, other errors stay errors', () => {
  const real = { file: 'a.json', message: 'race "X": missing name' };
  const lookalike = { file: 'c.json', message: 'No recognised 5etools content in this file' };
  expect(splitImportErrors([
    { file: 'index.json', message: 'No recognised 5etools content' }, real, lookalike,
    { file: 'fluff.json', message: 'No recognised 5etools content' },
  ])).toEqual({ skipped: ['index.json', 'fluff.json'], errors: [real, lookalike] });
  expect(splitImportErrors([])).toEqual({ skipped: [], errors: [] });
});
