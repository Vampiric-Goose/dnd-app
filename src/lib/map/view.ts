// Pure pan and zoom: screen = scene × scale + (x, y).
import type { Pt } from './grid.ts';

export interface View { x: number; y: number; scale: number }
export const MIN_SCALE = 0.05, MAX_SCALE = 8;

const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const toWorld = (v: View, s: Pt): Pt => ({ x: (s.x - v.x) / v.scale, y: (s.y - v.y) / v.scale });
export const toScreen = (v: View, w: Pt): Pt => ({ x: w.x * v.scale + v.x, y: w.y * v.scale + v.y });

/** The scene point under `s` stays under `s`; the scale is clamped. */
export function zoomAt(v: View, s: Pt, factor: number): View {
  const scale = clamp(v.scale * factor), w = toWorld(v, s);
  return { x: s.x - w.x * scale, y: s.y - w.y * scale, scale };
}

/** Two fingers moved from (a0, b0) to (a1, b1): the scene point under their midpoint follows it, scaled by the change in spread. */
export function pinch(v: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const scale = clamp(v.scale * (d0 > 0 && d1 > 0 ? d1 / d0 : 1));
  const w = toWorld(v, { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 });
  return { x: (a1.x + b1.x) / 2 - w.x * scale, y: (a1.y + b1.y) / 2 - w.y * scale, scale };
}

/** The whole w×h scene, centred in a vw×vh viewport. */
export function fit(w: number, h: number, vw: number, vh: number): View {
  const scale = clamp(Math.min(vw / w, vh / h));
  return { x: (vw - w * scale) / 2, y: (vh - h * scale) / 2, scale };
}
