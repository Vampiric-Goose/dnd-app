import { describe, expect, test } from 'vitest';
import { cellAt, cellCenter, footprint } from '../../src/lib/map/grid.ts';
import { addTokens, DEFAULT_GRID, initials, liveHp, MAX_TOKENS, moveTokens, newScene, patchToken, regrid, removeTokens, tokenAt, tokenColor, tokensInRect } from '../../src/lib/map/scene.ts';
import type { Combat, Scene, Token } from '../../src/lib/types.ts';

const tok = (id: string, x: number, y: number, o: Partial<Token> = {}): Token => ({ id, name: id, x, y, size: 'M', color: '#336699', ...o });
const scene = (tokens: Token[], o: Partial<Scene> = {}): Scene => ({ ...newScene('c1', 'S'), tokens, ...o });

test('I3: regrid re-snaps tokens only when the grid type changes', () => {
  const s = scene([tok('a', 35, 35), tok('b', 105, 35)]);
  const bigger = regrid(s, { size: 200, offsetX: 7, opacity: 0.5 });
  expect(bigger.grid).toMatchObject({ size: 200, offsetX: 7, opacity: 0.5 });
  expect(bigger.tokens).toEqual(s.tokens); // they do not pile together
  const hexed = regrid(s, { type: 'hex-pointy' });
  expect(hexed.tokens.map((t) => [t.x, t.y])).not.toEqual(s.tokens.map((t) => [t.x, t.y]));
  for (const t of hexed.tokens) expect(cellCenter(hexed.grid, cellAt(hexed.grid, t))).toEqual({ x: t.x, y: t.y });
});

test('initials', () => {
  expect(initials('Goblin 1')).toBe('G1');
  expect(initials('Goblin 12')).toBe('G12');
  expect(initials('Thorin Oakenshield')).toBe('TO');
  expect(initials('ogre')).toBe('O');
  expect(initials('')).toBe('?');
  expect(initials('   ')).toBe('?');
});

test('tokenColor is stable', () => {
  expect(tokenColor('Goblin')).toBe(tokenColor('Goblin'));
  expect(tokenColor('Goblin')).toMatch(/^#[0-9a-f]{6}$/);
});

test('newScene', () => {
  const s = newScene('c1', 'Cave');
  expect(s).toMatchObject({ campaignId: 'c1', name: 'Cave', width: 1400, height: 1000, grid: DEFAULT_GRID, tokens: [] });
  expect(s.image).toBeUndefined();
  expect(newScene('c1', 'Map', { hash: 'abc', width: 800, height: 600 })).toMatchObject({ image: 'abc', width: 800, height: 600 });
});

describe('addTokens', () => {
  test('three tokens without a spot get distinct free snapped spots', () => {
    const s = addTokens(newScene('c1', 'S'), [{ name: 'A', size: 'M' }, { name: 'B', size: 'M' }, { name: 'C', size: 'L' }]);
    expect(s.tokens).toHaveLength(3);
    const cells = s.tokens.flatMap((t) => footprint(s.grid, t).map((c) => `${c.q},${c.r}`));
    expect(new Set(cells).size).toBe(cells.length);
    for (const t of s.tokens.slice(0, 2)) expect(cellCenter(s.grid, cellAt(s.grid, t))).toEqual({ x: t.x, y: t.y });
    expect(s.tokens[0].color).toBe(tokenColor('A'));
    expect(new Set(s.tokens.map((t) => t.id)).size).toBe(3);
  });
  test('a given spot is snapped', () => {
    const s = addTokens(newScene('c1', 'S'), [{ name: 'A', size: 'M', x: 80, y: 10 }]);
    expect(s.tokens[0]).toMatchObject({ x: 105, y: 35 });
  });
  test(`stops at ${MAX_TOKENS}`, () => {
    const s = addTokens(newScene('c1', 'S'), Array.from({ length: 250 }, (_, i) => ({ name: `G${i}`, size: 'M' as const })));
    expect(s.tokens).toHaveLength(MAX_TOKENS);
  });
});

describe('moveTokens (Review Focus 4)', () => {
  const s = scene([tok('a', 35, 35), tok('b', 105, 35)]);
  test('the group moves by the primary snapped delta', () => {
    const out = moveTokens(s, ['a', 'b'], 'a', { x: 180, y: 40 });
    expect(out.tokens.map((t) => [t.x, t.y])).toEqual([[175, 35], [245, 35]]);
  });
  test('refused whole when one would leave the scene', () => {
    expect(moveTokens(s, ['a', 'b'], 'a', { x: 1390, y: 40 })).toBe(s);
    expect(moveTokens(s, ['a'], 'a', { x: -10, y: 40 })).toBe(s);
  });
  test('a hex L token lands on a hex centre', () => {
    const g = { ...DEFAULT_GRID, type: 'hex-pointy' as const, size: 60 };
    const h = scene([tok('l', 60, 0, { size: 'L' })], { grid: g });
    const t = moveTokens(h, ['l'], 'l', { x: 333, y: 222 }).tokens[0];
    const c = cellCenter(g, cellAt(g, t));
    expect(t.x).toBeCloseTo(c.x);
    expect(t.y).toBeCloseTo(c.y);
    expect(t.x).not.toBe(60);
  });
});

test('patchToken and removeTokens', () => {
  const s = scene([tok('a', 35, 35), tok('b', 105, 35)]);
  expect(patchToken(s, 'a', { name: 'Boss', id: 'x' }).tokens[0]).toMatchObject({ id: 'a', name: 'Boss' });
  expect(removeTokens(s, ['a']).tokens.map((t) => t.id)).toEqual(['b']);
});

test('tokenAt: topmost, hidden only for the DM', () => {
  const s = scene([tok('under', 35, 35), tok('over', 40, 40), tok('ghost', 500, 500, { hidden: true })]);
  expect(tokenAt(s, { x: 38, y: 38 }, false)?.id).toBe('over');
  expect(tokenAt(s, { x: 500, y: 500 }, false)).toBeUndefined();
  expect(tokenAt(s, { x: 500, y: 500 }, true)?.id).toBe('ghost');
  expect(tokenAt(s, { x: 300, y: 300 }, true)).toBeUndefined();
});

test('tokensInRect', () => {
  const s = scene([tok('a', 35, 35), tok('b', 105, 35), tok('c', 50, 90, { hidden: true })]);
  expect(tokensInRect(s, { x: 100, y: 100 }, { x: 0, y: 0 }, true)).toEqual(['a', 'c']);
  expect(tokensInRect(s, { x: 0, y: 0 }, { x: 100, y: 100 }, false)).toEqual(['a']);
});

test('liveHp', () => {
  const t = tok('g', 0, 0, { hp: 7, maxHp: 7, combatantId: 'g1' });
  const combat: Combat = { campaignId: 'c1', round: 1, groupMonsters: false, updatedAt: 0,
    combatants: [{ id: 'g1', kind: 'monster', name: 'Goblin', initMod: 2, dex: 14, tie: 0, conSave: 0, hp: 3, maxHp: 7, conditions: ['Prone'] }] };
  expect(liveHp(t, combat)).toEqual({ hp: 3, maxHp: 7, conditions: ['Prone'] });
  expect(liveHp(t, undefined)).toEqual({ hp: 7, maxHp: 7, conditions: [] });
});
