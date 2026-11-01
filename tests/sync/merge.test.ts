import { describe, expect, test } from 'vitest';
import { hlcCompare, hlcNow, hlcReceive, type Hlc } from '../../src/lib/sync/hlc.ts';
import { canon, latestClock, mergeCharacter, rebase, stamp, SYNC_PATHS, type Synced } from '../../src/lib/sync/merge.ts';
import type { Character, InventoryEntry, ItemDef } from '../../src/lib/types.ts';
import { characterProblem } from '../../src/lib/recordShape.ts';
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

  test('M2: a counter past 999999 carries into the wall time and still sorts later', () => {
    const last = '000000000000100:999999:n';
    const next = hlcNow('n', last, 50);
    expect(next).toBe('000000000000101:000000:n');
    expect(hlcCompare(next, last)).toBe(1);
    expect(hlcCompare(hlcReceive('n', last, '000000000000100:999999:m', 50), last)).toBe(1);
  });

  test('I2: a remote wall time over a day ahead is ignored (the local clock stays)', () => {
    const local = hlcNow('b', undefined, T);
    expect(hlcReceive('b', local, '999999999999999:000000:x', T)).toBe(local);
    expect(hlcReceive('b', undefined, hlcNow('x', undefined, T + 2 * 86_400_000), T)).toBe(hlcNow('b', undefined, T));
    expect(hlcCompare(hlcReceive('b', local, hlcNow('x', undefined, T + 3_600_000), T), local)).toBe(1); // an hour ahead is believed
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

  test('C1: rebase keeps what arrived since the load (a value, an add, a removal); a missing entry the base had is a deletion', () => {
    const at1 = hlcNow('a', undefined, T);
    const stale = stamp(undefined, base(), at1); // the editor loaded this
    // since then the store merged a remote edit: notes changed, b1 removed, n added
    const stored = stamp(stale, { ...clone(stale), details: { ...stale.details, notes: 'remote' }, inventory: [entry('b2'), entry('n')] }, hlcNow('b', at1, T + 1));
    const edited = { ...clone(stale), state: { ...stale.state, hp: 4 }, inventory: stale.inventory.filter((e) => e.id !== 'b2') }; // the editor removed b2
    const r = rebase(stored, edited);
    expect(r.details.notes).toBe('remote');
    expect(r.state.hp).toBe(4);
    expect(r.inventory.map((e) => e.id)).toEqual(['n']);
    expect(rebase(stored, { ...edited, sync: undefined })).toEqual({ ...edited, sync: undefined }); // no base: unchanged
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

  test('M3: embedded is the union of both snapshots (a class taken on one device, a race changed on the other)', () => {
    const [a, b] = pair();
    a.edit((c) => { c.build.levels = [{ classId: 'class:fighter@PHB' }]; c.embedded = { 'class:fighter@PHB': gear as never }; }, T);
    b.edit((c) => { c.build.raceId = 'race:elf@PHB'; c.embedded = { 'race:elf@PHB': gear as never }; }, T + 5);
    const m = mergeCharacter(b.rec, a.rec);
    expect(Object.keys(m.embedded).sort()).toEqual(['class:fighter@PHB', 'race:elf@PHB']);
    expect(m.build.raceId).toBe('race:elf@PHB');
    expect(m.build.levels).toEqual([{ classId: 'class:fighter@PHB' }]);
  });

  test('R7: different keys of one map survive; a deleted key sticks against an older value', () => {
    const [a, b] = pair();
    a.edit((c) => { c.build.choices.feat4 = { type: 'ids', ids: ['feat:alert@PHB'] }; c.state.resourcesUsed.Rage = 1; c.overrides.ac = 18; c.state.slotsUsed = [1]; }, T);
    b.edit((c) => { c.build.choices.skill1 = { type: 'ids', ids: ['athletics'] }; c.state.resourcesUsed['Second Wind'] = 1; c.overrides.speed = 40; c.state.slotsUsed = [0, 0, 2]; }, T + 1);
    const m = mergeCharacter(a.rec, b.rec);
    expect(Object.keys(m.build.choices).sort()).toEqual(['feat4', 'skill1']);
    expect(m.state.resourcesUsed).toEqual({ Rage: 1, 'Second Wind': 1 });
    expect(m.overrides).toEqual({ ac: 18, speed: 40 });
    expect(m.state.slotsUsed).toEqual([1, 0, 2]);
    // a later delete of feat4 on b wins over the older value, both ways, and the merged map has no such key at all
    b.receive(a);
    b.edit((c) => { delete c.build.choices.feat4; c.state.slotsUsed = []; }, T + 2);
    for (const x of [mergeCharacter(a.rec, b.rec), mergeCharacter(b.rec, a.rec)]) {
      expect(Object.hasOwn(x.build.choices, 'feat4')).toBe(false);
      expect(x.state.slotsUsed).toEqual([]);
    }
    expect(SYNC_PATHS).toEqual(expect.arrayContaining(['build.choices.*', 'state.slotsUsed.*', 'overrides.*', 'customEffects']));
  });

  test('a __proto__ key from the network stays a plain key', () => {
    const [a] = pair();
    const evil = JSON.parse('{"clock":{"__proto__":"x"},"gone":{"__proto__":"y"}}');
    const m = mergeCharacter(a.rec, { ...a.rec, sync: evil });
    expect(Object.getPrototypeOf(m.sync!.clock)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  test('M1: an inherited name (constructor) is never read as a value', () => {
    const [a] = pair();
    const crafted = JSON.parse(JSON.stringify(a.rec));
    crafted.details.constructor = 'x';
    crafted.sync.clock['details.constructor'] = hlcNow('a', undefined, T);
    const later = { ...a.rec, sync: { ...a.rec.sync!, clock: { ...a.rec.sync!.clock, 'details.constructor': hlcNow('b', undefined, T + 1) } } };
    const m = mergeCharacter(crafted, later);
    expect(Object.hasOwn(m.details, 'constructor')).toBe(false);
    expect(() => structuredClone(m)).not.toThrow();
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

  // Compared as canonical JSON (toEqual would ignore keys holding undefined).
  const same = (x: unknown, y: unknown, msg?: string) => expect(canon(x), msg).toBe(canon(y));
  const read = (c: unknown, p: string[]) => {
    let v = c;
    for (const k of p) v = v && typeof v === 'object' && Object.hasOwn(v, k) ? (v as Record<string, unknown>)[k] : undefined;
    return v === undefined && p[1] === 'slotsUsed' ? 0 : v;
  };

  test(`${SCRIPTS} seeded edit scripts × ${STEPS} steps`, () => {
    for (let s = 1; s <= SCRIPTS; s++) {
      const r = mulberry32(s), int = (n: number) => Math.floor(r() * n);
      let now = T, seq = 100; // above every base value, so each edit changes something
      // M4: in some scripts the replicas start from diverged unstamped copies (different name, hp, an entry and a choice each)
      const diverged = r() < 0.3;
      const start = (i: number): Character => !diverged ? base() : {
        ...base(), name: `B${i}`, state: { ...base().state, hp: 10 + i }, inventory: [...base().inventory, entry(`b${3 + i}`)],
        build: { ...base().build, choices: { [`base${i}`]: { type: 'ids', ids: [`q${i}`] } } },
      };
      // skews up to ±10 min; a replica's clock sometimes jumps back a minute
      const devs = ['pa', 'pb', 'dm'].map((n, i) => new Device(n, start(i), 0)).map((d) => Object.assign(d, { skew: (r() - 0.5) * 20 * MIN }));
      const wall = (d: Device & { skew: number }) => Math.round(now + d.skew - (r() < 0.1 ? MIN : 0));
      // the oracle: per path the value of the edit with the latest HLC; per entry its latest edit and latest removal
      const values = new Map<string, { at: Hlc; v: unknown; p: string[] }>(), edits = new Map<string, { at: Hlc; e: InventoryEntry }>();
      const removed = new Map<string, Hlc>(), added = new Map<string, Hlc>();
      for (const d of devs) for (const e of d.rec.inventory) edits.set(e.id, { at: '', e });

      for (let step = 0; step < STEPS; step++) {
        now += int(3000);
        const d = devs[int(3)];
        if (r() < 0.6) {
          const n = ++seq;
          const op = int(18);
          const changes: [string[], unknown][] = [];
          let ent: InventoryEntry | undefined, gone: string | undefined, pushed = false;
          const before = clone(d.rec);
          const set = (p: string[], v: unknown) => { changes.push([p, v]); };
          const at = d.edit((c) => {
            const inv = c.inventory, st = c.state;
            const hp = () => set(['state', 'hp'], (st.hp = n));
            switch (op) {
              case 0: hp(); break;
              case 1: set(['details', 'notes'], (c.details.notes = `n${n}`)); break;
              case 2: set(['name'], (c.name = `N${n}`)); break;
              case 3: set(['currency', 'gp'], (c.currency.gp = n)); break;
              case 4: inv.push((ent = entry(`e${n}`, n))); pushed = true; break;
              case 5: if (inv.length) { gone = inv[int(inv.length)].id; c.inventory = inv.filter((e) => e.id !== gone); } else hp(); break;
              case 6: if (inv.length) { ent = inv[int(inv.length)]; ent.quantity = n; } else hp(); break;
              case 7: if (st.stable) { delete st.stable; set(['state', 'stable'], undefined); } else set(['state', 'stable'], (st.stable = true)); break;
              case 8: set(['build', 'levels'], (c.build.levels = [{ classId: `class:c${n}@PHB` }])); break;
              case 9: set(['state', 'conditions'], (st.conditions = [`c${n}`])); break;
              case 10: if (c.details.portrait) { delete c.details.portrait; set(['details', 'portrait'], undefined); } else set(['details', 'portrait'], (c.details.portrait = `p${n}`)); break;
              // R7: different keys of one map on different replicas; deletions included
              case 11: {
                const k = `k${int(4)}`, ch = c.build.choices;
                if (Object.hasOwn(ch, k) && r() < 0.5) { delete ch[k]; set(['build', 'choices', k], undefined); } else set(['build', 'choices', k], (ch[k] = { type: 'ids', ids: [`x${n}`] }));
                break;
              }
              case 12: { const k = `r${int(3)}`; set(['state', 'resourcesUsed', k], (st.resourcesUsed[k] = n)); break; }
              case 13: { const die = [6, 8, 10][int(3)]; set(['state', 'hitDiceUsed', String(die)], (st.hitDiceUsed[die] = n)); break; }
              case 14: {
                const k = (['ac', 'initiative', 'speed'] as const)[int(3)], o = c.overrides;
                if (o[k] !== undefined && r() < 0.5) { delete o[k]; set(['overrides', k], undefined); } else set(['overrides', k], (o[k] = n));
                break;
              }
              case 15: { const i = int(4); st.slotsUsed = Array.from({ length: Math.max(st.slotsUsed.length, i + 1) }, (_, k) => st.slotsUsed[k] ?? 0); set(['state', 'slotsUsed', String(i)], (st.slotsUsed[i] = n)); break; }
              case 16: { // a long rest: every spent slot back to 0
                const spent = st.slotsUsed.flatMap((x, i) => (x ? [i] : []));
                if (!spent.length) { hp(); break; }
                for (const i of spent) set(['state', 'slotsUsed', String(i)], 0);
                st.slotsUsed = [];
                break;
              }
              default: { // M4: re-add a removed id (an item handed back)
                const back = [...removed.keys()].filter((id) => !inv.some((e) => e.id === id));
                if (!back.length) { hp(); break; }
                inv.push((ent = entry(back[int(back.length)], n)));
                pushed = true;
              }
            }
          }, wall(d));
          for (const [p, v] of changes) { const k = p.join('.'); if (!(values.get(k)?.at! >= at)) values.set(k, { at, v, p }); }
          if (ent && !(edits.get(ent.id)?.at! >= at)) edits.set(ent.id, { at, e: clone(ent) });
          if (ent && op === 4) added.set(ent.id, at);
          if (gone && !(removed.get(gone)! >= at)) removed.set(gone, at);
          // stamp touched exactly those paths, plus a pushed entry's position if it had none (a first edit also positions base entries)
          const fresh = Object.entries(d.rec.sync!.clock).filter(([k, c]) => c.startsWith(at) && before.sync?.clock[k] !== c && !k.startsWith('order/b')).map(([k]) => k);
          const want = [...changes.map(([p]) => p.join('.')), ...(ent ? [`inventory/${ent.id}`] : []),
            ...(ent && pushed && !before.sync?.clock[`order/${ent.id}`] ? [`order/${ent.id}`] : [])].filter((k) => !k.startsWith('order/b'));
          expect(fresh.sort(), `seed ${s} op ${op}`).toEqual(want.sort());
          if (gone) expect(d.rec.sync!.gone[gone]).toBe(at);
        } else {
          const e = devs[(devs.indexOf(d) + 1 + int(2)) % 3];
          const m = mergeCharacter(d.rec, e.rec);
          same(mergeCharacter(e.rec, d.rec), m); // commutative
          same(mergeCharacter(m, m), m); // idempotent
          same(mergeCharacter(m, d.rec), m); // absorbs its inputs
          same(mergeCharacter(m, e.rec), m);
          d.receive(e, wall(d));
          if (r() < 0.5) e.receive(d, wall(e)); // otherwise a partial (one-way) sync
        }
      }

      // associative: every order of folding the three gives the same record
      const [x, y, z] = devs.map((d) => d.rec);
      const all = mergeCharacter(mergeCharacter(x, y), z);
      for (const [p, q, t] of [[x, z, y], [y, x, z], [y, z, x], [z, x, y], [z, y, x]]) same(mergeCharacter(mergeCharacter(p, q), t), all);
      same(mergeCharacter(x, mergeCharacter(y, z)), all);

      // everyone syncs both ways with everyone, in a random order: all three end identical
      const pairs = [[0, 1], [1, 2], [0, 2]].sort(() => r() - 0.5);
      for (const [i, j] of pairs) { devs[i].receive(devs[j], wall(devs[i])); devs[j].receive(devs[i], wall(devs[j])); }
      same(devs[1].rec, devs[0].rec);
      same(devs[2].rec, devs[0].rec);
      const fin = devs[0].rec;
      same(fin, all);

      // no edit is lost: each path holds its latest edit; each entry is present iff its latest edit is later than its removal
      for (const [k, { v, p }] of values) expect(read(fin, p), `seed ${s} ${k}`).toEqual(v);
      const expected = [...edits].filter(([id, { at }]) => !(removed.get(id)! > at)).map(([id]) => id).sort();
      expect([...ids(fin)].sort(), `seed ${s} inventory`).toEqual(expected);
      for (const e of fin.inventory) same(e, edits.get(e.id)!.e);
      // added entries keep their add order (a re-added one keeps its first place)
      const addOrder = ids(fin).filter((id) => added.has(id));
      expect(addOrder).toEqual([...addOrder].sort((p, q) => hlcCompare(added.get(p)!, added.get(q)!)));
    }
  }, 60_000); // ~4 s locally; shared CI runners are several times slower
});

describe('N3: crafted state maps', () => {
  const crafted = (state: Record<string, unknown>) => ({ ...char('c', 'camp'), state: { ...char('c').state, ...state } }) as unknown as Character;
  const huge = crafted({ slotsUsed: Array.from({ length: 300_000 }, () => 1) });
  const far = crafted({ slotsUsed: { 3000000: 1 } });
  const farther = crafted({ slotsUsed: { 4000000000: 1 } });

  test('characterProblem refuses them', () => {
    for (const c of [huge, far, farther]) expect(characterProblem(c)).toMatch(/slotsUsed/);
    expect(characterProblem(crafted({ slotsUsed: [1, Infinity] }))).toMatch(/slotsUsed/);
    expect(characterProblem(crafted({ resourcesUsed: { Rage: 'x' } }))).toMatch(/resourcesUsed/);
    expect(characterProblem(crafted({ hitDiceUsed: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [i, 1])) }))).toMatch(/hitDiceUsed/);
    expect(characterProblem(crafted({ slotsUsed: [1, 0, 2], resourcesUsed: { Rage: 1 }, hitDiceUsed: { 8: 1 } }))).toBeUndefined();
  });

  test('and the merge copes without allocating by key or spreading', () => {
    const ok = stamp(undefined, char('c', 'camp'), hlcNow('n', undefined, T));
    for (const c of [far, farther]) expect((mergeCharacter(ok, stamp(ok, c, hlcNow('m', undefined, T + 1))).state.slotsUsed as number[]).length).toBeLessThanOrEqual(20);
    expect(() => mergeCharacter(ok, stamp(ok, huge, hlcNow('m', undefined, T + 1)))).not.toThrow();
  });
});
