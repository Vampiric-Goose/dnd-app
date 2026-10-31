// Task 5 extras from the Group A/B reviews: M1, M9, B1, B4, the stalled pack stream, the PeerJS framing, and the campaign/backup
// housekeeping of shared packs and the trash.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { exportBackup, readBackup, applyBackup } from '../../src/lib/backup.ts';
import { db, hostOffKey, onLocalChange, resetDb, TRASH_CAP } from '../../src/lib/db.ts';
import { Guest } from '../../src/lib/sync/guest.ts';
import { Host, MAX_CHARACTERS, STALL_TIMEOUT } from '../../src/lib/sync/host.ts';
import { FRAME, frames, memoryPair, unframer } from '../../src/lib/sync/link.ts';
import { hlcNow } from '../../src/lib/sync/hlc.ts';
import { latestClock, replay, stamp } from '../../src/lib/sync/merge.ts';
import { MAX_MESSAGE } from '../../src/lib/sync/protocol.ts';
import type { Campaign, Character, Entity, Pack } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN', CID = 'c1';
const hosted = (players: NonNullable<Campaign['sync']>['players'] = {}): Campaign =>
  ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players } });

describe('M1: a character the DM reassigned or moved out', () => {
  test('the old owner gets notYours (no strike) and takes it out of the campaign; a deletion of it is forgotten', async () => {
    const d = new Device();
    d.putCampaign(hosted({ A1: {}, A2: {} }));
    d.edit({ ...char('x', CID), ownerId: 'A1' });
    d.edit({ ...char('y', CID), ownerId: 'A1' });
    const host = new Host(d.hostDeps(CID));
    const p = new Device(), guest = new Guest(p.guestDeps(CODE, { playerId: 'A1' }));
    const [h] = connect(host, guest);
    await settle(host, guest);
    h.close();
    await settle(host, guest);
    // offline: the DM gives x to A2 and moves y out of the campaign; the player edits x and deletes y
    d.edit({ ...d.char('x')!, ownerId: 'A2' });
    d.edit({ ...d.char('y')!, campaignId: undefined });
    p.edit({ ...p.char('x')!, name: 'Mine' });
    p.deleteChar('y');
    const up: string[] = [], down: string[] = [];
    const [h2] = connect(host, guest, down, up);
    await settle(host, guest);
    expect(down.map((m) => JSON.parse(m)).filter((m) => m.t === 'notYours').map((m) => m.id).sort()).toEqual(['x', 'y']);
    expect(d.errors).toEqual([]); // no violation counted
    expect([d.char('x')!.name, d.char('x')!.ownerId]).toEqual(['x', 'A2']); // the DM's copy is untouched
    expect([p.char('x')!.name, p.char('x')!.campaignId]).toEqual(['Mine', undefined]); // kept on the device, out of the campaign
    expect(p.campaigns.get(CID)!.sync!.deleted ?? {}).toEqual({});
    // a reconnect sends neither again
    h2.close();
    await settle(host, guest);
    const again: string[] = [];
    connect(host, guest, again);
    await settle(host, guest);
    expect(again.map((m) => JSON.parse(m).t)).not.toContain('notYours');
  });
});

describe('M9: a welcome for another campaign', () => {
  test('a rejoin expecting its campaign refuses a welcome for a different one', async () => {
    const d = new Device();
    d.putCampaign(hosted({ A1: {} }));
    const host = new Host(d.hostDeps(CID));
    const p = new Device();
    const guest = new Guest(p.guestDeps(CODE, { playerId: 'A1', campaignId: 'other' }));
    connect(host, guest);
    await settle(host, guest);
    expect(guest.status).toBe('rejected');
    expect(p.campaigns.size).toBe(0);
  });
});

describe('B1: caps', () => {
  test(`a player may sync at most ${MAX_CHARACTERS} live characters; one more is a violation and is not stored`, async () => {
    const d = new Device();
    d.putCampaign(hosted({ A1: {} }));
    for (let i = 0; i < MAX_CHARACTERS; i++) d.edit({ ...char(`c${i}`, CID), ownerId: 'A1' });
    const host = new Host(d.hostDeps(CID));
    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    evil.deliver({ t: 'chars', characters: [{ ...char('extra', CID), ownerId: 'A1' }] });
    await settle(host);
    expect(d.char('extra')).toBeUndefined();
    expect(String(d.errors.at(-1))).toMatch(/more than 30 characters/);
    // an existing one still syncs
    const c0 = d.char('c0')!;
    evil.deliver({ t: 'chars', characters: [stamp(c0, { ...c0, name: 'Renamed' }, hlcNow('pnode001', latestClock(c0)))] });
    await settle(host);
    expect(d.char('c0')!.name).toBe('Renamed');
  });

  test(`the trash keeps the newest ${TRASH_CAP} per campaign, and Empty removes them all`, async () => {
    await resetDb();
    await db.campaigns.put(hosted());
    for (let i = 0; i < TRASH_CAP + 5; i++) {
      await db.characters.put(char(`t${i}`, CID));
      await db.characters.delete(`t${i}`, { by: 'A1' });
    }
    const t = await db.trash.list(CID);
    expect(t.length).toBe(TRASH_CAP);
    expect(t[0].character.id).toBe('t5'); // the oldest five went
    await db.trash.empty(CID);
    expect(await db.trash.list(CID)).toEqual([]);
  });
});

describe('B4: a sheet edit made while a save is in flight', () => {
  beforeEach(resetDb);

  test('replay keeps a remote value the in-flight save preserved, and the edit made meanwhile', async () => {
    await db.campaigns.put(hosted());
    const loaded = await db.characters.put(char('s', CID)); // the sheet loads this
    const cur = { ...loaded, state: { ...loaded.state, hp: 9 } }; // the sheet's edit being saved
    // a remote merge lands first (the player's notes)
    const remote = { ...loaded, details: { ...loaded.details, notes: 'from the player' } };
    await db.characters.putSynced({ ...remote, sync: { clock: { ...loaded.sync!.clock, 'details.notes': hlcNow('remote01', latestClock(loaded)) }, gone: {} } });
    const stored = await db.characters.put(cur); // the in-flight save: rebased, it keeps the remote notes
    expect(stored.details.notes).toBe('from the player');
    const meanwhile = { ...cur, details: { ...cur.details, alignment: 'Lawful good' } }; // typed while it saved; its notes are the stale ''
    const next = replay(stored, cur, meanwhile);
    const after = await db.characters.put(next);
    expect([after.state.hp, after.details.notes, after.details.alignment]).toEqual([9, 'from the player', 'Lawful good']);
    // what the old code did ({...meanwhile, sync: stored.sync}) loses the remote notes
    const old = await db.characters.put({ ...meanwhile, details: { ...meanwhile.details, notes: '' }, sync: after.sync });
    expect(old.details.notes).toBe('');
  });
});

describe('a stalled pack stream', () => {
  afterEach(() => { vi.useRealTimers(); });

  test(`no drain for ${STALL_TIMEOUT / 1000} s drops the stream and closes the link`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const spell = (i: number): Entity => ({ kind: 'spell', id: `spell:s${i}@MYBREW`, name: `S${i}`, source: 'MYBREW', text: [{ p: 'x'.repeat(2000) }], level: 1, school: 'evocation',
      castingTime: '1 action', range: 'Self', components: { v: true }, duration: 'Instantaneous', concentration: false, ritual: false, classes: ['wizard'] }) as Entity;
    const big: Pack = { id: 'pack:MYBREW', name: 'Brew', source: 'MYBREW', homebrew: true, importedAt: 1, hash: 'h', entities: Array.from({ length: 50 }, (_, i) => spell(i)), patches: [] };
    const d = new Device();
    d.packs.set(big.id, big);
    d.putCampaign({ ...hosted({ A1: {} }), enabledPacks: [big.id] });
    const host = new Host(d.hostDeps(CID));
    const [h, l] = memoryPair();
    let closed = false, chunks = 0;
    const send = h.send.bind(h);
    // the first chunk goes out, then the buffer never drains
    Object.assign(h, { bufferedAmount: () => (chunks ? 10 * 1024 * 1024 : 0), onDrain: () => {}, send: (m: { t: string }) => { if (m.t === 'packChunk') chunks++; send(m); } });
    h.onClose(() => { closed = true; });
    host.accept(h);
    const guest = new Guest(new Device().guestDeps(CODE, { playerId: 'A1' }));
    guest.connect(l);
    for (let i = 0; i < 500 && !chunks; i++) await new Promise((r) => setImmediate(r)); // not host.idle(): it waits for the stream
    expect([chunks, closed]).toEqual([1, false]);
    await vi.advanceTimersByTimeAsync(STALL_TIMEOUT);
    await settle(guest);
    expect(closed).toBe(true);
  });
});

describe('PeerJS framing', () => {
  test('a message travels as frames of at most FRAME characters, a surrogate pair split across frames survives the JSON channel', () => {
    const text = 'a'.repeat(FRAME - 3) + '😀'.repeat(3000); // the first cut falls inside an emoji
    const json = JSON.stringify({ t: 'chars', text });
    const fs = frames(json);
    expect(fs.length).toBeGreaterThan(1);
    expect(fs.every((f) => f.length <= FRAME + 1 && new TextEncoder().encode(JSON.stringify(f)).length < 16_300)).toBe(true);
    const got: unknown[] = [];
    const read = unframer(MAX_MESSAGE, (m) => got.push(m), (why) => { throw new Error(why); });
    for (const f of fs) read(JSON.parse(JSON.stringify(f))); // what PeerJS's JSON serialization does to each frame
    expect(got).toEqual([{ t: 'chars', text }]);
  });

  test('a message over MAX_MESSAGE is refused before it is parsed; a non-frame or bad JSON too', () => {
    const bad: string[] = [];
    const parse = vi.spyOn(JSON, 'parse');
    const read = unframer(MAX_MESSAGE, () => { throw new Error('delivered'); }, (why) => bad.push(why));
    for (const f of frames(JSON.stringify({ t: 'x', pad: 'y'.repeat(MAX_MESSAGE) }))) read(f);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    read({ t: 'hello' });
    read('=not json');
    expect(bad).toEqual(['message too large', 'not a frame', 'not JSON']);
  });
});

describe('housekeeping', () => {
  beforeEach(resetDb);

  test('deleting a campaign removes the packs its DM shared, its trash and its hosting switch, but not the player\'s own packs', async () => {
    const p = (id: string, sharedBy?: string): Pack => ({ id, name: id, source: 'MYBREW', homebrew: true, importedAt: 1, hash: id, entities: [], patches: [], ...(sharedBy && { sharedBy }) });
    await db.packs.put(p('pack:shared', CID));
    await db.packs.put(p('pack:other', 'c2'));
    await db.packs.put(p('pack:own'));
    await db.campaigns.put(hosted());
    await db.characters.put(char('k', CID));
    await db.characters.delete('k');
    await db.meta.set(hostOffKey(CID), true);
    await db.campaigns.delete(CID);
    expect((await db.packs.listMeta()).map((m) => m.id).sort()).toEqual(['pack:other', 'pack:own']);
    expect(await db.trash.list(CID)).toEqual([]);
    expect(await db.meta.get(hostOffKey(CID))).toBeUndefined();
  });

  test('the trash is in backups and comes back with them', async () => {
    await db.campaigns.put(hosted());
    await db.characters.put(char('k', CID));
    await db.characters.delete('k', { by: 'A1' });
    const file = await exportBackup({ includePacks: false });
    await resetDb();
    await applyBackup(await readBackup(file));
    expect((await db.trash.list(CID)).map((e) => [e.character.id, e.by])).toEqual([['k', 'A1']]);
    await db.trash.restore(CID, 'k');
    expect((await db.characters.get('k'))?.name).toBe('k');
  });

  test('onLocalChange reports user writes, never the sync engine\'s own', async () => {
    const seen: string[] = [];
    onLocalChange((kind, id) => seen.push(`${kind}:${id}`));
    try {
      await db.campaigns.put(hosted());
      const c: Character = await db.characters.put(char('a', CID));
      await db.characters.putSynced({ ...c, name: 'merged' });
      await db.characters.delete('a', { by: 'A1', network: true });
      await db.trash.restore(CID, 'a');
      await db.characters.delete('a');
      expect(seen).toEqual([`campaign:${CID}`, 'character:a', 'character:a', 'character:a']);
    } finally {
      onLocalChange(undefined);
    }
  });
});
