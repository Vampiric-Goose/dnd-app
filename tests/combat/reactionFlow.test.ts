// Task 4: the reaction flow on the DM's device: moves and casts wait for the stack, hits and damage open their own asks.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { addCombatants, monsterCombatant } from '../../src/lib/combat/combat.ts';
import { guardCast, guardMove, land, type FlowCtx } from '../../src/lib/combat/reactionFlow.ts';
import { answer, AUTO_PASS_MS, onChange, pass, reactions, reset, type Answer, type Open } from '../../src/lib/combat/reactionStack.svelte.ts';
import { applyUse, monsterActions } from '../../src/lib/combat/turnActions.ts';
import { updateCombat } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { newScene } from '../../src/lib/map/scene.ts';
import type { Character, Combatant, MonsterDef, Pack, SpellDef, Token } from '../../src/lib/types.ts';
import { camp, char } from '../fixtures/records.ts';

const srd: Pack = JSON.parse(fs.readFileSync('src/data/srd.json', 'utf8'));
const def = (id: string) => srd.entities.find((e) => e.id === id) as MonsterDef;
const goblin = def('monster:goblin@SRD'), mage = def('monster:mage@SRD');
const sentinel: MonsterDef = { ...goblin, id: 'monster:sentinel', traits: [...goblin.traits, { name: 'Sentinel', text: [{ p: 'Its hits stop movement.' }] }] };
const fiend: MonsterDef = { ...mage, id: 'monster:fiend', name: 'Fiend', traits: [{ name: 'Spellcasting', text: [
  { p: 'The fiend is a 5th-level spellcaster. Its spellcasting ability is Charisma (spell save DC 13, +5 to hit with spell attacks). It has the following warlock spells prepared:' },
  { list: ['1st level (2 slots): hellish rebuke'] }] }] };
const monsters = new Map([goblin, mage, sentinel, fiend].map((m) => [m.id, m]));
const spells = new Map(srd.entities.filter((e) => e.kind === 'spell').map((s) => [s.name.toLowerCase(), s as SpellDef]));

const cell = (cx: number, cy: number) => ({ x: 35 + 70 * cx, y: 35 + 70 * cy });
const tok = (id: string, cx: number, cy: number, o: Partial<Token>): Token => ({ id, name: id, ...cell(cx, cy), size: 'M', color: '#000000', ...o });
const mon = (m: MonsterDef, id: string): Combatant => ({ ...monsterCombatant(m, id, 'average', () => 0.5), id, name: id });
const pcC: Combatant = { id: 'pc:p', kind: 'pc', name: 'p', characterId: 'p', initMod: 0, dex: 10, tie: 0.5, conSave: 0 };
const pc = (hp = 20): Character => ({ ...char('p', 'c1'), state: { ...char('p').state, hp }, overrides: { maxHp: 30 } });

async function fight(list: [Combatant, number, number][], turn: string, hp = 20) {
  await db.campaigns.put(camp('c1'));
  await db.characters.put(pc(hp));
  const tokens = list.map(([x, cx, cy]) => tok(`t:${x.id}`, cx, cy, x.characterId ? { characterId: x.characterId } : { combatantId: x.id }));
  await db.scenes.put({ ...newScene('c1', 'Field'), id: 's1', tokens });
  await updateCombat('c1', (c) => ({ ...addCombatants(c, list.map(([x]) => x)), round: 1, turn }));
}
const ctx = (o: Partial<FlowCtx> = {}): FlowCtx => ({ cid: 'c1', settings: camp('c1').settings, scene: () => db.scenes.get('s1'),
  monster: (id) => monsters.get(id), spell: (n) => spells.get(n.toLowerCase()), rng: () => 0, d20: () => 10,
  rollAim: () => ({ rolled: { d20: [15, 15], dmg: [[4]] } }), ...o });
const fighter = async (id: string) => (await db.combat.get('c1'))!.combatants.find((x) => x.id === id)!;
const at = async (tokenId: string) => { const t = (await db.scenes.get('s1'))!.tokens.find((x) => x.id === tokenId)!; return { x: t.x, y: t.y }; };
const pcHp = async () => (await db.characters.get('p'))!.state.hp;

/** Answers each new ask as `fn` says (undefined: leave it open), from a microtask; `seen` keeps every ask as it opened. */
const seen: Open[] = [];
function answering(fn: (o: Open) => Answer | 'pass' | undefined) {
  const done = new Set<string>();
  stop = onChange(() => {
    for (const o of reactions.open) {
      if (done.has(o.id)) continue;
      done.add(o.id);
      seen.push(JSON.parse(JSON.stringify(o)) as Open);
      const a = fn(o);
      if (a) queueMicrotask(() => (a === 'pass' ? pass(o.id) : answer(o.id, a)));
    }
  });
}
let stop = () => {};

beforeEach(async () => { await resetDb(); seen.length = 0; });
afterEach(() => { stop(); stop = () => {}; reset(); vi.useRealTimers(); });

// the PC walks right along row 0 from cell 1; a goblin below cell 1 reaches it until cell 2 (the edge), then it leaves
const walk = (o: Combatant = mon(goblin, 'g1')) => fight([[pcC, 1, 0], [o, 1, 1]], 'pc:p');

test('a PC walking away from a goblin waits at the edge; the goblin’s attack lands; the PC goes on to the end', async () => {
  await walk();
  const where: Promise<{ x: number; y: number }>[] = [];
  answering((o) => { where.push(at('t:pc:p')); return { reactor: 'g1', option: 'oa' }; });
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(6, 0));
  expect(seen.map((o) => [o.kind, o.reactors.map((r) => r.id), o.playerTrigger, o.waiting])).toEqual([['opportunity', ['g1'], 'p leaves your reach', 'pc:p']]);
  expect(await where[0]).toEqual(cell(2, 0));
  expect(await pcHp()).toBe(14); // 15 + 4 hits AC 10; 4 + 2 slashing
  expect((await fighter('g1')).reactionUsed).toBe(true);
  expect(await at('t:pc:p')).toEqual(cell(6, 0));
  expect((await db.combat.get('c1'))!.movement?.['pc:p']?.from).toEqual(cell(1, 0)); // the turn's origin, as a plain move records it
});

test('a PC dropped to 0 by the attack stays at the edge', async () => {
  await fight([[pcC, 1, 0], [mon(goblin, 'g1'), 1, 1]], 'pc:p', 3);
  answering(() => ({ reactor: 'g1', option: 'oa' }));
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(2, 0));
  expect(await pcHp()).toBe(0);
  expect(await at('t:pc:p')).toEqual(cell(2, 0));
});

test('a Sentinel hit stops the move', async () => {
  await walk(mon(sentinel, 'g1'));
  answering(() => ({ reactor: 'g1', option: 'oa' }));
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(2, 0));
  expect((await db.combat.get('c1'))!.movement?.['pc:p']?.mult).toBe(0);
  expect(await at('t:pc:p')).toEqual(cell(2, 0));
});

test('nobody answers: the move finishes after 10 s', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await walk();
  answering(() => { queueMicrotask(() => vi.advanceTimersByTime(AUTO_PASS_MS)); return undefined; });
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(6, 0));
  expect(seen).toHaveLength(1);
  expect(await pcHp()).toBe(20);
  expect((await fighter('g1')).reactionUsed).toBeFalsy();
});

/** Mage `ma` pays for Fireball at 3rd level (as the turn panel does before the effects). */
async function fireball() {
  await fight([[pcC, 0, 0], [mon(mage, 'ma'), 3, 0], [mon(mage, 'mb'), 6, 0]], 'ma');
  const a = monsterActions(mage, { spell: (n) => spells.get(n) }).find((x) => x.name === 'Fireball')!;
  await updateCombat('c1', (k) => applyUse(k, k.combatants.find((x) => x.id === 'ma')!, a, 1, undefined, 3));
}

test('a countered Fireball spends its slot and changes nobody’s HP', async () => {
  await fireball();
  answering((o) => (o.reactors[0].id === 'mb' ? { reactor: 'mb', option: 'counterspell', slot: 3 } : 'pass'));
  expect(await guardCast(ctx(), 'ma', { name: 'Fireball', level: 3 })).toBe(false);
  expect(seen[0].trigger).toContain('Fireball');
  expect(seen[0].playerTrigger).toBe('ma casts a spell'); // never the monster's spell or its level
  expect(seen.map((o) => o.reactors.map((r) => r.id))).toEqual([['mb'], ['ma']]); // ma may counter the Counterspell, and passed
  const [ma, mb] = [await fighter('ma'), await fighter('mb')];
  expect([ma.spellsUsed?.['slot:3'], mb.spellsUsed?.['slot:3'], mb.reactionUsed]).toEqual([1, 1, true]);
  expect([ma.hp, mb.hp, await pcHp()]).toEqual([40, 40, 20]);
});

test('a Counterspell countered back lets the spell through', async () => {
  await fireball();
  answering((o) => ({ reactor: o.reactors[0].id, option: 'counterspell', slot: 3 }));
  expect(await guardCast(ctx(), 'ma', { name: 'Fireball', level: 3 })).toBe(true);
  expect(seen).toHaveLength(2); // mb's reaction is spent, so nobody is asked about ma's Counterspell
  expect([(await fighter('ma')).spellsUsed?.['slot:3'], (await fighter('mb')).spellsUsed?.['slot:3']]).toEqual([2, 1]);
});

test('Shield turns the hit into a miss and leaves the Shield condition until the wizard’s next turn', async () => {
  await fight([[pcC, 1, 0], [mon(mage, 'ma'), 1, 1]], 'pc:p');
  answering(() => ({ reactor: 'ma', option: 'shield' }));
  await land(ctx(), { id: 'r1', actor: 'pc:p', action: 'Longsword', outcomes: [{ id: 'ma', part: 'hit', hit: true, roll: 14, ac: 12, damage: 6 }], at: 0 }, undefined, { melee: true });
  expect(seen.map((o) => [o.kind, o.playerTrigger])).toEqual([['hit', 'p hits you (14)']]);
  const ma = await fighter('ma');
  expect([ma.hp, ma.conditions, ma.durations?.Shield, ma.spellsUsed?.['slot:1'], ma.reactionUsed]).toEqual([40, ['Shield'], { rounds: 1, at: 'start', of: 'ma' }, 1, true]);
  expect((await db.combat.get('c1'))!.resolutions![0].outcomes[0]).toMatchObject({ hit: false, damage: 0, ac: 17 });
});

test('Hellish Rebuke after damage hits the attacker for its fire damage', async () => {
  await fight([[pcC, 4, 4], [mon(goblin, 'g1'), 1, 0], [mon(fiend, 'f1'), 1, 1]], 'g1');
  answering(() => ({ reactor: 'f1', option: 'rebuke', slot: 1 }));
  await land(ctx({ rollAim: () => ({ rolled: { dmg: [[5, 5]] } }) }), { id: 'r1', actor: 'g1', action: 'Scimitar', outcomes: [{ id: 'f1', part: 'hit', hit: true, roll: 18, ac: 12, damage: 5 }], at: 0 }, undefined, { melee: true });
  expect(seen.map((o) => o.kind)).toEqual(['rebuke']);
  const [g1, f1] = [await fighter('g1'), await fighter('f1')];
  expect([g1.hp, f1.hp, f1.reactionUsed, f1.spellsUsed?.['slot:1']]).toEqual([0, 35, true, 1]); // 10 fire: a failed Dex save (1 + 2 < 13)
  expect((await db.combat.get('c1'))!.resolutions!.map((r) => r.action)).toEqual(['Scimitar', 'Hellish Rebuke']);
});

test('settings.reactions === false or targeting off: no asks at all', async () => {
  for (const off of [{ reactions: false }, { targeting: false }]) {
    await resetDb();
    await walk();
    let asks = 0;
    stop = onChange(() => { asks++; });
    const c = ctx({ settings: { ...camp('c1').settings, ...off } });
    expect(await guardMove(c, 't:pc:p', cell(6, 0))).toEqual(cell(6, 0));
    expect(await guardCast(c, 'g1', { name: 'Fireball', level: 3 })).toBe(true);
    await land(c, { id: 'r1', actor: 'pc:p', action: 'Longsword', outcomes: [{ id: 'g1', part: 'hit', hit: true, roll: 20, ac: 15, damage: 3 }], at: 0 });
    expect([asks, (await fighter('g1')).hp]).toEqual([0, 4]);
    stop();
  }
});

test('no fight: the move goes straight through', async () => {
  await walk();
  await db.combat.update('c1', () => undefined);
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(6, 0));
  expect(await at('t:pc:p')).toEqual(cell(6, 0));
});
