// The DM's reaction cards: which open reactors the DM answers for and which belong to a connected player.
import { expect, test } from 'vitest';
import { dmCards, dmAnswers } from '../../src/lib/combat/reactionCard.ts';
import type { Open } from '../../src/lib/combat/reactionStack.svelte.ts';
import type { Combatant } from '../../src/lib/types.ts';

const opt = [{ id: 'oa' as const, label: 'Attack (Mace)' }];
const open = (id: string, ids: string[], answered: string[] = []): Open => ({ id, kind: 'opportunity', trigger: 'Bree leaves the goblin’s reach', playerTrigger: 'p', waiting: 'x',
  reactors: ids.map((r) => ({ id: r, name: r.toUpperCase(), options: opt })), answered, answers: [], deadline: 5000 });

test('the DM answers for monsters and for PCs whose player is not connected; a connected player’s reactor is only waited on', () => {
  const [card] = dmCards([open('a1', ['g1', 'pc:bob', 'pc:ann'])], (id) => id !== 'pc:ann');
  expect(card.mine.map((r) => r.id)).toEqual(['g1', 'pc:bob']);
  expect(card.others.map((r) => r.id)).toEqual(['pc:ann']);
  expect([card.ask, card.trigger, card.deadline]).toEqual(['a1', 'Bree leaves the goblin’s reach', 5000]);
});

test('answered reactors drop out; an ask with nobody left has no card', () => {
  const cards = dmCards([open('a1', ['g1', 'pc:ann'], ['g1']), open('a2', ['g2'], ['g2'])], (id) => id.startsWith('g'));
  expect(cards.map((c) => [c.ask, c.mine.length, c.others.map((r) => r.id)])).toEqual([['a1', 0, ['pc:ann']]]);
});

test('dmAnswers: a monster, a PC with no owner and a PC whose owner is offline are the DM’s; a connected owner’s PC is not', () => {
  const fighters = [{ id: 'g1' }, { id: 'pc:a', characterId: 'a' }, { id: 'pc:b', characterId: 'b' }, { id: 'pc:c', characterId: 'c' }] as Combatant[];
  const owner = (id: string) => ({ a: 'P1', b: 'P2' })[id];
  const mine = dmAnswers(fighters, owner, { P1: 1 });
  expect(['g1', 'pc:a', 'pc:b', 'pc:c', 'gone'].map(mine)).toEqual([true, false, true, true, true]);
});
