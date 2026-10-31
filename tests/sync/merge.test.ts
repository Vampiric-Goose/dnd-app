import { describe, expect, test } from 'vitest';
import { hlcCompare, hlcNow, hlcReceive, type Hlc } from '../../src/lib/sync/hlc.ts';
import { latestClock, mergeCharacter, stamp, SYNC_PATHS, type Synced } from '../../src/lib/sync/merge.ts';
import type { Character, InventoryEntry, ItemDef } from '../../src/lib/types.ts';
import { char } from '../fixtures/records.ts';

const MIN = 60_000;
const T = 1_800_000_000_000;
const gear: ItemDef = { kind: 'item', id: 'item:rope@PHB', name: 'Rope', source: 'PHB', text: [], type: 'gear', magic: false };
const entry = (id: string, quantity = 1): InventoryEntry => ({ id, item: gear, quantity, equipped: false, attuned: false, chargesUsed: 0, notes: '' });
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const base = (): Character => ({ ...char('c', 'camp'), inventory: [entry('b1'), entry('b2')] });

/** One device: its copy of the character and its clock. `edit` stamps a change like a save. */
class Device {
  last?: Hlc;
  node: string; rec: Synced<Character>; wall: number;
  constructor(node: string, rec: Synced<Character>, wall = T) { this.node = node; this.rec = rec; this.wall = wall; }
  edit(f: (c: Character) => void, wall = this.wall) {
    const next = clone(this.rec);
    delete next.sync;
    f(next);
    this.last = hlcNow(this.node, this.last, wall);
    this.rec = stamp(this.rec, next, this.last);
    return this.last;
  }
  receive(from: Device, wall = this.wall) {
    this.rec = mergeCharacter(this.rec, from.rec);
    this.last = hlcReceive(this.node, this.last, latestClock(from.rec), wall);
  }
}

describe('HLC', () => {
  test('format sorts in time order; node id breaks ties', () => {
    const a = hlcNow('aaaaaaaa', undefined, 5);
    expect(a).toBe('000000000000005:000000:aaaaaaaa');
    expect(hlcCompare(a, hlcNow('bbbbbbbb', undefined, 5))).toBe(-1);
    expect(hlcCompare(a, a)).toBe(0);
    expect(hlcCompare('', a)).toBe(-1); // unstamped is the smallest
    expect(hlcCompare(hlcNow('z', undefined, 4), a)).toBe(-1);
  });

  test('monotonic when the wall clock goes backwards or stands still', () => {
    let last: Hlc | undefined, prev = '';
    for (const wall of [100, 100, 50, 10, 100, 101, 0, 99]) {
      last = hlcNow('n', last, wall);
      expect(hlcCompare(last, prev)).toBe(1);
      prev = last;
    }
    expect(last).toBe('000000000000101:000002:n');
  });

  test('receive moves past the remote clock, even from a device whose wall clock is behind', () => {
    const remote = hlcNow('a', undefined, T);
    const r = hlcReceive('b', undefined, remote, T - 10 * MIN);
    expect(hlcCompare(r, remote)).toBe(1);
    expect(hlcCompare(hlcNow('b', r, T - 10 * MIN + 1000), remote)).toBe(1);
    const local = hlcNow('b', undefined, T + MIN); // a local clock ahead of both
    expect(hlcCompare(hlcReceive('b', local, remote, T), local)).toBe(1);
    expect(hlcReceive('b', remote, remote, T)).toBe(`${String(T).padStart(15, '0')}:000001:b`);
  });
});

describe('stamp', () => {
  test('stamps exactly the changed paths, tombstones removed entries and ignores a stale sync on next', () => {
    const at1 = hlcNow('n', undefined, T), at2 = hlcNow('n', at1, T + 1);
    const first = stamp(undefined, base(), at1);
    expect(new Set(Object.values(first.sync!.clock))).toEqual(new Set([at1, `${at1}/000000`, `${at1}/000001`]));
    expect(first.sync!.clock['state.hp']).toBe(at1);
    expect(first.sync!.clock['order/b2']).toBe(`${at1}/000001`);
    const next = clone(first);
    next.state.hp = 9;
    next.details.portrait = 'abc';
    next.inventory = [entry('b2', 3), entry('n1')];
    next.sync = { clock: { name: 'zzz' }, gone: {} };
    const s = stamp(first, next, at2);
    const changed = Object.entries(s.sync!.clock).filter(([, v]) => v.startsWith(at2)).map(([k]) => k).sort();
    expect(changed).toEqual(['details.portrait', 'inventory/b2', 'inventory/n1', 'order/n1', 'state.hp']);
    expect(s.sync!.clock['order/n1']).toBe(`${at2}/000001`);
    expect(s.sync!.clock.name).toBe(at1);
    expect(s.sync!.gone).toEqual({ b1: at2 });
  });

  test('key order alone is not a change', () => {
    const at1 = hlcNow('n', undefined, T);
    const first = stamp(undefined, base(), at1);
    const next = clone(first);
    next.currency = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
    expect(stamp(first, next, hlcNow('n', at1, T + 1)).sync).toEqual(first.sync);
  });

  test('documents its paths', () => {
    expect(SYNC_PATHS).toEqual(expect.arrayContaining(['name', 'ownerId', 'build.*', 'state.*', 'details.*', 'currency.*', 'inventory/*']));
  });
});

describe('the spec guarantees (3.6)', () => {
  const pair = () => { const r = stamp(undefined, base(), hlcNow('dm', undefined, T - MIN)); return [new Device('a', r), new Device('b', r)]; };

  test('different fields on two devices both survive', () => {
    const [a, b] = pair();
    a.edit((c) => { c.state.hp = 5; });
    b.edit((c) => { c.details.notes = 'met the duke'; });
    const m = mergeCharacter(a.rec, b.rec);
    expect(m.state.hp).toBe(5);
    expect(m.details.notes).toBe('met the duke');
    expect(mergeCharacter(b.rec, a.rec)).toEqual(m);
  });

  test('entries added on two devices are both present, in add order', () => {
    const [a, b] = pair();
    a.edit((c) => { c.inventory.push(entry('x')); }, T);
    b.edit((c) => { c.inventory.push(entry('y')); }, T + 1);
    expect(mergeCharacter(a.rec, b.rec).inventory.map((e) => e.id)).toEqual(['b1', 'b2', 'x', 'y']);
    expect(mergeCharacter(b.rec, a.rec).inventory.map((e) => e.id)).toEqual(['b1', 'b2', 'x', 'y']);
  });

  test('a deleted entry stays deleted while the other device changes something else', () => {
    const [a, b] = pair();
    a.edit((c) => { c.inventory = c.inventory.filter((e) => e.id !== 'b1'); });
    b.edit((c) => { c.state.tempHp = 4; c.inventory[1].quantity = 7; });
    const m = mergeCharacter(a.rec, b.rec);
    expect(m.inventory.map((e) => [e.id, e.quantity])).toEqual([['b2', 7]]);
    expect(m.state.tempHp).toBe(4);
    // and it does not come back on later syncs
    b.receive(a);
    b.edit((c) => { c.name = 'Renamed'; });
    expect(mergeCharacter(a.rec, b.rec).inventory.map((e) => e.id)).toEqual(['b2']);
  });

  test('same field: the later HLC wins, even from a device whose wall clock is 10 minutes behind', () => {
    const [a, b] = pair();
    a.wall = T;
    b.wall = T - 10 * MIN;
    a.edit((c) => { c.state.hp = 5; });
    b.receive(a); // b has seen a's change, so its next stamp is later although its wall clock is behind
    b.edit((c) => { c.state.hp = 7; }, T - 10 * MIN + 1000);
    expect(mergeCharacter(a.rec, b.rec).state.hp).toBe(7);
    expect(mergeCharacter(b.rec, a.rec).state.hp).toBe(7);
  });

  test('an unstamped (legacy) copy loses every path to a stamped change and keeps its entry order', () => {
    const legacy = base();
    const d = new Device('a', legacy);
    d.edit((c) => { c.state.hp = 3; c.inventory.push(entry('z')); });
    for (const m of [mergeCharacter(legacy, d.rec), mergeCharacter(d.rec, legacy)]) {
      expect(m.state.hp).toBe(3);
      expect(m.inventory.map((e) => e.id)).toEqual(['b1', 'b2', 'z']);
    }
  });

  test('an entry keeps its first position: a later first save elsewhere does not move old entries after new ones', () => {
    const a = new Device('a', base()), b = new Device('b', base());
    b.edit((c) => { c.inventory.push(entry('e1')); }, T); // positions b1, b2, e1
    a.edit((c) => { c.inventory = c.inventory.filter((e) => e.id !== 'b1'); }, T + MIN); // a's first save positions b2 first, later
    expect(mergeCharacter(a.rec, b.rec).inventory.map((e) => e.id)).toEqual(['b2', 'e1']);
  });

  test('two diverged unstamped copies merge the same either way', () => {
    const x = base(), y = { ...base(), name: 'Other', inventory: [entry('b2', 5), entry('q')] };
    expect(mergeCharacter(x, y)).toEqual(mergeCharacter(y, x));
    expect(mergeCharacter(x, y).inventory.map((e) => e.id)).toEqual(['b1', 'b2', 'q']);
  });

  test('embedded comes from the copy with the newest build change', () => {
    const [a, b] = pair();
    a.edit((c) => { c.build.levels = [{ classId: 'class:fighter@PHB' }]; c.embedded = { 'class:fighter@PHB': gear as never }; }, T);
    b.edit((c) => { c.state.hp = 2; c.embedded = {}; }, T + 5);
    expect(Object.keys(mergeCharacter(b.rec, a.rec).embedded)).toEqual(['class:fighter@PHB']);
  });

  test('a __proto__ key from the network stays a plain key', () => {
    const [a] = pair();
    const evil = JSON.parse('{"clock":{"__proto__":"x"},"gone":{"__proto__":"y"}}');
    const m = mergeCharacter(a.rec, { ...a.rec, sync: evil });
    expect(Object.getPrototypeOf(m.sync!.clock)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

// Review Focus 1: two player devices and the DM edit offline and sync partially in random orders.
describe('property: three replicas converge', () => {
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SCRIPTS = 200, STEPS = 40;
  const ids = (c: Character) => c.inventory.map((e) => e.id);

  test(`${SCRIPTS} seeded edit scripts × ${STEPS} steps`, () => {
    for (let s = 1; s <= SCRIPTS; s++) {
      const r = mulberry32(s), int = (n: number) => Math.floor(r() * n);
      let now = T, seq = 100; // above every base value, so each edit changes something
      // skews up to ±10 min; a replica's clock sometimes jumps back a minute
      const devs = ['pa', 'pb', 'dm'].map((n) => new Device(n, base(), 0)).map((d) => Object.assign(d, { skew: (r() - 0.5) * 20 * MIN }));
      const wall = (d: Device & { skew: number }) => Math.round(now + d.skew - (r() < 0.1 ? MIN : 0));
      // the oracle: per path the value of the edit with the latest HLC; per entry its latest edit and latest removal
      const values = new Map<string, { at: Hlc; v: unknown }>(), edits = new Map<string, { at: Hlc; e: InventoryEntry }>();
      const removed = new Map<string, Hlc>(), added = new Map<string, Hlc>();
      const note = (path: string, at: Hlc, v: unknown) => { if (!(values.get(path)?.at! >= at)) values.set(path, { at, v }); };
      for (const e of base().inventory) edits.set(e.id, { at: '', e });

      for (let step = 0; step < STEPS; step++) {
        now += int(3000);
        const d = devs[int(3)];
        if (r() < 0.6) {
          const n = ++seq;
          const op = int(11);
          let path = '', v: unknown, ent: InventoryEntry | undefined, gone: string | undefined;
          const before = clone(d.rec);
          const at = d.edit((c) => {
            const inv = c.inventory;
            switch (op) {
              case 0: path = 'state.hp'; v = c.state.hp = n; break;
              case 1: path = 'details.notes'; v = c.details.notes = `n${n}`; break;
              case 2: path = 'name'; v = c.name = `N${n}`; break;
              case 3: path = 'currency.gp'; v = c.currency.gp = n; break;
              case 4: inv.push((ent = entry(`e${n}`, n))); break;
              case 5: if (inv.length) { gone = inv[int(inv.length)].id; c.inventory = inv.filter((e) => e.id !== gone); } else { path = 'state.hp'; v = c.state.hp = n; } break;
              case 6: if (inv.length) { ent = inv[int(inv.length)]; ent.quantity = n; } else { path = 'state.hp'; v = c.state.hp = n; } break;
              case 7: path = 'state.stable'; v = c.state.stable = c.state.stable ? undefined : true; if (v === undefined) delete c.state.stable; break;
              case 8: path = 'build.levels'; v = c.build.levels = [{ classId: `class:c${n}@PHB` }]; break;
              case 9: path = 'state.conditions'; v = c.state.conditions = [`c${n}`]; break;
              default: path = 'details.portrait'; v = c.details.portrait = c.details.portrait ? undefined : `p${n}`; if (v === undefined) delete c.details.portrait; break;
            }
          }, wall(d));
          if (path) note(path, at, v);
          if (ent && !(edits.get(ent.id)?.at! >= at)) edits.set(ent.id, { at, e: clone(ent) });
          if (ent && op === 4) added.set(ent.id, at);
          if (gone && !(removed.get(gone)! >= at)) removed.set(gone, at);
          // stamp touched exactly that path (plus the new entry's position)
          // (a first edit also gives the base entries their positions)
          const fresh = Object.entries(d.rec.sync!.clock).filter(([k, c]) => c.startsWith(at) && before.sync?.clock[k] !== c && !k.startsWith('order/b')).map(([k]) => k);
          const want = path ? [path] : ent ? [`inventory/${ent.id}`, ...(op === 4 ? [`order/${ent.id}`] : [])] : [];
          expect(fresh.sort()).toEqual(want.sort());
          if (gone) expect(d.rec.sync!.gone[gone]).toBe(at);
        } else {
          const e = devs[(devs.indexOf(d) + 1 + int(2)) % 3];
          const m = mergeCharacter(d.rec, e.rec);
          expect(mergeCharacter(e.rec, d.rec)).toEqual(m); // commutative
          expect(mergeCharacter(m, m)).toEqual(m); // idempotent
          expect(mergeCharacter(m, d.rec)).toEqual(m); // absorbs its inputs
          expect(mergeCharacter(m, e.rec)).toEqual(m);
          d.receive(e, wall(d));
          if (r() < 0.5) e.receive(d, wall(e)); // otherwise a partial (one-way) sync
        }
      }

      // associative: every order of folding the three gives the same record
      const [x, y, z] = devs.map((d) => d.rec);
      const all = mergeCharacter(mergeCharacter(x, y), z);
      for (const [p, q, t] of [[x, z, y], [y, x, z], [y, z, x], [z, x, y], [z, y, x]]) expect(mergeCharacter(mergeCharacter(p, q), t)).toEqual(all);
      expect(mergeCharacter(x, mergeCharacter(y, z))).toEqual(all);

      // everyone syncs both ways with everyone, in a random order: all three end identical
      const pairs = [[0, 1], [1, 2], [0, 2]].sort(() => r() - 0.5);
      for (const [i, j] of pairs) { devs[i].receive(devs[j], wall(devs[i])); devs[j].receive(devs[i], wall(devs[j])); }
      expect(devs[1].rec).toEqual(devs[0].rec);
      expect(devs[2].rec).toEqual(devs[0].rec);
      const fin = devs[0].rec;
      expect(fin).toEqual(all);

      // no edit is lost: each path holds its latest edit; each entry is present iff its latest edit is later than its removal
      for (const [path, { v }] of values) {
        const dot = path.indexOf('.');
        const got = dot < 0 ? (fin as unknown as Record<string, unknown>)[path] : ((fin as unknown as Record<string, Record<string, unknown>>)[path.slice(0, dot)])[path.slice(dot + 1)];
        expect(got, `seed ${s} ${path}`).toEqual(v);
      }
      const expected = [...edits].filter(([id, { at }]) => !(removed.get(id)! > at)).map(([id]) => id).sort();
      expect([...ids(fin)].sort(), `seed ${s} inventory`).toEqual(expected);
      for (const e of fin.inventory) expect(e).toEqual(edits.get(e.id)!.e);
      // added entries keep their add order
      const addOrder = ids(fin).filter((id) => added.has(id));
      expect(addOrder).toEqual([...addOrder].sort((p, q) => hlcCompare(added.get(p)!, added.get(q)!)));
    }
  });
});
