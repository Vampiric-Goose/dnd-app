// Pure (no Svelte/Vite/DOM/PeerJS). The engine's view of a connection: JSON messages in and out. Task 5's PeerJS adapter and
// the tests' memory pair implement it.

export interface Link {
  send(msg: unknown): void;
  onMessage(f: (msg: unknown) => void): void;
  onClose(f: () => void): void;
  close(): void;
  readonly id: string;
  /** R1: bytes queued and not yet sent. Absent = always drained (the memory link). */
  bufferedAmount?: () => number;
  /** R1: calls `f` once, the next time the send buffer runs low. */
  onDrain?(f: () => void): void;
}

let n = 0;

/** Two connected in-memory links. Delivery is async and goes through JSON, like the real transport, so no object is shared. */
export function memoryPair(): [Link, Link] {
  let closed = false;
  const msg: ((m: unknown) => void)[][] = [[], []], close: (() => void)[][] = [[], []];
  const make = (i: number): Link => ({
    id: `mem-${++n}`,
    send(m) {
      if (closed) return;
      const json = JSON.stringify(m);
      queueMicrotask(() => { for (const f of msg[1 - i]) f(JSON.parse(json)); }); // sent before a close: still delivered
    },
    onMessage(f) { msg[i].push(f); },
    onClose(f) { close[i].push(f); },
    close() {
      if (closed) return;
      closed = true;
      queueMicrotask(() => { for (const f of [...close[0], ...close[1]]) f(); });
    },
  });
  return [make(0), make(1)];
}

/** How a session reaches the other devices (Task 5: PeerJS in peer.ts; tests: an in-memory fake). */
export interface Transport {
  /** Registers as `peerId` and hands over every incoming link once it is open. `status(false)` = not reachable; the caller retries. */
  listen(peerId: string, on: { link(l: Link): void; status(up: boolean, why?: string): void }, secret?: string): Listener;
  /** An open link to `peerId`, or a rejection saying why not. `secret` (the join code) keys end-to-end encryption where a server relays. */
  dial(peerId: string, secret?: string): Promise<Link>;
}
export interface Listener {
  /** Tries to register again (after status(false)). */
  retry(): void;
  /** Stops accepting at once; links already open get a moment to flush (a bye), then close. */
  close(): void;
}

/** Characters of message JSON per frame. PeerJS's JSON channel refuses anything over ~16 KB, and a character is at most 3 UTF-8 bytes. */
export const FRAME = 5000;

/**
 * A message's JSON as frames: '+' = more follows, '=' = the last. ponytail: a cut may fall inside a surrogate pair; the channel
 * JSON-encodes each frame, which writes a lone surrogate as a \uXXXX escape, so the pair rejoins intact.
 */
export function frames(json: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < json.length || !out.length; i += FRAME) out.push((i + FRAME >= json.length ? '=' : '+') + json.slice(i, i + FRAME));
  return out;
}

/**
 * Reassembles frames into messages. The JSON is parsed only once it is whole, and a message over `max` characters is refused before
 * anything of it is parsed (MAX_MESSAGE on receive). Anything else than a frame, or JSON that does not parse, goes to `bad`.
 */
export function unframer(max: number, onMessage: (m: unknown) => void, bad: (why: string) => void): (frame: unknown) => void {
  let buf = '';
  return (f) => {
    if (typeof f !== 'string' || (f[0] !== '+' && f[0] !== '=')) return bad('not a frame');
    if (buf.length + f.length - 1 > max) { buf = ''; return bad('message too large'); }
    buf += f.slice(1);
    if (f[0] === '+') return;
    const json = buf;
    buf = '';
    let m: unknown;
    try { m = JSON.parse(json); } catch { return bad('not JSON'); }
    onMessage(m);
  };
}
