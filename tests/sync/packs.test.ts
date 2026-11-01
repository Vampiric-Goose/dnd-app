import { describe, expect, test } from 'vitest';
import { sha256Text } from '../../src/lib/sync/code.ts';
import { Guest, type PackProgress } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { memoryPair } from '../../src/lib/sync/link.ts';
import { packForPlayers } from '../../src/lib/sync/project.ts';
import { MAX_CHUNK } from '../../src/lib/sync/protocol.ts';
import type { Campaign, Entity, Pack } from '../../src/lib/types.ts';
import { camp } from '../fixtures/records.ts';
import { connect, Device, settle, tap } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN', CID = 'c1';

const spell = (name: string, source: string, text = 'A spell.'): Entity =>
  ({ kind: 'spell', id: `spell:${name.toLowerCase().replace(/\W+/g, '-')}@${source}`, name, source, text: [{ p: text }], level: 1, school: 'evocation', castingTime: '1 action',
    range: '60 feet', components: { v: true }, duration: 'Instantaneous', concentration: false, ritual: false, classes: ['wizard'] }) as Entity;
const monster = (name: string, source: string): Entity => ({ kind: 'monster', id: `monster:${name.toLowerCase()}@${source}`, name, source, text: [] }) as unknown as Entity;
const pack = (source: string, entities: Entity[], o: Partial<Pack> = {}): Pack =>
  ({ id: `pack:${source}`, name: source, source, importedAt: 1, hash: `stored-${source}`, entities, patches: [], ...o });

const PHB = pack('PHB', [spell('Chromatic Orb', 'PHB'), spell('Witch Bolt', 'PHB')]);
const XGE = pack('XGE', [spell('Ice Knife', 'XGE'), monster('Gloomwyrm', 'XGE')]); // mixed: the monster stays home
const BREW = pack('MYBREW', [spell('Brewed Bolt', 'MYBREW')], { homebrew: true });
const MM = pack('MM', [monster('Beholder', 'MM')]);

/** What the host would send for a pack, and its hash (R6: of exactly that JSON). */
const sentHash = async (p: Pack) => sha256Text(JSON.stringify(packForPlayers(p)));

function setup(packs: Pack[]) {
  const d = new Device();
  for (const p of packs) d.packs.set(p.id, p);
  const c: Campaign = { ...camp(CID), enabledPacks: packs.map((p) => p.id), sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {} } } };
  d.putCampaign(c);
  return { d, host: new Host(d.hostDeps(CID)) };
}
function joiner(d = new Device(), progress: PackProgress[] = []) {
  return { d, progress, guest: new Guest(d.guestDeps(CODE, { playerId: 'A1', onPacks: (p) => { progress.push(p); } })) };
}
const chunks = (down: string[]) => down.map((s) => JSON.parse(s)).filter((m) => m.t === 'packChunk');

describe('pack sharing', () => {
  test('a 3-pack campaign where the guest already has one by hash: exactly 2 are sent; a reconnect sends none (Review Focus 5)', async () => {
    const { host } = setup([PHB, XGE, BREW]);
    const g = joiner();
    g.d.packs.set(PHB.id, { ...packForPlayers(PHB)!, hash: await sentHash(PHB), sharedBy: CID });
    const down: string[] = [];
    const [h] = connect(host, g.guest, down);
    await settle(host, g.guest);
    const welcome = JSON.parse(down[0]);
    expect(welcome.packs.map((o: { id: string }) => o.id)).toEqual([PHB.id, XGE.id, BREW.id]);
    expect(welcome.packs[1].hash).toBe(await sentHash(XGE));
    expect(new Set(chunks(down).map((m) => m.id))).toEqual(new Set([XGE.id, BREW.id]));
    const xge = g.d.packs.get(XGE.id)!;
    expect(xge.entities.map((e) => e.name)).toEqual(['Ice Knife']);
    expect([xge.sharedBy, xge.hash]).toEqual([CID, await sentHash(XGE)]);
    expect(g.d.packs.get(BREW.id)!.homebrew).toBe(true);
    expect(g.progress.at(-1)).toMatchObject({ done: 2, total: 2 });
    expect(g.progress.at(-1)!.error).toBeUndefined();
    expect(g.progress.at(-1)!.bytes).toBeGreaterThan(0);

    h.close();
    await settle(host, g.guest);
    const again: string[] = [], up: string[] = [];
    connect(host, g.guest, again, up);
    await settle(host, g.guest);
    expect(g.guest.status).toBe('online');
    expect(chunks(again)).toEqual([]);
    expect(up.some((s) => s.includes('packWant'))).toBe(false);
  });

  test('a monster pack is never listed or sent, and asking for it anyway is refused', async () => {
    const { d, host } = setup([MM, XGE]);
    const g = joiner();
    const down: string[] = [];
    connect(host, g.guest, down);
    await settle(host, g.guest);
    expect(JSON.parse(down[0]).packs.map((o: { id: string }) => o.id)).toEqual([XGE.id]);
    expect(JSON.parse(down[0]).campaign.enabledPacks).toEqual([XGE.id]); // M2: no DM-only pack ids
    expect(g.d.campaigns.get(CID)!.enabledPacks).toEqual([XGE.id]);
    expect(down.join()).not.toMatch(/Beholder|Gloomwyrm/);
    // a crafted packWant for the monster pack
    const before = down.length;
    const [h2, g2] = memoryPair();
    host.accept(tap(h2, down));
    g2.send({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    g2.send({ t: 'packWant', ids: [MM.id] });
    await settle(host);
    expect(down.slice(before).map((s) => JSON.parse(s).t)).toEqual(['welcome', 'tracker']); // stage 4 I1: a welcome is always followed by the tracker
    expect(d.errors.some((e) => String(e).includes('not offered'))).toBe(true);
  });

  test('chunks stay within 64 KB, arrive in order, and rebuild the pack exactly', async () => {
    const text = 'Ünïcödé "quoted" \\ ' + '火球'.repeat(50) + ' 🐉'.repeat(20);
    const BIG = pack('TCE', Array.from({ length: 300 }, (_, i) => spell(`Spell ${i}`, 'TCE', `${text} ${i}`)));
    const { host } = setup([BIG]);
    const g = joiner();
    const down: string[] = [];
    connect(host, g.guest, down);
    await settle(host, g.guest);
    const cs = chunks(down);
    expect(cs.length).toBeGreaterThan(5);
    const enc = new TextEncoder();
    for (const [i, s] of down.filter((x) => x.includes('"packChunk"')).entries()) {
      expect(enc.encode(s).length).toBeLessThanOrEqual(MAX_CHUNK);
      expect(cs[i].seq).toBe(i);
    }
    expect(g.d.packs.get(BIG.id)!.entities).toEqual(BIG.entities);
  });

  test('a tampered chunk fails the hash check, and the pack is not stored', async () => {
    const { host } = setup([PHB, XGE]);
    const g = joiner();
    const [h, l] = memoryPair();
    const send = h.send.bind(h);
    h.send = (m) => {
      const msg = m as { t: string; id?: string; data?: string };
      send(msg.t === 'packChunk' && msg.id === PHB.id ? { ...msg, data: msg.data!.replace('Chromatic', 'Chromatik') } : m);
    };
    host.accept(h);
    g.guest.connect(l);
    await settle(host, g.guest);
    expect(g.d.packs.has(PHB.id)).toBe(false);
    expect(g.d.packs.has(XGE.id)).toBe(true);
    expect(g.progress.at(-1)).toMatchObject({ done: 2, total: 2 });
    expect(g.progress.map((p) => p.error).find((e) => e)).toMatch(/pack:PHB: damaged in transfer/);
  });

  describe('from a host that is not honest (anyone with the code can pose as the DM)', () => {
    /** A guest talking to a hand-driven host end. */
    async function crafted(p: Pack | string, o: { size?: number; offerHash?: string; chunk?: (data: string, hash: string) => unknown[] } = {}) {
      const g = joiner();
      const [h, l] = memoryPair();
      g.guest.connect(l);
      const json = typeof p === 'string' ? p : JSON.stringify(p);
      const id = typeof p === 'string' ? 'pack:X' : p.id;
      const hash = await sha256Text(json);
      h.send({ t: 'welcome', playerId: 'A1', campaign: { id: CID, name: 'C', settings: camp(CID).settings, enabledPacks: [id] }, roster: [], packs: [{ id, hash: o.offerHash ?? hash, size: o.size ?? json.length }] });
      await settle(g.guest);
      for (const m of o.chunk ? o.chunk(json, hash) : [{ t: 'packChunk', id, hash, seq: 0, total: 1, data: json }]) h.send(m);
      await settle(g.guest);
      return g;
    }

    test('a pack containing an @XMM entity is refused', async () => {
      const g = await crafted(pack('MYBREW', [spell('Fine', 'MYBREW'), { ...spell('Sneaky', 'XMM'), id: 'spell:sneaky@XMM' }], { homebrew: true }));
      expect(g.d.packs.size).toBe(0);
      expect(g.progress.at(-1)!.error).toMatch(/refused/);
    });

    test('a 2024 pack, the SRD id, and a pack over 64 MB are refused', async () => {
      expect((await crafted(pack('XPHB', [spell('New', 'XPHB')]))).d.packs.size).toBe(0);
      expect((await crafted(pack('SRD', [spell('Fake', 'SRD')], { id: 'srd' }))).d.packs.size).toBe(0);
      const big = await crafted(pack('PHB', [spell('Huge', 'PHB')]), { size: 65 * 1024 * 1024 });
      expect(big.d.packs.size).toBe(0);
      expect(big.progress.at(-1)!.error).toMatch(/Too large/);
    });

    test('chunks out of order discard the pack', async () => {
      const g = await crafted(pack('PHB', [spell('Orb', 'PHB')]), {
        chunk: (data, hash) => [1, 0].map((seq) => ({ t: 'packChunk', id: 'pack:PHB', hash, seq, total: 2, data: seq ? data.slice(10) : data.slice(0, 10) })),
      });
      expect(g.d.packs.size).toBe(0);
      expect(g.progress.at(-1)!.error).toMatch(/out of order/);
    });

    test('M3: the offered hash and size are what count, not the chunk\'s', async () => {
      const real = pack('MYBREW', [spell('Fine', 'MYBREW')], { homebrew: true });
      const offered = await sha256Text(JSON.stringify(real));
      const swapped = await crafted(pack('MYBREW', [spell('Swapped', 'MYBREW')], { homebrew: true }), { offerHash: offered });
      expect(swapped.d.packs.size).toBe(0);
      expect(swapped.progress.at(-1)!.error).toMatch(/hash mismatch/);
      const bigger = await crafted(real, { size: 10 });
      expect(bigger.d.packs.size).toBe(0);
      expect(bigger.progress.at(-1)!.error).toMatch(/larger than offered/);
    });

    test('a well-formed homebrew pack from it is stored, marked as shared by the campaign', async () => {
      const g = await crafted(pack('MYBREW', [spell('Fine', 'MYBREW')], { homebrew: true }));
      expect(g.d.packs.get('pack:MYBREW')!.sharedBy).toBe(CID);
    });
  });

  test('M4: a chunk never ends inside a surrogate pair', async () => {
    for (const lead of ['x', 'xx']) { // one of the two puts a pair across a 20,000-unit boundary
      const DRAGONS = pack('TCE', [spell('Dragons', 'TCE', lead + '🐉'.repeat(30_000))]);
      const { host } = setup([DRAGONS]);
      const g = joiner();
      const down: string[] = [];
      connect(host, g.guest, down);
      await settle(host, g.guest);
      const cs = chunks(down);
      expect(cs.length).toBeGreaterThan(1);
      for (const c of cs) {
        const last = c.data.charCodeAt(c.data.length - 1), first = c.data.charCodeAt(0);
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
        expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      }
      expect(g.d.packs.get(DRAGONS.id)!.entities).toEqual(DRAGONS.entities);
    }
  });

  test('M5: asking for the same pack twice is refused, and it is streamed once', async () => {
    const { d, host } = setup([XGE]);
    const down: string[] = [];
    const [h2, g2] = memoryPair();
    host.accept(tap(h2, down));
    g2.send({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    g2.send({ t: 'packWant', ids: [XGE.id] });
    g2.send({ t: 'packWant', ids: [XGE.id] });
    await settle(host);
    expect(chunks(down).filter((m) => m.seq === 0)).toHaveLength(1);
    expect(d.errors.some((e) => String(e).includes('already asked'))).toBe(true);
  });

  test('a pack the player imported themself is kept, not overwritten or marked shared', async () => {
    const { host } = setup([PHB]);
    const g = joiner();
    const own = { ...PHB, hash: 'their-own-import' };
    g.d.packs.set(PHB.id, own);
    const down: string[] = [];
    connect(host, g.guest, down);
    await settle(host, g.guest);
    expect(chunks(down)).toEqual([]);
    expect(g.d.packs.get(PHB.id)).toEqual(own);
  });

  test('the host waits for the link to drain between chunks', async () => {
    const BIG = pack('TCE', Array.from({ length: 100 }, (_, i) => spell(`Spell ${i}`, 'TCE', 'x'.repeat(2000))));
    const { host } = setup([BIG]);
    const g = joiner();
    const [h, l] = memoryPair();
    let buffered = 0, drains: (() => void)[] = [], listeners = 0;
    const send = h.send.bind(h);
    const sent: string[] = [];
    Object.assign(h, {
      bufferedAmount: () => buffered,
      onDrain: (f: () => void) => { listeners++; drains.push(f); },
      send: (m: unknown) => { const s = JSON.stringify(m); sent.push(s); if (s.includes('"packChunk"')) buffered += 10 * MAX_CHUNK; send(m); },
    });
    host.accept(h);
    g.guest.connect(l);
    await settle(g.guest);
    await new Promise((r) => setTimeout(r, 50));
    expect(chunks(sent).length).toBe(1);
    const flush = () => { buffered = 0; const fs = drains; drains = []; for (const f of fs) f(); };
    for (let i = 0; i < 50 && !g.d.packs.has(BIG.id); i++) { flush(); await settle(g.guest); }
    expect(g.d.packs.get(BIG.id)!.entities).toEqual(BIG.entities);
    expect(listeners).toBeLessThanOrEqual(chunks(sent).length); // M5: one drain listener per wait, not one per 100 ms
  });
});
