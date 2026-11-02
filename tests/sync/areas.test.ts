import { describe, expect, test } from 'vitest';
import { areasOn } from '../../src/lib/combat/aiming.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import { DEFAULT_SETTINGS } from '../../src/lib/settings.ts';
import { cleanScene, sceneForPlayers } from '../../src/lib/sync/scene.ts';
import type { Combat, Combatant, Resolution, Scene } from '../../src/lib/types.ts';

// A cast spell's area shows on every map: an instant one until its caster's next turn, a concentration one while the caster keeps
// concentrating, on the scene it was cast on. Undo (which drops the result) takes it away.
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const area = { shape: 'sphere' as const, origin: { x: 105, y: 105 }, aim: { x: 106, y: 105 }, feet: 20 };
const res = (id: string, o: Partial<Resolution> = {}): Resolution => ({ id, actor: 'm', action: 'Fireball', outcomes: [], applied: [], at: 0, area, sceneId: 's1', round: 2, ...o });
const fight = (turn: string, round: number, o: Partial<Combat> = {}): Combat => ({ campaignId: 'c1', round, turn, groupMonsters: false, updatedAt: 0,
  combatants: [cb({ id: 'a', kind: 'pc', name: 'A' }), cb({ id: 'm', kind: 'monster', name: 'Mage' }), cb({ id: 'z', kind: 'monster', name: 'Z' })], ...o });

describe('spell areas on the map', () => {
  test('an instant area stays until its caster\'s next turn, on its own scene only', () => {
    expect(areasOn(fight('m', 2, { resolutions: [res('r1')] }), 's1')).toEqual([area]);
    expect(areasOn(fight('z', 2, { resolutions: [res('r1')] }), 's1')).toEqual([area]);
    expect(areasOn(fight('a', 3, { resolutions: [res('r1')] }), 's1')).toEqual([area]); // before the Mage acts again
    expect(areasOn(fight('m', 3, { resolutions: [res('r1')] }), 's1')).toEqual([]);
    expect(areasOn(fight('m', 2, { resolutions: [res('r1')] }), 's2')).toEqual([]);
  });
  test('a concentration area stays while its caster concentrates', () => {
    const k = (concentrating: boolean) => fight('m', 5, { resolutions: [res('r1', { lasting: true })], combatants: fight('m', 5).combatants.map((x) => (x.id === 'm' ? { ...x, concentrating } : x)) });
    expect(areasOn(k(true), 's1')).toEqual([area]);
    expect(areasOn(k(false), 's1')).toEqual([]);
  });
  test('a new concentration spell hides the old spell\'s area', () => {
    const k = (on: string) => fight('m', 5, { resolutions: [res('r1', { lasting: true, action: 'Moonbeam' })],
      combatants: fight('m', 5).combatants.map((x) => (x.id === 'm' ? { ...x, concentrating: true, concentratingOn: on } : x)) });
    expect(areasOn(k('Moonbeam'), 's1')).toEqual([area]);
    expect(areasOn(k('Fly'), 's1')).toEqual([]);
  });
  test('players get the areas with the scene, and a guest keeps only well-formed ones', () => {
    const s: Scene = { id: 's1', campaignId: 'c1', name: 'F', width: 700, height: 490, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0, tokens: [] };
    const v = sceneForPlayers(s, [], fight('m', 2, { resolutions: [res('r1')] }), DEFAULT_SETTINGS)!;
    expect(v.areas).toEqual([area]);
    expect(cleanScene({ ...v, areas: [area, { shape: 'blob', origin: area.origin, aim: area.aim, feet: 5 }, { ...area, feet: 'x' }] })!.areas).toEqual([area]);
  });
});
