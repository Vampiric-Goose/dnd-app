// Task 4: the reaction flow on the DM's device: moves and casts wait for the stack, hits and damage open their own asks.
import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { addCombatants, monsterCombatant } from '../../src/lib/combat/combat.ts';
import { guardCast, guardMove, land, settle, type FlowCtx } from '../../src/lib/combat/reactionFlow.ts';
import { answer, AUTO_PASS_MS, onChange, pass, reactions, reset, type Answer, type Open } from '../../src/lib/combat/reactionStack.svelte.ts';
import { applyUse, monsterActions } from '../../src/lib/combat/turnActions.ts';
import { applyResolution, updateCombat } from '../../src/lib/combat/store.ts';
import { db, resetDb } from '../../src/lib/db.ts';
import { newScene } from '../../src/lib/map/scene.ts';
import type { Character, Combatant, MonsterDef, Pack, SpellDef, Token } from '../../src/lib/types.ts';
import { flowCtx } from '../../src/lib/combat/flowCtx.ts';
import { makeEntry } from '../../src/lib/items/inventory.ts';
import { rollHooks, rollLog, rollViewer, rollVisibility, type RollEntry } from '../../src/lib/rolls.svelte.ts';
import { longsword, mkChar } from '../fixtures/content.ts';
import { camp, char } from '../fixtures/records.ts';

vi.mock('../../src/lib/content/srd.ts', async () => ({ loadSrd: async () => (await import('../fixtures/srdPack.ts')).srdPackFixture })); // flowCtx's index
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

async function fight(list: [Combatant, number, number][], turn: string, hp = 20, who: Character = pc(hp)) {
  await db.campaigns.put(camp('c1'));
  await db.characters.put(who);
  const tokens = list.map(([x, cx, cy]) => tok(`t:${x.id}`, cx, cy, x.characterId ? { characterId: x.characterId } : { combatantId: x.id }));
  await db.scenes.put({ ...newScene('c1', 'Field'), id: 's1', tokens });
  await db.scenes.show('c1', 's1'); // players see the map (a creature off it is hidden from them)
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

// ---- Task 5 rulings ----
const hr = srd.entities.find((e) => e.id === 'spell:hellish-rebuke@SRD') as SpellDef;
/** A PC that can Hellish Rebuke (a wizard with the spell prepared; 2 first-level slots). */
function rebuker(): Character {
  const c = mkChar({ race: 'human', base: { int: 16 }, levels: ['wizard'] });
  return { ...c, id: 'p', name: 'p', campaignId: 'c1', state: { ...c.state, hp: 20 }, overrides: { maxHp: 30 }, embedded: { ...c.embedded, [hr.id]: hr },
    build: { ...c.build, spells: { 'class:wizard@FIX': { known: [hr.id], prepared: [hr.id] } } } };
}
const rogue5 = (): Character => { const c = mkChar({ race: 'human', base: { dex: 16 }, levels: ['rogue', 'rogue', 'rogue', 'rogue', 'rogue'] }); return { ...c, id: 'p', name: 'p', campaignId: 'c1', state: { ...c.state, hp: 20 }, overrides: { maxHp: 30 } }; };
const owed = { id: 'r1', actor: 'g1', action: 'Fireball', at: 0, dc: 30, ability: 'dex' as const, outcomes: [{ id: 'pc:p', part: 'save' as const, pending: true as const, damage: 0, owed: [{ amount: 9, type: 'fire' }] }] };

test('(a) a PC’s settled failed save takes the damage and is asked about Hellish Rebuke, once', async () => {
  await fight([[pcC, 0, 0], [mon(goblin, 'g1'), 3, 0]], 'g1', 20, rebuker());
  await applyResolution('c1', owed, camp('c1').settings);
  answering(() => ({ reactor: 'pc:p', option: 'rebuke', slot: 1 }));
  await settle(ctx({ rollAim: () => ({ rolled: { dmg: [[5, 5]] } }) }), 'r1', 'pc:p', 2);
  expect(seen.map((o) => [o.kind, o.reactors.map((r) => r.id), o.waiting])).toEqual([['rebuke', ['pc:p'], 'g1']]);
  expect(await pcHp()).toBe(11);
  expect([(await fighter('g1')).hp, (await fighter('pc:p')).reactionUsed]).toEqual([0, true]);
  await settle(ctx(), 'r1', 'pc:p', 2); // already settled: nothing more
  expect(seen).toHaveLength(1);
});

test('(a) a saved-for-nothing or unsettled outcome opens no Rebuke ask', async () => {
  await fight([[pcC, 0, 0], [mon(goblin, 'g1'), 3, 0]], 'g1', 20, rebuker());
  await applyResolution('c1', { ...owed, outcomes: [{ ...owed.outcomes[0], owed: [{ amount: 9, type: 'fire' }] }], dc: 1 }, camp('c1').settings);
  answering(() => 'pass');
  await settle(ctx(), 'r1', 'pc:p', 20); // saves; onSave none: no damage
  expect(seen).toEqual([]);
});

test('(b) a mover whose turn ends during the ask stays where it is', async () => {
  await walk();
  answering((o) => { void updateCombat('c1', (k) => ({ ...k, turn: 'g1' })).then(() => pass(o.id)); return undefined; });
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(2, 0));
  expect(await at('t:pc:p')).toEqual(cell(2, 0));
});

test('(c) a second move of a token that is waiting on an ask does not walk', async () => {
  await walk();
  answering(() => undefined);
  const first = guardMove(ctx(), 't:pc:p', cell(6, 0));
  await vi.waitFor(() => expect(reactions.open).toHaveLength(1));
  expect(await guardMove(ctx(), 't:pc:p', cell(1, 5))).toEqual(cell(2, 0)); // where it waits
  expect(await at('t:pc:p')).toEqual(cell(2, 0));
  expect(reactions.open).toHaveLength(1);
  pass(reactions.open[0].id);
  expect(await first).toEqual(cell(6, 0));
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 1))).toEqual(cell(6, 1)); // free again
});

test('(d) Magic Missile darts: only Shield applies, never Uncanny Dodge', async () => {
  await fight([[pcC, 0, 0], [mon(mage, 'ma'), 3, 0]], 'ma', 20, rogue5());
  answering(() => 'pass');
  await land(ctx(), { id: 'r1', actor: 'ma', action: 'Magic Missile', outcomes: [{ id: 'pc:p', part: 'hit', hit: true, damage: 7 }], at: 0 });
  expect(seen).toEqual([]);
  expect(await pcHp()).toBe(13);
  // the same hit by a weapon does offer it
  await land(ctx(), { id: 'r2', actor: 'ma', action: 'Dagger', outcomes: [{ id: 'pc:p', part: 'hit', hit: true, roll: 15, ac: 12, damage: 4 }], at: 0 });
  expect(seen.map((o) => o.reactors[0].options.map((z) => z.id))).toEqual([['uncanny']]);
});

test('(e) Shield on Acid Arrow leaves half the damage on the miss', async () => {
  await fight([[pcC, 1, 0], [mon(mage, 'ma'), 1, 1]], 'pc:p');
  answering(() => ({ reactor: 'ma', option: 'shield' }));
  await land(ctx(), { id: 'r1', actor: 'pc:p', action: 'Acid Arrow', outcomes: [{ id: 'ma', part: 'hit', hit: true, roll: 14, ac: 12, damage: 8 }], at: 0 });
  expect((await db.combat.get('c1'))!.resolutions![0].outcomes[0]).toMatchObject({ hit: false, damage: 4, ac: 17 });
  expect((await fighter('ma')).hp).toBe(36);
});

test('a countered concentration spell leaves its caster concentrating on nothing (the counter’s own caster keeps hers)', async () => {
  await fight([[pcC, 0, 0], [mon(mage, 'ma'), 3, 0]], 'pc:p');
  const held = (x: Combatant) => ({ ...x, concentrating: true, concentratingOn: 'Call Lightning', concentrationCount: 1, concentrationSlot: 3 });
  await updateCombat('c1', (k) => ({ ...k, combatants: k.combatants.map((x) => (x.id === 'pc:p' ? held(x) : { ...x, concentrating: true, concentratingOn: 'Hold Person' }))
  }));
  answering(() => ({ reactor: 'ma', option: 'counterspell', slot: 3 }));
  expect(await guardCast(ctx(), 'pc:p', { name: 'Call Lightning', level: 3 })).toBe(false);
  const [p, ma] = [await fighter('pc:p'), await fighter('ma')];
  expect([p.concentrating, p.concentratingOn, p.concentrationSlot]).toEqual([false, undefined, undefined]);
  expect([ma.concentrating, ma.concentratingOn]).toEqual([true, 'Hold Person']); // Counterspell is no concentration spell
});

// ---- Final review fixes ----
const spellOf = (id: string) => srd.entities.find((e) => e.id === id) as SpellDef;
/** A PC wizard (5th level: 3rd-level slots) of player A1 with `ids` prepared. */
function wizard(ids: string[], levels = 5): Character {
  const c = mkChar({ race: 'human', base: { int: 16 }, levels: Array(levels).fill('wizard') }), list = ids.map(spellOf);
  return { ...c, id: 'p', name: 'p', campaignId: 'c1', ownerId: 'A1', state: { ...c.state, hp: 20 }, overrides: { maxHp: 30 }, embedded: { ...c.embedded, ...Object.fromEntries(list.map((x) => [x.id, x])) },
    build: { ...c.build, spells: { 'class:wizard@FIX': { known: ids, prepared: ids } } } };
}
const hideToken = (id: string) => db.scenes.update('s1', (s) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, hidden: true } : t)) }));

test('a monster hidden from the players (hidden row or hidden token) leaving a PC: no Opportunity Attack is offered', async () => {
  for (const how of ['row', 'token']) {
    await resetDb(); seen.length = 0;
    await fight([[pcC, 1, 1], [{ ...mon(goblin, 'g1'), ...(how === 'row' && { hidden: true }) }, 1, 0]], 'g1');
    if (how === 'token') await hideToken('t:g1');
    answering(() => 'pass');
    expect(await guardMove(ctx(), 't:g1', cell(6, 0))).toEqual(cell(6, 0));
    expect(seen).toEqual([]);
    stop();
  }
});

test('a hidden caster: no PC is asked to Counterspell it', async () => {
  await fight([[pcC, 0, 0], [mon(mage, 'ma'), 3, 0]], 'ma', 20, wizard(['spell:counterspell@SRD']));
  await hideToken('t:ma');
  answering(() => 'pass');
  expect(await guardCast(ctx(), 'ma', { name: 'Fireball', level: 3 })).toBe(true);
  expect(seen).toEqual([]);
});

test('a hidden attacker: the player card names nobody', async () => {
  await fight([[pcC, 0, 0], [mon(mage, 'ma'), 1, 0]], 'ma', 20, wizard(['spell:shield@SRD'], 1));
  await hideToken('t:ma');
  answering(() => 'pass');
  await land(ctx(), { id: 'r1', actor: 'ma', action: 'Dagger', outcomes: [{ id: 'pc:p', part: 'hit', hit: true, roll: 14, ac: 12, damage: 3 }], at: 0 }, undefined, { melee: true });
  expect(seen.map((o) => [o.kind, o.playerTrigger])).toEqual([['hit', 'Something hits you (14)']]);
});

const wolf = (by = 'pc:p'): Combatant => ({ ...mon(goblin, 'w1'), summon: { by, spell: 'Conjure Animals' } });
test('a PC walking away from its own summon: no ask, it walks on', async () => {
  await fight([[pcC, 1, 0], [wolf(), 1, 1]], 'pc:p');
  answering(() => ({ reactor: 'w1', option: 'oa' }));
  expect(await guardMove(ctx(), 't:pc:p', cell(6, 0))).toEqual(cell(6, 0));
  expect([seen, await pcHp()]).toEqual([[], 20]);
});

test('a monster leaving a PC summon (or a summon of that summon): the summon gets the attack', async () => {
  await fight([[mon(goblin, 'g1'), 1, 0], [wolf(), 1, 1], [{ ...mon(goblin, 'w2'), summon: { by: 'w1', spell: 'Conjure' } }, 5, 1], [pcC, 9, 9]], 'g1');
  answering((o) => ({ reactor: o.reactors[0].id, option: 'oa' }));
  await guardMove(ctx(), 't:g1', cell(5, 0)); // leaves w1, walks up to w2
  expect(seen.map((o) => o.reactors.map((r) => r.id))).toEqual([['w1']]);
  expect((await fighter('w1')).reactionUsed).toBe(true);
  await updateCombat('c1', (k) => ({ ...k, combatants: k.combatants.map((x) => (x.id === 'g1' ? { ...x, hp: 7 } : x)) }));
  await guardMove(ctx(), 't:g1', cell(9, 0)); // leaves w2 (by w1, by the PC)
  expect(seen.map((o) => o.reactors.map((r) => r.id))).toEqual([['w1'], ['w2']]);
});

test('a countered Haste ends the haste it gave at payment', async () => {
  await fight([[pcC, 0, 0], [mon(mage, 'ma'), 3, 0]], 'pc:p');
  await updateCombat('c1', (k) => ({ ...k, combatants: k.combatants.map((x) => (x.id === 'pc:p' ? { ...x, concentrating: true, concentratingOn: 'Haste', concentrationSlot: 3, hasted: { by: 'pc:p', round: 1 } } : x)) }));
  answering(() => ({ reactor: 'ma', option: 'counterspell', slot: 3 }));
  expect(await guardCast(ctx(), 'pc:p', { name: 'Haste', level: 3 })).toBe(false);
  expect((await fighter('pc:p')).hasted).toEqual({ by: 'pc:p', round: 1, ended: true });
});

test('Shield can be countered: the hit stands, the slot is spent, no Shield condition', async () => {
  await fight([[pcC, 1, 0], [mon(mage, 'ma'), 1, 1], [mon(mage, 'mb'), 3, 1]], 'pc:p');
  answering((o) => (o.kind === 'hit' ? { reactor: 'ma', option: 'shield' } : o.reactors.some((r) => r.id === 'mb') ? { reactor: 'mb', option: 'counterspell', slot: 3 } : 'pass'));
  await land(ctx(), { id: 'r1', actor: 'pc:p', action: 'Longsword', outcomes: [{ id: 'ma', part: 'hit', hit: true, roll: 14, ac: 12, damage: 6 }], at: 0 }, undefined, { melee: true });
  expect(seen.map((o) => o.kind)).toEqual(['hit', 'counterspell']);
  const ma = await fighter('ma');
  expect([ma.hp, ma.conditions ?? [], ma.spellsUsed?.['slot:1'], ma.reactionUsed]).toEqual([34, [], 1, true]);
  expect((await db.combat.get('c1'))!.resolutions![0].outcomes[0]).toMatchObject({ hit: true, damage: 6 });
});

/** A PC fighter (Str 16) of player A1, next to a monster that walks away; its player answers with its own dice. */
async function playerOa(m: MonsterDef, inventory: Character['inventory'] = []) {
  const c = mkChar({ race: 'human', base: { str: 16 }, levels: ['fighter'] });
  await fight([[pcC, 1, 1], [mon(m, 'm1'), 1, 0]], 'm1', 20, { ...c, id: 'p', name: 'p', campaignId: 'c1', ownerId: 'A1', inventory });
}
test('a player answers an Opportunity Attack with its own dice: the foe is hit, the PC reaction is spent; dice that do not fit are refused', async () => {
  const refused: [string, string][] = [];
  const c = ctx({ rollAim: undefined, onRefused: (id, why) => { refused.push([id, why]); } });
  await playerOa(goblin);
  answering(() => ({ reactor: 'pc:p', option: 'oa', aim: { rolled: { d20: [19, 19], dmg: [[]] }, toggles: [] } }));
  expect(await guardMove(c, 't:m1', cell(6, 0))).toEqual(cell(6, 0));
  expect([(await fighter('pc:p')).reactionUsed, (await fighter('m1')).hp, refused]).toEqual([true, 3, []]); // unarmed: 1 + 3
  stop(); await resetDb(); seen.length = 0;
  await playerOa(goblin);
  answering(() => ({ reactor: 'pc:p', option: 'oa', aim: { rolled: { d20: [19, 19], dmg: [[3]] }, toggles: [] } }));
  await guardMove(c, 't:m1', cell(6, 0));
  expect([(await fighter('pc:p')).reactionUsed, (await fighter('m1')).hp]).toEqual([undefined, 7]);
  expect(refused).toEqual([['pc:p', expect.any(String)]]);
});

test('a player Opportunity Attack is worked out from the player view of the sheet (a hidden weapon bonus does not apply)', async () => {
  const sword = { ...makeEntry({ ...longsword, magic: true, bonuses: { damage: 5 } }, { view: { hidden: ['bonuses'], revealed: [] } }), equipped: true };
  await playerOa(mage, [sword]);
  answering((o) => o.kind === 'hit' ? 'pass' : ({ reactor: 'pc:p', option: 'oa', aim: { rolled: { d20: [19, 19], dmg: [[4]] }, toggles: [] } }));
  await guardMove(ctx({ rollAim: undefined }), 't:m1', cell(6, 0));
  expect([(await fighter('pc:p')).reactionUsed, (await fighter('m1')).hp]).toEqual([true, 33]); // 4 + 3, not + 5
});

test('the Counterspell check d20 rolled on the DM device is never shared, even with the DM rolls public (it would name the spell)', async () => {
  await db.campaigns.put(camp('c1'));
  const shared: RollEntry[] = [], was = { viewer: rollViewer.value, dm: rollVisibility.dm, hook: rollHooks.public };
  rollViewer.value = 'dm'; rollVisibility.dm = true; rollHooks.public = (e) => { shared.push(e); };
  try {
    const d = (await flowCtx('c1', camp('c1').settings)).d20!();
    expect(d).toBeGreaterThanOrEqual(1);
    expect(rollLog[0]).toMatchObject({ label: 'Counterspell check', public: false });
    expect(shared).toEqual([]);
  } finally { rollViewer.value = was.viewer; rollVisibility.dm = was.dm; rollHooks.public = was.hook; }
});
