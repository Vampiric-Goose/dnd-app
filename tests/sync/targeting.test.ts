import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { cleanOutcome, cleanSettings, cleanTracker } from '../../src/lib/sync/guest.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { parseGuestMessage } from '../../src/lib/sync/protocol.ts';
import type { TrackerView } from '../../src/lib/sync/project.ts';
import type { Campaign, CampaignSettings, Character, Combat, Combatant, Scene, SpellDef } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp } from '../fixtures/records.ts';
import { Device, rawLink, settle } from './fakes.ts';

// Targeting over sync: the player's device sends raw dice with the use; the DM's device checks them, works out hits and saves, applies
// damage, and answers only the acting player (hit or miss, a spell's DC, the visible creatures caught). No AC, no monster save roll, no
// hidden creature ever reaches a player. A PC caught in an area gets a save prompt of its own.
const CODE = 'ABCDEFGHJKMN', CID = 'c1';
const settings = (o: Partial<CampaignSettings> = {}): CampaignSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...o });
const cell = (q: number, r = 0) => ({ x: 35 + 70 * q, y: 35 + 70 * r }); // 70 px, 5 ft cells
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
// Paraphrased Ice-Knife-like spell (no book text): a ranged spell attack, then a 5-foot burst with a Dex save.
const shard: SpellDef = { kind: 'spell', id: 'spell:shard@FIX', name: 'Shard', source: 'FIX', level: 1, school: 'conjuration', castingTime: '1 action', range: '60 feet',
  components: { s: true }, duration: 'Instantaneous', concentration: false, ritual: false, classes: ['wizard'],
  text: [{ p: 'Make a ranged spell attack against the target. On a hit, the target takes 1d10 piercing damage. Hit or miss, the shard bursts: the target and each creature within 5 feet of it must succeed on a Dexterity saving throw or take 2d6 cold damage.' }] };

// Paraphrased: a bolt whose d8s pick its type and leap on a match (Chaos Bolt's rule applies by name).
const bolt: SpellDef = { ...shard, id: 'spell:chaos-bolt@FIX', name: 'Chaos Bolt', range: '120 feet', text: [{ p: 'Make a ranged spell attack against the target. On a hit, the target takes 2d8 + 1d6 damage.' }] };

function thorin(): Character {
  const c = mkChar({ race: 'human', base: { str: 16 }, levels: ['fighter'] });
  return { ...c, id: 'thorin', name: 'Thorin', campaignId: CID, ownerId: 'A1' };
}
function mira(): Character {
  const c = mkChar({ race: 'human', base: { int: 16 }, levels: ['wizard'] });
  return { ...c, id: 'mira', name: 'Mira', campaignId: CID, ownerId: 'A2', embedded: { ...c.embedded, [shard.id]: shard, [bolt.id]: bolt },
    build: { ...c.build, spells: { 'class:wizard@FIX': { known: [shard.id, bolt.id], prepared: [shard.id, bolt.id] } } } };
}
const scene = (): Scene => ({
  id: 's1', campaignId: CID, name: 'Field', width: 1400, height: 1400, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
  tokens: [
    { id: 't-thorin', name: 'Thorin', ...cell(0), size: 'M', color: '#c0392b', characterId: 'thorin' },
    { id: 't-mira', name: 'Mira', ...cell(0, 6), size: 'M', color: '#8e44ad', characterId: 'mira' },
    { id: 't-g1', name: 'Goblin 1', ...cell(1), size: 'M', color: '#27ae60', combatantId: 'g1' },
    { id: 't-g2', name: 'Goblin 2', ...cell(6), size: 'M', color: '#27ae60', combatantId: 'g2' },
    { id: 't-x1', name: 'Assassin', ...cell(7), size: 'M', color: '#000000', combatantId: 'x1', hidden: true },
  ],
});
const fight = (o: Partial<Combat> = {}): Combat => ({
  campaignId: CID, round: 1, turn: 'pc:thorin', groupMonsters: false, updatedAt: 0,
  combatants: [
    cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17 }),
    cb({ id: 'pc:mira', kind: 'pc', name: 'Mira', characterId: 'mira', init: 16 }),
    cb({ id: 'g1', kind: 'monster', name: 'Goblin 1', init: 12, ac: 15, hp: 7, maxHp: 7 }),
    cb({ id: 'g2', kind: 'monster', name: 'Goblin 2', init: 11, ac: 15, hp: 7, maxHp: 7 }),
    cb({ id: 'x1', kind: 'monster', name: 'Assassin', init: 10, ac: 15, hp: 30, maxHp: 30, hidden: true }),
  ],
  ...o,
});

describe('targeting over sync', () => {
  const hosted = (set: CampaignSettings): Campaign => ({ ...camp(CID), name: 'Ravenloft', settings: set, sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } });
  async function joined(o: { combat?: Combat; set?: CampaignSettings } = {}) {
    const d = new Device();
    d.map = true;
    d.putCampaign(hosted(o.set ?? settings()));
    d.edit(thorin());
    d.edit(mira());
    d.scene = scene();
    d.combat = o.combat ?? fight();
    const host = new Host(d.hostDeps(CID));
    const link = (playerId: string) => { const r = rawLink(); host.accept(r.link); r.deliver({ t: 'hello', code: CODE, playerId }); return r; };
    const a = link('A1'), b = link('A2');
    await settle(host);
    return { d, host, a, b };
  }
  const outcomes = (r: { got: unknown[] }) => (r.got as { t: string }[]).filter((m) => m.t === 'outcome');
  const refusals = (r: { got: unknown[] }) => (r.got as { t: string; reason?: string }[]).filter((m) => m.t === 'useRefused').map((m) => m.reason);
  const hp = (d: Device, id: string) => d.combat!.combatants.find((x) => x.id === id)!.hp;
  const aliasOf = (r: { got: unknown[] }, name: string) => {
    const t = (r.got as { t: string; tracker?: TrackerView }[]).filter((m) => m.t === 'tracker').at(-1)!.tracker!;
    return t.rows.find((x) => x.name === name)!.id;
  };
  const strike = (target: string, d20: number[], dmg: number[][]) =>
    ({ t: 'use', characterId: 'thorin', action: 'attack:unarmed', aim: { target, rolled: { d20, dmg }, toggles: [] } });

  test('the parse keeps a well-formed aim and drops a malformed one', () => {
    const ok = parseGuestMessage(strike('g1', [17], [[]]));
    expect(ok).toMatchObject({ t: 'use', aim: { target: 'g1', rolled: { d20: [17], dmg: [[]] }, toggles: [] } });
    expect(parseGuestMessage({ ...strike('g1', [17], [[]]), aim: { rolled: { d20: ['x'], dmg: [] }, toggles: [] } })).toMatchObject({ error: 'bad use' });
    const typed = (dtype: unknown) => parseGuestMessage({ ...strike('g1', [17], [[]]), aim: { ...strike('g1', [17], [[]]).aim, dtype } });
    expect(typed('fire')).toMatchObject({ aim: { dtype: 'fire' } });
    expect(typed(7)).toMatchObject({ error: 'bad use' });
    const rays = (targets: unknown, d20: number[]) => parseGuestMessage({ ...strike('g1', d20, [[], [], []]), aim: { targets, rolled: { d20, dmg: [[], [], []] }, toggles: [] } });
    expect(rays(['g1', 'g1', 'g2'], [1, 2, 3, 4, 5, 6])).toMatchObject({ aim: { targets: ['g1', 'g1', 'g2'], rolled: { d20: [1, 2, 3, 4, 5, 6] } } });
    expect(rays(Array(13).fill('g1'), [1, 2])).toMatchObject({ error: 'bad use' });
    expect(parseGuestMessage({ t: 'leap', characterId: 'mira', resolution: 'r1', aim: { target: 'g2', rolled: { d20: [3, 4], dmg: [[1, 2, 3]] }, toggles: [] } }))
      .toMatchObject({ t: 'leap', characterId: 'mira', resolution: 'r1', aim: { target: 'g2' } });
    expect(parseGuestMessage({ t: 'save', resolution: 'r1', characterId: 'mira', d20: 12 })).toEqual({ t: 'save', resolution: 'r1', characterId: 'mira', d20: 12 });
    expect(parseGuestMessage({ t: 'save', resolution: 'r1', characterId: 'mira', d20: 21 })).toMatchObject({ error: 'bad save' });
  });

  test('an adjacent goblin: a hit takes its HP; the player hears "hit", never the AC', async () => {
    const { d, host, a } = await joined();
    a.deliver(strike(aliasOf(a, 'Goblin 1'), [17], [[]])); // unarmed: 1 + Str 3 = 4 bludgeoning, no dice
    await settle(host);
    expect(hp(d, 'g1')).toBe(3);
    expect(outcomes(a)).toEqual([{ t: 'outcome', action: 'Unarmed Strike', hit: true }]);
    expect(JSON.stringify(a.got)).not.toMatch(/"ac"/);
    expect(d.combat!.resolutions).toHaveLength(1);
    expect(d.combat!.resolutions![0].undo?.before.combatants['pc:thorin'].economy?.used ?? 0).toBe(0); // taken before paying: Undo gives the Action back
  });

  test('Every Spell, Review Focus 1: Bless on a player\'s character adds its d4 to the attack the player sends', async () => {
    const { d, host, a } = await joined();
    d.edit({ ...thorin(), state: { ...thorin().state, conditions: ['Bless'] } });
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // the d4 shows 4, rolled on the DM's device
    a.deliver(strike(aliasOf(a, 'Goblin 1'), [9], [[]])); // 9 + 5 = 14 misses AC 15; + 4 hits
    await settle(host);
    vi.restoreAllMocks();
    expect(outcomes(a)).toEqual([{ t: 'outcome', action: 'Unarmed Strike', hit: true }]);
    expect(d.combat!.resolutions![0].outcomes[0].note).toMatch(/Bless \+4/);
  });

  test('Review Focus 5: a player whose device left out the rider\'s dice is refused; with them, the hit carries the extra damage', async () => {
    const k = fight();
    const { d, host, a } = await joined({ combat: { ...k, combatants: k.combatants.map((x) => (x.id === 'pc:thorin' ? { ...x, rider: { spell: 'Divine Favor', dice: '1d4', type: 'radiant' } } : x)) } });
    a.deliver(strike('t-g1', [17], [[]]));
    await settle(host);
    expect(refusals(a)).toEqual(['bad damage dice']);
    a.deliver(strike('t-g1', [17], [[], [2]]));
    await settle(host);
    expect(hp(d, 'g1')).toBe(1); // 4 + 2
  });

  test('Chaos Bolt leaps once from the creature it hit, to one it has not hit; nothing more is paid', async () => {
    const hit: Combat['resolutions'] = [{ id: 'r1', actor: 'pc:mira', action: 'Chaos Bolt', outcomes: [{ id: 'g1', part: 'hit', hit: true, damage: 5, leap: true }], applied: [], at: 0, chain: ['g1'], slot: 1 }];
    const { d, host, b } = await joined({ combat: fight({ turn: 'pc:mira', resolutions: hit }) });
    const leap = (target: string) => b.deliver({ t: 'leap', characterId: 'mira', resolution: 'r1', aim: { target, rolled: { d20: [18, 18], dmg: [[1, 2, 4]] }, toggles: [] } });
    leap('t-g1');
    leap('t-g2');
    leap('t-g2');
    await settle(host);
    expect(refusals(b)).toEqual(['pick another creature', 'no leap']);
    expect(d.combat!.resolutions!.at(-1)!.outcomes[0].choose?.map((o) => o.type)).toEqual(['acid', 'cold']); // d8s 1 and 2: the player picks
    expect(d.combat!.resolutions!.find((r) => r.id === 'r1')!.leapt).toBe(true);
    expect(d.combat!.resolutions!.at(-1)).toMatchObject({ action: 'Chaos Bolt', chain: ['g1', 'g2'] });
    expect(d.combat!.combatants.find((x) => x.id === 'pc:mira')!.economy?.used ?? 0).toBe(0);
  });

  test('Chaos Bolt\'s d8 pick: the pop-up\'s options reach only the caster\'s player, never their damage; the pick reaches the DM\'s device', async () => {
    const waiting: Combat['resolutions'] = [{ id: 'r1', actor: 'pc:mira', action: 'Chaos Bolt', applied: [], at: 0,
      outcomes: [{ id: 'g1', part: 'hit', hit: true, damage: 0, choose: [{ face: 3, type: 'fire', damage: 4 }, { face: 2, type: 'cold', damage: 9 }] }] }];
    const { d, host, a, b } = await joined({ combat: fight({ turn: 'pc:mira', resolutions: waiting }) });
    const last = (r: { got: unknown[] }) => (r.got as { t: string; tracker?: TrackerView }[]).filter((m) => m.t === 'tracker').at(-1)!.tracker!;
    expect(last(b).picks).toEqual([{ resolution: 'r1', characterId: 'mira', spell: 'Chaos Bolt', options: [{ face: 3, type: 'fire' }, { face: 2, type: 'cold' }] }]);
    expect(last(a).picks).toBeUndefined();
    expect(cleanTracker(last(b))?.picks).toEqual(last(b).picks);
    b.deliver({ t: 'pick', characterId: 'mira', resolution: 'r1', type: 'psychic' });
    b.deliver({ t: 'pick', characterId: 'mira', resolution: 'r1', type: 'cold' });
    await settle(host);
    expect(d.picked).toEqual([{ rid: 'r1', target: 'g1', type: 'cold' }]);
    expect(parseGuestMessage({ t: 'pick', characterId: 'mira', resolution: 'r1', type: 'x'.repeat(30) })).toMatchObject({ error: 'bad pick' });
  });

  test('a player map names its target by token id; a hidden token is no target', async () => {
    const { d, host, a } = await joined();
    a.deliver(strike('t-g1', [17], [[]]));
    a.deliver(strike('t-x1', [17], [[]]));
    await settle(host);
    expect(hp(d, 'g1')).toBe(3);
    expect(refusals(a)).toEqual(['pick a target']);
  });

  test('the DM turning Targeting off reaches players (their panel goes back to roll buttons)', () => {
    expect(cleanSettings({ ...settings(), targeting: false })?.targeting).toBe(false);
  });

  test('Review Focus 2: the same use sent twice (a resend after a reconnect) lands once', async () => {
    const { d, host, a } = await joined();
    a.deliver(strike('t-g1', [17], [[]]));
    a.deliver(strike('t-g1', [17], [[]]));
    await settle(host);
    expect(hp(d, 'g1')).toBe(3);
    expect(refusals(a)).toEqual(['no Action left']);
    expect(d.combat!.resolutions).toHaveLength(1);
  });

  test('a creature whose token is hidden (or fogged) is no target and is never named in a catch', async () => {
    const { d, host, b } = await joined({ combat: fight({ turn: 'pc:mira', combatants: [...fight().combatants, cb({ id: 'l1', kind: 'monster', name: 'Lurker', init: 9, ac: 12, hp: 9, maxHp: 9 })] }) });
    d.scene = { ...d.scene!, tokens: [...d.scene!.tokens, { id: 't-l1', name: 'Lurker', ...cell(6, 1), size: 'M', color: '#000000', combatantId: 'l1', hidden: true }] };
    b.deliver({ t: 'use', characterId: 'mira', action: 'spell:spell:shard@FIX', slot: 1, aim: { target: 't-l1', rolled: { d20: [15], dmg: [[6], [3, 4]] }, toggles: [] } });
    b.deliver({ t: 'use', characterId: 'mira', action: 'spell:spell:shard@FIX', slot: 1, aim: { target: 't-g2', rolled: { d20: [15], dmg: [[6], [3, 4]] }, toggles: [] } });
    await settle(host);
    expect(refusals(b)).toEqual(['pick a target']);
    expect(d.combat!.resolutions![0].caught).toContain('l1'); // caught all the same
    expect(outcomes(b)).toEqual([expect.objectContaining({ caught: ['Goblin 2'] })]); // not the Lurker the player's map doesn't show
  });

  test('a miss: no damage, no damage in the outcome', async () => {
    const { d, host, a } = await joined();
    a.deliver(strike(aliasOf(a, 'Goblin 1'), [2], [[]]));
    await settle(host);
    expect(hp(d, 'g1')).toBe(7);
    expect(outcomes(a)).toEqual([{ t: 'outcome', action: 'Unarmed Strike', hit: false }]);
  });

  test('Review Focus 1: forged dice, an out-of-reach target or a hidden one: refused, nothing spent or applied', async () => {
    const { d, host, a } = await joined();
    a.deliver(strike(aliasOf(a, 'Goblin 1'), [25], [[]]));
    a.deliver(strike(aliasOf(a, 'Goblin 1'), [12], [[3]]));
    a.deliver(strike(aliasOf(a, 'Goblin 2'), [12], [[]]));
    a.deliver(strike('x1', [12], [[]]));
    await settle(host);
    expect(refusals(a)).toEqual(['bad d20', 'bad damage dice', 'out of range', 'pick a target']);
    expect([hp(d, 'g1'), hp(d, 'g2'), hp(d, 'x1')]).toEqual([7, 7, 30]);
    expect(d.combat!.combatants.find((x) => x.id === 'pc:thorin')!.economy?.used ?? 0).toBe(0);
  });

  test('Review Focus 2: a burst catches a hidden monster and a PC; the hidden one takes damage unseen, the PC gets its prompt', async () => {
    const { d, host, a, b } = await joined({ combat: fight({ turn: 'pc:mira' }) });
    d.scene = { ...d.scene!, tokens: d.scene!.tokens.map((t) => (t.id === 't-x1' ? { ...t, ...cell(6, 1) } : t.id === 't-thorin' ? { ...t, ...cell(5) } : t)) };
    b.deliver({ t: 'use', characterId: 'mira', action: 'spell:spell:shard@FIX', slot: 1, aim: { target: aliasOf(b, 'Goblin 2'), rolled: { d20: [15], dmg: [[6], [3, 4]] }, toggles: [] } });
    await settle(host);
    host.trackerChanged(); // the app does this on every combat change
    await settle(host);
    expect(refusals(b)).toEqual([]);
    expect(d.combat!.resolutions![0].outcomes.some((o) => o.id === 'x1' && o.save)).toBe(true); // caught and saved, unseen
    const o = outcomes(b)[0] as { hit?: boolean; dc?: number; caught?: string[] };
    expect(o).toMatchObject({ hit: true, dc: 13 });
    expect(o.caught!.sort()).toEqual(['Goblin 2', 'Thorin']);
    for (const r of [a, b]) expect(JSON.stringify(r.got)).not.toMatch(/x1|Assassin/);
    const prompt = (a.got as { t: string; tracker?: TrackerView }[]).filter((m) => m.t === 'tracker').at(-1)!.tracker!.saves;
    expect(prompt).toEqual([expect.objectContaining({ characterId: 'thorin', ability: 'dex', spell: 'Shard' })]);
    expect(prompt![0]).not.toHaveProperty('dc'); // only the caster learns the DC
    const other = (b.got as { t: string; tracker?: TrackerView }[]).filter((m) => m.t === 'tracker').at(-1)!.tracker!.saves;
    expect(other).toBeUndefined();
  });

  test('a save roll from the PC\'s owner settles it; from another player it is a violation', async () => {
    const { d, host, a, b } = await joined({ combat: { ...fight(), resolutions: [{ id: 'r1', actor: 'pc:mira', action: 'Shard', dc: 13, ability: 'dex', onSave: 'none', at: 0, applied: [],
      outcomes: [{ id: 'pc:thorin', part: 'save', pending: true, damage: 0, owed: [{ amount: 7, type: 'cold' }] }] }] } });
    b.deliver({ t: 'save', resolution: 'r1', characterId: 'thorin', d20: 12 });
    await settle(host);
    expect(d.settled).toEqual([]);
    expect(d.errors.length).toBeGreaterThan(0);
    a.deliver({ t: 'save', resolution: 'r1', characterId: 'thorin', d20: 12 });
    await settle(host);
    expect(d.settled).toEqual([{ rid: 'r1', target: 'pc:thorin', d20: 12 }]);
  });

  test('with Targeting off, an aimed use is refused and nothing is applied', async () => {
    const { d, host, a } = await joined({ set: settings({ targeting: false }) });
    a.deliver(strike(aliasOf(a, 'Goblin 1'), [17], [[]]));
    await settle(host);
    expect(refusals(a)).toEqual(['targeting is off']);
    expect(hp(d, 'g1')).toBe(7);
  });

  test('the guest keeps a well-formed outcome and save prompt only', () => {
    expect(cleanOutcome({ t: 'outcome', action: 'Shard', hit: true, dc: 13, caught: ['Goblin 2'] })).toEqual({ action: 'Shard', hit: true, dc: 13, caught: ['Goblin 2'] });
    expect(cleanOutcome({ t: 'outcome', action: 5 })).toBeUndefined();
    const t = cleanTracker({ round: 1, rows: [], saves: [{ resolution: 'r1', characterId: 'thorin', ability: 'dex', dc: 13, spell: 'Shard' }, { resolution: 3 }] });
    expect(t?.saves).toEqual([{ resolution: 'r1', characterId: 'thorin', ability: 'dex', spell: 'Shard' }]);
  });
});
