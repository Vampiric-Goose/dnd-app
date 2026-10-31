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
