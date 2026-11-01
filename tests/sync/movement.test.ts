// Map ↔ combat, Task A2: the host enforces movement budgets, players Dash, and the player tracker carries their own movement.
import { describe, expect, test } from 'vitest';
import { next } from '../../src/lib/combat/combat.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { cleanTracker, Guest, type GuestDeps } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { trackerForPlayers, type TrackerView } from '../../src/lib/sync/project.ts';
import { parseGuestMessage } from '../../src/lib/sync/protocol.ts';
import { moveCost, moveProblem } from '../../src/lib/sync/scene.ts';
import type { Campaign, CampaignSettings, Character, Combat, Combatant, Scene } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';
const settings = (o: Partial<CampaignSettings> = {}): CampaignSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });
// A human fighter: walk 30. Cells are 70 px and 5 ft (DEFAULT_GRID); Thorin starts on cell (0,0).
function thorin(): Character {
  const c = mkChar({ race: 'human', base: {}, levels: ['fighter'] });
  return { ...c, id: 'thorin', name: 'Thorin', campaignId: CID, ownerId: 'A1' };
}
const scene = (): Scene => ({
  id: 's1', campaignId: CID, name: 'Crypt', width: 700, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
  tokens: [{ id: 't-thorin', name: 'Thorin', x: 35, y: 35, size: 'M', color: '#c0392b', characterId: 'thorin' }],
});
const cell = (q: number, r = 0) => ({ x: 35 + 70 * q, y: 35 + 70 * r });
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (o: Partial<Combat> = {}): Combat => ({
  campaignId: CID, round: 1, turn: 'pc:thorin', groupMonsters: false, updatedAt: 0,
  combatants: [
    cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17 }),
    cb({ id: 'x1', kind: 'monster', name: 'Assassin', init: 15, hidden: true }),
    cb({ id: 'g1', kind: 'monster', name: 'Goblin 1', init: 12 }),
  ],
  ...o,
});
const mv = (feet: number, dashes = 0) => ({ feet, dashes });

test('moveCost: the grid distance and what is left; none without a budget', () => {
  const m = { tokenId: 't-thorin', ...cell(4, 1) };
  expect(moveCost(scene(), m, thorin(), fight({ movement: { 'pc:thorin': mv(5) } }), settings())).toEqual({ combatantId: 'pc:thorin', feet: 20, left: 25 });
  expect(moveCost(scene(), m, thorin(), fight(), settings({ freeMovement: true }))).toBeUndefined();
  expect(moveCost(scene(), m, thorin(), fight({ round: 0 }), settings())).toBeUndefined();
  expect(moveCost(scene(), m, thorin(), undefined, settings())).toBeUndefined();
  expect(moveCost(scene(), m, thorin(), fight({ combatants: [] }), settings())).toBeUndefined();
  const grappled = thorin();
  grappled.state.conditions = ['Grappled'];
  expect(moveCost(scene(), m, grappled, fight(), settings())!.left).toBe(0);
  expect(moveProblem(scene(), { sceneId: 's1', ...m }, 'A1', [grappled], fight(), settings())).toEqual({ error: 'too far', violation: false });
});

test('the parse: dash', () => {
  expect(parseGuestMessage({ t: 'dash', characterId: 'thorin', extra: 1 })).toEqual({ t: 'dash', characterId: 'thorin' });
  for (const characterId of [undefined, 5, 'x'.repeat(101)]) expect(parseGuestMessage({ t: 'dash', characterId })).toEqual({ error: 'bad dash' });
});

describe('engine', () => {
  const hosted = (): Campaign => ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } });
  function setup(combat: Combat = fight(), set = settings()) {
    const d = new Device();
    d.map = true;
    d.putCampaign({ ...hosted(), settings: set });
    d.edit(thorin());
    d.scene = scene();
    d.combat = combat;
    return { d, host: new Host(d.hostDeps(CID)) };
  }
  function player(playerId: string, o: Partial<GuestDeps> = {}) {
    const d = new Device(), trackers: (TrackerView | undefined)[] = [];
    return { d, trackers, guest: new Guest(d.guestDeps(CODE, { playerId, onTracker: (t) => { trackers.push(t); }, ...o })) };
  }
  const at = (d: Device) => { const t = d.scene!.tokens[0]; return { x: t.x, y: t.y }; };
  const scenes = (down: string[]) => down.filter((m) => JSON.parse(m).t === 'scene').length;
  async function joined(combat?: Combat, set?: CampaignSettings) {
    const { d, host } = setup(combat, set);
    const a = player('A1'), down: string[] = [];
    connect(host, a.guest, down);
    await settle(host, a.guest);
    const move = async (q: number, r = 0) => { a.guest.sendMove('s1', 't-thorin', cell(q, r)); await settle(host, a.guest); };
    return { d, host, a, down, move };
  }

  test('a move within budget lands and is recorded; past it is refused, re-sent, and no violation', async () => {
    const { d, down, move } = await joined();
    await move(4, 1);
    expect(at(d)).toEqual(cell(4, 1));
    expect(d.combat!.movement).toEqual({ 'pc:thorin': mv(20) });
    const before = JSON.stringify(d.scene), n = scenes(down);
    await move(7, 1); // 15 ft, 10 left
    expect(JSON.stringify(d.scene)).toBe(before);
    expect(scenes(down)).toBe(n + 1);
    expect(d.combat!.movement).toEqual({ 'pc:thorin': mv(20) });
    await move(4, 3); // exactly the 10 ft left
    expect(at(d)).toEqual(cell(4, 3));
    expect(d.combat!.movement).toEqual({ 'pc:thorin': mv(30) });
    expect(d.errors).toEqual([]);
  });

  test('free movement on, or setup: no budget, nothing recorded', async () => {
    const { d, move } = await joined(fight(), settings({ freeMovement: true }));
    await move(9, 9);
    expect(at(d)).toEqual(cell(9, 9));
    expect(d.combat!.movement).toBeUndefined();
    const s = await joined(fight({ round: 0 }), settings({ freeMovement: true }));
    await s.move(9, 9);
    expect(at(s.d)).toEqual(cell(9, 9));
    expect(s.d.combat!.movement).toBeUndefined();
  });

  test('a hidden turn after the PC keeps their leftover feet, and a move within them is accepted', async () => {
    const hiddenTurn = next(fight({ movement: { 'pc:thorin': mv(20) } })).combat;
    expect(hiddenTurn.turn).toBe('x1');
    const { d, move } = await joined(hiddenTurn);
    await move(2);
    expect(at(d)).toEqual(cell(2));
    expect(d.combat!.movement!['pc:thorin']).toEqual(mv(30));
    await move(3); // nothing left: refused like any stale move
    expect(at(d)).toEqual(cell(2));
    expect(d.errors).toEqual([]);
  });

  test('Dash: the owner on their turn doubles the budget; a non-owner is a violation; off-turn is ignored', async () => {
    const { d, host, a, move } = await joined();
    a.guest.sendDash('thorin');
    await settle(host, a.guest);
    expect(d.combat!.movement).toEqual({ 'pc:thorin': mv(0, 1) });
    await move(9); // 45 ft of 60
    expect(at(d)).toEqual(cell(9));

    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A2' });
    await settle(host);
    evil.deliver({ t: 'dash', characterId: 'thorin' });
    await settle(host);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their character/)]);
    expect(d.combat!.movement!['pc:thorin'].dashes).toBe(1);

    d.combat = fight({ turn: 'g1', movement: { 'pc:thorin': mv(45, 1) } });
    a.guest.sendDash('thorin');
    await settle(host, a.guest);
    expect(d.combat.movement).toEqual({ 'pc:thorin': mv(45, 1) });
    expect(d.errors.length).toBe(1);
  });

  test('Review Focus 1: the tracker carries the player\'s own movement, never a monster\'s; a reconnect gets it in its first tracker', async () => {
    const c = fight({ movement: { 'pc:thorin': mv(20, 1), g1: mv(15) } });
    const v = trackerForPlayers(c, [thorin()], settings(), undefined, 'A1')!;
    expect(v.rows.find((r) => r.characterId === 'thorin')!.moved).toEqual(mv(20, 1));
    expect(v.rows.filter((r) => r.moved).length).toBe(1);
    expect(trackerForPlayers(c, [thorin()], settings({ freeMovement: true }), undefined, 'A1')!.rows.some((r) => r.moved)).toBe(false);
    for (const viewer of ['A2', undefined]) expect(trackerForPlayers(c, [thorin()], settings(), undefined, viewer)!.rows.some((r) => r.moved)).toBe(false);

    const { host, move } = await joined();
    await move(4);
    const again = player('A1'), down: string[] = [];
    connect(host, again.guest, down);
    await settle(host, again.guest);
    expect(again.trackers[0]!.rows.find((r) => r.characterId === 'thorin')!.moved).toEqual(mv(20));
    const sent = JSON.parse(down.find((m) => JSON.parse(m).t === 'tracker')!).tracker as TrackerView;
    expect(sent.rows.filter((r) => r.moved).map((r) => r.characterId)).toEqual(['thorin']);
  });

  test('spec 1: another player never gets Thorin\'s movement; his owner does', async () => {
    const { host, a, move } = await joined();
    const b = player('A2'), downB: string[] = [];
    connect(host, b.guest, downB);
    await settle(host, a.guest, b.guest);
    await move(4);
    host.trackerChanged(); // the session's db change hook does this
    await settle(host, a.guest, b.guest);
    const thorinRow = (t: TrackerView | undefined) => t!.rows.find((r) => r.characterId === 'thorin')!;
    expect(thorinRow(a.trackers.at(-1)).moved).toEqual(mv(20));
    expect(thorinRow(b.trackers.at(-1))).toBeDefined();
    expect(thorinRow(b.trackers.at(-1)).moved).toBeUndefined();
    expect(downB.some((m) => m.includes('moved'))).toBe(false);
  });

  test('cleanTracker keeps a well-formed moved only', () => {
    const row = { id: 'pc:thorin', name: 'Thorin', characterId: 'thorin' };
    expect(cleanTracker({ round: 1, rows: [{ ...row, moved: mv(10, 1) }] })!.rows[0].moved).toEqual(mv(10, 1));
    expect(cleanTracker({ round: 1, rows: [{ ...row, moved: { feet: 5, dashes: 0, x: 1 } }] })!.rows[0].moved).toEqual(mv(5));
    for (const moved of [{ feet: '5', dashes: 0 }, { feet: 5 }, 'x', { feet: -5, dashes: 0 }]) expect(cleanTracker({ round: 1, rows: [{ ...row, moved }] })!.rows[0].moved).toBeUndefined();
  });
});
