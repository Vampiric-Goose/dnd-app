// Task 3: players' reaction cards and answers. The DM's device is the only judge: a player gets only their own characters' cards, in the
// players' line, with no combatant ids; an answer is checked against the open ask before it counts.
import { afterEach, describe, expect, test } from 'vitest';
import { answer, ask, onChange, pass, reactions, reset } from '../../src/lib/combat/reactionStack.svelte.ts';
import { Host } from '../../src/lib/sync/host.ts';
import { parseGuestMessage } from '../../src/lib/sync/protocol.ts';
import { promptsFor } from '../../src/lib/sync/project.ts';
import type { Campaign, Character, Combat, Combatant } from '../../src/lib/types.ts';
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
