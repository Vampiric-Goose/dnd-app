// Group D, Task D1: declared actions over sync: players' arrows reach the party, crafted ones are refused, hidden sources stay DM-only,
// and a turn ending clears its arrows for everyone.
import { describe, expect, test } from 'vitest';
import { next } from '../../src/lib/combat/combat.ts';
import type { DeclaredAction, PlayerAction } from '../../src/lib/map/actions.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { Guest } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { parseGuestMessage } from '../../src/lib/sync/protocol.ts';
import type { Campaign, Character, Combat, Combatant, Scene } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';
const thorin = (): Character => ({ ...char('thorin', CID), name: 'Thorin', ownerId: 'A1' });
const bree = (): Character => ({ ...char('bree', CID), name: 'Bree', ownerId: 'A2' });
const scene = (): Scene => ({
  id: 's1', campaignId: CID, name: 'Crypt', width: 700, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
  tokens: [
    { id: 't-thorin', name: 'Thorin', x: 35, y: 35, size: 'M', color: '#c0392b', characterId: 'thorin' },
    { id: 't-bree', name: 'Bree', x: 35, y: 105, size: 'M', color: '#27ae60', characterId: 'bree' },
    { id: 't-gob', name: 'Goblin 1', x: 105, y: 35, size: 'S', color: '#2471a3', monsterId: 'monster:goblin@SRD', combatantId: 'g1' },
    { id: 't-ass', name: 'Assassin', x: 175, y: 35, size: 'M', color: '#000000', monsterId: 'monster:assassin@SRD', hidden: true },
  ],
});
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (): Combat => ({
  campaignId: CID, round: 1, turn: 'pc:thorin', groupMonsters: false, updatedAt: 0,
  combatants: [
    cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17 }),
    cb({ id: 'pc:bree', kind: 'pc', name: 'Bree', characterId: 'bree', init: 14 }),
    cb({ id: 'g1', kind: 'monster', name: 'Goblin 1', monsterId: 'monster:goblin@SRD', init: 12, hp: 7, maxHp: 7 }),
  ],
});

function setup() {
  const d = new Device(), dm: DeclaredAction[][] = [];
  d.map = true;
  d.putCampaign({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } } satisfies Campaign);
  for (const c of [thorin(), bree()]) d.edit(c);
  d.scene = scene();
  d.combat = fight();
  return { d, dm, host: new Host({ ...d.hostDeps(CID), onActions: (l) => { dm.push(l); } }) };
}
function player(playerId: string) {
  const d = new Device(), got: PlayerAction[][] = [];
  return { d, got, guest: new Guest(d.guestDeps(CODE, { playerId, onActions: (l) => { got.push(l); } })) };
}
const last = <T>(xs: T[][]) => xs.at(-1) ?? [];

describe('declared actions over sync', () => {
  test("a player's arrow reaches the other player (no endsWith), and the DM sees it with its turn", async () => {
    const { d, dm, host } = setup();
    const a = player('A1'), b = player('A2');
    connect(host, a.guest);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    expect(last(b.got)).toEqual([]);
    a.guest.sendAction({ sceneId: 's1', from: { tokenId: 't-thorin' }, to: { tokenId: 't-gob' }, kind: 'intent' });
    await settle(host, a.guest, b.guest);
    expect(last(b.got)).toEqual([expect.objectContaining({ by: 'A1', from: { tokenId: 't-thorin' }, to: { tokenId: 't-gob' }, kind: 'intent' })]);
    expect(last(b.got)[0]).not.toHaveProperty('endsWith');
    expect(last(a.got)).toEqual(last(b.got));
    expect(last(dm)).toEqual([expect.objectContaining({ by: 'A1', endsWith: 'pc:thorin', duringFight: true })]);
    a.guest.clearAction();
    await settle(host, a.guest, b.guest);
    expect(last(b.got)).toEqual([]);
    expect(d.errors).toEqual([]);
  });

  test("a request from someone else's token is a violation; targeting a hidden token is refused without one", async () => {
    const { d, dm, host } = setup();
    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A2' });
    await settle(host);
    evil.deliver({ t: 'action', action: { sceneId: 's1', from: { tokenId: 't-bree' }, to: { tokenId: 't-ass' }, kind: 'intent' } });
    await settle(host);
    expect(d.errors).toEqual([]);
    expect(dm).toEqual([]);
    evil.deliver({ t: 'action', action: { sceneId: 's1', from: { tokenId: 't-thorin' }, to: { x: 300, y: 300 }, kind: 'intent' } });
    await settle(host);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their token/)]);
    expect(dm).toEqual([]);
    evil.deliver({ t: 'action', action: { sceneId: 's1', from: { x: 1, y: 1 }, to: { x: 3, y: 3 }, kind: 'attack' } });
    await settle(host);
    expect(String(d.errors.at(-1))).toMatch(/bad action/);
    expect(parseGuestMessage({ t: 'clearAction' })).toEqual({ t: 'clearAction' });
  });

  test("the DM's arrow from a hidden monster is not sent to players; one from a visible token is", async () => {
    const { d, dm, host } = setup();
    const a = player('A1'), down: string[] = [];
    connect(host, a.guest, down);
    await settle(host, a.guest);
    host.setDmAction({ sceneId: 's1', from: { tokenId: 't-ass' }, to: { tokenId: 't-thorin' }, kind: 'intent' });
    await settle(host, a.guest);
    expect(last(dm)).toHaveLength(1);
    expect(last(a.got)).toEqual([]);
    for (const m of down) expect(m).not.toContain('t-ass');
    host.setDmAction({ sceneId: 's1', from: { tokenId: 't-gob' }, to: { tokenId: 't-thorin' }, kind: 'intent' });
    await settle(host, a.guest);
    expect(last(dm).map((x) => x.endsWith)).toEqual([undefined, 'g1']); // the hidden monster has no combatant here
    expect(last(a.got).map((x) => x.from)).toEqual([{ tokenId: 't-gob' }]);
    host.clearAction();
    await settle(host, a.guest);
    expect(last(dm)).toEqual([]);
    expect(last(a.got)).toEqual([]);
    expect(d.errors).toEqual([]);
  });

  test("next turn clears the acting player's arrow for everyone", async () => {
    const { d, dm, host } = setup();
    const a = player('A1'), b = player('A2');
    connect(host, a.guest);
    connect(host, b.guest);
    await settle(host, a.guest, b.guest);
    a.guest.sendAction({ sceneId: 's1', from: { tokenId: 't-thorin' }, to: { tokenId: 't-gob' }, kind: 'intent' });
    b.guest.sendAction({ sceneId: 's1', from: { tokenId: 't-bree' }, to: { x: 300, y: 300 }, kind: 'intent' });
    await settle(host, a.guest, b.guest);
    expect(last(b.got).map((x) => x.by)).toEqual(['A1', 'A2']);
    d.combat = next(d.combat!).combat;
    host.trackerChanged();
    await settle(host, a.guest, b.guest);
    expect(last(a.got).map((x) => x.by)).toEqual(['A2']);
    expect(last(b.got).map((x) => x.by)).toEqual(['A2']);
    expect(last(dm).map((x) => x.by)).toEqual(['A2']);
    d.combat = undefined; // the fight ends: arrows made during it go
    host.trackerChanged();
    await settle(host, a.guest, b.guest);
    expect(last(b.got)).toEqual([]);
    expect(d.errors).toEqual([]);
  });
});
