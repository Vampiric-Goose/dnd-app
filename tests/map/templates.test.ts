import { describe, expect, test } from 'vitest';
import { cellCenter } from '../../src/lib/map/grid.ts';
import { affectedCells, inTemplate, tokensInTemplate, type Template } from '../../src/lib/map/templates.ts';
import type { Grid, Token } from '../../src/lib/types.ts';

const g: Grid = { type: 'square', size: 50, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.35, feet: 5 }; // 10 px per foot
const t = (shape: Template['shape'], feet: number, o: Partial<Template> = {}): Template => ({ shape, origin: { x: 0, y: 0 }, aim: { x: 1, y: 0 }, feet, ...o });
const at = (tp: Template, x: number, y: number) => inTemplate(tp, g, { x, y });

describe('area templates (cell-centre test)', () => {
  test('sphere: a 10 ft radius covers 12 square cells; 5 ft on a pointy hex grid covers 7 hexes', () => {
    expect(affectedCells(t('sphere', 10, { origin: { x: 250, y: 250 } }), g, 1000, 1000)).toHaveLength(12);
    const hex: Grid = { ...g, type: 'hex-pointy' };
    const c = cellCenter(hex, { q: 2, r: 2 });
    expect(affectedCells(t('sphere', 5, { origin: c }), hex, 400, 400)).toHaveLength(7);
  });
  test('only cells inside the scene', () => {
    expect(affectedCells(t('sphere', 10, { origin: { x: 0, y: 0 } }), g, 1000, 1000)).toHaveLength(3); // (25,25), (75,25), (25,75)
  });
  test('cone: as wide as it is far', () => {
    const c = t('cone', 30);
    expect(at(c, 200, 90)).toBe(true);
    expect(at(c, 200, 110)).toBe(false);
    expect(at(c, 310, 0)).toBe(false);
    expect(at(c, -10, 0)).toBe(false);
    expect(at(t('cone', 30, { aim: { x: 0, y: 1 } }), 90, 200)).toBe(true);
  });
  test('line: 5 ft wide by default', () => {
    const l = t('line', 30);
    expect(at(l, 150, 24)).toBe(true);
    expect(at(l, 150, 26)).toBe(false);
    expect(at(l, 301, 0)).toBe(false);
    expect(at(t('line', 30, { width: 10 }), 150, 49)).toBe(true);
  });
  test('cube: the origin is the middle of one face', () => {
    const c = t('cube', 10);
    expect(at(c, 50, 49)).toBe(true);
    expect(at(c, 50, 51)).toBe(false);
    expect(at(c, 101, 0)).toBe(false);
  });
  test('cylinder: a radius around the origin', () => {
    const c = t('cylinder', 10, { origin: { x: 300, y: 300 } });
    expect(at(c, 300 + 99, 300)).toBe(true);
    expect(at(c, 300, 300 + 101)).toBe(false);
  });
  test('aim at the origin points +x', () => {
    expect(at(t('line', 30, { aim: { x: 0, y: 0 } }), 150, 0)).toBe(true);
  });
  test('tokens with any footprint cell affected', () => {
    const tok = (id: string, x: number, y: number, size: Token['size']): Token => ({ id, name: id, x, y, size, color: '#000000' });
    expect(tokensInTemplate(t('sphere', 10, { origin: { x: 250, y: 250 } }), g, [tok('goblin', 75, 75, 'M'), tok('ogre', 200, 200, 'L')])).toEqual(['ogre']);
  });
});
