// Stage 3 transport: PeerJS (WebRTC data channels) behind the engine's Link. Loaded only when hosting or joining starts (session.svelte.ts
// imports this module dynamically), so neither PeerJS nor the engine is in the first-load bundle. Default public PeerJS signaling server,
// Google STUN, reliable channels, PeerJS's JSON serialization. Each message travels as frames (link.ts), because that channel refuses
// anything over ~16 KB, and its size is checked before any of it is parsed.
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { frames, unframer, type Link, type Listener, type Transport } from './link.ts';
import { MAX_CHUNK, MAX_MESSAGE } from './protocol.ts';

const OPTIONS: PeerOptions = { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] } };
const CONNECT = { reliable: true, serialization: 'json' } as const;
/** The largest data channel message an honest peer sends (PeerJS's JSON-channel limit). A bigger one is refused unread. */
const MAX_FRAME_TEXT = 16_300;
/** A link closed with messages still queued (a bye) waits this long for the far side to take them and close, then is cut. */
const FLUSH_WAIT = 5000;
const DIAL_TIMEOUT = 20_000;

/** What the user is told when PeerJS fails. */
function why(e: unknown): string {
  switch ((e as { type?: string })?.type) {
    case 'peer-unavailable': return 'The host is not online, or the join code has changed.';
    case 'unavailable-id': return 'Another tab or device is already hosting this campaign.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Could not reach the sync server.';
    case 'browser-incompatible': return 'This browser does not support peer-to-peer connections.';
    default: return e instanceof Error ? e.message : String(e);
  }
}

/** PeerJS parses each frame with the connection's own `parse`; this one refuses an oversized or odd message before parsing it. */
function guard(conn: DataConnection): void {
  (conn as unknown as { parse: (s: string) => unknown }).parse = (s) => {
    if (typeof s !== 'string' || s.length > MAX_FRAME_TEXT) return ''; // '' is not a frame: the link is closed as malformed
    try {
      const v: unknown = JSON.parse(s);
      return typeof v === 'string' || (typeof v === 'object' && v !== null) ? v : ''; // objects: PeerJS's own close marker
    } catch {
      return '';
    }
  };
}

/** A PeerJS data connection as a Link. Messages that arrive before the engine listens are kept for it. */
function wrap(conn: DataConnection): Link {
  let closed = false;
  const closers: (() => void)[] = [], listeners: ((m: unknown) => void)[] = [], early: unknown[] = [];
  const gone = () => {
    if (closed) return;
    closed = true;
    for (const f of closers) f();
  };
  const fail = () => { gone(); conn.close(); };
  const read = unframer(MAX_MESSAGE, (m) => (listeners.length ? listeners.forEach((f) => f(m)) : early.push(m)), fail);
  guard(conn);
  conn.on('data', (d) => { if (!closed) read(d); });
  conn.on('close', gone);
  conn.on('error', fail);
  return {
    id: conn.connectionId,
    send(m) { if (!closed && conn.open) for (const f of frames(JSON.stringify(m))) conn.send(f); },
    onMessage(f) {
      listeners.push(f);
      for (const m of early.splice(0)) f(m);
    },
    onClose(f) { closers.push(f); },
    close() {
      if (closed) return;
      gone();
      // Flush: PeerJS queues a close marker behind everything not yet sent (a bye), and the far side closes when it reads it.
      if (conn.open) conn.close({ flush: true });
      setTimeout(() => conn.close(), FLUSH_WAIT);
    },
    // ponytail: PeerJS's own queue counts messages, not bytes; a frame is at most ~15 KB.
    bufferedAmount: () => (conn.dataChannel?.bufferedAmount ?? 0) + ((conn as unknown as { bufferSize?: number }).bufferSize ?? 0) * 15_000,
    onDrain(f) {
      const dc = conn.dataChannel;
      if (!dc) return f();
      dc.bufferedAmountLowThreshold = MAX_CHUNK;
      dc.addEventListener('bufferedamountlow', () => f(), { once: true });
    },
  };
}

export const transport: Transport = {
  listen(peerId, on) {
    let peer: Peer | undefined, stopped = false;
    const start = () => {
      peer?.destroy();
      const p = (peer = new Peer(peerId, OPTIONS));
      const down = (e?: unknown) => { if (!stopped && p === peer) on.status(false, e === undefined ? 'Lost the connection to the sync server.' : why(e)); };
      p.on('open', () => { if (!stopped && p === peer) on.status(true); });
      p.on('connection', (conn) => {
        if (stopped || conn.serialization !== 'json') return void conn.close(); // only our own JSON channel has the size guard
        const link = wrap(conn);
        conn.on('open', () => (stopped ? link.close() : on.link(link)));
      });
      p.on('disconnected', () => down());
      p.on('error', (e) => { if (p.destroyed || p.disconnected) down(e); }); // errors of one connection don't stop hosting
    };
    start();
    return {
      retry() {
        if (stopped) return;
        if (!peer || peer.destroyed) start();
        else if (peer.disconnected) peer.reconnect();
      },
      close() {
        stopped = true;
        const p = peer;
        p?.disconnect(); // the server frees the id now: the old peer id no longer reaches this device
        setTimeout(() => p?.destroy(), FLUSH_WAIT); // open links first get to flush their bye
      },
    };
  },

  dial(peerId) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(OPTIONS); // a random peer id
      let done = false;
      const fail = (e: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        peer.destroy();
        reject(new Error(why(e)));
      };
      const timer = setTimeout(() => fail(new Error('Could not connect to the host in time.')), DIAL_TIMEOUT);
      peer.on('error', fail);
      peer.on('open', () => {
        const conn = peer.connect(peerId, CONNECT);
        const link = wrap(conn);
        link.onClose(() => { fail(new Error('The connection closed.')); setTimeout(() => peer.destroy(), FLUSH_WAIT); });
        conn.on('open', () => {
          if (done) return link.close();
          done = true;
          clearTimeout(timer);
          resolve(link);
        });
      });
    });
  },
};
