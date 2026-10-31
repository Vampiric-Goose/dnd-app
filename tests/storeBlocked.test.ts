// startup() tells the user when an older tab holds the database open, and clears the message once the upgrade goes through.
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { expect, test, vi } from 'vitest';
import { resetDb } from '../src/lib/db.ts';

vi.mock('../src/lib/content/srd.ts', async () => ({ loadSrd: async () => (await import('./fixtures/srdPack.ts')).srdPackFixture }));
const { app, startup } = await import('../src/lib/store.svelte.ts');

test('startup sets the "Another tab…" message while an older tab blocks the upgrade, then clears it', async () => {
  await resetDb();
  // An older tab on version 1 (all its stores), with no versionchange handler, so it keeps the database open.
  const v1 = await openDB('dnd-app', 1, { upgrade(d) { for (const s of ['campaigns', 'packMeta', 'packs', 'raw5e', 'blobs', 'meta']) d.createObjectStore(s); } });
  const done = startup();
  await vi.waitFor(() => expect(app.error).toMatch(/^Another tab of this app is open/));
  expect(app.ready).toBe(false);
  v1.close();
  await done;
  expect([app.error, app.ready]).toEqual([undefined, true]);
  await resetDb();
});
