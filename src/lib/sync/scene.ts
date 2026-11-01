// Pure (no Svelte/Vite/DOM). Stage 5: the battle map scene as players get it (an allowlist, spec 3.6), the check on a player's token
// move, and the guest's rebuild of what a host sent. Lazy: only host.ts and guest.ts import it.
import { snap } from '../map/grid.ts';
import { liveHp } from '../map/scene.ts';
import { isRec, sceneProblem } from '../recordShape.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { CampaignSettings, Character, Combat, Grid, Scene, Size } from '../types.ts';
import { healthStatus, type HealthStatus } from './project.ts';
import { HASH } from './protocol.ts';

export interface PlayerToken { id: string; name: string; x: number; y: number; size: Size; color: string; portrait?: string; characterId?: string; conditions: string[]; health?: HealthStatus }
export interface PlayerScene { id: string; name: string; image?: string; width: number; height: number; grid: Grid; fog?: string /* C */; tokens: PlayerToken[] }

const gridOf = (g: Grid): Grid => ({ type: g.type, size: g.size, offsetX: g.offsetX, offsetY: g.offsetY, color: g.color, opacity: g.opacity, feet: g.feet });

/**
 * The shown scene as players see it. No hidden token; of each token only where it is, how it looks, its conditions and (stage 4's gate,
 * except a player's own character, which always carries it) a health word. Never a monster id, HP numbers, a combatant link or the id
 * of a DM-only character (R13).
 */
export function sceneForPlayers(s: Scene | undefined, characters: Character[], combat: Combat | undefined, settings: CampaignSettings): PlayerScene | undefined {
  if (!s?.shown) return undefined;
  const byId = new Map(characters.map((c) => [c.id, c]));
  const gate = settings.showMonsterHealth && settings.initiativeModules.hp;
  const maxHp = (c: Character) => computeSheet(c, { settings, viewer: 'player' }).maxHp;
  const tokens: PlayerToken[] = [];
  for (const t of s.tokens) {
    if (t.hidden) continue;
    // stage 5 C2: fog filter goes here
    const ch = t.characterId === undefined ? undefined : byId.get(t.characterId);
    const portrait = t.portrait ?? ch?.details.portrait;
    const base = { id: t.id, name: t.name, x: t.x, y: t.y, size: t.size, color: t.color, ...(portrait !== undefined && { portrait }) };
    if (ch?.ownerId && ch.campaignId === s.campaignId) {
      const health = healthStatus(ch.state.hp, maxHp(ch));
      tokens.push({ ...base, characterId: ch.id, conditions: [...ch.state.conditions], ...(health && { health }) });
      continue;
    }
    const live = ch ? { hp: ch.state.hp, maxHp: maxHp(ch), conditions: ch.state.conditions } : liveHp(t, combat);
    const health = gate ? healthStatus(live.hp, live.maxHp) : undefined;
    tokens.push({ ...base, conditions: [...live.conditions], ...(health && { health }) });
  }
  return { id: s.id, name: s.name, ...(s.image !== undefined && { image: s.image }), width: s.width, height: s.height, grid: gridOf(s.grid), tokens };
}

/** The blobs a player may ask for: the scene image and visible portraits, each once. */
export const sceneBlobs = (v: PlayerScene | undefined): string[] =>
  v ? [...new Set([v.image, ...v.tokens.map((t) => t.portrait)])].filter((h): h is string => typeof h === 'string' && HASH.test(h)) : [];

/** Why a player's move is refused (undefined = allowed). `violation` only for a crafted one; the rest can come from a stale view. */
export function moveProblem(s: Scene | undefined, m: { sceneId: string; tokenId: string; x: number; y: number }, playerId: string,
  characters: Character[], combat: Combat | undefined, settings: CampaignSettings): { error: string; violation: boolean } | undefined {
  if (!s?.shown || s.id !== m.sceneId) return { error: 'not the shown scene', violation: false };
  const t = s.tokens.find((x) => x.id === m.tokenId);
  if (!t || t.hidden) return { error: 'no such token', violation: false }; // it may have just been hidden
  const ch = t.characterId === undefined ? undefined : characters.find((c) => c.id === t.characterId);
  if (!ch || ch.ownerId !== playerId || ch.campaignId !== s.campaignId) return { error: 'not their token', violation: true };
  const turn = combat && combat.round > 0 ? combat.combatants.find((x) => x.id === combat.turn) : undefined;
  if (!settings.freeMovement && turn?.characterId !== ch.id) return { error: 'not your turn', violation: false }; // a drag dropped just late
  const p = snap(s.grid, m, t.size);
  if (!(p.x >= 0 && p.x <= s.width && p.y >= 0 && p.y <= s.height)) return { error: 'off the map', violation: false };
}

const HEALTH: readonly string[] = ['Unhurt', 'Hurt', 'Bloodied', 'Down'] satisfies HealthStatus[];
const SIZES: readonly string[] = ['T', 'S', 'M', 'L', 'H', 'G'] satisfies Size[];
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A host's scene rebuilt from its known fields (a crafted host stands in for the DM too). Undefined when its frame or grid is bad. */
export function cleanScene(v: unknown): PlayerScene | undefined {
  if (!isRec(v) || !str(v.id, 100) || !str(v.name, 200) || !Array.isArray(v.tokens)) return undefined;
  if (sceneProblem({ id: v.id, campaignId: '', name: v.name, width: v.width, height: v.height, grid: v.grid, tokens: [] })) return undefined;
  const seen = new Set<string>();
  const tokens = v.tokens.flatMap((t): PlayerToken[] => {
    if (!isRec(t) || !str(t.id, 100) || !str(t.name, 200) || !fin(t.x) || !fin(t.y) || !SIZES.includes(t.size as string) || seen.has(t.id)) return [];
    seen.add(t.id);
    const conditions = (Array.isArray(t.conditions) ? t.conditions : []).filter((c): c is string => str(c, 40)).slice(0, 20);
    return [{ id: t.id, name: t.name, x: t.x, y: t.y, size: t.size as Size, color: typeof t.color === 'string' && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888',
      ...(typeof t.portrait === 'string' && HASH.test(t.portrait) && { portrait: t.portrait }), ...(str(t.characterId, 100) && { characterId: t.characterId }),
      conditions, ...(typeof t.health === 'string' && HEALTH.includes(t.health) && { health: t.health as HealthStatus }) }];
  }).slice(0, 200);
  return { id: v.id, name: v.name, ...(typeof v.image === 'string' && HASH.test(v.image) && { image: v.image }), width: v.width as number, height: v.height as number,
    grid: gridOf(v.grid as Grid), tokens };
}
