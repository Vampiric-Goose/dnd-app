// Pure scene and token operations. Never imports combat/ (that would pull the combat engine into the host chunk).
import type { Combat, Grid, Scene, Size, Token } from '../types.ts';
import { uid } from '../uid.ts';
import { cellAt, cellCenter, footprint, SIZE_CELLS, snap, type Pt } from './grid.ts';

export const MAX_TOKENS = 200, MAX_SIDE = 4096, BLANK = { width: 1400, height: 1000 };
export const DEFAULT_GRID: Grid = { type: 'square', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.35, feet: 5 };
export type NewToken = Omit<Token, 'id' | 'x' | 'y' | 'color'> & Partial<Pick<Token, 'x' | 'y' | 'color'>>;

export function newScene(campaignId: string, name: string, image?: { hash: string; width: number; height: number }): Scene {
  return { id: uid(), campaignId, name, ...(image && { image: image.hash }), width: image?.width ?? BLANK.width, height: image?.height ?? BLANK.height,
    grid: { ...DEFAULT_GRID }, tokens: [], updatedAt: Date.now() };
}

/** First letters of the first two words; a number as the second word is kept whole ('Goblin 12' → 'G12'). */
export function initials(name: string): string {
  const [a, b] = name.trim().split(/\s+/).filter(Boolean);
  if (!a) return '?';
  return (a[0] + (b === undefined ? '' : /^\d+$/.test(b) ? b : b[0])).toUpperCase();
}

const PALETTE = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#2e4053'];
export function tokenColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

const inside = (s: Scene, p: Pt) => p.x >= 0 && p.x <= s.width && p.y >= 0 && p.y <= s.height;
const key = (c: { q: number; r: number }) => `${c.q},${c.r}`;

/** The nearest snapped spot to `near` (ring by ring) whose footprint overlaps no token's, inside the scene. */
export function freeSpot(s: Scene, near: Pt, size: Size): Pt | undefined {
  const g = s.grid, taken = new Set(s.tokens.flatMap((t) => footprint(g, t).map(key)));
  const base = snap(g, near, size), c0 = cellAt(g, base);
  const square = g.type === 'square';
  const maxRing = Math.ceil(Math.max(s.width, s.height) / g.size) + 1;
  for (let k = 0; k <= maxRing; k++) {
    for (let dr = -k; dr <= k; dr++) for (let dq = -k; dq <= k; dq++) {
      const ring = square ? Math.max(Math.abs(dq), Math.abs(dr)) : (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
      if (ring !== k) continue;
      const p = square ? { x: base.x + dq * g.size, y: base.y + dr * g.size } : cellCenter(g, { q: c0.q + dq, r: c0.r + dr });
      if (inside(s, p) && !footprint(g, { ...p, size }).some((c) => taken.has(key(c)))) return p;
    }
  }
}

/** Each placed at its snapped x/y, else at a free spot near the scene's centre; stops at MAX_TOKENS. */
export function addTokens(s: Scene, list: NewToken[]): Scene {
  let out = s;
  for (const n of list) {
    if (out.tokens.length >= MAX_TOKENS) break;
    const p = n.x !== undefined && n.y !== undefined ? snap(out.grid, { x: n.x, y: n.y }, n.size)
      : freeSpot(out, { x: out.width / 2, y: out.height / 2 }, n.size) ?? snap(out.grid, { x: out.width / 2, y: out.height / 2 }, n.size);
    out = { ...out, tokens: [...out.tokens, { ...n, id: uid(), ...p, color: n.color ?? tokenColor(n.name) }] };
  }
  return out;
}

/** The primary snaps to `to`; the others move by the same delta. Unchanged (the same object) when any would leave the scene. */
export function moveTokens(s: Scene, ids: string[], primary: string, to: Pt): Scene {
  const p = s.tokens.find((t) => t.id === primary);
  if (!p) return s;
  const target = snap(s.grid, to, p.size), dx = target.x - p.x, dy = target.y - p.y;
  const moving = new Set([...ids, primary]);
  let off = false;
  const tokens = s.tokens.map((t) => {
    if (!moving.has(t.id)) return t;
    const n = { ...t, x: t.x + dx, y: t.y + dy };
    if (!inside(s, n)) off = true;
    return n;
  });
  return off || (dx === 0 && dy === 0) ? s : { ...s, tokens };
}

export const patchToken = (s: Scene, id: string, patch: Partial<Token>): Scene => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, ...patch, id } : t)) });

export function removeTokens(s: Scene, ids: string[]): Scene {
  const gone = new Set(ids);
  return { ...s, tokens: s.tokens.filter((t) => !gone.has(t.id)) };
}

export const radius = (g: Grid, size: Size) => (SIZE_CELLS[size] * g.size) / 2;

/** The topmost (last drawn) token whose circle holds p; hidden ones only for the DM. */
export function tokenAt(s: Scene, p: Pt, dm: boolean): Token | undefined {
  for (let i = s.tokens.length - 1; i >= 0; i--) {
    const t = s.tokens[i];
    if ((dm || !t.hidden) && Math.hypot(t.x - p.x, t.y - p.y) <= radius(s.grid, t.size)) return t;
  }
}

/** Ids of the tokens whose centre lies in the box from a to b (any corners). */
export function tokensInRect(s: Scene, a: Pt, b: Pt, dm: boolean): string[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return s.tokens.filter((t) => (dm || !t.hidden) && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map((t) => t.id);
}

/** A linked live combatant's HP and conditions win; else the token's own. */
export function liveHp(t: Token, combat: Combat | undefined): { hp?: number; maxHp?: number; conditions: string[] } {
  const x = t.combatantId === undefined ? undefined : combat?.combatants.find((c) => c.id === t.combatantId);
  if (!x) return { ...(t.hp !== undefined && { hp: t.hp }), ...(t.maxHp !== undefined && { maxHp: t.maxHp }), conditions: [] };
  const hp = x.hp ?? t.hp, maxHp = x.maxHp ?? t.maxHp;
  return { ...(hp !== undefined && { hp }), ...(maxHp !== undefined && { maxHp }), conditions: x.conditions ?? [] };
}
