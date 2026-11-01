// Pure fog of war: one bit per FOG_CELL × FOG_CELL square of the scene (bit = 1: revealed). A scene with no fog string is all fogged.
// Bit i = row·cols + col lives in byte i >> 3, bit i & 7. The paint functions return a new array.
import { fromBase64, toBase64 } from '../base64.ts';
import type { Pt } from './grid.ts';

export const FOG_CELL = 16;

export const fogSize = (w: number, h: number): { cols: number; rows: number } => ({ cols: Math.ceil(w / FOG_CELL), rows: Math.ceil(h / FOG_CELL) });

const bytes = (w: number, h: number) => { const { cols, rows } = fogSize(w, h); return Math.ceil((cols * rows) / 8); };

export const newFog = (w: number, h: number, revealed: boolean): Uint8Array => new Uint8Array(bytes(w, h)).fill(revealed ? 0xff : 0);

/** Every fog cell (col, row) in the column and row ranges for which `hit` holds, set or cleared. */
function paint(f: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, reveal: boolean, hit: (cx: number, cy: number) => boolean): Uint8Array {
  const { cols, rows } = fogSize(w, h), out = f.slice();
  const c0 = Math.max(0, Math.ceil(x0 / FOG_CELL - 0.5)), c1 = Math.min(cols - 1, Math.floor(x1 / FOG_CELL - 0.5));
  const r0 = Math.max(0, Math.ceil(y0 / FOG_CELL - 0.5)), r1 = Math.min(rows - 1, Math.floor(y1 / FOG_CELL - 0.5));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (!hit((c + 0.5) * FOG_CELL, (r + 0.5) * FOG_CELL)) continue;
    const i = r * cols + c;
    if (reveal) out[i >> 3] |= 1 << (i & 7); else out[i >> 3] &= ~(1 << (i & 7));
  }
  return out;
}

/** Fog cells whose centre is in the box from a to b (any corners). */
export const paintRect = (f: Uint8Array, w: number, h: number, a: Pt, b: Pt, reveal: boolean): Uint8Array =>
  paint(f, w, h, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), reveal, () => true);

/** Fog cells whose centre is within `radius` of c. */
export const paintBrush = (f: Uint8Array, w: number, h: number, c: Pt, radius: number, reveal: boolean): Uint8Array =>
  paint(f, w, h, c.x - radius, c.y - radius, c.x + radius, c.y + radius, reveal, (x, y) => Math.hypot(x - c.x, y - c.y) <= radius);

/** A point on the scene's far edge reads the last cell. No fog: false. */
export function isRevealed(f: Uint8Array | undefined, w: number, h: number, p: Pt): boolean {
  if (!f) return false;
  const { cols, rows } = fogSize(w, h);
  const c = Math.min(cols - 1, Math.max(0, Math.floor(p.x / FOG_CELL))), r = Math.min(rows - 1, Math.max(0, Math.floor(p.y / FOG_CELL)));
  const i = r * cols + c;
  return ((f[i >> 3] >> (i & 7)) & 1) === 1;
}

export const encodeFog = (f: Uint8Array): string => toBase64(f);

/** Undefined for a string that is not base64 or not the length this scene's fog has. */
export function decodeFog(s: string, w: number, h: number): Uint8Array | undefined {
  try {
    const f = fromBase64(s);
    return f.length === bytes(w, h) ? f : undefined;
  } catch { return undefined; }
}

/** For records from elsewhere: no fog stays none; a fog that decodes is kept; anything else present becomes all fogged. */
export const cleanFog = (fog: unknown, w: number, h: number): string | undefined =>
  fog === undefined ? undefined : typeof fog === 'string' && decodeFog(fog, w, h) ? fog : encodeFog(newFog(w, h, false));

/**
 * The players' projection with fog on (the caller checks settings.fog): drops every token whose centre is in a fogged cell and carries the
 * fog, or the all-fogged encoding when the scene has none or a damaged one.
 */
export function applyFog<T extends Pt, P extends { tokens: T[] }>(p: P, s: { width: number; height: number; fog?: string }): P & { fog: string } {
  const f = s.fog === undefined ? undefined : decodeFog(s.fog, s.width, s.height);
  return { ...p, tokens: p.tokens.filter((t) => isRevealed(f, s.width, s.height, t)), fog: f ? s.fog! : encodeFog(newFog(s.width, s.height, false)) };
}

/** One DM fog edit: reveal or hide everything, a rectangle, or a brush stroke (its pointer samples). */
export type FogEdit = { reveal: boolean } & ({ k: 'all' } | { k: 'rect'; a: Pt; b: Pt } | { k: 'brush'; points: Pt[]; radius: number });

/** The scene's fog string after the edit (a missing or damaged fog starts all fogged). */
export function paintFog(fog: string | undefined, w: number, h: number, e: FogEdit): string {
  if (e.k === 'all') return encodeFog(newFog(w, h, e.reveal));
  const f = (fog === undefined ? undefined : decodeFog(fog, w, h)) ?? newFog(w, h, false);
  return encodeFog(e.k === 'rect' ? paintRect(f, w, h, e.a, e.b, e.reveal) : e.points.reduce((x, p) => paintBrush(x, w, h, p, e.radius, e.reveal), f));
}
