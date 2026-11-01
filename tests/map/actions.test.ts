// Group D, Task D1: declared actions (intent arrows): the record's validation, the board's rules and what players get.
import { describe, expect, test } from 'vitest';
import { next, prev } from '../../src/lib/combat/combat.ts';
import { ActionBoard, actionProblem, actionsForPlayers, arrowsOn, cleanActionRequest, cleanActions, expiry, MAX_ACTIONS, type ActionRequest, type DeclaredAction } from '../../src/lib/map/actions.ts';
import { paintFog } from '../../src/lib/map/fog.ts';
import { DEFAULT_GRID } from '../../src/lib/map/scene.ts';
import type { PlayerScene } from '../../src/lib/sync/scene.ts';
import type { Combat, Combatant, Scene } from '../../src/lib/types.ts';

const req = (o: Partial<ActionRequest> = {}): ActionRequest => ({ sceneId: 's1', from: { tokenId: 't-a' }, to: { x: 100, y: 100 }, kind: 'intent', ...o });
let n = 0;
const act = (o: Partial<DeclaredAction> = {}): DeclaredAction => ({ ...req(), id: `x${++n}`, by: 'A1', at: n, ...o });
const cb = (id: string, o: Partial<Combatant> = {}): Combatant => ({ id, kind: 'monster', name: id, initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const fight = (o: Partial<Combat> = {}): Combat => ({ campaignId: 'c1', round: 1, turn: 'A', groupMonsters: false, updatedAt: 0, combatants: [cb('A'), cb('B'), cb('C')], ...o });
const view = (o: Partial<PlayerScene> = {}): PlayerScene => ({
  id: 's1', name: 'Crypt', width: 700, height: 700, grid: { ...DEFAULT_GRID },
  tokens: [
    { id: 't-a', name: 'Thorin', x: 35, y: 35, size: 'M', color: '#c0392b', characterId: 'thorin', conditions: [] },
    { id: 't-gob', name: 'Goblin', x: 105, y: 35, size: 'S', color: '#2471a3', conditions: [] },
  ],
  ...o,
});

describe('cleanActionRequest', () => {
  test('accepts an intent and rebuilds it from its known fields', () => {
    expect(cleanActionRequest({ ...req({ to: { tokenId: 't-gob' } }), extra: 1 })).toEqual(req({ to: { tokenId: 't-gob' } }));
  });
  test("rejects kind 'attack', NaN points, 101-character ids and intent data", () => {
    expect(cleanActionRequest({ ...req(), kind: 'attack' })).toBeUndefined();
    expect(cleanActionRequest(req({ to: { x: NaN, y: 1 } }))).toBeUndefined();
    expect(cleanActionRequest(req({ from: { x: 1, y: Infinity } }))).toBeUndefined();
    expect(cleanActionRequest(req({ sceneId: 'a'.repeat(101) }))).toBeUndefined();
    expect(cleanActionRequest(req({ from: { tokenId: 'a'.repeat(101) } }))).toBeUndefined();
    expect(cleanActionRequest(req({ data: { dmg: 3 } }))).toBeUndefined();
    for (const v of [null, 'x', [], { ...req(), from: undefined }]) expect(cleanActionRequest(v)).toBeUndefined();
  });
  test('cleanActions keeps well-formed entries, at most MAX_ACTIONS', () => {
    const ok = { ...req(), id: 'x', by: 'A1', at: 1 };
    expect(cleanActions([ok, { ...ok, by: 3 }, { ...ok, kind: 'attack' }, { ...ok, endsWith: 'pc:a' }])).toEqual([ok, ok]);
    expect(cleanActions(Array(150).fill(ok))).toHaveLength(MAX_ACTIONS);
    expect(cleanActions('x')).toEqual([]);
  });
});

describe('ActionBoard', () => {
  test("set replaces a player's previous arrow; the DM keeps one per token plus one with no token", () => {
    const b = new ActionBoard();
    b.set(act({ id: 'p1' }));
    b.set(act({ id: 'p2', from: { x: 5, y: 5 } }));
    b.set(act({ id: 'q1', by: 'A2' }));
    expect(b.list().map((a) => a.id)).toEqual(['p2', 'q1']);
    b.set(act({ id: 'd1', by: 'dm', from: { tokenId: 't-gob' } }));
    b.set(act({ id: 'd2', by: 'dm', from: { tokenId: 't-orc' } }));
    b.set(act({ id: 'd3', by: 'dm', from: { x: 1, y: 1 } }));
    b.set(act({ id: 'd4', by: 'dm', from: { tokenId: 't-gob' } }));
    b.set(act({ id: 'd5', by: 'dm', from: { x: 9, y: 9 } }));
    expect(b.list().map((a) => a.id)).toEqual(['p2', 'q1', 'd2', 'd4', 'd5']);
  });

  test('drops the oldest beyond MAX_ACTIONS', () => {
    const b = new ActionBoard();
    for (let i = 0; i < MAX_ACTIONS + 5; i++) b.set(act({ id: `d${i}`, by: 'dm', from: { tokenId: `t${i}` } }));
    expect(b.list()).toHaveLength(MAX_ACTIONS);
    expect(b.list()[0].id).toBe('d5');
  });

  test('clear: a player clears their own; the DM any one, or all', () => {
    const b = new ActionBoard();
    b.set(act({ id: 'p', by: 'A1' }));
    b.set(act({ id: 'q', by: 'A2' }));
    b.set(act({ id: 'd', by: 'dm' }));
    expect(b.clear('A1', 'q')).toBe(false);
    expect(b.clear('A1')).toBe(true);
    expect(b.list().map((a) => a.id)).toEqual(['q', 'd']);
    expect(b.clear('dm', 'q')).toBe(true);
    expect(b.clear('dm')).toBe(true);
    expect(b.list()).toEqual([]);
    expect(b.clear('dm')).toBe(false);
  });

  test("onCombat: turn A to B expires A's arrows only; prev back to A does not resurrect them", () => {
    const b = new ActionBoard(), f = fight();
    expect(b.onCombat(f)).toBe(false);
    b.set(act({ id: 'a', by: 'A1', endsWith: 'A', duringFight: true }));
    b.set(act({ id: 'c', by: 'A2', endsWith: 'C', duringFight: true }));
    b.set(act({ id: 'free', by: 'dm', from: { x: 1, y: 1 } }));
    const f2 = next(f).combat;
    expect(b.onCombat(f2)).toBe(true);
    expect(b.list().map((a) => a.id)).toEqual(['c', 'free']);
    expect(b.onCombat(prev(f2))).toBe(false);
    expect(b.list().map((a) => a.id)).toEqual(['c', 'free']);
  });

  test('a grouped run expires together when its turn ends', () => {
    const b = new ActionBoard(), f = fight({ combatants: [cb('A', { group: 'g' }), cb('A2', { group: 'g' }), cb('B')] });
    b.onCombat(f);
    b.set(act({ id: 'a2', by: 'dm', from: { tokenId: 't-a2' }, endsWith: 'A2', duringFight: true }));
    expect(b.onCombat(next(f).combat)).toBe(true);
    expect(b.list()).toEqual([]);
  });

  test('ending the fight drops duringFight arrows and keeps others', () => {
    const b = new ActionBoard();
    b.onCombat(fight());
    b.set(act({ id: 'c', by: 'A2', endsWith: 'C', duringFight: true }));
    b.set(act({ id: 'pt', by: 'A1', from: { x: 3, y: 3 }, duringFight: true }));
    b.set(act({ id: 'before', by: 'dm' }));
    expect(b.onCombat(undefined)).toBe(true);
    expect(b.list().map((a) => a.id)).toEqual(['before']);
  });

  test("Review Focus 4: resuming a different fight (new combatant ids) drops the old fight's arrows", () => {
    const b = new ActionBoard();
    b.onCombat(fight());
    b.set(act({ id: 'c', by: 'A2', endsWith: 'C', duringFight: true }));
    b.set(act({ id: 'free', by: 'dm' }));
    expect(b.onCombat(fight({ turn: 'X', combatants: [cb('X'), cb('Y')] }))).toBe(true);
    expect(b.list().map((a) => a.id)).toEqual(['free']);
  });

  test('onScene drops other scenes', () => {
    const b = new ActionBoard();
    b.set(act({ id: 'a', by: 'A1' }));
    b.set(act({ id: 'b', by: 'A2', sceneId: 's2' }));
    expect(b.onScene('s1')).toBe(true);
    expect(b.list().map((a) => a.id)).toEqual(['a']);
    expect(b.onScene('s1')).toBe(false);
    expect(b.onScene(undefined)).toBe(true);
    expect(b.list()).toEqual([]);
  });
});

describe('expiry', () => {
  const s: Scene = { id: 's1', campaignId: 'c1', name: 'S', width: 700, height: 700, grid: { ...DEFAULT_GRID }, updatedAt: 0, shown: true, tokens: [
    { id: 't-a', name: 'Thorin', x: 35, y: 35, size: 'M', color: '#c0392b', characterId: 'thorin' },
    { id: 't-gob', name: 'Goblin', x: 105, y: 35, size: 'S', color: '#2471a3', combatantId: 'B' },
  ] };
  const f = fight({ combatants: [cb('pc:thorin', { kind: 'pc', characterId: 'thorin' }), cb('B')], turn: 'B' });
  test("a PC or monster source ends with its combatant's turn while a fight runs", () => {
    expect(expiry(req(), s, f)).toEqual({ endsWith: 'pc:thorin', duringFight: true });
    expect(expiry(req({ from: { tokenId: 't-gob' } }), s, f)).toEqual({ endsWith: 'B', duringFight: true });
    expect(expiry(req({ from: { x: 1, y: 1 } }), s, f)).toEqual({ duringFight: true });
    expect(expiry(req(), s, undefined)).toEqual({});
    expect(expiry(req(), s, fight({ round: 0 }))).toEqual({});
  });
});

describe('actionProblem (the player check)', () => {
  const own = new Set(['t-a']);
  test('from their own visible token or a point, at a visible token or an unfogged point on the shown scene', () => {
    expect(actionProblem(req({ to: { tokenId: 't-gob' } }), view(), own)).toBeUndefined();
    expect(actionProblem(req({ from: { x: 600, y: 600 } }), view(), own)).toBeUndefined();
    expect(actionProblem(req(), undefined, own)).toBeDefined();
    expect(actionProblem(req({ sceneId: 's2' }), view(), own)).toBeDefined();
    expect(actionProblem(req({ from: { tokenId: 't-gob' } }), view(), own)).toBeDefined(); // not theirs
    expect(actionProblem(req(), view({ tokens: [] }), own)).toBeDefined(); // theirs, but hidden or fogged now
    expect(actionProblem(req({ to: { tokenId: 't-ass' } }), view(), own)).toBeDefined(); // a hidden token is not in the view
    expect(actionProblem(req({ to: { x: 701, y: 5 } }), view(), own)).toBeDefined();
    expect(actionProblem(req({ to: { x: -1, y: 5 } }), view(), own)).toBeDefined();
  });
  test('fogged points are refused', () => {
    const fog = paintFog(undefined, 700, 700, { k: 'rect', a: { x: 0, y: 0 }, b: { x: 200, y: 200 }, reveal: true });
    expect(actionProblem(req({ to: { x: 100, y: 100 } }), view({ fog }), own)).toBeUndefined();
    expect(actionProblem(req({ to: { x: 500, y: 500 } }), view({ fog }), own)).toBeDefined();
  });
});

describe('arrowsOn (Task D2: what the pages draw)', () => {
  test('ends at token centres or points, source colour or the drawer colour, gone tokens skipped', () => {
    const toks = view().tokens;
    const list = [
      act({ id: 'tok', by: 'A1', to: { tokenId: 't-gob' } }),
      act({ id: 'pt', by: 'A2', from: { x: 5, y: 6 } }),
      act({ id: 'gone', by: 'dm', from: { tokenId: 't-gone' } }),
      act({ id: 'other', by: 'A2', sceneId: 's2' }),
    ];
    expect(arrowsOn(list, 's1', toks, (a) => a.by === 'A1', (by) => `c:${by}`)).toEqual([
      { id: 'tok', from: { x: 35, y: 35 }, to: { x: 105, y: 35 }, color: '#c0392b', target: 't-gob', clearable: true },
      { id: 'pt', from: { x: 5, y: 6 }, to: { x: 100, y: 100 }, color: 'c:A2', clearable: false },
    ]);
  });
});

describe('actionsForPlayers', () => {
  test('hides an arrow whose source token is hidden or fogged (not in the view), and strips endsWith', () => {
    const list = [
      act({ id: 'ok', by: 'A1', to: { tokenId: 't-gob' }, endsWith: 'pc:thorin', duringFight: true }),
      act({ id: 'hid', by: 'dm', from: { tokenId: 't-ass' }, to: { tokenId: 't-a' }, endsWith: 'm1' }),
      act({ id: 'at', by: 'A2', from: { x: 600, y: 600 }, to: { tokenId: 't-ass' } }),
      act({ id: 'other', by: 'A2', sceneId: 's2' }),
    ];
    const out = actionsForPlayers(list, view());
    expect(out.map((a) => a.id)).toEqual(['ok']);
    expect(out[0]).not.toHaveProperty('endsWith');
    expect(out[0]).not.toHaveProperty('duringFight');
    expect(actionsForPlayers(list, undefined)).toEqual([]);
    const fog = paintFog(undefined, 700, 700, { k: 'rect', a: { x: 0, y: 0 }, b: { x: 200, y: 200 }, reveal: true });
    expect(actionsForPlayers([act({ by: 'A2', from: { x: 600, y: 600 }, to: { tokenId: 't-a' } })], view({ fog }))).toEqual([]);
  });
});
