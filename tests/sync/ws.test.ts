// The relay transport against an in-memory room that follows relay/src/index.ts's protocol: messages arrive sealed, in order, and a
// wrong join code or a missing host fails cleanly.
import { describe, expect, test, vi } from 'vitest';
import type { Link } from '../../src/lib/sync/link.ts';
import { relayTransport, type Socket } from '../../src/lib/sync/ws.ts';

/** A fake relay: rooms of one host and many guests, forwarding exactly as the Worker does. `seen` keeps every frame it forwarded. */
function fakeRelay() {
  type S = Omit<Socket, 'readyState'> & { readyState: number; recv(s: string): void; role: string; id?: string; room: string };
  type Room = { host?: S; guests: Map<string, S> };
  const rooms = new Map<string, Room>();
  const seen: string[] = [];
  let n = 0;
  const tick = (f: () => void) => setTimeout(f, 0);
  const connect = (url: string): Socket => {
    const u = new URL(url);
    const room = u.pathname.split('/').pop()!, role = u.searchParams.get('role')!;
    const r: Room = rooms.get(room) ?? { guests: new Map() };
    rooms.set(room, r);
    const s: S = {
      role, room, readyState: 0, bufferedAmount: 0, onopen: null, onclose: null, onmessage: null, onerror: null,
      recv(data) { tick(() => s.onmessage?.({ data } as MessageEvent)); },
      send(data: string) {
        seen.push(data);
        if (s.role === 'host') {
          const m = JSON.parse(data);
          if (m.to) r.guests.get(m.to)?.recv(m.d);
          else if (m.kick) r.guests.get(m.kick)?.close();
        } else r.host?.recv(JSON.stringify({ from: s.id, d: data }));
      },
      close() {
        if (s.readyState === 3) return;
        s.readyState = 3;
        tick(() => s.onclose?.({} as CloseEvent));
        if (s.role === 'host') { if (r.host === s) { r.host = undefined; for (const g of r.guests.values()) g.close(); } }
        else if (s.id && r.guests.delete(s.id)) r.host?.recv(JSON.stringify({ close: s.id }));
      },
    } as S;
    tick(() => {
      s.readyState = 1;
      s.onopen?.({} as Event);
      if (role === 'host') {
        if (r.host) { s.recv(JSON.stringify({ err: 'taken' })); return tick(() => s.close()); }
        r.host = s;
      } else {
        if (!r.host) { s.recv(JSON.stringify({ err: 'nohost' })); return tick(() => s.close()); }
        s.id = `g${++n}`;
        r.guests.set(s.id, s);
        r.host.recv(JSON.stringify({ open: s.id }));
        s.recv(JSON.stringify({ ready: 1 }));
      }
    });
    return s as unknown as Socket;
  };
  return { connect, seen };
}

const until = (f: () => void) => vi.waitFor(f, { timeout: 10_000, interval: 10 });

describe('relay transport', () => {
  test('host and guest exchange sealed messages in order; the relay never sees the plain text', async () => {
    const relay = fakeRelay();
    const t = relayTransport('wss://relay.test', relay.connect);
    const hostLinks: Link[] = [];
    let up = false;
    t.listen('dndapp-room1', { link: (l) => hostLinks.push(l), status: (u) => { up = u; } }, 'ABCDEFGHJKMN');
    await until(() => expect(up).toBe(true));

    const g = await t.dial('dndapp-room1', 'ABCDEFGHJKMN');
    await until(() => expect(hostLinks).toHaveLength(1));
    const atHost: unknown[] = [], atGuest: unknown[] = [];
    hostLinks[0].onMessage((m) => atHost.push(m));
    g.onMessage((m) => atGuest.push(m));

    for (let i = 0; i < 20; i++) g.send({ t: 'roll', i, secret: 'Potion of Poison' });
    hostLinks[0].send({ t: 'welcome', name: 'Ravenloft' });
    await until(() => expect(atHost).toHaveLength(20));
    await until(() => expect(atGuest).toEqual([{ t: 'welcome', name: 'Ravenloft' }]));
    expect(atHost.map((m) => (m as { i: number }).i)).toEqual([...Array(20).keys()]);
    expect(relay.seen.join('\n')).not.toMatch(/Potion|Ravenloft|roll/);
  });

  test('a guest with the wrong code is cut off on its first message', async () => {
    const relay = fakeRelay();
    const t = relayTransport('wss://relay.test', relay.connect);
    const hostLinks: Link[] = [];
    let up = false;
    t.listen('dndapp-room2', { link: (l) => hostLinks.push(l), status: (u) => { up = u; } }, 'ABCDEFGHJKMN');
    await until(() => expect(up).toBe(true));
    const g = await t.dial('dndapp-room2', 'ZZZZZZZZZZZZ');
    await until(() => expect(hostLinks).toHaveLength(1));
    const got: unknown[] = [];
    let closed = false;
    hostLinks[0].onMessage((m) => got.push(m));
    hostLinks[0].onClose(() => { closed = true; });
    g.send({ t: 'hello' });
    await until(() => expect(closed).toBe(true));
    expect(got).toEqual([]);
  });

  test('dialing a room with no host fails with a clear reason', async () => {
    const t = relayTransport('wss://relay.test', fakeRelay().connect);
    await expect(t.dial('dndapp-empty', 'ABCDEFGHJKMN')).rejects.toThrow(/host is not online/);
  });

  test('a host link closed after sends still delivers them (the bye), then the guest is let go', async () => {
    const relay = fakeRelay();
    const t = relayTransport('wss://relay.test', relay.connect);
    const hostLinks: Link[] = [];
    let up = false;
    t.listen('dndapp-room3', { link: (l) => hostLinks.push(l), status: (u) => { up = u; } }, 'ABCDEFGHJKMN');
    await until(() => expect(up).toBe(true));
    const g = await t.dial('dndapp-room3', 'ABCDEFGHJKMN');
    await until(() => expect(hostLinks).toHaveLength(1));
    const got: unknown[] = [];
    let closed = false;
    g.onMessage((m) => got.push(m));
    g.onClose(() => { closed = true; });
    hostLinks[0].send({ t: 'bye', why: 'code changed' });
    hostLinks[0].close();
    await until(() => expect(closed).toBe(true));
    expect(got).toEqual([{ t: 'bye', why: 'code changed' }]);
  });
});
