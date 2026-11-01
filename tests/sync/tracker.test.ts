// Stage 4, Task 3: the player-facing tracker (an allowlist), its messages, and the initiative roll a player sends.
import { describe, expect, test } from 'vitest';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { computeSheet } from '../../src/lib/rules/sheet.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { cleanTracker, Guest, type GuestDeps } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { currentActor, healthStatus, trackerForPlayers, type TrackerView } from '../../src/lib/sync/project.ts';
import { INIT_MAX, INIT_MIN, parseGuestMessage } from '../../src/lib/sync/protocol.ts';
import type { Campaign, CampaignSettings, Character, Combat, Combatant, ItemDef } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';
import { connect, Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN';
const CID = 'c1';
const settings = (o: Partial<CampaignSettings> = {}): CampaignSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });

/** A fighter 3 (Con 14) with an equipped item whose +1 hp per level is hidden from the player: 28 max HP to them, 31 to the DM. */
function thorin(): Character {
  const amulet: ItemDef = { kind: 'item', id: 'item:amulet-of-vigor@HOMEBREW', name: 'Amulet of Vigor', source: 'HOMEBREW', text: [], type: 'wondrous', magic: true,
    effects: [{ type: 'bonus', target: 'hpPerLevel', value: 1 }] };
  const c = mkChar({ race: 'human', base: { con: 14 }, levels: ['fighter', 'fighter', 'fighter'] });
  return { ...c, id: 'thorin', name: 'Thorin', campaignId: CID, ownerId: 'A1', state: { ...c.state, hp: 20 },
    inventory: [{ ...makeEntry(amulet, { view: { name: 'Plain amulet', hidden: ['effects'], revealed: [] } }), equipped: true }] };
}
const spy = (): Character => ({ ...char('spy', CID), name: 'Spy', overrides: { maxHp: 9 }, state: { ...char('spy').state, hp: 4 } }); // DM-only (R13)
const bree = (): Character => ({ ...char('bree', CID), name: 'Bree', ownerId: 'A2' });

const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
function fight(o: Partial<Combat> = {}): Combat {
  return {
    campaignId: CID, round: 1, turn: 'pc:thorin', groupMonsters: false, updatedAt: 0, ...o,
    combatants: o.combatants ?? [
      cb({ id: 'lair', kind: 'lair', name: 'Lair actions', init: 20 }),
      cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17, ac: 18, conSave: 4 }),
      cb({ id: 'g1', kind: 'monster', name: 'Goblin 1', monsterId: 'monster:goblin@SRD', ac: 15, init: 12, hp: 3, maxHp: 7, conSave: 3, notes: 'Secret note',
        conditions: ['poisoned'], durations: { poisoned: { rounds: 2, at: 'end', of: 'g1' } }, concentrating: true, reactionUsed: true }),
      cb({ id: 'x1', kind: 'monster', name: 'Assassin', monsterId: 'monster:assassin@SRD', init: 10, hp: 78, maxHp: 78, hidden: true }),
      cb({ id: 'pc:spy', kind: 'pc', name: 'Spy', characterId: 'spy', init: 8 }),
    ],
  };
}
const LEAKS = ['Assassin', 'Secret note', 'monster:goblin@SRD', '"ac"', 'conSave', 'durations', '"maxHp":7', '"maxHp":9', '"maxHp":31', '"maxHp":78',
  'poisoned', 'concentrating', 'reactionUsed', 'notes', '"init":12', '"init":8', 'Amulet', '"x1"'];
const row = (v: TrackerView | undefined, id: string) => v?.rows.find((r) => r.id === id);

test('healthStatus', () => {
  const cases: [number | undefined, number | undefined, string | undefined][] = [
    [10, 10, 'Unhurt'], [9, 10, 'Hurt'], [6, 10, 'Hurt'], [5, 10, 'Bloodied'], [4, 7, 'Hurt'], [3, 7, 'Bloodied'], [0, 10, 'Down'], [5, undefined, undefined], [5, 0, undefined],
  ];
  for (const [hp, max, want] of cases) expect([hp, max, healthStatus(hp, max)]).toEqual([hp, max, want]);
});

describe('trackerForPlayers', () => {
  const chars = () => [thorin(), spy(), bree()];

  test('sends only the allowlist (Review Focus 1)', () => {
    const v = trackerForPlayers(fight(), chars(), settings())!;
    expect(v.rows.map((r) => r.id)).toEqual(['lair', 'pc:thorin', 'g1', 'pc:spy']);
    expect(Object.keys(row(v, 'pc:thorin')!).sort()).toEqual(['characterId', 'hp', 'id', 'init', 'maxHp', 'name']);
    expect(row(v, 'pc:thorin')).toMatchObject({ name: 'Thorin', characterId: 'thorin', init: 17, hp: 20, maxHp: 28 });
    expect(Object.keys(row(v, 'g1')!).sort()).toEqual(['health', 'id', 'name']);
    expect(row(v, 'g1')!.health).toBe('Bloodied');
    expect(Object.keys(row(v, 'lair')!).sort()).toEqual(['id', 'name']);
    expect(Object.keys(row(v, 'pc:spy')!).sort()).toEqual(['health', 'id', 'name']);
    expect(row(v, 'pc:spy')!.health).toBe('Bloodied');
    expect([v.round, v.current]).toEqual([1, 'pc:thorin']);
    const json = JSON.stringify(v);
    for (const s of LEAKS) expect(json).not.toContain(s);
  });

  test('no combat → undefined; a PC whose character is gone is skipped', () => {
    expect(trackerForPlayers(undefined, chars(), settings())).toBeUndefined();
    expect(trackerForPlayers(fight(), [spy()], settings())!.rows.map((r) => r.id)).toEqual(['lair', 'g1', 'pc:spy']);
  });

  test('health words follow the settings', () => {
    expect(Object.keys(row(trackerForPlayers(fight(), chars(), settings({ showMonsterHealth: false })), 'g1')!).sort()).toEqual(['id', 'name']);
    const off = settings();
    off.initiativeModules.hp = false;
    expect(Object.keys(row(trackerForPlayers(fight(), chars(), off), 'g1')!).sort()).toEqual(['id', 'name']);
    expect(Object.keys(row(trackerForPlayers(fight(), chars(), off), 'pc:spy')!).sort()).toEqual(['id', 'name']);
  });

  test('setup sends player characters only', () => {
    const v = trackerForPlayers(fight({ round: 0 }), chars(), settings())!;
    expect(v.rows.map((r) => r.id)).toEqual(['pc:thorin']);
    expect(v.current).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/Goblin|Lair|Spy/);
  });

  test('a hidden current turn is not revealed', () => {
    const v = trackerForPlayers(fight({ turn: 'x1' }), chars(), settings())!;
    expect(v.current).toBeUndefined();
    expect('current' in v).toBe(false);
  });

  test('a PC\'s max HP is the player view\'s', () => {
    const t = thorin();
    const pl = computeSheet(t, { settings: settings(), viewer: 'player' }).maxHp, dm = computeSheet(t, { settings: settings(), viewer: 'dm' }).maxHp;
    expect(pl).toBeLessThan(dm);
    expect(row(trackerForPlayers(fight(), chars(), settings()), 'pc:thorin')!.maxHp).toBe(pl);
  });

  test('currentActor', () => {
    expect(currentActor(trackerForPlayers(fight(), chars(), settings()))).toBe('thorin');
    expect(currentActor(trackerForPlayers(fight({ turn: 'g1' }), chars(), settings()))).toBeUndefined();
    expect(currentActor(undefined)).toBeUndefined();
  });
});

describe('engine', () => {
  const hosted = (): Campaign => ({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } });

  function setup(combat?: Combat) {
    const d = new Device();
    d.putCampaign(hosted());
    for (const c of [thorin(), spy(), bree()]) d.edit(c);
    d.combat = combat;
    const calls: unknown[][] = [];
    const host = new Host({ ...d.hostDeps(CID), onInitiative: (...a) => { calls.push(a); } });
    return { d, host, calls };
  }
  function player(playerId: string, o: Partial<GuestDeps> = {}) {
    const d = new Device(), views: (TrackerView | undefined)[] = [];
    return { d, views, guest: new Guest(d.guestDeps(CODE, { playerId, onTracker: (t) => { views.push(t); }, ...o })) };
  }
  const trackers = (down: string[]) => down.filter((m) => JSON.parse(m).t === 'tracker');

  test('the DM\'s changes reach the players; a player joining mid-fight gets it after its welcome; nothing hidden is in any message', async () => {
    const { d, host } = setup(fight({ round: 0, turn: undefined }));
    const a = player('A1'), down: string[] = [];
    connect(host, a.guest, down);
    await settle(host, a.guest);
    expect(a.views.at(-1)!.rows.map((r) => r.id)).toEqual(['pc:thorin']); // setup: no monsters yet

    d.combat = fight();
    host.trackerChanged();
    await settle(host, a.guest);
    expect(a.views.at(-1)!.round).toBe(1);
    expect(a.views.at(-1)!.rows.map((r) => r.id)).toEqual(['lair', 'pc:thorin', 'g1', 'pc:spy']);

    const b = player('A2'), downB: string[] = [];
    connect(host, b.guest, downB);
    await settle(host, a.guest, b.guest);
    expect(downB.map((m) => JSON.parse(m).t).filter((t) => t !== 'chars').slice(0, 2)).toEqual(['welcome', 'tracker']);
    expect(b.views.at(-1)).toEqual(a.views.at(-1));

    // the DM damages Thorin: the next view has the new hp; a character not in the fight sends no tracker
    d.edit({ ...d.char('thorin')!, state: { ...d.char('thorin')!.state, hp: 9 } });
    host.characterChanged('thorin');
    await settle(host, a.guest, b.guest);
    expect(row(a.views.at(-1), 'pc:thorin')!.hp).toBe(9);
    const n = trackers(down).length;
    d.edit({ ...d.char('bree')!, details: { ...d.char('bree')!.details, notes: 'x' } });
    host.characterChanged('bree');
    await settle(host, a.guest, b.guest);
    expect(trackers(down).length).toBe(n);

    // B's own edit of a combatant (made on their device) reaches A's tracker too
    d.combat = fight({ combatants: [...fight().combatants, cb({ id: 'pc:bree', kind: 'pc', name: 'Bree', characterId: 'bree', init: 5 })] });
    host.trackerChanged();
    await settle(host, a.guest, b.guest);
    b.d.edit({ ...b.d.char('bree')!, state: { ...b.d.char('bree')!.state, hp: 6 } });
    b.guest.characterChanged('bree');
    await settle(host, a.guest, b.guest);
    expect(row(a.views.at(-1), 'pc:bree')!.hp).toBe(6);

    // the fight ends: players are told
    d.combat = undefined;
    host.trackerChanged();
    await settle(host, a.guest, b.guest);
    expect(a.views.at(-1)).toBeUndefined();

    expect(trackers(down).length).toBeGreaterThan(4);
    for (const m of [...trackers(down), ...trackers(downB)]) for (const s of LEAKS) expect(m).not.toContain(s);
    for (const m of [...down, ...downB]) for (const s of ['Assassin', 'Secret note', 'monster:', '"maxHp":31']) expect(m).not.toContain(s);
  });

  test('a settings change re-sends the tracker', async () => {
    const { d, host } = setup(fight());
    const a = player('A1');
    connect(host, a.guest);
    await settle(host, a.guest);
    expect(row(a.views.at(-1), 'g1')!.health).toBe('Bloodied');
    d.campaigns.get(CID)!.settings.showMonsterHealth = false;
    host.campaignChanged();
    await settle(host, a.guest);
    expect(row(a.views.at(-1), 'g1')!.health).toBeUndefined();
  });

  test('initiative messages are validated (Review Focus 4)', async () => {
    const { d, host, calls } = setup(fight({ round: 0, turn: undefined }));
    const a = player('A1'), up: string[] = [];
    connect(host, a.guest, [], up);
    await settle(host, a.guest);
    const before = JSON.stringify(d.combat);

    a.guest.sendInitiative('thorin', 17);
    await settle(host, a.guest);
    expect(calls).toEqual([['thorin', 17, 'A1']]);
    // the guest itself never sends a bad one
    const sent = up.length;
    for (const [id, n] of [['bree', 15], ['thorin', 17.5], ['thorin', 51], ['thorin', -11], ['nobody', 12]] as const) a.guest.sendInitiative(id, n);
    await settle(host, a.guest);
    expect(up.length).toBe(sent);

    const crafted: [unknown, RegExp][] = [
      [{ t: 'initiative', characterId: 'bree', total: 15 }, /not their character/],
      [{ t: 'initiative', characterId: 'spy', total: 15 }, /not their character/],
      [{ t: 'initiative', characterId: 'nobody', total: 15 }, /not their character/],
      [{ t: 'initiative', characterId: 'thorin', total: 17.5 }, /bad initiative/],
      [{ t: 'initiative', characterId: 'thorin', total: 51 }, /bad initiative/],
      [{ t: 'initiative', characterId: 'thorin', total: -11 }, /bad initiative/],
      [{ t: 'initiative', characterId: 'thorin', total: '17' }, /bad initiative/],
      [{ t: 'initiative', characterId: 'x'.repeat(101), total: 10 }, /bad initiative/],
    ];
    for (const [m, why] of crafted) {
      const evil = rawLink();
      host.accept(evil.link);
      evil.deliver({ t: 'hello', code: CODE, playerId: 'A1' });
      await settle(host);
      d.errors = [];
      evil.deliver(m);
      await settle(host);
      expect(String(d.errors[0])).toMatch(why);
      expect(evil.closed()).toBe(false); // one strike
      evil.link.close();
    }
    expect(calls.length).toBe(1);
    expect(JSON.stringify(d.combat)).toBe(before);
  });

  test('the shape check: an integer from INIT_MIN to INIT_MAX', () => {
    expect([INIT_MIN, INIT_MAX]).toEqual([-10, 50]);
    expect(parseGuestMessage({ t: 'initiative', characterId: 'c', total: -10 })).toEqual({ t: 'initiative', characterId: 'c', total: -10 });
    expect(parseGuestMessage({ t: 'initiative', characterId: 'c', total: 50, extra: 1 })).toEqual({ t: 'initiative', characterId: 'c', total: 50 });
    expect(parseGuestMessage({ t: 'initiative', characterId: 'c', total: NaN })).toEqual({ error: 'bad initiative' });
    expect(parseGuestMessage({ t: 'initiative', total: 5 })).toEqual({ error: 'bad initiative' });
  });
});

test('cleanTracker', () => {
  expect(cleanTracker({ round: 1, rows: [{ id: 5 }, { id: 'x', name: 'Goblin 1', health: 'Wounded' }] })).toEqual({ round: 1, rows: [{ id: 'x', name: 'Goblin 1' }] });
  expect(cleanTracker({ round: 2, rows: Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, name: 'G' })) })!.rows.length).toBe(200);
  const v = cleanTracker({ round: 1, current: 'p', extra: 'x', rows: [{ id: 'p', name: 'Thorin', characterId: 'thorin', init: 17, hp: Infinity, maxHp: 28, ac: 18, notes: 'n' }] });
  expect(v).toEqual({ round: 1, current: 'p', rows: [{ id: 'p', name: 'Thorin', characterId: 'thorin', init: 17, maxHp: 28 }] });
  expect(cleanTracker({ round: 1, current: 'gone', rows: [] })).toEqual({ round: 1, rows: [] });
  expect(cleanTracker({ round: 1, rows: [{ id: 'x', name: 'n'.repeat(201) }] })!.rows).toEqual([]);
  expect(cleanTracker('nope')).toBeUndefined();
  expect(cleanTracker({ round: 'one', rows: [] })).toBeUndefined();
});
