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
/** An entry whose turn origin is cell (q, r). */
const mv = (q: number, dashes = 0, r = 0) => ({ from: cell(q, r), dashes });

test('moveCost: the distance from the turn origin and the budget; none without a budget', () => {
  const m = { tokenId: 't-thorin', ...cell(4, 1) };
  expect(moveCost(scene(), m, thorin(), fight(), settings())).toEqual({ combatantId: 'pc:thorin', feet: 20, budget: 30 }); // no origin yet: from the token
  expect(moveCost(scene(), m, thorin(), fight({ movement: { 'pc:thorin': mv(1) } }), settings())).toEqual({ combatantId: 'pc:thorin', feet: 15, budget: 30 }); // from the origin
  expect(moveCost(scene(), m, thorin(), fight({ movement: { 'pc:thorin': { feet: 25, dashes: 1 } as never } }), settings())).toEqual({ combatantId: 'pc:thorin', feet: 20, budget: 60 }); // an old entry
  expect(moveCost(scene(), m, thorin(), fight(), settings({ freeMovement: true }))).toBeUndefined();
  expect(moveCost(scene(), m, thorin(), fight({ round: 0 }), settings())).toBeUndefined();
  expect(moveCost(scene(), m, thorin(), undefined, settings())).toBeUndefined();
  expect(moveCost(scene(), m, thorin(), fight({ combatants: [] }), settings())).toBeUndefined();
  const grappled = thorin();
  grappled.state.conditions = ['Grappled'];
  expect(moveCost(scene(), m, grappled, fight(), settings())!.budget).toBe(0);
  expect(moveProblem(scene(), { sceneId: 's1', ...m }, 'A1', [grappled], fight(), settings())).toEqual({ error: 'too far', violation: false });
});

test('the parse: use and endTurn; the old dash message is gone', () => {
  expect(parseGuestMessage({ t: 'dash', characterId: 'thorin' })).toEqual({ error: 'unknown message' });
  expect(parseGuestMessage({ t: 'use', characterId: 'thorin', action: 'std:dash', extra: 1 })).toEqual({ t: 'use', characterId: 'thorin', action: 'std:dash' });
  expect(parseGuestMessage({ t: 'use', characterId: 'thorin', action: 'spell:x', slot: 3 })).toEqual({ t: 'use', characterId: 'thorin', action: 'spell:x', slot: 3 });
  for (const slot of [0, 10, 1.5, '2']) expect(parseGuestMessage({ t: 'use', characterId: 'thorin', action: 'a', slot })).toEqual({ error: 'bad use' });
  expect(parseGuestMessage({ t: 'use', characterId: 5, action: 'a' })).toEqual({ error: 'bad use' });
  expect(parseGuestMessage({ t: 'use', characterId: 'thorin', action: 'a', target: 'g1' })).toEqual({ t: 'use', characterId: 'thorin', action: 'a', target: 'g1' });
  expect(parseGuestMessage({ t: 'use', characterId: 'thorin', action: 'a', target: 5 })).toEqual({ error: 'bad use' });
  expect(parseGuestMessage({ t: 'endTurn', characterId: 'thorin' })).toEqual({ t: 'endTurn', characterId: 'thorin' });
  expect(parseGuestMessage({ t: 'endTurn' })).toEqual({ error: 'bad endTurn' });
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

  test('the first move sets the turn origin; a drop past the budget from it is refused, re-sent, no violation; moving back refunds', async () => {
    const { d, down, move } = await joined();
    await move(4, 1);
    expect(at(d)).toEqual(cell(4, 1));
    expect(d.combat!.movement).toEqual({ 'pc:thorin': mv(0) }); // where Thorin stood before the move
    const before = JSON.stringify(d.scene), n = scenes(down);
    await move(7, 1); // 35 ft from the origin
    expect(JSON.stringify(d.scene)).toBe(before);
    expect(scenes(down)).toBe(n + 1);
    await move(6, 3); // exactly 30 ft from the origin
    expect(at(d)).toEqual(cell(6, 3));
    await move(1); // a slip taken back: 5 ft from the origin
    expect(at(d)).toEqual(cell(1));
    await move(0, 6); // so 30 ft the other way is fine
    expect(at(d)).toEqual(cell(0, 6));
    expect(d.combat!.movement).toEqual({ 'pc:thorin': mv(0) });
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
    const hiddenTurn = next(fight({ movement: { 'pc:thorin': mv(4) } })).combat; // Thorin stands 20 ft from his turn origin
    expect(hiddenTurn.turn).toBe('x1');
    const { d, move } = await joined(hiddenTurn);
    await move(0, 6); // 30 ft from the origin
    expect(at(d)).toEqual(cell(0, 6));
    expect(d.combat!.movement!['pc:thorin']).toEqual(mv(4));
    await move(0, 7); // 35 ft: refused like any stale move
    expect(at(d)).toEqual(cell(0, 6));
    expect(d.errors).toEqual([]);
  });

  test('Dash (the standard action): the owner on their turn spends the Action and doubles the budget; a non-owner is a violation; off-turn is refused', async () => {
    const { d, host, a, move } = await joined();
    a.guest.sendUse('thorin', 'std:dash');
    await settle(host, a.guest);
    expect(d.combat!.movement).toEqual({ 'pc:thorin': { dashes: 1 } });
    expect(d.combat!.combatants.find((x) => x.id === 'pc:thorin')!.economy).toMatchObject({ used: 1 });
    await move(9); // 45 ft of 60
    expect(at(d)).toEqual(cell(9));

    const evil = rawLink();
    host.accept(evil.link);
    evil.deliver({ t: 'hello', code: CODE, playerId: 'A2' });
    await settle(host);
    evil.deliver({ t: 'use', characterId: 'thorin', action: 'std:dash' });
    await settle(host);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their character/)]);
    expect(d.combat!.movement!['pc:thorin'].dashes).toBe(1);

    d.combat = fight({ turn: 'g1', movement: { 'pc:thorin': mv(9, 1) } });
    a.guest.sendUse('thorin', 'std:dash');
    await settle(host, a.guest);
    expect(d.combat.movement).toEqual({ 'pc:thorin': mv(9, 1) });
    expect(d.errors.length).toBe(1);
  });

  test('a second Dash with no Action left is refused with a reason, quietly (no violation), and spends nothing', async () => {
    const { d, host } = await joined();
    const owner = rawLink();
    host.accept(owner.link);
    owner.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    owner.deliver({ t: 'use', characterId: 'thorin', action: 'std:dash' });
    owner.deliver({ t: 'use', characterId: 'thorin', action: 'std:dash' });
    await settle(host);
    expect(d.combat!.movement!['pc:thorin'].dashes).toBe(1);
    expect((owner.got as { t: string }[]).filter((m) => m.t === 'useRefused')).toEqual([{ t: 'useRefused', reason: 'no Action left' }]);
    expect(d.errors).toEqual([]);
  });

  // Turn panel, Task 3: players use actions and end their own turn through the DM's device.
  test('use: an attack spends the Action; a second is refused with a reason and spends nothing (RF1)', async () => {
    const { d, host, a } = await joined();
    const refused: string[] = [];
    a.guest.sendUse('thorin', 'attack:unarmed');
    await settle(host, a.guest);
    expect(d.combat!.combatants.find((x) => x.id === 'pc:thorin')!.economy).toMatchObject({ used: 1, attacks: 1 });
    const owner = rawLink();
    host.accept(owner.link);
    owner.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    owner.deliver({ t: 'use', characterId: 'thorin', action: 'attack:unarmed' });
    await settle(host);
    for (const m of owner.got as { t: string; reason?: string }[]) if (m.t === 'useRefused') refused.push(m.reason!);
    expect(refused).toEqual(['no Action left']);
    expect(d.combat!.combatants.find((x) => x.id === 'pc:thorin')!.economy).toMatchObject({ used: 1 });
    expect(d.errors).toEqual([]);
  });

  test('use: a resource spends its pip and a use on the character; with none left it is refused', async () => {
    const { d, host, a } = await joined();
    a.guest.sendUse('thorin', 'res:Second Wind');
    await settle(host, a.guest);
    expect(d.char('thorin')!.state.resourcesUsed['Second Wind']).toBe(1); // its pip follows its text (the fixture's names none; the SRD's a bonus action)
    d.combat = fight(); // a fresh turn, but the use is gone until a rest
    a.guest.sendUse('thorin', 'res:Second Wind');
    await settle(host, a.guest);
    expect(d.char('thorin')!.state.resourcesUsed['Second Wind']).toBe(1);
  });

  test('off its turn an action is refused (RF3); an unknown action is refused', async () => {
    const { d, host } = await joined(fight({ turn: 'g1' }));
    const owner = rawLink();
    host.accept(owner.link);
    owner.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
    await settle(host);
    owner.deliver({ t: 'use', characterId: 'thorin', action: 'std:dodge' });
    owner.deliver({ t: 'use', characterId: 'thorin', action: 'spell:nope' });
    await settle(host);
    expect((owner.got as { t: string; reason?: string }[]).filter((m) => m.t === 'useRefused').map((m) => m.reason)).toEqual(['not your turn', 'that action is not available']);
    expect(d.combat!.combatants.find((x) => x.id === 'pc:thorin')!.economy).toBeUndefined();
  });

  test('endTurn: ignored off-turn; on their turn it passes the turn and expires durations like Next (RF5)', async () => {
    const poisoned = fight({ combatants: [...fight().combatants.slice(0, 2), cb({ id: 'g1', kind: 'monster', name: 'Goblin 1', init: 12, conditions: ['Poisoned'], durations: { Poisoned: { rounds: 1, at: 'end', of: 'pc:thorin' } } })] });
    const { d, host, a } = await joined({ ...poisoned, turn: 'g1' });
    a.guest.sendEndTurn('thorin');
    await settle(host, a.guest);
    expect(d.combat!.turn).toBe('g1');
    d.combat = poisoned;
    a.guest.sendEndTurn('thorin');
    await settle(host, a.guest);
    expect(d.combat.turn).toBe('x1');
    expect(d.combat.combatants.find((x) => x.id === 'g1')!.conditions).toEqual([]);
    expect(d.errors).toEqual([]);
  });

  test('final review: while a hidden creature acts after Thorin, his player can neither end its turn nor take an action', async () => {
    const { d, host, a } = await joined(fight({ turn: 'x1' }));
    a.guest.sendEndTurn('thorin');
    a.guest.sendUse('thorin', 'std:dodge');
    await settle(host, a.guest);
    expect(d.combat!.turn).toBe('x1');
    expect(d.combat!.combatants.find((x) => x.id === 'pc:thorin')!.economy).toBeUndefined();
    a.guest.sendUse('thorin', 'std:dodge'); // still refused on a second try
    await settle(host, a.guest);
    expect(d.combat!.turn).toBe('x1');
  });

  test('pips reach only their owner: another player gets no econ for Thorin', () => {
    const c = fight({ combatants: fight().combatants.map((x) => (x.id === 'pc:thorin' ? { ...x, economy: { used: 1, extra: 0, bonus: false, attacks: 1 } } : x)) });
    expect(trackerForPlayers(c, [thorin()], settings(), undefined, 'A1')!.rows[0].econ).toMatchObject({ used: 1, attacks: 1, perAction: 1, reaction: false });
    expect(trackerForPlayers(c, [thorin()], settings(), undefined, 'A2')!.rows[0].econ).toBeUndefined();
    expect(cleanTracker(JSON.parse(JSON.stringify(trackerForPlayers(c, [thorin()], settings(), undefined, 'A1'))))!.rows[0].econ).toMatchObject({ used: 1 });
  });

  test('Review Focus 1: the tracker carries the player\'s own movement, never a monster\'s; a reconnect gets it in its first tracker', async () => {
    const c = fight({ movement: { 'pc:thorin': mv(2, 1), g1: mv(3) } });
    const v = trackerForPlayers(c, [thorin()], settings(), undefined, 'A1')!;
    expect(v.rows.find((r) => r.characterId === 'thorin')!.moved).toEqual(mv(2, 1));
    expect(v.rows.filter((r) => r.moved).length).toBe(1);
    expect(trackerForPlayers(c, [thorin()], settings({ freeMovement: true }), undefined, 'A1')!.rows.some((r) => r.moved)).toBe(false);
    for (const viewer of ['A2', undefined]) expect(trackerForPlayers(c, [thorin()], settings(), undefined, viewer)!.rows.some((r) => r.moved)).toBe(false);

    const { host, move } = await joined();
    await move(4);
    const again = player('A1'), down: string[] = [];
    connect(host, again.guest, down);
    await settle(host, again.guest);
    expect(again.trackers[0]!.rows.find((r) => r.characterId === 'thorin')!.moved).toEqual(mv(0));
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
    expect(thorinRow(a.trackers.at(-1)).moved).toEqual(mv(0));
    expect(thorinRow(b.trackers.at(-1))).toBeDefined();
    expect(thorinRow(b.trackers.at(-1)).moved).toBeUndefined();
    expect(downB.some((m) => m.includes('moved'))).toBe(false);
  });

  test('cleanTracker keeps a well-formed moved only', () => {
    const row = { id: 'pc:thorin', name: 'Thorin', characterId: 'thorin' };
    expect(cleanTracker({ round: 1, rows: [{ ...row, moved: mv(10, 1) }] })!.rows[0].moved).toEqual(mv(10, 1));
    expect(cleanTracker({ round: 1, rows: [{ ...row, moved: { ...mv(5), feet: 5, x: 1 } }] })!.rows[0].moved).toEqual(mv(5));
    expect(cleanTracker({ round: 1, rows: [{ ...row, moved: { from: { x: 'a', y: 1 }, dashes: 1 } }] })!.rows[0].moved).toEqual({ dashes: 1 }); // a bad origin: none
    for (const moved of [{ from: cell(1), dashes: '0' }, { from: cell(1) }, 'x', { dashes: -1 }]) expect(cleanTracker({ round: 1, rows: [{ ...row, moved }] })!.rows[0].moved).toBeUndefined();
  });
});
