// The relay transport: one WebSocket per device to the dnd-app relay (relay/ in this repo, a Cloudflare Durable Object per room).
// Works wherever a website does, so hotel Wi-Fi that isolates guests and strict mobile networks are no obstacle. Every message is
// sealed (seal.ts) with a key from the join code before it leaves the device, so the relay only forwards opaque strings.
import { note } from './netlog.svelte.ts';
import type { Link, Listener, Transport } from './link.ts';
import { MAX_CHUNK, MAX_MESSAGE } from './protocol.ts';
import { sealFor, type Seal } from './seal.ts';

/** A sealed message is base64 of IV + ciphertext + tag: about 4/3 of the JSON's UTF-8 bytes (at most 3 per character), plus a little. */
const MAX_SEALED = Math.ceil((MAX_MESSAGE * 3 * 4) / 3) + 64;
const DIAL_TIMEOUT = 15_000;
/** The deployed relay (relay/, `npx wrangler deploy`). Empty: the app falls back to direct PeerJS connections. */
export const RELAY_URL = '';
const SERVER_DOWN = "Can't reach the sync server (it may be busy).";

export type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState' | 'bufferedAmount'> & {
  onopen: ((e: Event) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
};

type RelayLink = Link & { deliver(sealed: string): void; gone(): void; ended(): void };

/** One end of a relayed link: sealed sends, in-order opened receives, and the MAX_MESSAGE guard before any parse. */
function relayLink(id: string, seal: Seal, out: (sealed: string) => void, kick: () => void, socket: () => Socket | undefined): RelayLink {
  let closed = false;
  let chain = Promise.resolve();
  const listeners: ((m: unknown) => void)[] = [], closers: (() => void)[] = [], early: unknown[] = [];
  const gone = () => {
    if (closed) return;
    closed = true;
    for (const f of closers) f();
  };
  return {
    id,
    send(m) {
      if (closed) return;
      const json = JSON.stringify(m);
      // In order, as the engine sent them; a message sent before close() still goes (close queues behind it).
      chain = chain.then(async () => { const d = await seal.seal(json); try { out(d); } catch { /* socket already gone */ } });
    },
    onMessage(f) {
      listeners.push(f);
      for (const m of early.splice(0)) f(m);
    },
    onClose(f) { closers.push(f); },
    close() {
      if (closed) return;
      chain = chain.then(() => kick()); // after everything queued, so a bye still arrives
      gone();
    },
    bufferedAmount: () => socket()?.bufferedAmount ?? 0,
    onDrain(f) {
      const wait = () => ((socket()?.bufferedAmount ?? 0) <= MAX_CHUNK ? f() : setTimeout(wait, 50));
      wait();
    },
    deliver(sealed) {
      if (closed) return;
      if (sealed.length > MAX_SEALED) {
        kick();
        return gone();
      }
      chain = chain.then(async () => {
        if (closed) return;
        let m: unknown;
        try {
          const json = await seal.open(sealed);
          if (json.length > MAX_MESSAGE) throw new Error('too big');
          m = JSON.parse(json);
        } catch {
          note(`relay: a message failed its check; link ${id} closed`);
          kick();
          return gone();
        }
        if (listeners.length) for (const f of listeners) f(m);
        else early.push(m);
      });
    },
    gone,
    /** The far side or the relay closed it: messages already received are still handed over first (a bye). */
    ended() { chain = chain.then(gone); },
  };
}

/** The relay transport for the server at `base` (wss://…, no trailing slash). `connect` makes the socket (tests pass a fake). */
export function relayTransport(base: string, connect: (url: string) => Socket = (u) => new WebSocket(u) as unknown as Socket): Transport {
  return {
    listen(peerId, on, secret) {
      let ws: Socket | undefined;
      let stopped = false;
      const links = new Map<string, RelayLink>();
      const sealP = sealFor(secret ?? '', peerId);
      const start = (seal: Seal) => {
        const s = (ws = connect(`${base}/room/${encodeURIComponent(peerId)}?role=host`));
        let refused = '';
        s.onopen = () => {
          note('host: connected to the relay');
          if (!stopped && s === ws) on.status(true);
        };
        s.onmessage = (e) => {
          if (stopped || s !== ws || typeof e.data !== 'string') return;
          let m: { open?: string; from?: string; d?: string; close?: string; err?: string };
          try { m = JSON.parse(e.data); } catch { return; }
          if (m.err) refused = m.err === 'taken' ? 'Another tab or device is already hosting this campaign.' : m.err;
          else if (m.open) {
            const id = m.open;
            const kick = () => { links.delete(id); if (s.readyState === 1) s.send(JSON.stringify({ kick: id })); };
            const l = relayLink(id, seal, (d) => s.send(JSON.stringify({ to: id, d })), kick, () => ws);
            links.set(id, l);
            note('host: a player connected through the relay');
            on.link(l);
          } else if (m.from && typeof m.d === 'string') links.get(m.from)?.deliver(m.d);
          else if (m.close) {
            links.get(m.close)?.ended();
            links.delete(m.close);
          }
        };
        s.onclose = () => {
          if (s !== ws) return;
          for (const l of links.values()) l.ended();
          links.clear();
          if (stopped) return;
          note(`host: relay connection closed${refused ? ` (${refused})` : ''}`);
          on.status(false, refused || SERVER_DOWN);
        };
        s.onerror = () => {};
      };
      sealP.then((seal) => { if (!stopped) start(seal); }, () => on.status(false, 'This browser cannot encrypt messages.'));
      const listener: Listener = {
        retry() { if (!stopped && (!ws || ws.readyState > 1)) void sealP.then(start); },
        close() {
          stopped = true;
          const s = ws;
          for (const l of [...links.values()]) l.close();
          setTimeout(() => s?.close(1000), 1000); // queued byes go first
        },
      };
      return listener;
    },

    dial(peerId, secret) {
      return new Promise((resolve, reject) => {
        let done = false;
        let ws: Socket | undefined, link: RelayLink | undefined;
        const fail = (why: string) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          note(`join: failed: ${why}`);
          try { ws?.close(1000); } catch { /* already closed */ }
          reject(new Error(why));
        };
        const timer = setTimeout(() => fail(SERVER_DOWN), DIAL_TIMEOUT);
        note('join: contacting the relay');
        sealFor(secret ?? '', peerId).then((seal) => {
          if (done) return;
          const s = (ws = connect(`${base}/room/${encodeURIComponent(peerId)}?role=guest`));
          s.onmessage = (e) => {
            if (typeof e.data !== 'string') return;
            if (link) return link.deliver(e.data);
            let m: { ready?: number; err?: string };
            try { m = JSON.parse(e.data); } catch { return fail('The relay sent something unexpected.'); }
            if (m.err) return fail(m.err === 'nohost' ? 'The host is not online, or the join code has changed.' : m.err === 'full' ? 'This campaign has too many connections.' : m.err);
            if (!m.ready) return;
            link = relayLink('relay', seal, (d) => s.send(d), () => s.close(1000), () => ws);
            done = true;
            clearTimeout(timer);
            note('join: connected to the DM through the relay');
            resolve(link);
          };
          s.onclose = () => { if (link) link.ended(); else fail(SERVER_DOWN); };
          s.onerror = () => {};
        }, () => fail('This browser cannot encrypt messages.'));
      });
    },
  };
}
