// Pure. Finds a square grid printed on a battle map image (official maps often have one), so the scene's grid can be lined up
// with it in one click. Works on a grayscale image:
//   1. Line strength per column and per row: how much each pixel stands out from its neighbours across the line (a thin dark or
//      light line), clipped so one strong edge (a wall, the map border) cannot outweigh a whole faint grid line.
//   2. For each candidate cell size and offset, the contrast between the profile at the line positions and halfway between them,
//      times √(lines sampled): a significance, not a raw contrast. At an even multiple of the true size the halfway points land
//      on lines (no contrast); at an odd multiple the contrast ties but fewer lines are sampled, so √k favours the true size; at a
//      fraction of it part of the "line" positions are midpoints. Searched coarsely, then refined to a hundredth of a pixel.
//   3. Columns and rows are found separately; a square grid has the same size both ways, so the more confident axis decides
//      the size and the other axis only its offset.

export interface GridGuess { size: number; offsetX: number; offsetY: number; /** contrast in standard deviations; ≥ MIN_CONFIDENCE */ confidence: number }

/** Below this the profile has no clear repeating line pattern (tests: textured noise scores well under it). */
export const MIN_CONFIDENCE = 6.5;
const CLIP = 48;

/** Line strength per column (`axis` 'x', for vertical lines) or per row ('y'). */
export function lineProfile(gray: ArrayLike<number>, w: number, h: number, axis: 'x' | 'y'): Float64Array {
  const n = axis === 'x' ? w : h, out = new Float64Array(n);
  const at = axis === 'x' ? (i: number, j: number) => gray[j * w + i] : (i: number, j: number) => gray[i * w + j];
  const m = axis === 'x' ? h : w;
  for (let i = 2; i < n - 2; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) {
      const c = 2 * at(i, j);
      const r = Math.max(Math.abs(c - at(i - 1, j) - at(i + 1, j)), Math.abs(c - at(i - 2, j) - at(i + 2, j)) * 0.7);
      s += r > CLIP ? CLIP : r;
    }
    out[i] = s / m;
  }
  return out;
}

const sample = (p: Float64Array, x: number) => {
  const i = Math.floor(x), f = x - i;
  return i + 1 < p.length ? p[i] * (1 - f) + p[i + 1] * f : p[p.length - 1];
};

/** (Mean at the line positions offset + k·size minus the mean halfway between them) × √k, over the usable part of the profile. */
function contrast(p: Float64Array, size: number, offset: number): number {
  let on = 0, off = 0, k = 0;
  for (let x = offset; x + size / 2 < p.length - 3; x += size) { // the profile's first and last two entries are not measured
    if (x < 2) continue;
    on += sample(p, x);
    off += sample(p, x + size / 2);
    k++;
  }
  return k >= 3 ? ((on - off) / k) * Math.sqrt(k) : -Infinity;
}

/** The best offset in [0, size) for one size, by `step`. */
function bestOffset(p: Float64Array, size: number, step: number, from = 0, to = size): [number, number] {
  let best = -Infinity, at = from;
  for (let o = from; o < to; o += step) {
    const c = contrast(p, size, o);
    if (c > best) { best = c; at = o; }
  }
  return [best, at];
}

function std(p: Float64Array): number {
  let s = 0, s2 = 0, n = 0;
  for (let i = 2; i < p.length - 2; i++) { s += p[i]; s2 += p[i] * p[i]; n++; }
  const m = s / n;
  return Math.sqrt(Math.max(1e-9, s2 / n - m * m));
}

export interface AxisGuess { size: number; offset: number; confidence: number }

/** The repeating line pattern along one profile, or undefined when there is none worth trusting. */
export function detectAxis(p: Float64Array, min = 8, max = 300): AxisGuess | undefined {
  const top = Math.min(max, (p.length - 4) / 3); // at least three lines
  if (top < min) return undefined;
  let best = { score: -Infinity, size: 0, offset: 0 };
  for (let size = min; size <= top; size += size < 40 ? 0.25 : 0.5) {
    const [score, offset] = bestOffset(p, size, 1);
    if (score > best.score) best = { score, size, offset };
  }
  // Refine size and offset together near the coarse answer (sizes are rarely whole pixels; drift adds up over many cells).
  let { size, offset, score } = best;
  for (const [span, step] of [[0.6, 0.05], [0.06, 0.005]] as const) {
    for (let s = Math.max(min, size - span); s <= size + span; s += step) {
      const [c, o] = bestOffset(p, s, 0.1, offset - 1.5, offset + 1.5);
      if (c > score) { score = c; size = s; offset = o; }
    }
  }
  const confidence = score / std(p);
  return confidence >= MIN_CONFIDENCE ? { size, offset: ((offset % size) + size) % size, confidence } : undefined;
}

/** The square grid printed on a grayscale image (0–255, row-major, w×h), or undefined when none is clear. */
export function detectSquareGrid(gray: ArrayLike<number>, w: number, h: number, opts: { min?: number; max?: number } = {}): GridGuess | undefined {
  const px = lineProfile(gray, w, h, 'x'), py = lineProfile(gray, w, h, 'y');
  const gx = detectAxis(px, opts.min, opts.max), gy = detectAxis(py, opts.min, opts.max);
  if (!gx && !gy) return undefined;
  const lead = !gy || (gx && gx.confidence >= gy.confidence) ? gx! : gy!;
  const size = gx && gy && Math.abs(gx.size - gy.size) / lead.size < 0.02 ? (gx.size * gx.confidence + gy.size * gy.confidence) / (gx.confidence + gy.confidence) : lead.size;
  // Each axis's offset for the agreed size (the weaker axis may have found a multiple, or nothing).
  const off = (p: Float64Array) => { const [, o] = bestOffset(p, size, 0.1); return ((o % size) + size) % size; };
  return { size, offsetX: off(px), offsetY: off(py), confidence: lead.confidence };
}
