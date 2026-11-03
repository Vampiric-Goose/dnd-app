// Task 3: players' reaction cards and answers. The DM's device is the only judge: a player gets only their own characters' cards, in the
// players' line, with no combatant ids; an answer is checked against the open ask before it counts.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { answer, ask, onChange, pass, reactions, reset } from '../../src/lib/combat/reactionStack.svelte.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { Host, type HostDeps } from '../../src/lib/sync/host.ts';
import { parseGuestMessage } from '../../src/lib/sync/protocol.ts';
import { promptsFor } from '../../src/lib/sync/project.ts';
import type { Campaign, Character, Combat, Combatant, Scene, SpellDef } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';
import { Device, rawLink, settle } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN', CID = 'c1';
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (): Combat => ({
  campaignId: CID, round: 1, turn: 'g1', groupMonsters: false, updatedAt: 0,
  combatants: [
    cb({ id: 'pc:thorin', kind: 'pc', name: 'Thorin', characterId: 'thorin', init: 17 }),
    cb({ id: 'pc:bree', kind: 'pc', name: 'Bree', characterId: 'bree', init: 14 }),
    cb({ id: 'g1', kind: 'monster', name: 'Goblin Mage', init: 12, hp: 7, maxHp: 7 }),
  ],
});
const cs = (slot: number) => ({ id: 'counterspell' as const, label: `Counterspell (slot ${slot})`, slot });
const mkAsk = (id = 'k1', waiting = 'g1') => ({
  id, kind: 'counterspell' as const, trigger: 'Goblin Mage casts Fireball', playerTrigger: 'A creature casts a spell', waiting,
  reactors: [{ id: 'pc:thorin', name: 'Thorin', options: [cs(3), cs(4)] }, { id: 'pc:bree', name: 'Bree', options: [{ id: 'shield' as const, label: 'Shield', bonus: 5 }] }],
});

function setup() {
  const d = new Device();
  d.putCampaign({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } } satisfies Campaign);
  for (const c of [{ ...char('thorin', CID), name: 'Thorin', ownerId: 'A1' }, { ...char('bree', CID), name: 'Bree', ownerId: 'A2' }] as Character[]) d.edit(c);
  d.combat = fight();
  const host = new Host({ ...d.hostDeps(CID), reactions: { open: () => reactions.open, answer, pass, onChange } });
  return { d, host };
}
async function join(host: Host, playerId: string) {
  const l = rawLink();
  host.accept(l.link);
  l.deliver({ t: 'hello', code: CODE, playerId });
  await settle(host);
  return l;
}
const cards = (l: { got: unknown[] }) => (l.got as { t: string; prompts?: unknown[]; waiting?: boolean }[]).filter((m) => m.t === 'reactions');
afterEach(() => reset());

describe('reaction cards for players', () => {
  test('a player gets only their own character’s card, with the players’ line and no combatant ids', async () => {
    const { d, host } = setup();
    const a = await join(host, 'A1'), b = await join(host, 'A2'), idle = await join(host, 'A1');
    void ask(mkAsk());
    await settle(host);
    expect(cards(a).at(-1)).toEqual({ t: 'reactions', waiting: false, prompts: [{ ask: 'k1', trigger: 'A creature casts a spell', ms: expect.any(Number),
      reactors: [{ characterId: 'thorin', name: 'Thorin', options: [cs(3), cs(4)] }] }] });
    expect(cards(b).at(-1)?.prompts).toEqual([expect.objectContaining({ reactors: [{ characterId: 'bree', name: 'Bree', options: [{ id: 'shield', label: 'Shield', bonus: 5 }] }] })]);
    for (const l of [a, b, idle]) for (const m of cards(l)) for (const bad of ['pc:thorin', 'pc:bree', '"g1"', 'Fireball', 'Goblin']) expect(JSON.stringify(m)).not.toContain(bad);
    b.deliver({ t: 'react', ask: 'k1', characterId: 'bree', option: 'pass' });
    await settle(host);
    expect(cards(b).at(-1)).toEqual({ t: 'reactions', prompts: [], waiting: false });
    expect(d.errors).toEqual([]);
  });

  test('players with nothing to show get no traffic, and a late joiner gets the open card after welcome', async () => {
    const { host } = setup();
    const a = await join(host, 'A1');
    expect(cards(a)).toEqual([]);
    void ask(mkAsk());
    await settle(host);
    const late = await join(host, 'A2');
    expect(cards(late)).toHaveLength(1);
    reset();
    await settle(host);
    expect(cards(a).at(-1)).toEqual({ t: 'reactions', prompts: [], waiting: false });
  });

  test('the waiting player sees waiting: true', async () => {
    const { host } = setup();
    const a = await join(host, 'A1'), b = await join(host, 'A2');
    void ask(mkAsk('k2', 'pc:bree')); // Bree's own spell waits on the others
    await settle(host);
    expect(cards(b).at(-1)).toEqual(expect.objectContaining({ waiting: true }));
    expect(cards(a).at(-1)).toEqual(expect.objectContaining({ waiting: false }));
    pass('k2', 'pc:thorin');
    await settle(host);
    expect(cards(b).at(-1)).toEqual(expect.objectContaining({ waiting: true })); // Bree herself has not answered
    pass('k2', 'pc:bree');
    await settle(host);
    expect(cards(b).at(-1)).toEqual({ t: 'reactions', prompts: [], waiting: false });
  });

  test('an answer for someone else’s character is a violation; a slot not offered is refused; pass passes', async () => {
    const { d, host } = setup();
    const a = await join(host, 'A1'), b = await join(host, 'A2');
    const p = ask(mkAsk());
    await settle(host);
    b.deliver({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'pass' });
    await settle(host);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their character/)]);
    expect(reactions.open[0].answered).toEqual([]);
    a.deliver({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'counterspell', slot: 5 });
    await settle(host);
    expect(a.got.at(-1)).toEqual({ t: 'useRefused', reason: 'that reaction is not open' });
    expect(reactions.open[0].answers).toEqual([]);
    a.deliver({ t: 'react', ask: 'nope', characterId: 'thorin', option: 'pass' }); // no such ask: ignored
    a.deliver({ t: 'react', ask: 'k1', characterId: 'bree', option: 'pass' }); // not theirs
    await settle(host);
    expect(d.errors).toHaveLength(2);
    a.deliver({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'counterspell', slot: 4, d20: 12 });
    await settle(host);
    expect(reactions.open[0].answers).toEqual([{ reactor: 'pc:thorin', option: 'counterspell', slot: 4, d20: 12 }]);
    a.deliver({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'pass' }); // already answered: ignored
    await settle(host);
    expect(a.got.filter((m) => (m as { t: string }).t === 'useRefused')).toHaveLength(1);
    b.deliver({ t: 'react', ask: 'k1', characterId: 'bree', option: 'pass' });
    await settle(host);
    expect(await p).toEqual([{ reactor: 'pc:thorin', option: 'counterspell', slot: 4, d20: 12 }]);
  });

  test('without reactions deps the host refuses a react', async () => {
    const d = new Device();
    d.putCampaign({ ...camp(CID), sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {} } } } satisfies Campaign);
    d.edit({ ...char('thorin', CID), ownerId: 'A1' });
    const host = new Host(d.hostDeps(CID)), a = await join(host, 'A1');
    a.deliver({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'pass' });
    await settle(host);
    expect(a.got.at(-1)).toEqual({ t: 'useRefused', reason: 'reactions are off' });
  });

  test('a stopped host unsubscribes from the stack', async () => {
    const d = new Device();
    d.putCampaign({ ...camp(CID), sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {} } } } satisfies Campaign);
    const subs = new Set<() => void>();
    const host = new Host({ ...d.hostDeps(CID), reactions: { open: () => reactions.open, answer, pass, onChange: (fn) => { subs.add(fn); return () => void subs.delete(fn); } } });
    expect(subs.size).toBe(1);
    host.stop();
    expect(subs.size).toBe(0);
  });

  test('promptsFor floors ms at 0 and drops answered reactors', () => {
    const o = { ...mkAsk(), answered: ['pc:thorin'], answers: [], deadline: 1000 };
    const own = (id: string) => (id === 'pc:thorin' ? 'thorin' : undefined);
    expect(promptsFor([o], own, 5000)).toEqual([]);
    expect(promptsFor([{ ...o, answered: [] }], own, 5000)).toEqual([{ ask: 'k1', trigger: 'A creature casts a spell', ms: 0, reactors: [expect.objectContaining({ characterId: 'thorin' })] }]);
  });

  test('parseGuestMessage rejects a react with d20 21 or slot 10', () => {
    const ok = { t: 'react', ask: 'k1', characterId: 'thorin', option: 'counterspell', slot: 3, d20: 20 };
    expect(parseGuestMessage(ok)).toEqual(ok);
    expect(parseGuestMessage({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'pass' })).toEqual({ t: 'react', ask: 'k1', characterId: 'thorin', option: 'pass' });
    for (const bad of [{ d20: 21 }, { d20: 0 }, { slot: 10 }, { slot: 0 }, { option: 'fly' }, { ask: 5 }, { characterId: undefined }, { aim: { rolled: 1 } }])
      expect(parseGuestMessage({ ...ok, ...bad })).toEqual({ error: 'bad react' });
    expect(parseGuestMessage({ ...ok, extra: 'x' })).toEqual(ok); // unknown fields are dropped
  });
});

describe('table reactions on the wire', () => {
  test('parseGuestMessage keeps a table reaction’s key and rejects a 101-character one', () => {
    const ok = { t: 'react', ask: 'k1', characterId: 'thorin', option: 'more', key: 'Riposte' };
    expect(parseGuestMessage(ok)).toEqual(ok);
    expect(parseGuestMessage({ ...ok, key: 'x'.repeat(101) })).toEqual({ error: 'bad react' });
  });
  test('cleanReactions keeps key, strike and spell', async () => {
    const { cleanReactions } = await import('../../src/lib/sync/guest.ts');
    const o = { id: 'more', label: 'War Caster (Fire Bolt)', key: 'War Caster', strike: true, spell: 'Fire Bolt' };
    expect(cleanReactions({ prompts: [{ ask: 'a', trigger: 't', ms: 1, reactors: [{ characterId: 'c', name: 'n', options: [o] }] }] }).prompts[0].reactors[0].options).toEqual([o]);
  });
});

describe('moves and casts through the reaction flow', () => {
  const cell = (q: number, r = 0) => ({ x: 35 + 70 * q, y: 35 + 70 * r });
  const ward: SpellDef = { kind: 'spell', id: 'spell:shield-of-faith@FIX', name: 'Shield of Faith', source: 'FIX', level: 1, school: 'abjuration', castingTime: '1 action', range: '60 feet',
    components: { s: true }, duration: 'Concentration, up to 10 minutes', concentration: true, ritual: false, classes: ['wizard'], text: [{ p: 'A shimmering field surrounds a creature of your choice within range.' }] };
  const mira = (): Character => {
    const c = mkChar({ race: 'human', base: { int: 16 }, levels: ['wizard'] });
    return { ...c, id: 'mira', name: 'Mira', campaignId: CID, ownerId: 'A2', embedded: { ...c.embedded, [ward.id]: ward },
      build: { ...c.build, spells: { 'class:wizard@FIX': { known: [ward.id], prepared: [ward.id] } } } };
  };
  const scene = (): Scene => ({ id: 's1', campaignId: CID, name: 'Field', width: 1400, height: 1400, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0, tokens: [
    { id: 't-thorin', name: 'Thorin', ...cell(0), size: 'M', color: '#c0392b', characterId: 'thorin' },
    { id: 't-mira', name: 'Mira', ...cell(0, 6), size: 'M', color: '#8e44ad', characterId: 'mira' },
    { id: 't-g1', name: 'Goblin', ...cell(1, 1), size: 'M', color: '#27ae60', combatantId: 'g1' }] });
  async function hosted(turn: string, deps: (d: Device) => Partial<HostDeps> = () => ({})) {
    const d = new Device();
    d.map = true;
    d.putCampaign({ ...camp(CID), name: 'Ravenloft', sync: { role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} } } } satisfies Campaign);
    d.edit({ ...char('thorin', CID), name: 'Thorin', ownerId: 'A1' });
    d.edit(mira());
    d.scene = scene();
    d.combat = { ...fight(), turn, combatants: [...fight().combatants, cb({ id: 'pc:mira', kind: 'pc', name: 'Mira', characterId: 'mira', init: 10 })] };
    const host = new Host({ ...d.hostDeps(CID), reactions: { open: () => reactions.open, answer, pass, onChange }, ...deps(d) });
    return { d, host, a: await join(host, 'A1'), b: await join(host, 'A2') };
  }
  const where = (d: Device) => { const t = d.scene!.tokens.find((x) => x.id === 't-thorin')!; return { x: t.x, y: t.y }; };
  const aliasOf = (r: { got: unknown[] }, name: string) => (r.got as { t: string; tracker?: { rows: { id: string; name: string }[] } }[]).filter((m) => m.t === 'tracker').at(-1)!.tracker!.rows.find((x) => x.name === name)!.id;

  // a stand-in for guardMove: the token waits at the edge on Mira's card, then goes on
  const edgeWalk = (d: Device, seen: string[]) => async (tokenId: string, route: { x: number; y: number }[]) => {
    const put = (p: { x: number; y: number }) => { d.scene = { ...d.scene!, tokens: d.scene!.tokens.map((t) => (t.id === tokenId ? { ...t, ...p } : t)) }; };
    put(cell(2));
    seen.push('edge');
    await ask({ ...mkAsk('m1', 'pc:thorin'), kind: 'opportunity', trigger: 'Thorin leaves', playerTrigger: 'Thorin leaves your reach', reactors: [{ id: 'pc:mira', name: 'Mira', options: [{ id: 'oa', label: 'Opportunity Attack' }] }] });
    seen.push('answered');
    put(route.at(-1)!);
  };

  test('a player’s move away from a goblin stops at the edge until the DM passes, then finishes', async () => {
    const edge: string[] = [];
    const { d, host, a } = await hosted('pc:thorin', (dev) => ({ guardMove: edgeWalk(dev, edge) }));
    a.deliver({ t: 'move', sceneId: 's1', tokenId: 't-thorin', x: cell(5).x, y: cell(5).y });
    await settle(host);
    expect(where(d)).toEqual(cell(2)); // waiting on the card
    expect(reactions.open).toHaveLength(1);
    pass('m1');
    await settle(host);
    expect(edge).toEqual(['edge', 'answered']);
    expect(where(d)).toEqual(cell(5));
    expect(d.errors).toEqual([]);
  });

  test('another player’s answer reaches the stack while a move waits', async () => {
    const edge: string[] = [];
    const { d, host, a, b } = await hosted('pc:thorin', (dev) => ({ guardMove: edgeWalk(dev, edge) }));
    a.deliver({ t: 'move', sceneId: 's1', tokenId: 't-thorin', x: cell(5).x, y: cell(5).y });
    await settle(host);
    expect(cards(b).at(-1)?.prompts).toHaveLength(1);
    expect(where(d)).toEqual(cell(2));
    b.deliver({ t: 'react', ask: 'm1', characterId: 'mira', option: 'pass' }); // handled while the move waits: the queue is free
    await settle(host);
    expect(where(d)).toEqual(cell(5));
    expect(reactions.open).toEqual([]);
  });

  test('a move with no guard goes straight', async () => {
    const none = await hosted('pc:thorin');
    none.a.deliver({ t: 'move', sceneId: 's1', tokenId: 't-thorin', x: cell(3).x, y: cell(3).y });
    await settle(none.host);
    expect(where(none.d)).toEqual(cell(3));
  });

  const ward1 = (b: { got: unknown[] }) => ({ t: 'use', characterId: 'mira', action: `spell:${ward.id}`, slot: 1, aim: { targets: [aliasOf(b, 'Thorin')], rolled: { dmg: [] }, toggles: [] } });
  test('a player’s spell countered by a monster spends the slot and sends no outcome, only a notice', async () => {
    const guard = vi.fn(async () => false);
    const { d, host, b } = await hosted('pc:mira', () => ({ guardCast: guard }));
    b.deliver(ward1(b));
    await settle(host);
    expect(guard).toHaveBeenCalledWith('pc:mira', { name: 'Shield of Faith', level: 1 });
    expect(d.char('mira')!.state.slotsUsed[0]).toBe(1);
    expect(b.got.filter((m) => ['outcome', 'useRefused'].includes((m as { t: string }).t))).toEqual([{ t: 'useRefused', reason: 'your Shield of Faith was countered' }]);
    expect(d.combat!.resolutions ?? []).toEqual([]);
  });

  test('a spell nobody counters goes ahead, after the guard; the guard waits off the message queue', async () => {
    let go: (v: boolean) => void = () => {};
    const { d, host, b } = await hosted('pc:mira', () => ({ guardCast: () => new Promise<boolean>((r) => { go = r; }) }));
    b.deliver(ward1(b));
    await settle(host);
    expect(d.combat!.resolutions ?? []).toEqual([]); // still waiting on the asks
    b.deliver({ t: 'endTurn', characterId: 'bree' }); // other messages are still handled
    await settle(host);
    expect(d.errors.map(String)).toEqual([expect.stringMatching(/not their character/)]);
    go(true);
    await settle(host);
    expect(d.combat!.resolutions!.at(-1)).toMatchObject({ action: 'Shield of Faith' });
    expect(b.got.filter((m) => (m as { t: string }).t === 'outcome')).toHaveLength(1);
  });

  test('a countered buff cast without aiming puts nothing on the caster; one that goes ahead does', async () => {
    const plain = { t: 'use', characterId: 'mira', action: `spell:${ward.id}`, slot: 1 };
    for (const [ok, held] of [[false, []], [true, ['Shield of Faith']]] as const) {
      const { d, host, b } = await hosted('pc:mira', () => ({ guardCast: async () => ok }));
      b.deliver(plain);
      await settle(host);
      expect([d.char('mira')!.state.slotsUsed[0], d.char('mira')!.state.conditions]).toEqual([1, held]);
      reset();
    }
  });

  test('tell reaches the owner’s links only; a DM-run character has none', async () => {
    const { host, a, b } = await hosted('pc:thorin');
    expect(await host.tell('thorin', 'no dice')).toBe(true);
    expect(a.got.at(-1)).toEqual({ t: 'useRefused', reason: 'no dice' });
    expect(b.got.filter((m) => (m as { t: string }).t === 'useRefused')).toEqual([]);
    expect(await host.tell('nobody', 'x')).toBe(false);
  });
});
