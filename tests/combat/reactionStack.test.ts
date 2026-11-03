// Task 2: the stack of open reaction asks.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { answer, ask, AUTO_PASS_MS, onChange, pass, reactions, reset, type Ask } from '../../src/lib/combat/reactionStack.svelte.ts';

const mk = (id: string, ...reactors: { id: string; slots?: number[] }[]): Ask => ({
  id, kind: 'hit', trigger: 'DM line', playerTrigger: 'Player line', waiting: 'goblin',
  reactors: reactors.map((r) => ({ id: r.id, name: r.id, options: r.slots ? r.slots.map((slot) => ({ id: 'counterspell' as const, label: `C${slot}`, slot })) : [{ id: 'shield' as const, label: 'Shield' }] })),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { reset(); vi.useRealTimers(); });

describe('reaction stack', () => {
  test('an ask resolves with the chosen answers once every reactor has answered or passed', async () => {
    const p = ask(mk('a', { id: 'x' }, { id: 'y' }));
    expect(reactions.open.map((o) => o.id)).toEqual(['a']);
    expect(answer('a', { reactor: 'x', option: 'shield' })).toBe(true);
    expect(reactions.open).toHaveLength(1);
    pass('a', 'y');
    expect(await p).toEqual([{ reactor: 'x', option: 'shield' }]);
    expect(reactions.open).toHaveLength(0);
  });

  test('an unanswered ask passes by itself after 10 seconds', async () => {
    let done = false;
    const p = ask(mk('a', { id: 'x' })).then((r) => { done = true; return r; });
    vi.advanceTimersByTime(AUTO_PASS_MS - 1);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(reactions.open).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(await p).toEqual([]);
    expect(reactions.open).toHaveLength(0);
  });

  test('the deadline comes from the clock given', () => {
    void ask(mk('a', { id: 'x' }), () => 1000);
    expect(reactions.open[0].deadline).toBe(1000 + AUTO_PASS_MS);
  });

  test('a nested ask resolves first and the outer one stays open', async () => {
    const outer = ask(mk('outer', { id: 'x' }));
    vi.advanceTimersByTime(4000);
    const inner = ask(mk('inner', { id: 'y' }));
    expect(reactions.open.map((o) => o.id)).toEqual(['outer', 'inner']);
    answer('inner', { reactor: 'y', option: 'shield' });
    expect(await inner).toHaveLength(1);
    expect(reactions.open.map((o) => o.id)).toEqual(['outer']);
    vi.advanceTimersByTime(6000); // the outer's own timer
    expect(await outer).toEqual([]);
  });

  test('answer refuses an option or slot it wasn’t offered, and a second answer', () => {
    void ask(mk('a', { id: 'x', slots: [3, 5] }, { id: 'y' }));
    expect(answer('nope', { reactor: 'y', option: 'shield' })).toBe(false);
    expect(answer('a', { reactor: 'z', option: 'shield' })).toBe(false);
    expect(answer('a', { reactor: 'y', option: 'parry' })).toBe(false);
    expect(answer('a', { reactor: 'x', option: 'counterspell' })).toBe(false); // slot needed
    expect(answer('a', { reactor: 'x', option: 'counterspell', slot: 4 })).toBe(false);
    expect(answer('a', { reactor: 'y', option: 'shield', slot: 9 })).toBe(true); // no slot on the option: ignored
    expect(answer('a', { reactor: 'y', option: 'shield' })).toBe(false);
    expect(answer('a', { reactor: 'x', option: 'counterspell', slot: 5 })).toBe(true);
  });

  test('a passed reactor cannot answer', () => {
    void ask(mk('a', { id: 'x' }, { id: 'y' }));
    pass('a', 'x');
    expect(answer('a', { reactor: 'x', option: 'shield' })).toBe(false);
  });

  test('pass with no reactor passes everyone', async () => {
    const p = ask(mk('a', { id: 'x' }, { id: 'y' }));
    pass('a');
    expect(await p).toEqual([]);
  });

  test('reset resolves open asks with the answers they have', async () => {
    const p = ask(mk('a', { id: 'x' }, { id: 'y' }));
    answer('a', { reactor: 'x', option: 'shield' });
    reset();
    expect(await p).toEqual([{ reactor: 'x', option: 'shield' }]);
    expect(reactions.open).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('an ask with no reactors never opens', async () => {
    const fn = vi.fn();
    const off = onChange(fn);
    expect(await ask(mk('a'))).toEqual([]);
    expect(reactions.open).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  test('onChange fires on push, answer and pop, and stops after unsubscribe', () => {
    const fn = vi.fn();
    const off = onChange(fn);
    void ask(mk('a', { id: 'x' }, { id: 'y' }));
    expect(fn).toHaveBeenCalledTimes(1);
    answer('a', { reactor: 'x', option: 'shield' });
    expect(fn).toHaveBeenCalledTimes(2);
    pass('a');
    expect(fn).toHaveBeenCalledTimes(3); // the pass that closes it: one change
    off();
    void ask(mk('b', { id: 'x' }));
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
