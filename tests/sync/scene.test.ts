// Stage 5, Task B1: the scene players receive (an allowlist), their token moves, and the chunked image transfer.
import { describe, expect, test } from 'vitest';
import { toBase64, fromBase64 } from '../../src/lib/base64.ts';
import { paintFog } from '../../src/lib/map/fog.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { sha256Bytes } from '../../src/lib/sync/code.ts';
import { Guest, type GuestDeps } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { memoryPair } from '../../src/lib/sync/link.ts';
import { BLOB_CHUNK, MAX_BLOB, MAX_MESSAGE, parseGuestMessage, size } from '../../src/lib/sync/protocol.ts';
import { cleanScene, moveProblem, sceneBlobs, sceneForPlayers, type PlayerScene } from '../../src/lib/sync/scene.ts';
import type { Campaign, CampaignSettings, Character, Combat, Combatant, Scene } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle, tap } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';
const IMG = 'a'.repeat(64), PT = 'b'.repeat(64), PX = 'c'.repeat(64);
const settings = (o: Partial<CampaignSettings> = {}): CampaignSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });

// Thorin as in tracker.test.ts (A1's fighter 3, 20 of 28 HP to the player), minus the hidden amulet.
function thorin(): Character {
  const c = mkChar({ race: 'human', base: { con: 14 }, levels: ['fighter', 'fighter', 'fighter'] });
  return { ...c, id: 'thorin', name: 'Thorin', campaignId: CID, ownerId: 'A1', state: { ...c.state, hp: 20 } };
}
const spy = (): Character => ({ ...char('spy', CID), name: 'Spy', overrides: { maxHp: 9 }, state: { ...char('spy').state, hp: 4 } }); // DM-only (R13)
const bree = (): Character => ({ ...char('bree', CID), name: 'Bree', ownerId: 'A2' });
const chars = () => [thorin(), spy(), bree()];

function scene(o: Partial<Scene> = {}): Scene {
  return {
    id: 's1', campaignId: CID, name: 'Crypt', image: IMG, width: 700, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
    tokens: [
      { id: 't-thorin', name: 'Thorin', x: 35, y: 35, size: 'M', color: '#c0392b', characterId: 'thorin', portrait: PT },
      { id: 't-gob', name: 'Goblin 1', x: 105, y: 35, size: 'S', color: '#2471a3', monsterId: 'monster:goblin@SRD', hp: 3, maxHp: 7 },
      { id: 't-ass', name: 'Assassin', x: 175, y: 35, size: 'M', color: '#000000', monsterId: 'monster:assassin@SRD', hidden: true, portrait: PX, hp: 78, maxHp: 78 },
      { id: 't-shadow', name: 'Shadowy figure', x: 245, y: 35, size: 'M', color: '#111111', monsterId: 'monster:lich@SRD' },
      { id: 't-spy', name: 'Spy', x: 315, y: 35, size: 'M', color: '#222222', characterId: 'spy' },
    ],
    ...o,
  };
}
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (o: Partial<Combat> = {}): Combat => ({
  campaignId: CID, round: 1, turn: 'pc:thorin', groupMonsters: false, updatedAt: 0,
  combatants: [
    cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17 }),
    cb({ id: 'g1', kind: 'monster', name: 'Goblin 1', monsterId: 'monster:goblin@SRD', init: 12, hp: 0, maxHp: 7, conditions: ['Prone'] }),
  ],
  ...o,
});
const LEAKS = ['Assassin', 'monster:', 'lich', '"hp"', 'maxHp', 'combatantId', 'hidden'];
const tok = (v: PlayerScene | undefined, name: string) => v?.tokens.find((t) => t.name === name);

describe('sceneForPlayers', () => {
  test('sends only the allowlist (Review Focus 1)', () => {
    const v = sceneForPlayers(scene(), chars(), undefined, settings())!;
    expect(v.tokens.map((t) => t.name)).toEqual(['Thorin', 'Goblin 1', 'Shadowy figure', 'Spy']);
    expect(Object.keys(tok(v, 'Goblin 1')!).sort()).toEqual(['color', 'conditions', 'health', 'id', 'name', 'size', 'x', 'y']);
    expect(tok(v, 'Goblin 1')!.health).toBe('Bloodied');
    expect(tok(v, 'Thorin')).toMatchObject({ characterId: 'thorin', portrait: PT, health: 'Hurt' });
    expect(tok(v, 'Spy')!.characterId).toBeUndefined();
    expect(tok(v, 'Spy')!.health).toBe('Bloodied');
    const json = JSON.stringify(v);
    for (const s of LEAKS) expect(json).not.toContain(s);
  });

  test("health follows stage 4's gate", () => {
    const a = sceneForPlayers(scene(), chars(), undefined, settings({ showMonsterHealth: false }))!;
    expect(tok(a, 'Goblin 1')!.health).toBeUndefined();
    expect(tok(a, 'Spy')!.health).toBeUndefined();
    expect(tok(a, 'Thorin')!.health).toBe('Hurt');
    const off = settings();
    off.initiativeModules.hp = false;
    const b = sceneForPlayers(scene(), chars(), undefined, off)!;
    expect(tok(b, 'Goblin 1')!.health).toBeUndefined();
    expect(tok(b, 'Thorin')!.health).toBe('Hurt');
  });

  test('live state comes from the combat or the character', () => {
    const s = scene();
    s.tokens[1] = { ...s.tokens[1], combatantId: 'g1' };
    const t = thorin();
    t.state.conditions = ['Poisoned'];
    const v = sceneForPlayers(s, [t, spy()], fight(), settings())!;
    expect(tok(v, 'Goblin 1')).toMatchObject({ health: 'Down', conditions: ['Prone'] });
    expect(tok(v, 'Thorin')!.conditions).toEqual(['Poisoned']);
    expect(JSON.stringify(v)).not.toContain('g1');
  });

  test('an unshown scene sends nothing', () => {
    expect(sceneForPlayers(scene({ shown: false }), chars(), undefined, settings())).toBeUndefined();
    expect(sceneForPlayers(undefined, chars(), undefined, settings())).toBeUndefined();
  });

  test('sceneBlobs: the image and visible portraits only', () => {
    expect(sceneBlobs(sceneForPlayers(scene(), chars(), undefined, settings()))).toEqual([IMG, PT]);
    expect(sceneBlobs(undefined)).toEqual([]);
  });

  test('C2: with fog on, fogged tokens and their portraits never reach players; the fog goes along', () => {
    const base = scene();
    base.tokens[1] = { ...base.tokens[1], portrait: PX }; // the goblin, about to be fogged
    const fog = paintFog(undefined, 700, 700, { k: 'rect', a: { x: 0, y: 0 }, b: { x: 60, y: 60 }, reveal: true }); // only Thorin's corner
    const s = { ...base, fog };
    const v = sceneForPlayers(s, chars(), undefined, settings({ fog: true }))!;
    expect(v.tokens.map((t) => t.name)).toEqual(['Thorin']);
    expect(v.fog).toBe(fog);
    expect(sceneBlobs(v)).toEqual([IMG, PT]);
    expect(JSON.stringify(v)).not.toMatch(/Goblin|Shadowy|Spy/);
    expect(sceneForPlayers(base, chars(), undefined, settings({ fog: true }))!.tokens).toEqual([]); // no fog yet: all fogged
    expect(sceneForPlayers(s, chars(), undefined, settings())!.fog).toBeUndefined(); // fog off: nothing withheld, no fog sent
    // a move of a fogged token is a stale one, never applied
    const mv = { sceneId: 's1', tokenId: 't-thorin', x: 35, y: 35 };
    expect(moveProblem({ ...base, fog: paintFog(undefined, 700, 700, { k: 'all', reveal: false }) }, mv, 'A1', chars(), fight(), settings({ fog: true })))
      .toEqual({ error: 'no such token', violation: false });
    expect(moveProblem(s, mv, 'A1', chars(), fight(), settings({ fog: true }))).toBeUndefined();
  });

  test('a full scene fits in one message (Review Focus 5)', () => {
    const tokens = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`.padEnd(36, 'x'), name: 'N'.repeat(100), x: 35, y: 35, size: 'M' as const, color: '#123456', portrait: PT }));
    const v = sceneForPlayers(scene({ tokens }), [], undefined, settings())!;
    expect(v.tokens.length).toBe(200);
    expect(size({ t: 'scene', scene: v })).toBeLessThan(MAX_MESSAGE);
  });
});

describe('moveProblem (Review Focus 2)', () => {
  const m = (o: Partial<{ sceneId: string; tokenId: string; x: number; y: number }> = {}) => ({ sceneId: 's1', tokenId: 't-thorin', x: 100, y: 100, ...o });
  const check = (o = {}, pid = 'A1', combat: Combat | null = fight(), set = settings(), s = scene()) => moveProblem(s, m(o), pid, chars(), combat ?? undefined, set);

  test('the owner on their turn, inside the scene', () => expect(check()).toBeUndefined());
  test('the turn gate', () => {
    expect(check({}, 'A1', fight({ turn: 'g1' }))).toEqual({ error: 'not your turn', violation: false });
    expect(check({}, 'A1', fight({ turn: 'g1' }), settings({ freeMovement: true }))).toBeUndefined();
    expect(check({}, 'A1', null)).toEqual({ error: 'not your turn', violation: false });
    expect(check({}, 'A1', fight({ round: 0 }))).toEqual({ error: 'not your turn', violation: false });
  });
  test('ownership', () => {
    expect(check({}, 'A2')).toEqual({ error: 'not their token', violation: true });
    expect(check({ tokenId: 't-gob' })).toEqual({ error: 'not their token', violation: true });
    expect(check({ tokenId: 't-spy' })).toEqual({ error: 'not their token', violation: true });
  });
  test('stale or wrong targets', () => {
    expect(check({ tokenId: 't-ass' })).toEqual({ error: 'no such token', violation: false });
    expect(check({ tokenId: 'nope' })).toEqual({ error: 'no such token', violation: false });
    expect(check({ sceneId: 's2' })).toEqual({ error: 'not the shown scene', violation: false });
    expect(check({}, 'A1', fight(), settings(), scene({ shown: false }))).toEqual({ error: 'not the shown scene', violation: false });
    expect(check({ x: 5000 })).toEqual({ error: 'off the map', violation: false });
  });
});

test('cleanScene', () => {
  const base = { id: 's1', name: 'Crypt', width: 700, height: 700, grid: { ...DEFAULT_GRID }, tokens: [] as unknown[] };
  const t = { id: 't', name: 'Goblin 1', x: 35, y: 35, size: 'M', color: '#123456', conditions: ['Prone'] };
  expect(cleanScene({ ...base, image: IMG, tokens: [t] })).toEqual({ ...base, image: IMG, tokens: [t] });
  expect(cleanScene({ ...base, tokens: [{ ...t, id: 5 }, t] })!.tokens).toEqual([t]);
  expect(cleanScene({ ...base, tokens: [{ ...t, health: 'Wounded', portrait: 'x', characterId: 7, hp: 3, monsterId: 'monster:x' }] })!.tokens).toEqual([t]);
  expect(cleanScene({ ...base, tokens: [{ ...t, color: 'red', conditions: [1, 'x'.repeat(41), 'Prone'] }] })!.tokens).toEqual([{ ...t, color: '#888888' }]);
  expect(cleanScene({ ...base, grid: { ...DEFAULT_GRID, type: 'triangle' } })).toBeUndefined();
  expect(cleanScene({ ...base, width: 5000 })).toBeUndefined();
  expect(cleanScene({ ...base, tokens: Array.from({ length: 300 }, (_, i) => ({ ...t, id: `t${i}` })) })!.tokens.length).toBe(200);
  expect(cleanScene({ ...base, image: 'abc' })!.image).toBeUndefined();
  expect(cleanScene({ ...base, tokens: [{ ...t, x: NaN }] })!.tokens).toEqual([]);
  expect(cleanScene('nope')).toBeUndefined();
  const fog = paintFog(undefined, 700, 700, { k: 'all', reveal: true });
  expect(cleanScene({ ...base, fog })!.fog).toBe(fog);
  expect(cleanScene({ ...base, fog: 'garbage!' })!.fog).toBe(paintFog(undefined, 700, 700, { k: 'all', reveal: false })); // bad fog: all fogged
  expect('fog' in cleanScene(base)!).toBe(false);
});

test('the parse: move and blobWant shapes', () => {
  expect(parseGuestMessage({ t: 'move', sceneId: 's1', tokenId: 't', x: 1, y: 2, extra: 1 })).toEqual({ t: 'move', sceneId: 's1', tokenId: 't', x: 1, y: 2 });
  for (const bad of [{ x: '5' }, { x: Infinity }, { x: -1 }, { x: 4097 }, { tokenId: 'x'.repeat(101) }, { sceneId: 3 }]) {
    expect(parseGuestMessage({ t: 'move', sceneId: 's1', tokenId: 't', x: 1, y: 2, ...bad })).toEqual({ error: 'bad move' });
  }
  expect(parseGuestMessage({ t: 'blobWant', hashes: [IMG] })).toEqual({ t: 'blobWant', hashes: [IMG] });
  for (const hashes of [[], ['abc'], Array(202).fill(IMG), 'x']) expect(parseGuestMessage({ t: 'blobWant', hashes })).toEqual({ error: 'bad blobWant' });
});

describe('engine', () => {
  const hosted = (): Campaign => ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } });
  function setup(s: Scene | undefined = scene(), combat: Combat | undefined = fight()) {
    const d = new Device();
    d.map = true;
    d.putCampaign(hosted());
    for (const c of chars()) d.edit(c);
    d.scene = s;
    d.combat = combat;
    return { d, host: new Host(d.hostDeps(CID)) };
  }
  function player(playerId: string, o: Partial<GuestDeps> = {}) {
    const d = new Device(), views: (PlayerScene | undefined)[] = [];
    return { d, views, guest: new Guest(d.guestDeps(CODE, { playerId, onScene: (s) => { views.push(s); }, ...o })) };
  }
  const scenes = (down: string[]) => down.filter((m) => JSON.parse(m).t === 'scene');
  const chunks = (down: string[]) => down.filter((m) => JSON.parse(m).t === 'blobChunk');
  const thorinAt = (d: Device) => d.scene!.tokens.find((t) => t.id === 't-thorin')!;

  test('the shown scene reaches players, live and after a welcome; nothing hidden is in any message', async () => {
    const { d, host } = setup(scene({ shown: false }));
    const a = player('A1'), down: string[] = [];
    connect(host, a.guest, down);
    await settle(host, a.guest);
    expect(a.views).toEqual([undefined]);
    d.scene = scene();
    host.sceneChanged();
    await settle(host, a.guest);
    expect(a.views.at(-1)!.tokens.map((t) => t.name)).toEqual(['Thorin', 'Goblin 1', 'Shadowy figure', 'Spy']);

    const b = player('A2'), downB: string[] = [];
    connect(host, b.guest, downB);
    await settle(host, a.guest, b.guest);
    expect(downB.map((m) => JSON.parse(m).t).filter((t) => t !== 'chars').slice(0, 3)).toEqual(['welcome', 'tracker', 'scene']);
    expect(b.views.at(-1)).toEqual(a.views.at(-1));

    host.sceneChanged(); // nothing a player sees changed: not sent again
    d.scene = { ...d.scene!, tokens: d.scene!.tokens.map((t) => (t.hidden ? { ...t, x: 455 } : t)) };
    host.sceneChanged();
    await settle(host, a.guest, b.guest);
    expect(scenes(down).length).toBe(2);
    for (const m of [...scenes(down), ...scenes(downB)]) for (const s of LEAKS) expect(m).not.toContain(s);
    for (const m of [...down, ...downB]) for (const s of ['Assassin', 'monster:', 'lich', PX]) expect(m).not.toContain(s);
    expect(d.errors).toEqual([]);
  });

  test('a move on their turn lands, snapped, and everyone gets it; off-turn snaps back; another player\'s token is a violation', async () => {
    const { d, host } = setup();
    const a = player('A1'), b = player('A2'), down: string[] = [], up: string[] = [];
    connect(host, a.guest, down, up);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    a.guest.sendMove('s1', 't-thorin', { x: 100, y: 100 });
    await settle(host, a.guest, b.guest);
    expect(thorinAt(d)).toMatchObject({ x: 105, y: 105 });
    expect(tok(a.views.at(-1), 'Thorin')).toMatchObject({ x: 105, y: 105 });
    expect(tok(b.views.at(-1), 'Thorin')).toMatchObject({ x: 105, y: 105 });

    d.combat = fight({ turn: 'g1' }); // off-turn: refused, the scene is sent to A1 again (its token snaps back), no strike
    const before = JSON.stringify(d.scene), n = scenes(down).length;
    a.guest.sendMove('s1', 't-thorin', { x: 300, y: 300 });
    await settle(host, a.guest, b.guest);
    expect(JSON.stringify(d.scene)).toBe(before);
    expect(scenes(down).length).toBe(n + 1);
    expect(d.errors).toEqual([]);

    const sent = up.length; // the guest never sends a move for a token that is not its own
    a.guest.sendMove('s1', 't-gob', { x: 300, y: 300 });
    b.guest.sendMove('s1', 't-thorin', { x: 300, y: 300 });
    await settle(host, a.guest, b.guest);
    expect(up.length).toBe(sent);

    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A2' });
    await settle(host);
    evil.deliver({ t: 'move', sceneId: 's1', tokenId: 't-thorin', x: 300, y: 300 });
    await settle(host);
    expect(JSON.stringify(d.scene)).toBe(before);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their token/)]);
    expect(evil.closed()).toBe(false);
    evil.deliver({ t: 'move', sceneId: 's1', tokenId: 't-thorin', x: '5', y: 3 });
    await settle(host);
    expect(String(d.errors.at(-1))).toMatch(/bad move/);
  });

  test('images reach players in chunks; a hidden portrait is refused; too big is never sent; a damaged chunk is not stored', async () => {
    const bytes = new Uint8Array(300_000).map((_, i) => (i * 7919) % 251);
    const hash = await sha256Bytes(bytes);
    const { d, host } = setup(scene({ image: hash }));
    d.blobs.set(hash, { type: 'image/webp', data: bytes });
    d.blobs.set(PX, { type: 'image/png', data: new Uint8Array(10) });
    const a = player('A1'), down: string[] = [];
    connect(host, a.guest, down);
    await settle(host, a.guest);
    expect(chunks(down).length).toBe(Math.ceil(300_000 / BLOB_CHUNK));
    expect(a.d.blobs.get(hash)?.type).toBe('image/webp');
    expect(a.d.blobs.get(hash)?.data).toEqual(bytes);
    for (const m of chunks(down)) expect(m.length).toBeLessThan(64 * 1024);

    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    evil.deliver({ t: 'blobWant', hashes: [PX] });
    await settle(host);
    expect(String(d.errors.at(-1))).toMatch(/not offered/);
    expect(evil.got.some((m) => (m as { t: string }).t === 'blobChunk')).toBe(false);

    // too big: offered (it is the scene image) but never streamed
    const big = 'd'.repeat(64);
    d.blobs.set(big, { type: 'image/webp', data: new Uint8Array(MAX_BLOB + 1) });
    d.scene = scene({ image: big });
    const c = player('A1'), downC: string[] = [];
    connect(host, c.guest, downC);
    await settle(host, c.guest);
    expect(chunks(downC).length).toBe(0);
    expect(c.d.blobs.size).toBe(0);

    // a flipped byte: the hash does not match, nothing is stored
    d.scene = scene({ image: hash });
    const e = player('A1');
    const [h, g] = memoryPair();
    const send = h.send.bind(h);
    h.send = (m) => {
      const x = m as { t: string; seq: number; data: string };
      if (x.t !== 'blobChunk' || x.seq !== 1) return send(m);
      const raw = fromBase64(x.data);
      raw[0] ^= 1;
      send({ ...x, data: toBase64(raw) });
    };
    host.accept(tap(h, []));
    e.guest.connect(g);
    await settle(host, e.guest);
    expect(e.d.blobs.size).toBe(0);
  });
});
