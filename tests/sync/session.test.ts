// Task 5: the app-wide sync session over a fake transport (an in-memory "signaling server" of memory links) and the real db.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { db, hostOffKey, resetDb, TRASH_CAP } from '../../src/lib/db.ts';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { roll, rollLog, rollViewer, rollVisibility } from '../../src/lib/rolls.svelte.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { peerIdFor } from '../../src/lib/sync/code.ts';
import { Guest, type GuestDeps } from '../../src/lib/sync/guest.ts';
import { Host, type HostDeps } from '../../src/lib/sync/host.ts';
import type { TrackerView } from '../../src/lib/sync/project.ts';
import { memoryPair, type Link, type Transport } from '../../src/lib/sync/link.ts';
import type { Campaign, Combat, ItemDef } from '../../src/lib/types.ts';
import { rollD20 } from '../../src/ui/sheet/roll.ts';
import { camp, char } from '../fixtures/records.ts';
import { Device } from './fakes.ts';

vi.mock('../../src/lib/content/srd.ts', async () => ({ loadSrd: async () => (await import('../fixtures/srdPack.ts')).srdPackFixture }));
await import('../fixtures/srdPack.ts'); // loaded once here, so the mocked SRD resolves at once inside settle()
const { app, refreshCampaigns, setCampaign } = await import('../../src/lib/store.svelte.ts');
const { backoff, follow, hostCampaign, join, rotateCode, sendInitiative, session, stopHosting, stopSession, useTransport } = await import('../../src/lib/sync/session.svelte.ts');

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';

/** A fake signaling server: `listen` registers a peer id while `up`, `dial` hands one end of a memory pair to the listener. */
class Net implements Transport {
  peers = new Map<string, (l: Link) => void>();
  listens: string[] = [];
  registers = 0; // listen + retry
  dials: number[] = []; // Date.now() of each dial
  up = true;
  listen(id: string, on: { link(l: Link): void; status(up: boolean, why?: string): void }) {
    this.listens.push(id);
    const register = () => {
      this.registers++;
      if (!this.up) return on.status(false, 'server down');
      this.peers.set(id, on.link);
      on.status(true);
    };
    register();
    return { retry: register, close: () => { if (this.peers.get(id) === on.link) this.peers.delete(id); } };
  }
  async dial(id: string): Promise<Link> {
    this.dials.push(Date.now());
    const to = this.peers.get(id);
    if (!to) throw new Error('The host is not online.');
    const [a, b] = memoryPair();
    to(a);
    return b;
  }
}

let net: Net;
async function settle(...hosts: { idle(): Promise<void> }[]) {
  for (let i = 0; i < 60; i++) {
    await Promise.all(hosts.map((h) => h.idle()));
    await new Promise((r) => setImmediate(r));
  }
}
/** Stage 4: a started fight holding only ch1's character, its initiative not rolled. */
const fightWith = (id: string): Combat => ({ campaignId: CID, round: 1, turn: `pc:${id}`, groupMonsters: false, updatedAt: 1,
  combatants: [{ id: `pc:${id}`, kind: 'pc', name: id, characterId: id, initMod: 0, dex: 10, tie: 0.5, conSave: 0 }] });
const hosted = (): Campaign => ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01' } });

beforeEach(async () => {
  stopSession();
  await resetDb();
  app.campaign = undefined;
  app.campaigns = [];
  net = new Net();
  useTransport(net);
});
afterEach(() => { stopSession(); vi.useRealTimers(); rollViewer.value = 'dm'; rollVisibility.dm = false; });

/** The DM hosting CID on the real db with a guest device connected over the fake network (as A1, the first player). */
async function hostWithGuest(o: Partial<GuestDeps> = {}) {
  await db.campaigns.put(hosted());
  await refreshCampaigns();
  await setCampaign(CID);
  await follow(app.campaign);
  await settle();
  const p = new Device(), guest = new Guest(p.guestDeps(CODE, { name: 'Ann', ...o }));
  guest.connect(await net.dial(await peerIdFor(CODE)));
  await settle(guest);
  expect(guest.playerId).toBe('A1');
  return { p, guest };
}

describe('DM', () => {
  test('hosting resumes on startup with the campaign open; after Stop hosting it does not', async () => {
    await db.campaigns.put(hosted());
    await refreshCampaigns();
    await setCampaign(CID);
    await follow(app.campaign);
    await settle();
    expect(net.listens).toEqual([await peerIdFor(CODE)]);
    expect([session.role, session.status]).toEqual(['dm', 'hosting']);

    await stopHosting(CID);
    expect(session.status).toBe('off');
    expect(net.peers.size).toBe(0);
    await follow(app.campaign); // as on the next startup
    await settle();
    expect(net.listens.length).toBe(1);
    expect(await db.meta.get(hostOffKey(CID))).toBe(true);

    await hostCampaign(CID); // "Host again" keeps the code
    await settle();
    expect(net.listens).toEqual([await peerIdFor(CODE), await peerIdFor(CODE)]);
    expect(session.status).toBe('hosting');
  });

  test('Host this campaign creates a join code; a guest joins; DM saves and public rolls reach it, private rolls do not', async () => {
    await db.campaigns.put({ ...camp(CID), name: 'Ravenloft' });
    await refreshCampaigns();
    await setCampaign(CID);
    await hostCampaign(CID);
    const code = app.campaign!.sync!.code;
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/);
    const p = new Device(), guest = new Guest(p.guestDeps(code, { name: 'Ann' }));
    guest.connect(await net.dial(await peerIdFor(code)));
    await settle(guest);
    expect([guest.status, guest.playerId]).toEqual(['online', 'A1']);
    expect(session.online).toEqual({ A1: 1 });
    expect(app.campaign!.sync!.players).toEqual({ A1: { name: 'Ann' } });

    await db.characters.put({ ...char('ch1', CID), ownerId: 'A1' }); // a DM save goes out through onLocalChange
    await settle(guest);
    expect(p.char('ch1')?.name).toBe('ch1');
    const ch = (await db.characters.get('ch1'))!;
    await db.characters.put({ ...ch, state: { ...ch.state, hp: 7 } });
    await settle(guest);
    expect(p.char('ch1')!.state.hp).toBe(7);

    rollVisibility.dm = true; // R12: the DM shares on purpose
    roll('Table roll', '1d6');
    roll('Goblin attack', '1d20', { public: false });
    await settle(guest);
    expect(p.rolls.map((r) => r.e.label)).toEqual(['Table roll']);

    // the guest's own public roll is logged by the DM, labelled with who rolled it
    guest.sendRoll({ id: 'g1', label: 'Ann attacks', expr: '1d20', total: 12, detail: '1d20 (12)', at: 1, public: true });
    await settle(guest);
    expect(rollLog.find((r) => r.id === 'g1')?.from).toBe('A1 · ch1');
  });

  test('a new join code disconnects everyone as rejected, the old peer id stops answering, and the new code works', async () => {
    await db.campaigns.put(hosted());
    await refreshCampaigns();
    await setCampaign(CID);
    await follow(app.campaign);
    await settle();
    const p = new Device(), guest = new Guest(p.guestDeps(CODE));
    guest.connect(await net.dial(await peerIdFor(CODE)));
    await settle(guest);
    expect(guest.status).toBe('online');

    await rotateCode();
    await settle(guest);
    const code = app.campaign!.sync!.code;
    expect(code).not.toBe(CODE);
    expect([guest.status, session.status, session.online]).toEqual(['rejected', 'hosting', {}]);
    await expect(net.dial(await peerIdFor(CODE))).rejects.toThrow(/not online/); // the old link no longer reaches the host
    expect([...net.peers.keys()]).toEqual([await peerIdFor(code)]);

    const again = new Guest(new Device().guestDeps(code));
    again.connect(await net.dial(await peerIdFor(code)));
    await settle(again);
    expect([again.status, again.playerId]).toEqual(['online', 'A2']);
  });

  test('a signaling outage is retried on the backoff schedule', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    net.up = false;
    await db.campaigns.put(hosted());
    await refreshCampaigns();
    await setCampaign(CID);
    await follow(app.campaign);
    await settle();
    expect([session.status, session.reason]).toEqual(['retrying', 'server down']);
    await vi.advanceTimersByTimeAsync(1999);
    expect(net.registers).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(net.registers).toBe(2);
    net.up = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.registers).toBe(3);
    expect(session.status).toBe('hosting');
  });
});

describe('final review fixes (DM side)', () => {
  test('I1 (R12): a DM-view sheet attack with a hidden +1 weapon is not shared; shared on purpose, no real name or bonus leaves', async () => {
    const { p, guest } = await hostWithGuest();
    const flame = makeEntry({ kind: 'item', id: 'item:flame-tongue@HOMEBREW', name: 'Flame Tongue', source: 'HOMEBREW', text: [], type: 'weapon', magic: true,
      weapon: { category: 'martial', ranged: false, damage: '1d8', damageType: 'slashing', properties: [] }, bonuses: { attack: 1 } } as ItemDef,
    { view: { name: 'Longsword', hidden: ['bonuses'], revealed: [] } });
    const c = { ...char('t', CID), inventory: [{ ...flame, equipped: true }] };
    const dmA = computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'dm' }).attacks[0], plA = computeSheet(c, { settings: DEFAULT_SETTINGS, viewer: 'player' }).attacks[0];
    expect([dmA.name, plA.name, dmA.toHit - plA.toHit]).toEqual(['Flame Tongue', 'Longsword', 1]);
    rollViewer.value = 'dm';
    rollD20(`${dmA.name} attack`, dmA.toHit, { shareAs: 'Attack' }); // as Attacks.svelte rolls it
    await settle(guest);
    expect(p.rolls).toEqual([]); // DM rolls start private
    expect(rollLog[0].label).toBe('Flame Tongue attack'); // the DM's own log keeps the real label
    rollVisibility.dm = true;
    const mine = rollD20(`${dmA.name} attack`, dmA.toHit, { shareAs: 'Attack' })!;
    await settle(guest);
    expect(p.rolls.map((r) => [r.e.label, r.e.total, r.e.expr, r.e.detail])).toEqual([['Attack', mine.total, '', '']]);
    expect(JSON.stringify(p.rolls)).not.toMatch(/Flame|1d20\+/);
  });

  test(`I2: with Deleted characters full (${TRASH_CAP}), a player's delete is refused, the character comes back to them, and the trash is untouched`, async () => {
    const { p, guest } = await hostWithGuest();
    for (let i = 0; i < TRASH_CAP; i++) {
      await db.characters.put(char(`junk${i}`, CID));
      await db.characters.delete(`junk${i}`); // the DM's own deletes fill the trash
    }
    await db.characters.put({ ...char('mine', CID), ownerId: 'A1' });
    await settle(guest);
    expect(p.char('mine')).toBeTruthy();
    p.deleteChar('mine');
    guest.characterChanged('mine');
    await settle(guest);
    expect((await db.characters.get('mine'))?.name).toBe('mine');
    expect((await db.campaigns.get(CID))!.sync!.deleted ?? {}).not.toHaveProperty('mine');
    const t = await db.trash.list(CID);
    expect([t.length, t[0].character.id]).toEqual([TRASH_CAP, 'junk0']);
    expect(p.char('mine')?.name).toBe('mine'); // back on the player's device, its tombstone cleared
    expect(p.campaigns.get(CID)!.sync!.deleted ?? {}).not.toHaveProperty('mine');
  });

  test('I3 (R13): a DM-only character is not in the party sent to players; assigning it to A1 delivers it, and edits from A1 come back', async () => {
    const rosters: unknown[][] = [];
    const { p, guest } = await hostWithGuest({ onRoster: (r) => rosters.push(r) });
    await db.characters.put(char('npc', CID));
    await db.characters.put({ ...char('pc', CID), ownerId: 'A1' });
    await settle(guest);
    expect(p.char('npc')).toBeUndefined();
    expect((rosters.at(-1) as { id: string }[]).map((r) => r.id)).toEqual(['pc']);
    const npc = (await db.characters.get('npc'))!;
    await db.characters.put({ ...npc, ownerId: 'A1' }); // what the Player menu on the Characters page saves
    await settle(guest);
    expect(p.char('npc')?.ownerId).toBe('A1');
    expect((rosters.at(-1) as { id: string }[]).map((r) => r.id).sort()).toEqual(['npc', 'pc']);
    p.edit({ ...p.char('npc')!, name: 'Sidekick Sam' });
    guest.characterChanged('npc');
    await settle(guest);
    expect((await db.characters.get('npc'))?.name).toBe('Sidekick Sam');
  });

  test("stage 4: the DM's combat reaches the player, and the player's roll lands in it", async () => {
    const views: (TrackerView | undefined)[] = [];
    const { p, guest } = await hostWithGuest({ onTracker: (t) => { views.push(t); } });
    await db.characters.put({ ...char('ch1', CID), ownerId: 'A1' });
    await settle(guest);
    await vi.waitFor(() => expect(p.char('ch1')).toBeTruthy());
    await db.combat.update(CID, () => fightWith('ch1')); // reported as 'combat': the session sends the tracker
    await vi.waitFor(() => expect(views.at(-1)?.round).toBe(1));
    expect(views.at(-1)?.rows[0]).toMatchObject({ characterId: 'ch1' });
    expect(views.at(-1)?.rows[0].init).toBeUndefined();
    guest.sendInitiative('ch1', 14); // the host validates it; the session applies it through the lazily loaded combat store
    await vi.waitFor(async () => expect((await db.combat.get(CID))!.combatants[0].init).toBe(14));
    await vi.waitFor(() => expect(views.at(-1)?.rows[0].init).toBe(14));
  });

  test('M2: when hosting cannot start, the session stops and says why (Host again shows)', async () => {
    net.listen = () => { throw new Error('no WebRTC here'); };
    await db.campaigns.put(hosted());
    await refreshCampaigns();
    await hostCampaign(CID);
    expect([session.role, session.status, session.reason]).toEqual([undefined, 'off', 'Could not start hosting: no WebRTC here']);
  });
});

describe('player', () => {
  /** A DM device with a host engine listening on the fake network. */
  async function dmDevice(o: Partial<HostDeps> = {}) {
    const d = new Device();
    d.putCampaign(hosted());
    const host = new Host({ ...d.hostDeps(CID), ...o });
    net.listen(await peerIdFor(CODE), { link: (l) => host.accept(l), status: () => {} });
    return { d, host };
  }

  test('reconnects after 2 s, 5 s, 15 s, then every 30 s; online resets the schedule; a removed player stops retrying', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    expect([0, 1, 2, 3, 9].map(backoff)).toEqual([2000, 5000, 15000, 30000, 30000]);
    await db.campaigns.put({ ...camp(CID), sync: { role: 'player', code: CODE, node: 'pnode001', playerId: 'A1' } });
    await refreshCampaigns();
    await setCampaign(CID);
    await follow(app.campaign);
    await settle();
    expect([session.status, net.dials.length]).toEqual(['offline', 1]);
    const t0 = net.dials[0];
    for (const ms of [2000, 5000, 15000, 30000, 30000]) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      await settle();
      const n = net.dials.length;
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(net.dials.length).toBe(n + 1);
    }
    expect(net.dials.map((t) => t - t0)).toEqual([0, 2000, 7000, 22000, 52000, 82000]);

    const { d, host } = await dmDevice();
    d.updateSync(CID, (s) => ({ ...s!, players: { A1: { name: 'Ann' } } }));
    await vi.advanceTimersByTimeAsync(30000);
    await settle(host);
    expect(session.status).toBe('online');
    host.stop(); // 'host stopped': offline, and the schedule starts again at 2 s
    await settle(host);
    expect([session.status, session.reason]).toEqual(['offline', 'host stopped']);
    const n = net.dials.length;
    await vi.advanceTimersByTimeAsync(2000);
    await settle(host);
    expect(net.dials.length).toBe(n + 1);
    expect(session.status).toBe('online');

    await host.removePlayer('A1');
    await settle(host);
    expect([session.status, session.reason]).toEqual(['rejected', 'removed']);
    const m = net.dials.length;
    await vi.advanceTimersByTimeAsync(120_000);
    await settle(host);
    expect(net.dials.length).toBe(m);
  });

  test('joining with a link: the campaign is created and opened, and a new character there is the player\'s and reaches the DM', async () => {
    const { d, host } = await dmDevice();
    await join({ code: CODE, name: 'Ann' });
    await settle(host);
    expect([session.status, session.campaignId, session.welcomed, app.campaign?.id]).toEqual(['online', CID, true, CID]);
    expect((await db.campaigns.get(CID))!.sync).toMatchObject({ role: 'player', code: CODE, playerId: 'A1' });

    const stored = await db.characters.put(char('n1', CID));
    expect(stored.ownerId).toBe('A1');
    await settle(host);
    expect(d.char('n1')).toMatchObject({ ownerId: 'A1', campaignId: CID });
    expect(session.roster.map((r) => r.name)).toEqual(['n1']);

    // following the (now open) joined campaign keeps the same session
    const dials = net.dials.length;
    await follow(app.campaign);
    expect(net.dials.length).toBe(dials);
  });

  test('stage 4: the tracker reaches session.tracker, sendInitiative goes to the DM, and stopSession clears it', async () => {
    const calls: unknown[][] = [];
    const { d, host } = await dmDevice({ onInitiative: (...a) => { calls.push(a); } });
    await join({ code: CODE, name: 'Ann' });
    await settle(host);
    await db.characters.put(char('n1', CID)); // the player's own character (A1)
    await vi.waitFor(() => expect(d.char('n1')?.ownerId).toBe('A1')); // ponytail: waitFor, settle alone ran short under a loaded full run
    d.combat = fightWith('n1');
    host.trackerChanged();
    await vi.waitFor(() => expect(session.tracker?.rows.map((r) => r.characterId)).toEqual(['n1']));
    expect(session.tracker?.round).toBe(1);
    sendInitiative('n1', 14);
    sendInitiative('n1', 14.5); // never sent
    await vi.waitFor(() => expect(calls).toEqual([['n1', 14, 'A1']]));
    await settle(host);
    expect(calls.length).toBe(1);
    stopSession();
    expect(session.tracker).toBeUndefined();
  });

  test('M9: a link join that would take over a campaign joined as another ID asks first; No keeps it', async () => {
    const { d, host } = await dmDevice();
    d.updateSync(CID, (s) => ({ ...s!, players: { A1: {} } }));
    await db.campaigns.put({ ...camp(CID), name: 'Old', sync: { role: 'player', code: CODE, node: 'pnode001', playerId: 'A1' } });
    await join({ code: CODE }); // as a new player: the host makes A2
    await settle(host);
    expect(session.confirm?.text).toMatch(/already plays “Old” as A1/);
    session.confirm!.answer(false);
    await settle(host);
    expect([session.status, (await db.campaigns.get(CID))!.sync!.playerId]).toEqual(['rejected', 'A1']);
  });
});
