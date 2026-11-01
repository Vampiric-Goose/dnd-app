import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { deletedInCampaign, keepBoth, replacement } from '../../src/lib/backup.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import type { RollEntry } from '../../src/lib/rolls.svelte.ts';
import { newJoinCode, nextPlayerId, peerIdFor } from '../../src/lib/sync/code.ts';
import { Guest } from '../../src/lib/sync/guest.ts';
import { HELLO_TIMEOUT, Host } from '../../src/lib/sync/host.ts';
import { hlcNow } from '../../src/lib/sync/hlc.ts';
import { canon, latestClock, stamp } from '../../src/lib/sync/merge.ts';
import { characterForPlayer } from '../../src/lib/sync/project.ts';
import { MAX_MESSAGE } from '../../src/lib/sync/protocol.ts';
import type { Campaign, Character, ItemDef } from '../../src/lib/types.ts';
import { fixtureIndex } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';
const hosted = (players: NonNullable<Campaign['sync']>['players'] = {}): Campaign =>
  ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players } });

/** A DM device hosting CID, with a host engine on it. */
function dm(players?: NonNullable<Campaign['sync']>['players']) {
  const d = new Device();
  d.putCampaign(hosted(players));
  return { d, host: new Host(d.hostDeps(CID)) };
}
const player = (o: { playerId?: string; name?: string } = {}) => { const d = new Device(); return { d, guest: new Guest(d.guestDeps(CODE, o)) }; };
const same = (a?: Character, b?: Character) => canon({ ...a, updatedAt: 0 }) === canon({ ...b, updatedAt: 0 });
const roll = (o: Partial<RollEntry> = {}): RollEntry => ({ id: 'r' + Math.random(), label: 'Attack', expr: '1d20+5', total: 17, detail: '1d20 (12) + 5', at: 1, public: true, ...o });

describe('code', () => {
  test('join codes, peer ids and player ids', async () => {
    for (let i = 0; i < 50; i++) expect(newJoinCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/);
    expect(new Set(Array.from({ length: 50 }, newJoinCode)).size).toBe(50);
    const id = await peerIdFor(CODE);
    expect(id).toMatch(/^dndapp-[0-9a-f]{32}$/);
    expect(await peerIdFor(CODE)).toBe(id);
    expect(await peerIdFor('ABCDEFGHJKMP')).not.toBe(id);
    expect(nextPlayerId([])).toBe('A1');
    expect(nextPlayerId(['A1', 'A2'])).toBe('A3');
    expect(nextPlayerId(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'])).toBe('B1');
    expect(nextPlayerId(['A2'])).toBe('A1');
    const all = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].flatMap((l) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => l + n));
    expect(() => nextPlayerId(all)).toThrow(/no free player IDs/);
  });
});

describe('join', () => {
  test('a new player gets A1 and a second one A2; both get a local player copy of the campaign', async () => {
    const { d, host } = dm();
    const a = player({ name: 'Ann' }), b = player({ name: 'Bo' });
    connect(host, a.guest);
    await settle(host, a.guest);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    expect([a.guest.status, a.guest.playerId, b.guest.status, b.guest.playerId]).toEqual(['online', 'A1', 'online', 'A2']);
    expect(d.campaigns.get(CID)!.sync!.players).toEqual({ A1: { name: 'Ann' }, A2: { name: 'Bo' } });
    expect([...host.players]).toEqual([['A1', { links: 1, name: 'Ann' }], ['A2', { links: 1, name: 'Bo' }]]);
    const local = a.d.campaigns.get(CID)!;
    expect(local.name).toBe('Ravenloft');
    expect(local.loot).toEqual([]);
    expect(local.sync).toMatchObject({ role: 'player', code: CODE, playerId: 'A1' });
    expect(local.sync!.node).toMatch(/^[0-9a-f]{8}$/);
  });

  test('rejoining as A1 from a second device: both devices get character updates', async () => {
    const { d, host } = dm({ A1: { name: 'Ann' } });
    d.edit({ ...char('ch1', CID), ownerId: 'A1' });
    const one = player({ playerId: 'A1' }), two = player({ playerId: 'A1' });
    connect(host, one.guest);
    connect(host, two.guest);
    await settle(host, one.guest, two.guest);
    expect(host.players.get('A1')!.links).toBe(2);
    expect(one.d.char('ch1')).toBeTruthy();
    d.edit({ ...d.char('ch1')!, state: { ...d.char('ch1')!.state, hp: 9 } });
    host.characterChanged('ch1');
    await settle(host, one.guest, two.guest);
    expect([one.d.char('ch1')!.state.hp, two.d.char('ch1')!.state.hp]).toEqual([9, 9]);
    // and an edit on one device reaches the other through the DM
    one.d.edit({ ...one.d.char('ch1')!, name: 'Renamed' });
    one.guest.characterChanged('ch1');
    await settle(host, one.guest, two.guest);
    expect([d.char('ch1')!.name, two.d.char('ch1')!.name]).toEqual(['Renamed', 'Renamed']);
  });

  test('offline edits on the player and the DM merge on connect, both ways, and then nothing more is sent (R2)', async () => {
    const { d, host } = dm({ A1: {} });
    d.edit({ ...char('ch1', CID), ownerId: 'A1' });
    const a = player({ playerId: 'A1' });
    const [h] = connect(host, a.guest);
    await settle(host, a.guest);
    h.close();
    await settle(host, a.guest);
    expect(a.guest.status).toBe('offline');

    const mine = a.d.char('ch1')!;
    a.d.edit({ ...mine, state: { ...mine.state, hp: 4 }, currency: { ...mine.currency, gp: 12 } });
    d.wall = () => Date.now() + 5000; // the DM's edit is the later one
    const theirs = d.char('ch1')!;
    d.edit({ ...theirs, details: { ...theirs.details, notes: 'DM note' }, currency: { ...theirs.currency, gp: 30 } }); // gp: the later edit wins

    const down: string[] = [], up: string[] = [];
    connect(host, a.guest, down, up);
    await settle(host, a.guest);
    const p = a.d.char('ch1')!, m = d.char('ch1')!;
    expect([m.state.hp, m.details.notes, m.currency.gp]).toEqual([4, 'DM note', 30]);
    expect(same(p, m)).toBe(true);
    const sent = down.length + up.length;
    await settle(host, a.guest);
    expect(down.length + up.length).toBe(sent);
    expect(sent).toBeLessThan(10);
  });

  test('a public roll is shared with the party and logged by the DM; a private one never leaves', async () => {
    const { d, host } = dm();
    const a = player(), b = player();
    const up: string[] = [];
    connect(host, a.guest, [], up);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    a.guest.sendRoll(roll({ label: 'Ann attacks' }));
    a.guest.sendRoll(roll({ label: 'Ann secret', public: false }));
    host.broadcastRoll(roll({ label: 'DM public' }));
    host.broadcastRoll(roll({ label: 'DM secret', public: false }));
    await settle(host, a.guest, b.guest);
    expect(d.rolls.map((r) => [r.e.label, r.from])).toEqual([['Ann attacks', 'A1']]);
    expect(b.d.rolls.map((r) => [r.e.label, r.from]).sort()).toEqual([['Ann attacks', 'A1'], ['DM public', undefined]]);
    expect(a.d.rolls.map((r) => r.e.label)).toEqual(['DM public']);
    expect(up.join()).not.toContain('Ann secret');
  });

  test('deletions stick: a player deleting offline, and the DM deleting', async () => {
    const { d, host } = dm({ A1: {} });
    d.edit({ ...char('x', CID), ownerId: 'A1' });
    d.edit({ ...char('y', CID), ownerId: 'A1' });
    const a = player({ playerId: 'A1' }), a2 = player({ playerId: 'A1' });
    const [h] = connect(host, a.guest);
    connect(host, a2.guest);
    await settle(host, a.guest, a2.guest);
    h.close();
    await settle(host, a.guest);
    a.d.deleteChar('x'); // offline
    connect(host, a.guest);
    await settle(host, a.guest, a2.guest);
    expect([d.char('x'), a2.d.char('x')]).toEqual([undefined, undefined]);
    expect(Object.keys(d.campaigns.get(CID)!.sync!.deleted!)).toEqual(['x']);

    d.deleteChar('y');
    host.characterChanged('y');
    await settle(host, a.guest, a2.guest);
    expect([a.d.char('y'), a2.d.char('y')]).toEqual([undefined, undefined]);
    // a device that still has it sends it again: the DM answers with the deletion and does not bring it back
    const b = player({ playerId: 'A1' });
    b.d.putCampaign({ ...camp(CID), sync: { role: 'player', code: CODE, node: 'bbbbbbbb', playerId: 'A1' } });
    b.d.edit({ ...char('y', CID), ownerId: 'A1' });
    connect(host, b.guest);
    await settle(host, b.guest);
    expect([d.char('y'), b.d.char('y')]).toEqual([undefined, undefined]);
  });
});

describe('Review Focus 2: crafted guest messages', () => {
  /** A DM with two honest players online (A1 with ch1, A2 with ch2), plus an attacker link admitted as A1. */
  async function session() {
    const { d, host } = dm();
    const a = player(), b = player();
    connect(host, a.guest);
    await settle(host, a.guest);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    a.d.edit({ ...char('ch1', CID), ownerId: 'A1' });
    a.guest.characterChanged('ch1');
    b.d.edit({ ...char('ch2', CID), ownerId: 'A2' });
    b.guest.characterChanged('ch2');
    await settle(host, a.guest, b.guest);
    expect(d.char('ch1') && d.char('ch2')).toBeTruthy();
    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    expect((evil.got[0] as { t: string }).t).toBe('welcome');
    return { d, host, a, b, evil };
  }

  /** The others keep working: B's edit still reaches the DM, and the DM's reaches A. */
  async function stillServing(s: Awaited<ReturnType<typeof session>>) {
    const c2 = s.b.d.char('ch2')!;
    s.b.d.edit({ ...c2, state: { ...c2.state, hp: c2.state.hp + 1 } });
    s.b.guest.characterChanged('ch2');
    const c1 = s.d.char('ch1')!;
    s.d.edit({ ...c1, details: { ...c1.details, notes: c1.details.notes + '!' } });
    s.host.characterChanged('ch1');
    await settle(s.host, s.a.guest, s.b.guest);
    expect(s.d.char('ch2')!.state.hp).toBe(c2.state.hp + 1);
    expect(s.a.d.char('ch1')!.details.notes).toBe(c1.details.notes + '!');
  }

  test('a wrong code is rejected and the link closed', async () => {
    const s = await session();
    const x = rawLink();
    s.host.accept(x.link);
    x.deliver({ t: 'hello', code: 'WRONGCODE234' });
    await settle(s.host);
    expect(x.got).toEqual([{ t: 'rejected', reason: 'wrong code' }]);
    expect(x.closed()).toBe(true);
    await stillServing(s);
  });

  const crafted: [string, (s: Awaited<ReturnType<typeof session>>) => unknown][] = [
    ['A2\'s character sent from A1', (s) => ({ t: 'chars', characters: [{ ...s.d.char('ch2')!, name: 'Stolen' }] })],
    ['A2\'s character id re-owned as A1', (s) => ({ t: 'chars', characters: [{ ...s.d.char('ch2')!, ownerId: 'A1', name: 'Stolen' }] })],
    ['a character of another campaign', (s) => ({ t: 'chars', characters: [{ ...s.d.char('ch1')!, campaignId: 'other' }] })],
    ['a __proto__ object literal', () => ({ t: 'chars', characters: [{ __proto__: { x: 1 } }] })],
    ['a __proto__ key from JSON', (s) => ({ t: 'chars', characters: [JSON.parse(JSON.stringify(s.d.char('ch1')!).replace('"name":', '"__proto__":{"polluted":1},"name":'))] })],
    ['an embedded @XPHB class, with the newest build clock', (s) => { const c = s.d.char('ch1')!; return { t: 'chars', characters: [stamp(c, { ...c, build: { ...c.build, abilityMethod: 'manual' }, embedded: { 'class:fighter@XPHB': { kind: 'class', id: 'class:fighter@XPHB', name: 'Fighter', source: 'XPHB', text: [] } } } as unknown as Character, hlcNow('evil0001', latestClock(c)))] }; }],
    ['an @XPHB class in the build', (s) => { const c = s.d.char('ch1')!; return { t: 'chars', characters: [{ ...c, build: { ...c.build, levels: [{ classId: 'class:fighter@XPHB' }] } }] }; }],
    ['a 2024 item in the inventory', (s) => ({ t: 'chars', characters: [{ ...s.d.char('ch1')!, inventory: [makeEntry({ kind: 'item', id: 'item:x@XDMG', name: 'X', source: 'XDMG', text: [], type: 'gear', magic: false })] }] })],
    ['malformed: characters not a list', () => ({ t: 'chars', characters: 'nope' })],
    ['malformed: a character without build', (s) => { const { build: _b, ...c } = s.d.char('ch1')!; return { t: 'chars', characters: [c] }; }],
    ['malformed: unknown type', () => ({ t: 'pwn' })],
    ['malformed: not an object', () => 42],
    ['malformed: a second hello', () => ({ t: 'hello', code: CODE })],
    ['malformed: a roll without total', () => ({ t: 'roll', entry: { id: 'r', label: 'x', expr: '1', detail: '', at: 1, public: true } })],
    ['deleting A2\'s character', () => ({ t: 'deleteChar', id: 'ch2', at: '1' })],
  ];

  for (const [name, make] of crafted) {
    test(`refused, nothing stored: ${name}`, async () => {
      const s = await session();
      const before = s.d.snapshot();
      s.evil.deliver(make(s));
      await settle(s.host);
      expect(s.d.snapshot()).toBe(before);
      // M1: a stored character that is not theirs gets `notYours` (and no strike); everything else gets no reply at all
      expect(s.evil.got.slice(1).map((m) => (m as { t: string }).t).filter((t) => t !== 'chars' && t !== 'tracker')).toEqual(name.includes('re-owned') ? ['notYours'] : []);
      expect(s.evil.closed()).toBe(false); // one strike
      await stillServing(s);
    });
  }

  test('a message over 256 KB is dropped and the link closed at once', async () => {
    const s = await session();
    const before = s.d.snapshot();
    const c = s.d.char('ch1')!;
    s.evil.deliver({ t: 'chars', characters: [{ ...c, details: { ...c.details, notes: 'x'.repeat(300 * 1024) } }] });
    expect(JSON.stringify(c).length + 300 * 1024).toBeGreaterThan(MAX_MESSAGE);
    await settle(s.host);
    expect(s.evil.closed()).toBe(true);
    expect(s.d.snapshot()).toBe(before);
    await stillServing(s);
  });

  test('the third refused message closes the link', async () => {
    const s = await session();
    for (let i = 0; i < 3; i++) s.evil.deliver({ t: 'pwn' });
    await settle(s.host);
    expect(s.evil.closed()).toBe(true);
    expect(s.host.players.get('A1')!.links).toBe(1);
    await stillServing(s);
  });

  test('before hello, nothing but hello is read', async () => {
    const s = await session();
    const x = rawLink();
    s.host.accept(x.link);
    const before = s.d.snapshot();
    x.deliver({ t: 'chars', characters: [{ ...s.d.char('ch1')!, name: 'No hello' }] });
    x.deliver({ t: 'hello', code: CODE, playerId: 'B7' }); // never allocated
    await settle(s.host);
    expect(s.d.snapshot()).toBe(before);
    expect(x.got).toEqual([{ t: 'rejected', reason: 'unknown player' }]);
  });
});

describe('Review Focus 3: nothing hidden is sent', () => {
  test('a hidden item, a DM monster and homebrew item, Unassigned loot, private rolls and other players\' sheets stay home', async () => {
    const venom: ItemDef = { kind: 'item', id: 'item:potion-of-venom@DMG', name: 'Potion of Venom', source: 'DMG', type: 'potion', magic: true, rarity: 'uncommon',
      text: [{ p: 'Looks like healing. {{redact:r1}}It is deadly venom.{{/redact}}' }] };
    const blade: ItemDef = { kind: 'item', id: 'item:homebrew-1@HOMEBREW', name: 'Unassigned Moonblade', source: 'Homebrew', type: 'weapon', magic: true, text: [{ p: 'Sings at night.' }] };
    const { d, host } = dm({ A1: {}, A2: {} });
    d.putCampaign({ ...d.campaigns.get(CID)!, loot: [makeEntry(blade)] });
    d.other.push({ kind: 'monster', id: 'monster:homebrew-1@HOMEBREW', name: 'Gloomwyrm Matriarch', campaignId: CID });
    d.other.push({ ...blade, id: 'item:homebrew-2@HOMEBREW', name: 'Crown of the Drowned', campaignId: CID });
    const potion = makeEntry(venom, { sourceId: venom.id, view: { name: 'Zinc vial', hidden: ['rarity'], revealed: [] } });
    d.edit({ ...char('ch1', CID), ownerId: 'A1', inventory: [potion] });
    d.edit({ ...char('ch2', CID), ownerId: 'A2', details: { ...char('x').details, backstory: 'Secretly a doppelganger' } });

    const down: string[] = [], up: string[] = [];
    const a = player({ playerId: 'A1' });
    connect(host, a.guest, down, up);
    await settle(host, a.guest);
    host.broadcastRoll(roll({ label: 'Gloomwyrm bite (private)', public: false }));
    a.guest.sendRoll(roll({ label: 'Hidden check', public: false }));
    // the player changes the quantity; the DM keeps the real item (R8), the player still sees only the cover
    const mine = a.d.char('ch1')!;
    expect(mine.inventory[0].item.name).toBe('Zinc vial');
    a.d.edit({ ...mine, inventory: [{ ...mine.inventory[0], quantity: 2 }] });
    a.guest.characterChanged('ch1');
    await settle(host, a.guest);
    host.characterChanged('ch1');
    await settle(host, a.guest);

    const all = down.join('\n');
    expect(down.length).toBeGreaterThan(3);
    for (const secret of ['Venom', 'venom', 'deadly', 'uncommon', 'potion-of-venom', 'Moonblade', 'Gloomwyrm', 'Crown of the Drowned', 'doppelganger', CODE, '"loot"', '"players"']) {
      expect(all).not.toContain(secret);
    }
    expect(up.join('\n')).not.toContain('Hidden check');
    const real = d.char('ch1')!.inventory[0];
    expect([real.item.name, real.quantity, real.sourceId, real.view?.name]).toEqual(['Potion of Venom', 2, venom.id, 'Zinc vial']);
    expect(a.d.char('ch1')!.inventory[0].quantity).toBe(2);
    expect(same(a.d.char('ch1')!, { ...d.char('ch1')!, inventory: a.d.char('ch1')!.inventory })).toBe(true);
  });

  test('a field the DM hides again while the player edits the same entry later, offline: the player gets the view of the DM, and the copies settle', async () => {
    const ring: ItemDef = { kind: 'item', id: 'item:ring@DMG', name: 'Ring of Truth', source: 'DMG', type: 'ring', magic: true, rarity: 'rare', text: [] };
    const { d, host } = dm({ A1: {} });
    d.edit({ ...char('ch1', CID), ownerId: 'A1', inventory: [makeEntry(ring, { view: { hidden: [], revealed: [] } })] });
    const a = { d: new Device(() => Date.now() + 5000), guest: undefined as unknown as Guest }; // the player's edit is the later one
    a.guest = new Guest(a.d.guestDeps(CODE, { playerId: 'A1' }));
    const [h] = connect(host, a.guest);
    await settle(host, a.guest);
    h.close();
    await settle(host, a.guest);
    const dmc = d.char('ch1')!;
    d.edit({ ...dmc, inventory: [{ ...dmc.inventory[0], view: { hidden: ['rarity'], revealed: [] } }] }); // DM hides the rarity (it projects smaller, so it would lose a tie)
    const pc = a.d.char('ch1')!;
    a.d.edit({ ...pc, inventory: [{ ...pc.inventory[0], equipped: true }] }); // player equips it, later
    const down: string[] = [], up: string[] = [];
    connect(host, a.guest, down, up);
    await settle(host, a.guest);
    const e = a.d.char('ch1')!.inventory[0];
    expect([e.item.rarity, e.equipped]).toEqual([undefined, true]);
    expect(d.char('ch1')!.inventory[0].view).toEqual({ hidden: ['rarity'], revealed: [] });
    expect(same(characterForPlayer(d.char('ch1')!), a.d.char('ch1'))).toBe(true);
    const n = down.length + up.length;
    await settle(host, a.guest);
    expect(down.length + up.length).toBe(n);
  });
});

describe('Review Focus 4 (engine): rotating the code, removing a player', () => {
  test('rotateCode closes every link with bye, and a hello with the old code is rejected', async () => {
    const { d, host } = dm();
    const a = player(), b = player();
    const down: string[] = [];
    connect(host, a.guest, down);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    const code = await host.rotateCode();
    await settle(host, a.guest, b.guest);
    expect(code).not.toBe(CODE);
    expect(d.campaigns.get(CID)!.sync!.code).toBe(code);
    expect(JSON.parse(down.at(-1)!)).toEqual({ t: 'bye', reason: 'code changed' });
    expect([a.guest.status, b.guest.status, host.players.size]).toEqual(['rejected', 'rejected', 0]);
    const again = player({ playerId: 'A1' });
    connect(host, again.guest);
    await settle(host, again.guest);
    expect(again.guest.status).toBe('rejected');
    const fresh = new Guest(a.d.guestDeps(code, { playerId: 'A1' }));
    connect(host, fresh);
    await settle(host, fresh);
    expect(fresh.status).toBe('online');
  });

  test('removePlayer closes that player\'s links, rejects its next hello, and never reuses the ID', async () => {
    const { d, host } = dm();
    const a = player(), a2 = player(), b = player();
    connect(host, a.guest);
    await settle(host, a.guest);
    connect(host, a2.guest = new Guest(a2.d.guestDeps(CODE, { playerId: 'A1' })));
    connect(host, b.guest);
    await settle(host, a.guest, a2.guest, b.guest);
    host.removePlayer('A1');
    await settle(host, a.guest, a2.guest, b.guest);
    expect([a.guest.status, a2.guest.status, b.guest.status]).toEqual(['rejected', 'rejected', 'online']);
    expect(d.campaigns.get(CID)!.sync!.players!.A1.removed).toBe(true);
    const back = player({ playerId: 'A1' });
    const down: string[] = [];
    connect(host, back.guest, down);
    await settle(host, back.guest);
    expect(JSON.parse(down[0])).toEqual({ t: 'rejected', reason: 'removed' });
    const next = player();
    connect(host, next.guest);
    await settle(host, next.guest);
    expect(next.guest.playerId).toBe('A3');
  });
});

/** A host on the real db. `beforeSave` runs once, between the host's load of a character and its save (I2). */
function dbHost(o: { beforeSave?: () => Promise<void> } = {}) {
  let hook = o.beforeSave;
  return new Host({
    loadCampaign: () => db.campaigns.get(CID),
    updateSync: (fn) => db.campaigns.updateSync(CID, (s) => fn(s!)),
    loadCharacters: () => db.characters.list(CID),
    loadCharacter: async (id) => { const c = await db.characters.get(id); const h = hook; hook = undefined; await h?.(); return c; },
    saveCharacter: async (c) => { await db.characters.putSynced(c); },
    deleteCharacter: (id, by) => db.characters.delete(id, { by }),
    index: fixtureIndex,
    packMeta: () => db.packs.listMeta(),
    loadPack: (id) => db.packs.get(id),
  });
}

describe('with the real db (fake-indexeddb)', () => {
  beforeEach(resetDb);

  test('the DM side on the db: join, then a player edit and a DM edit merge, saved without new stamps', async () => {
    await db.campaigns.put(hosted({ A1: {} }));
    await db.characters.put({ ...char('ch1', CID), ownerId: 'A1' });
    const host = dbHost();
    const a = player({ playerId: 'A1' }), n = player({ name: 'Nia' });
    const [h] = connect(host, a.guest);
    connect(host, n.guest);
    await settle(host, a.guest, n.guest);
    expect(n.guest.playerId).toBe('A2');
    expect((await db.campaigns.get(CID))!.sync!.players).toEqual({ A1: {}, A2: { name: 'Nia' } });
    h.close();
    await settle(host, a.guest);

    const pc = a.d.char('ch1')!;
    a.d.edit({ ...pc, state: { ...pc.state, hp: 3 } });
    const stored = (await db.characters.get('ch1'))!;
    await db.characters.put({ ...stored, details: { ...stored.details, notes: 'from the DM' } });
    connect(host, a.guest);
    await settle(host, a.guest);
    const m = (await db.characters.get('ch1'))!;
    expect([m.state.hp, m.details.notes]).toEqual([3, 'from the DM']);
    expect(same(m, a.d.char('ch1'))).toBe(true);
    expect(m.sync).toEqual(a.d.char('ch1')!.sync); // putSynced added no clock of its own (R2)
  });

  test('R4: an ordinary campaign put keeps the stored sync; updateSync changes it; a delete in a synced campaign leaves a tombstone', async () => {
    await db.campaigns.put(hosted());
    const stale = (await db.campaigns.get(CID))!;
    await db.campaigns.updateSync(CID, (s) => ({ ...s!, players: { A1: { name: 'Ann' } } }));
    await db.campaigns.put({ ...stale, name: 'Renamed' });
    await db.saveTogether({ campaign: { ...stale, name: 'Again' } });
    const c = (await db.campaigns.get(CID))!;
    expect([c.name, c.sync!.players]).toEqual(['Again', { A1: { name: 'Ann' } }]);
    await db.characters.put(char('x', CID));
    await db.characters.delete('x');
    const s = (await db.campaigns.get(CID))!.sync!;
    expect(s.deleted!.x).toBe(s.last);
    await expect(db.campaigns.updateSync('nope', (x) => x)).rejects.toThrow(/Could not save/);
  });

  test('I2: a DM edit saved between the host loading a character and saving the merge survives', async () => {
    await db.campaigns.put(hosted({ A1: {} }));
    await db.characters.put({ ...char('ch1', CID), ownerId: 'A1' });
    const host = dbHost();
    const a = player({ playerId: 'A1' });
    const [h] = connect(host, a.guest);
    await settle(host, a.guest);
    h.close();
    await settle(host, a.guest);
    const pc = a.d.char('ch1')!;
    a.d.edit({ ...pc, details: { ...pc.details, notes: 'from the player' } });
    const racy = dbHost({ beforeSave: async () => { const s = (await db.characters.get('ch1'))!; await db.characters.put({ ...s, state: { ...s.state, hp: 9 } }); } });
    connect(racy, a.guest);
    await settle(racy, a.guest);
    const m = (await db.characters.get('ch1'))!;
    expect([m.state.hp, m.details.notes]).toEqual([9, 'from the player']);
  });

  test('N1: two saves from one open sheet both land, in order, when the holder continues from what put returns', async () => {
    await db.campaigns.put(hosted());
    const loaded = await db.characters.put(char('x', CID));
    const s1 = await db.characters.put({ ...loaded, state: { ...loaded.state, hp: 5 } });
    const s2 = await db.characters.put({ ...s1, state: { ...s1.state, hp: 3 } });
    expect([s2.state.hp, (await db.characters.get('x'))!.state.hp]).toEqual([3, 3]);
    const [t] = await db.saveTogether({ characters: [{ ...s2, details: { ...s2.details, notes: 'n' } }] });
    const t2 = await db.characters.put({ ...t, details: { ...t.details, notes: 'n2' } });
    expect(t2.details.notes).toBe('n2');
  });

  test('R10: an import Replace overwrites every field with the file\'s, even fields stored later than the export', async () => {
    await db.campaigns.put(hosted());
    const exported = await db.characters.put({ ...char('x', CID), name: 'Old' });
    const stored = await db.characters.put({ ...exported, state: { ...exported.state, hp: 5 }, details: { ...exported.details, notes: 'later' } });
    const file = { ...exported, name: 'Restored', state: { ...exported.state, hp: 20 } }; // carries the export's sync
    await db.characters.put(replacement(file, stored, false));
    const after = (await db.characters.get('x'))!;
    const strip = (c: Character) => canon({ ...c, sync: undefined, updatedAt: 0 });
    expect(strip(after)).toBe(strip(file));
  });

  test('R9: a player delete goes to the DM\'s trash; restore brings it back to every device; delete permanently removes it', async () => {
    await db.campaigns.put(hosted({ A1: {} }));
    await db.characters.put({ ...char('x', CID), ownerId: 'A1', name: 'Vex' });
    const host = dbHost();
    const a = player({ playerId: 'A1' }), a2 = player({ playerId: 'A1' });
    connect(host, a.guest);
    const [h2] = connect(host, a2.guest);
    await settle(host, a.guest, a2.guest);
    a.d.deleteChar('x');
    a.guest.characterChanged('x');
    await settle(host, a.guest, a2.guest);
    expect([await db.characters.get('x'), a2.d.char('x')]).toEqual([undefined, undefined]);
    const trash = await db.trash.list(CID);
    expect(trash.map((e) => [e.character.name, e.by])).toEqual([['Vex', 'A1']]);
    h2.close(); // a2 goes offline still holding the tombstone
    await settle(host, a2.guest);

    await db.trash.restore(CID, 'x');
    host.characterChanged('x');
    await settle(host, a.guest);
    expect((await db.characters.get('x'))!.name).toBe('Vex');
    expect(a.d.char('x')!.name).toBe('Vex');
    expect(a.d.campaigns.get(CID)!.sync!.deleted).toEqual({});
    expect(await db.trash.list(CID)).toEqual([]);
    connect(host, a2.guest); // re-sends its old tombstone: outdated by the restore
    await settle(host, a.guest, a2.guest);
    expect([!!(await db.characters.get('x')), a2.d.char('x')?.name]).toEqual([true, 'Vex']);

    await db.characters.delete('x'); // the DM's own delete also goes to the trash
    expect((await db.trash.list(CID)).map((e) => e.by)).toEqual(['DM']);
    await db.trash.purge(CID, 'x');
    expect([await db.trash.list(CID), await db.characters.get('x')]).toEqual([[], undefined]);
  });

  test('I1: re-importing a deleted character adds it under a new id, which sync keeps', async () => {
    await db.campaigns.put(hosted({ A1: {} }));
    const file = await db.characters.put({ ...char('x', CID), ownerId: 'A1', name: 'Vex' });
    const host = dbHost();
    const a = player({ playerId: 'A1' });
    const [h] = connect(host, a.guest);
    await settle(host, a.guest);
    a.d.deleteChar('x');
    a.guest.characterChanged('x');
    await settle(host, a.guest);
    h.close();
    await settle(host, a.guest);
    expect(await deletedInCampaign(file)).toBe(true);
    const copy = await db.characters.put(keepBoth(file));
    connect(host, a.guest); // still holds the tombstone for x
    await settle(host, a.guest);
    expect([(await db.characters.get(copy.id))?.name, a.d.char(copy.id)?.name, await db.characters.get('x')]).toEqual(['Vex', 'Vex', undefined]);
  });

  test('M8: a backup restored over a hosted campaign keeps its code, unions players and tombstones, and keeps the later clock', async () => {
    const L1 = '001800000000000:000000:aaaaaaaa', L2 = '001800000001000:000000:bbbbbbbb';
    await db.campaigns.put({ ...hosted({ A1: {}, A2: { name: 'Bo' } }), sync: { role: 'dm', code: 'NEWCODE23456', node: 'dmnode01', last: L2, players: { A1: {}, A2: { name: 'Bo' } }, deleted: { x: L2 } } });
    const old: Campaign = { ...hosted(), sync: { role: 'dm', code: CODE, node: 'oldnode1', last: L1, players: { A1: { name: 'Ann', removed: true } }, deleted: { y: L1 } } };
    await db.restore({ campaigns: [old], characters: [], items: [], packs: [], blobs: [] });
    const s = (await db.campaigns.get(CID))!.sync!;
    expect([s.code, s.last, s.players, s.deleted]).toEqual(['NEWCODE23456', L2, { A1: { name: 'Ann', removed: true }, A2: { name: 'Bo' } }, { x: L2, y: L1 }]);
    expect(s.node).not.toMatch(/dmnode01|oldnode1/);
  });

  test('R5: restoring a backup gives a synced campaign a new clock node and keeps its code and role', async () => {
    await db.restore({ campaigns: [hosted()], characters: [], items: [], packs: [], blobs: [] });
    const s = (await db.campaigns.get(CID))!.sync!;
    expect([s.role, s.code]).toEqual(['dm', CODE]);
    expect(s.node).toMatch(/^[0-9a-f]{8}$/);
    expect(s.node).not.toBe('dmnode01');
  });
});

describe('handshake', () => {
  afterEach(() => { vi.useRealTimers(); });

  test('M6: a link that has not said hello within 15 s is closed; one that has stays', async () => {
    vi.useFakeTimers();
    const { host } = dm();
    const quiet = rawLink(), talker = rawLink();
    host.accept(quiet.link);
    host.accept(talker.link);
    talker.deliver({ t: 'hello', code: CODE });
    await host.idle();
    vi.advanceTimersByTime(HELLO_TIMEOUT);
    expect([quiet.closed(), talker.closed()]).toEqual([true, false]);
  });

  test('M7: a first join stores the campaign and its player sync in one write', async () => {
    const { host } = dm();
    const d = new Device();
    const calls: string[] = [];
    const deps = d.guestDeps(CODE);
    const guest = new Guest({
      ...deps,
      saveCampaign: async (c) => { calls.push(`save:${c.sync?.role}:${c.sync?.playerId}`); return deps.saveCampaign(c); },
      updateSync: async (id, fn) => { calls.push('updateSync'); return deps.updateSync(id, fn); },
    });
    connect(host, guest);
    await settle(host, guest);
    expect(calls).toEqual(['save:player:A1']);
    expect(d.campaigns.get(CID)!.sync).toMatchObject({ role: 'player', code: CODE, playerId: 'A1' });
  });
});
