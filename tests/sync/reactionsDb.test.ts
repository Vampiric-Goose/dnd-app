// Task 5 fix round: the host with the real reaction flow on the real (fake-indexeddb) db. A reaction ask opened by a player's message
// must not hold the host's message queue, or the players' cards and answers would wait behind it (until the 10 s auto-pass).
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { addCombatants, monsterCombatant } from '../../src/lib/combat/combat.ts';
import { guardCast, guardMove, land, settle, type FlowCtx } from '../../src/lib/combat/reactionFlow.ts';
import { answer, onChange, pass, reactions, reset } from '../../src/lib/combat/reactionStack.svelte.ts';
import { applyResolution, editCharacter, updateCombat } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { Host, type HostDeps } from '../../src/lib/sync/host.ts';
import type { Character, Combatant, MonsterDef, Pack, Scene, SpellDef } from '../../src/lib/types.ts';
import { mkChar } from '../fixtures/content.ts';
import { camp } from '../fixtures/records.ts';
import { Device, rawLink, settle as settleHost } from './fakes.ts';

const CODE = 'ABCDEFGHJKMN', CID = 'c1';
const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const entity = <T>(id: string) => srd.entities.find((e) => e.id === id) as T;
const goblin = entity<MonsterDef>('monster:goblin@SRD'), mage = entity<MonsterDef>('monster:mage@SRD');
const monsters = new Map([goblin, mage].map((m) => [m.id, m]));
const spells = new Map(srd.entities.filter((e) => e.kind === 'spell').map((s) => [s.name.toLowerCase(), s as SpellDef]));
const hr = entity<SpellDef>('spell:hellish-rebuke@SRD'), shield = entity<SpellDef>('spell:shield@SRD');
// Paraphrased: a held aura whose bonus action heals (Aura of Vitality's rule applies by name).
const aura: SpellDef = { kind: 'spell', id: 'spell:aura-of-vitality@FIX', name: 'Aura of Vitality', source: 'FIX', level: 1, school: 'evocation', castingTime: '1 action', range: 'Self',
  components: { s: true }, duration: 'Concentration, up to 1 minute', concentration: true, ritual: false, classes: ['wizard'],
  text: [{ p: 'Healing energy radiates from you in an aura. Until the spell ends, you can use a bonus action to cause one creature in the aura (including you) to regain 2d6 hit points.' }] };

const cell = (q: number, r = 0) => ({ x: 35 + 70 * q, y: 35 + 70 * r });
const mon = (m: MonsterDef, id: string): Combatant => ({ ...monsterCombatant(m, id, 'average', () => 0.5), id, name: id });
const pcX = (id: string): Combatant => ({ id: `pc:${id}`, kind: 'pc', name: id, characterId: id, initMod: 0, dex: 10, tie: 0.5, conSave: 0 });
const thorin = (): Character => ({ ...mkChar({ race: 'human', base: { str: 16 }, levels: ['fighter'] }), id: 'thorin', name: 'Thorin', campaignId: CID, ownerId: 'A1' });
function mira(): Character {
  const c = mkChar({ race: 'human', base: { int: 16 }, levels: ['wizard'] });
  return { ...c, id: 'mira', name: 'Mira', campaignId: CID, ownerId: 'A2', state: { ...c.state, hp: 20 }, overrides: { maxHp: 30 },
    embedded: { ...c.embedded, [hr.id]: hr, [shield.id]: shield, [aura.id]: aura },
    build: { ...c.build, spells: { 'class:wizard@FIX': { known: [hr.id, shield.id, aura.id], prepared: [hr.id, shield.id, aura.id] } } } };
}

const refused: [string, string][] = [];
const flow = (): FlowCtx => ({ cid: CID, settings: camp(CID).settings, scene: () => db.scenes.shown(CID), monster: (id) => monsters.get(id), spell: (n) => spells.get(n.toLowerCase()),
  rng: () => 0, d20: () => 10, rollAim: () => ({ rolled: { dmg: [[5, 5]] } }), onRefused: (id, why) => { refused.push([id, why]); } });
const deps = (): HostDeps => ({ ...new Device().hostDeps(CID),
  loadCampaign: () => db.campaigns.get(CID), updateSync: (fn) => db.campaigns.updateSync(CID, (s) => fn(s!)).then(() => {}),
  loadCharacters: () => db.characters.list(CID), loadCharacter: (id) => db.characters.get(id), saveCharacter: (c) => db.characters.putSynced(c).then(() => {}),
  loadCombat: () => db.combat.get(CID), updateCombat: (fn) => db.combat.update(CID, (c) => c && fn(c)), editCharacter: (id, fn) => editCharacter(id, fn),
  loadMonster: async (id) => monsters.get(id), loadScene: () => db.scenes.shown(CID), updateScene: (id, fn) => db.scenes.update(id, fn, { network: true }),
  resolve: (r, b, o) => land(flow(), r, b, o), settleSave: async (rid, t, d) => { await settle(flow(), rid, t, d); },
  guardMove: (id, to) => guardMove(flow(), id, to), guardCast: (id, s) => guardCast(flow(), id, s),
  reactions: { open: () => reactions.open, answer, pass, onChange }, onError: (e) => { errors.push(e); } });
const errors: unknown[] = [];

async function table(tokens: [string, number, number, Partial<Scene['tokens'][number]>][], combatants: Combatant[], turn: string) {
  await db.campaigns.put(camp(CID));
  await db.campaigns.updateSync(CID, () => ({ role: 'dm', code: CODE, node: 'dmnode01', players: { A1: {}, A2: {} }, last: '', deleted: {} }) as never);
  for (const c of [thorin(), mira()]) await db.characters.put(c);
  await db.scenes.put({ id: 's1', campaignId: CID, name: 'Field', width: 1400, height: 1400, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0,
    tokens: tokens.map(([id, q, r, o]) => ({ id, name: id, ...cell(q, r), size: 'M' as const, color: '#000000', ...o })) });
  await db.scenes.show(CID, 's1');
  await updateCombat(CID, (c) => ({ ...addCombatants(c, combatants), round: 1, turn }));
  const host = new Host(deps());
  const join = async (playerId: string) => { const l = rawLink(); host.accept(l.link); l.deliver({ t: 'hello', code: CODE, playerId }); await settleHost(host); return l; };
  return { host, a: await join('A1'), b: await join('A2') };
}
const cards = (l: { got: unknown[] }) => (l.got as { t: string; prompts: { ask: string; reactors: { characterId: string; options: { id: string; slot?: number }[] }[] }[] }[]).filter((m) => m.t === 'reactions');
const fighter = async (id: string) => (await db.combat.get(CID))!.combatants.find((x) => x.id === id)!;

beforeEach(async () => { await resetDb(); refused.length = 0; errors.length = 0; });
afterEach(() => reset());

test('a PC’s settled save from a monster’s area spell: its Rebuke card arrives while the ask is open; its answer burns the monster', async () => {
  const { host, b } = await table([['t-mira', 0, 0, { characterId: 'mira' }], ['t-g1', 3, 0, { combatantId: 'g1' }]], [pcX('mira'), mon(goblin, 'g1')], 'g1');
  await applyResolution(CID, { id: 'r1', actor: 'g1', action: 'Fireball', at: 0, dc: 30, ability: 'dex',
    outcomes: [{ id: 'pc:mira', part: 'save', pending: true, damage: 0, owed: [{ amount: 9, type: 'fire' }] }] }, camp(CID).settings);
  b.deliver({ t: 'save', resolution: 'r1', characterId: 'mira', d20: 2 });
  await settleHost(host); // the queue is free while the ask is open (no 10 s wait)
  expect(reactions.open.map((o) => o.kind)).toEqual(['rebuke']);
  expect(cards(b).at(-1)!.prompts[0].reactors).toEqual([expect.objectContaining({ characterId: 'mira', options: [expect.objectContaining({ id: 'rebuke', slot: 1 })] })]);
  b.deliver({ t: 'react', ask: cards(b).at(-1)!.prompts[0].ask, characterId: 'mira', option: 'rebuke', slot: 1 });
  await settleHost(host);
  expect((await fighter('g1')).hp).toBe(0); // 10 fire on a failed Dex save
  expect((await db.characters.get('mira'))!.state.hp).toBe(11);
  expect([reactions.open, errors]).toEqual([[], []]);
});

test('a player’s attack: the target’s Shield card arrives while the hit ask is open; Shield makes it a miss', async () => {
  const { host, a, b } = await table([['t-thorin', 0, 0, { characterId: 'thorin' }], ['t-mira', 1, 0, { characterId: 'mira' }]], [pcX('thorin'), pcX('mira')], 'pc:thorin');
  a.deliver({ t: 'use', characterId: 'thorin', action: 'attack:unarmed', aim: { target: 't-mira', rolled: { d20: [8, 8], dmg: [[]] }, toggles: [] } });
  await settleHost(host);
  expect(reactions.open.map((o) => o.kind)).toEqual(['hit']);
  const card = cards(b).at(-1)!.prompts[0];
  expect(card.reactors[0].options.map((o) => o.id)).toEqual(['shield']);
  a.deliver({ t: 'endTurn', characterId: 'bree' }); // the queue still handles other messages
  await settleHost(host);
  expect(errors.map(String)).toEqual([expect.stringMatching(/not their character/)]);
  b.deliver({ t: 'react', ask: card.ask, characterId: 'mira', option: 'shield', slot: 1 });
  await settleHost(host);
  expect((await db.characters.get('mira'))!.state.hp).toBe(20); // 8 + 5 hits AC 10, not AC 15
  const heard = (a.got as { t: string; hit?: boolean }[]).filter((m) => m.t === 'outcome');
  expect(heard).toHaveLength(1);
  expect(heard[0].hit).toBe(false); // the attacker hears what Shield made of it, not the roll as thrown
});

test('using a held spell again is not a cast: no Counterspell ask, and it resolves', async () => {
  const held = { ...pcX('mira'), concentrating: true, concentratingOn: 'Aura of Vitality', concentrationCount: 1, concentrationSlot: 1 };
  const { host, b } = await table([['t-mira', 0, 0, { characterId: 'mira' }], ['t-ma', 3, 0, { combatantId: 'ma' }]], [held, mon(mage, 'ma')], 'pc:mira');
  b.deliver({ t: 'use', characterId: 'mira', action: 'again:spell:spell:aura-of-vitality@FIX', aim: { targets: ['pc:mira'], rolled: { dmg: [[3, 4]] }, toggles: [] } });
  await settleHost(host);
  expect(reactions.open).toEqual([]);
  expect((await db.combat.get(CID))!.resolutions!.at(-1)).toMatchObject({ outcomes: [{ id: 'pc:mira', heal: 7 }] });
  expect(errors).toEqual([]);
});
