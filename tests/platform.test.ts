import { expect, test } from 'vitest';
import { needsBackupReminder } from '../src/lib/platform.ts';

const day = 86_400_000, now = 100 * day;
test('backup reminder', () => {
  expect(needsBackupReminder({ hasData: true, now })).toBe(true);
  expect(needsBackupReminder({ hasData: true, lastBackupAt: now - 13 * day, now })).toBe(false);
  expect(needsBackupReminder({ hasData: true, lastBackupAt: now - 15 * day, now })).toBe(true);
  expect(needsBackupReminder({ hasData: true, lastBackupAt: now - 15 * day, snoozedUntil: now + day, now })).toBe(false);
  expect(needsBackupReminder({ hasData: false, now })).toBe(false);
});
