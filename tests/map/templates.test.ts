import { describe, expect, test } from 'vitest';
import { cellAt, cellCenter, cellsIn, snap } from '../../src/lib/map/grid.ts';
import { affectedCells, inTemplate, tokensInTemplate, type Template } from '../../src/lib/map/templates.ts';
import type { Grid, Token } from '../../src/lib/types.ts';

const g: Grid = { type: 'square', size: 50, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.35, feet: 5 }; // 10 px per foot
const t = (shape: Template['shape'], feet: number, o: Partial<Template> = {}): Template => ({ shape, origin: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, feet, ...o });
const at = (tp: Template, x: number, y: number) => inTemplate(tp, g, { x, y });
const key = (c: { q: number; r: number }) => `${c.q},${c.r}`;
const tok = (id: string, x: number, y: number, size: Token['size']): Token => ({ id, name: id, x, y, size, color: '#000000' });

describe('area templates (cell-centre test, origin on a cell centre)', () => {
  test('the map snaps the origin to the centre of the cell under the pointer, square and hex', () => {
    expect(snap(g, { x: 61, y: 140 }, 'M')).toEqual({ x: 75, y: 125 });
    const hex: Grid = { ...g, type: 'hex-flat' }, p = { x: 133, y: 171 };
    expect(snap(hex, p, 'M')).toEqual(cellCenter(hex, cellAt(hex, p)));
  });
  test('sphere: a 20 ft radius centred in a cell is a round blob, 9 cells across, the origin in the middle and no stray tips', () => {
    const o = cellCenter(g, { q: 10, r: 10 });
    const cells = affectedCells(t('sphere', 20, { origin: o }), g, 1050, 1050);
    const rows = new Map<number, number>();
    for (const c of cells) rows.set(c.r, (rows.get(c.r) ?? 0) + 1);
    expect([...rows.keys()].sort((x, y) => x - y).map((r) => rows.get(r))).toEqual([5, 7, 9, 9, 9, 9, 9, 7, 5]);
    expect(cells.map(key)).toContain('10,10');
  });
  test('sphere: 5 ft from a cell centre covers that cell and its 8 neighbours; on a pointy hex grid 7 hexes', () => {
    expect(affectedCells(t('sphere', 5, { origin: { x: 275, y: 275 } }), g, 1000, 1000)).toHaveLength(9);
    const hex: Grid = { ...g, type: 'hex-pointy' };
    expect(affectedCells(t('sphere', 5, { origin: cellCenter(hex, { q: 2, r: 2 }) }), hex, 400, 400)).toHaveLength(7);
  });
  test('only cells inside the scene', () => {
    // from the corner cell's centre: the quarter of a 10 ft blob that is on the map (3 + 3 + 2)
    expect(affectedCells(t('sphere', 10, { origin: { x: 25, y: 25 } }), g, 1000, 1000)).toHaveLength(8);
  });
  test('cylinder: a radius around the origin cell centre, which it includes', () => {
    const c = t('cylinder', 10, { origin: { x: 325, y: 325 } });
    expect(at(c, 325 + 100, 325)).toBe(true);
    expect(at(c, 325, 325 + 150)).toBe(false);
    expect(affectedCells(c, g, 1000, 1000).map(key)).toContain('6,6');
  });
  test('cone: as wide as it is far, the origin cell left out, and it widens away from the caster on a diagonal too', () => {
    const o = { x: 275, y: 275 }, e = { origin: o, aim: { x: 900, y: 275 } };
    expect(at(t('cone', 30, e), 275 + 200, 275 + 90)).toBe(true);
    expect(at(t('cone', 30, e), 275 + 200, 275 + 110)).toBe(false);
    expect(at(t('cone', 30, e), 275 - 50, 275)).toBe(false);
    expect(at(t('cone', 30, e), 275, 275)).toBe(false);
    // 15 ft aimed east: 1, 3, 3 cells in its three columns
    expect(affectedCells(t('cone', 15, { origin: o, aim: { x: 500, y: 275 } }), g, 1000, 1000)).toHaveLength(7);
    // aimed south-east: each ring out from the caster is at least as wide as the one before
    const cells = affectedCells(t('cone', 30, { origin: o, aim: { x: 500, y: 500 } }), g, 1000, 1000);
    const ring = (c: { q: number; r: number }) => Math.max(Math.abs(c.q - 5), Math.abs(c.r - 5));
    const per = [1, 2, 3, 4, 5].map((k) => cells.filter((c) => ring(c) === k).length);
    for (let k = 1; k < per.length; k++) expect(per[k]).toBeGreaterThanOrEqual(per[k - 1]);
  });
  test('line: 5 ft wide by default, its length counted out from the origin cell', () => {
    const l = t('line', 30);
    expect(at(l, 150, 24)).toBe(true);
    expect(at(l, 150, 26)).toBe(false);
    expect(at(l, 301, 0)).toBe(false);
    expect(at(t('line', 30, { width: 10 }), 150, 49)).toBe(true);
    const cells = affectedCells(t('line', 30, { origin: { x: 275, y: 275 }, aim: { x: 900, y: 275 } }), g, 1000, 1000);
    expect(cells.map(key)).toEqual(['6,5', '7,5', '8,5', '9,5', '10,5', '11,5']);
  });
  test('cube: a square centred on the origin cell; an even side reaches toward the aim', () => {
    const o = { x: 275, y: 275 };
    expect(affectedCells(t('cube', 15, { origin: o }), g, 1000, 1000).map(key).sort()).toEqual(['4,4', '4,5', '4,6', '5,4', '5,5', '5,6', '6,4', '6,5', '6,6']);
    expect(affectedCells(t('cube', 10, { origin: o, aim: { x: 275, y: 0 } }), g, 1000, 1000).map(key).sort()).toEqual(['5,4', '5,5', '6,4', '6,5']);
    expect(affectedCells(t('cube', 10, { origin: o, aim: { x: 0, y: 900 } }), g, 1000, 1000).map(key).sort()).toEqual(['4,5', '4,6', '5,5', '5,6']);
  });
  test('aim at the origin points +x', () => {
    expect(at(t('line', 30, { aim: { x: 0, y: 0 } }), 150, 0)).toBe(true);
  });
  test('tokens with any footprint cell affected', () => {
    const sphere = t('sphere', 10, { origin: { x: 275, y: 275 } });
    expect(tokensInTemplate(sphere, g, [tok('goblin', 75, 75, 'M'), tok('ogre', 200, 200, 'L'), tok('centre', 275, 275, 'M'), tok('far', 275, 425, 'M')]))
      .toEqual(['ogre', 'centre']);
    // a line cast from the caster's cell leaves the caster out and catches who stands in it
    const line = t('line', 30, { origin: { x: 275, y: 275 }, aim: { x: 900, y: 275 } });
    expect(tokensInTemplate(line, g, [tok('caster', 275, 275, 'M'), tok('orc', 425, 275, 'M')])).toEqual(['orc']);
  });
});
