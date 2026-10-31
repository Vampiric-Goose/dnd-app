// Pure. A hybrid logical clock (Kulkarni et al.): wall-clock milliseconds plus a counter, so a device whose clock is behind still
// stamps later than anything it has already seen. Timestamps are strings that sort in time order:
// `${wallMs padded to 15}:${counter padded to 6}:${nodeId}`. The empty string is the smallest (an unstamped value).

export type Hlc = string;

const make = (wall: number, counter: number, node: string): Hlc => `${String(wall).padStart(15, '0')}:${String(counter).padStart(6, '0')}:${node}`;

/** Wall and counter of a timestamp; [0, -1] for none, so the next counter is 0. Anything after the second `:` is the node. */
function parse(h: Hlc | undefined): [number, number] {
  if (!h) return [0, -1];
  const [w, c] = h.split(':');
  return [Number(w) || 0, Number.isFinite(Number(c)) ? Number(c) : -1];
}

/** A new local timestamp, later than `last`: the wall clock, or `last`'s wall with the counter bumped when the wall clock is not ahead. */
export function hlcNow(node: string, last?: Hlc, wall = Date.now()): Hlc {
  const [lw, lc] = parse(last);
  return wall > lw ? make(wall, 0, node) : make(lw, lc + 1, node);
}

/** The local clock after receiving `remote`: later than both the local clock and `remote`. */
export function hlcReceive(node: string, local: Hlc | undefined, remote: Hlc, wall = Date.now()): Hlc {
  const [lw, lc] = parse(local), [rw, rc] = parse(remote);
  const w = Math.max(wall, lw, rw);
  const c = w === lw && w === rw ? Math.max(lc, rc) + 1 : w === lw ? lc + 1 : w === rw ? rc + 1 : 0;
  return make(w, c, node);
}

/** Total order: time, then counter, then node id (fixed-width fields make it plain string order). */
export const hlcCompare = (a: Hlc, b: Hlc): number => (a < b ? -1 : a > b ? 1 : 0);
