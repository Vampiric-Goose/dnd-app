// A joined campaign is always seen as a player: the device never holds the DM's view, and DM-only controls stay hidden.
import 'fake-indexeddb/auto';
import { expect, test, vi } from 'vitest';
import { db, resetDb } from '../src/lib/db.ts';
import { camp } from './fixtures/records.ts';

vi.mock('../src/lib/content/srd.ts', async () => ({ loadSrd: async () => (await import('./fixtures/srdPack.ts')).srdPackFixture }));
const { app, refreshCampaigns, setCampaign } = await import('../src/lib/store.svelte.ts');

test('opening a joined campaign switches the view to Player; a hosted one keeps the DM view', async () => {
  await resetDb();
  await db.campaigns.put({ ...camp('mine'), sync: { role: 'dm', code: 'ABCDEFGHJKMN', node: 'dmnode01', players: {} } });
  await db.campaigns.put({ ...camp('joined'), sync: { role: 'player', code: 'ABCDEFGHJKMN', node: 'pnode001', playerId: 'A1' } });
  await refreshCampaigns();
  app.viewer = 'dm';
  await setCampaign('mine');
  expect(app.viewer).toBe('dm');
  await setCampaign('joined');
  expect(app.viewer).toBe('player');
  await resetDb();
});
