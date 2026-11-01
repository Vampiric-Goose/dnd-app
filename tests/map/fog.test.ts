import { describe, expect, test } from 'vitest';
import { MAX_MESSAGE } from '../../src/lib/sync/protocol.ts';
import { applyFog, cleanFog, decodeFog, encodeFog, fogSize, isRevealed, newFog, paintBrush, paintFog, paintRect } from '../../src/lib/map/fog.ts';

const W = 100, H = 40;
const rev = (f: Uint8Array, x: number, y: number) => isRevealed(f, W, H, { x, y });

describe('fog bitset', () => {
  test('size and a fresh fog', () => {
    expect(fogSize(100, 40)).toEqual({ cols: 7, rows: 3 });
    expect(rev(newFog(W, H, false), 5, 5)).toBe(false);
    expect(rev(newFog(W, H, true), 99, 39)).toBe(true);
  });
  test('rectangle: fog cells whose centre is in the box', () => {
    const f0 = newFog(W, H, false);
    const f = paintRect(f0, W, H, { x: 32, y: 16 }, { x: 0, y: 0 }, true);
    expect(f).not.toBe(f0);
    expect(rev(f0, 5, 5)).toBe(false);
    expect([rev(f, 5, 5), rev(f, 20, 5), rev(f, 40, 5), rev(f, 5, 20)]).toEqual([true, true, false, false]);
  });
  test('brush reveals and hides', () => {
    const f = paintBrush(newFog(W, H, false), W, H, { x: 50, y: 20 }, 10, true);
    expect(rev(f, 52, 20)).toBe(true);
    expect(rev(f, 44, 20)).toBe(false);
    expect(rev(paintBrush(f, W, H, { x: 50, y: 20 }, 10, false), 52, 20)).toBe(false);
  });
  test('a point on the far edge reads the last cell; no fog is all fogged', () => {
    const f = paintRect(newFog(96, 32, false), 96, 32, { x: 80, y: 16 }, { x: 96, y: 32 }, true);
    expect(isRevealed(f, 96, 32, { x: 96, y: 32 })).toBe(true);
    expect(isRevealed(undefined, W, H, { x: 5, y: 5 })).toBe(false);
  });
  test('encode and decode', () => {
    const f = paintBrush(newFog(W, H, false), W, H, { x: 50, y: 20 }, 30, true);
    expect(decodeFog(encodeFog(f), W, H)).toEqual(f);
    expect(encodeFog(newFog(4096, 4096, true))).toHaveLength(10_924);
    expect(decodeFog(encodeFog(newFog(200, 40, false)), W, H)).toBeUndefined();
    expect(decodeFog('not base64!', W, H)).toBeUndefined();
  });
  test('cleanFog: absent stays absent, bad becomes all fogged', () => {
    const good = encodeFog(newFog(W, H, true));
    expect(cleanFog(undefined, W, H)).toBeUndefined();
    expect(cleanFog(good, W, H)).toBe(good);
    expect(cleanFog(encodeFog(newFog(200, 40, true)), W, H)).toBe(encodeFog(newFog(W, H, false)));
    expect(cleanFog(42, W, H)).toBe(encodeFog(newFog(W, H, false)));
  });
});

test('paintFog: one DM edit on the scene\'s fog string', () => {
  const brushed = paintFog(undefined, W, H, { k: 'brush', points: [{ x: 10, y: 10 }, { x: 50, y: 20 }], radius: 10, reveal: true });
  const f = decodeFog(brushed, W, H)!;
  expect([rev(f, 10, 10), rev(f, 52, 20), rev(f, 90, 30)]).toEqual([true, true, false]);
  expect(rev(decodeFog(paintFog(brushed, W, H, { k: 'rect', a: { x: 0, y: 0 }, b: { x: 100, y: 40 }, reveal: false }), W, H)!, 10, 10)).toBe(false);
  expect(paintFog('bad', W, H, { k: 'all', reveal: true })).toBe(encodeFog(newFog(W, H, true)));
});

describe('applyFog (the players\' projection)', () => {
  const thorin = { id: 'thorin', name: 'Thorin', x: 20, y: 20 }, goblin = { id: 'goblin', name: 'Goblin 1', x: 80, y: 20 };
  test('fogged tokens never reach players', () => {
    const fog = encodeFog(paintBrush(newFog(W, H, false), W, H, thorin, 12, true));
    const out = applyFog({ tokens: [thorin, goblin] }, { width: W, height: H, fog });
    expect(out.tokens.map((t) => t.id)).toEqual(['thorin']);
    expect(out.fog).toBe(fog);
    expect(JSON.stringify(out)).not.toContain('Goblin');
  });
  test('a scene with fog on and no fog string is all black', () => {
    const out = applyFog({ tokens: [thorin, goblin] }, { width: W, height: H });
    expect(out.tokens).toEqual([]);
    expect(out.fog).toBe(encodeFog(newFog(W, H, false)));
  });
  test('a damaged fog string is all black too', () => {
    const out = applyFog({ tokens: [thorin] }, { width: W, height: H, fog: 'AAAA' });
    expect(out.tokens).toEqual([]);
    expect(out.fog).toBe(encodeFog(newFog(W, H, false)));
  });
  test('full fog still fits in one message', () => {
    const tokens = Array.from({ length: 200 }, (_, i) => ({ id: `token-${i}-xxxxxxxxxxxx`, name: 'N'.repeat(100), x: 8 + (i % 200) * 16, y: 8 + Math.floor(i / 200) * 16, size: 'M', color: '#c0392b', portrait: 'a'.repeat(64), health: 'Bloodied' }));
    const fog = encodeFog(newFog(4096, 4096, true));
    const out = applyFog({ id: 's1', name: 'N'.repeat(100), width: 4096, height: 4096, tokens }, { width: 4096, height: 4096, fog });
    expect(out.tokens).toHaveLength(200);
    expect(JSON.stringify({ type: 'scene', scene: out }).length).toBeLessThan(MAX_MESSAGE);
  });
});
