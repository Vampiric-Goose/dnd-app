// The tracker page's operation wrapper: errors and unreachable characters become toasts, never thrown.
import { beforeEach, expect, test } from 'vitest';
import { toasts } from '../../src/lib/toast.svelte.ts';
import { act } from '../../src/ui/initiative/act.ts';

beforeEach(() => { toasts.length = 0; });

test('returns the result and shows nothing when all went well', async () => {
  expect(await act(async () => ({ failed: [] as string[] }))).toEqual({ failed: [] });
  expect(await act(async () => undefined)).toBeUndefined();
  expect(toasts).toEqual([]);
});

test('a failed list names the characters in an error toast', async () => {
  await act(async () => ({ failed: ['Aria', 'Bram'] }));
  expect(toasts.map((t) => [t.text, t.error])).toEqual([['Could not update Aria, Bram.', true]]);
});

test('a thrown error becomes an error toast and undefined', async () => {
  expect(await act(async () => { throw new Error('That combatant is not in the fight.'); })).toBeUndefined();
  expect(toasts.map((t) => t.text)).toEqual(['That combatant is not in the fight.']);
});
