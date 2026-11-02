// Pure (no Svelte/Vite/DOM). Stage 5: the battle map scene as players get it (an allowlist, spec 3.6), the check on a player's token
// move, and the guest's rebuild of what a host sent. Lazy: only host.ts and guest.ts import it.
import { applyFog, cleanFog, decodeFog, isRevealed } from '../map/fog.ts';
import { budgetApplies, budgetFeet, combatantForToken, effectiveSpeed, originOf } from '../combat/movement.ts';
import { feetBetween, snap } from '../map/grid.ts';
import { liveHp } from '../map/scene.ts';
import { isRec, sceneProblem } from '../recordShape.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { Area, CampaignSettings, Character, Combat, Grid, Scene, Size } from '../types.ts';
import { areasOn } from '../combat/aiming.ts';
import { currentActor, healthStatus, trackerForPlayers, type HealthStatus } from './project.ts';
import { HASH } from './protocol.ts';

export interface PlayerToken { id: string; name: string; x: number; y: number; size: Size; color: string; portrait?: string; characterId?: string; conditions: string[]; health?: HealthStatus }
export interface PlayerScene { id: string; name: string; image?: string; width: number; height: number; grid: Grid; fog?: string /* C */; tokens: PlayerToken[];
  /** Spell areas cast on this scene (areasOn): everyone sees them. */ areas?: Area[] }

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
    if (t.hidden) continue; // fogged tokens are dropped by applyFog below
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
  const areas = areasOn(combat, s.id);
  const v: PlayerScene = { id: s.id, name: s.name, ...(s.image !== undefined && { image: s.image }), width: s.width, height: s.height, grid: gridOf(s.grid), tokens, ...(areas.length && { areas }) };
  return settings.fog ? applyFog(v, s) : v; // C2: no token whose centre is fogged; the fog (or all fogged) goes along
}

/** With fog on: the token's centre is in a fogged cell (a missing or damaged fog counts as all fogged). */
const fogged = (s: Scene, p: { x: number; y: number }, settings: CampaignSettings) =>
  settings.fog && !isRevealed(s.fog === undefined ? undefined : decodeFog(s.fog, s.width, s.height), s.width, s.height, p);

/** Players may see a live drag preview of the token: it is on the shown scene, not hidden, and neither it nor the preview point is fogged (sceneForPlayers' rules). */
export function previewVisible(s: Scene | undefined, tokenId: string, at: { x: number; y: number } | undefined, settings: CampaignSettings): boolean {
  const t = s?.shown ? s.tokens.find((x) => x.id === tokenId) : undefined;
  return !!t && !t.hidden && !fogged(s!, t, settings) && (!at || !fogged(s!, at, settings));
}

/** The blobs a player may ask for: the scene image and visible portraits, each once. */
export const sceneBlobs = (v: PlayerScene | undefined): string[] =>
  v ? [...new Set([v.image, ...v.tokens.map((t) => t.portrait)])].filter((h): h is string => typeof h === 'string' && HASH.test(h)) : [];

/** Why a player's move (or, `budget` false, drag preview) is refused (undefined = allowed). `violation` only for a crafted one; the rest can come from a stale view. */
export function moveProblem(s: Scene | undefined, m: { sceneId: string; tokenId: string; x: number; y: number }, playerId: string,
  characters: Character[], combat: Combat | undefined, settings: CampaignSettings, budget = true): { error: string; violation: boolean } | undefined {
  if (!s?.shown || s.id !== m.sceneId) return { error: 'not the shown scene', violation: false };
  const t = s.tokens.find((x) => x.id === m.tokenId);
  if (!t || t.hidden || fogged(s, t, settings)) return { error: 'no such token', violation: false }; // it may have just been hidden or fogged
  const ch = t.characterId === undefined ? undefined : characters.find((c) => c.id === t.characterId);
  if (!ch || ch.ownerId !== playerId || ch.campaignId !== s.campaignId) return { error: 'not their token', violation: true };
  // Final I1: the turn players see (S4-R4 keeps a hidden turn on the last visible one), so the host and the player's screen agree
  // and a refusal never reveals that something hidden is acting
  if (!settings.freeMovement && currentActor(trackerForPlayers(combat, characters, settings)) !== ch.id) return { error: 'not your turn', violation: false };
  const p = snap(s.grid, m, t.size);
  if (!(p.x >= 0 && p.x <= s.width && p.y >= 0 && p.y <= s.height)) return { error: 'off the map', violation: false };
  const cost = budget ? moveCost(s, m, ch, combat, settings) : undefined; // a drag preview (budget false) needs no budget check
  if (cost && cost.feet > cost.budget) return { error: 'too far', violation: false }; // spec 1: the player's screen snaps back
}

/**
 * A player character's move under the movement budget: its combatant, how far the snapped drop is from the turn's origin (the token
 * itself before its first move this turn) and the budget. Undefined when no budget applies or the character has no combatant. Speed is
 * the player view's (no hidden item bonus).
 */
export function moveCost(s: Scene, m: { tokenId: string; x: number; y: number }, ch: Character, combat: Combat | undefined,
  settings: CampaignSettings): { combatantId: string; feet: number; budget: number } | undefined {
  const t = s.tokens.find((x) => x.id === m.tokenId);
  const x = t && budgetApplies(combat, settings) ? combatantForToken(combat!, { characterId: ch.id }) : undefined;
  if (!t || !x) return undefined;
  const speed = effectiveSpeed(computeSheet(ch, { settings, viewer: 'player' }).speed.walk, ch.state.conditions, ch.state.exhaustion);
  const mv = combat!.movement?.[x.id];
  return { combatantId: x.id, feet: feetBetween(s.grid, originOf(mv) ?? t, snap(s.grid, m, t.size), settings.diagonal), budget: budgetFeet(speed, mv) };
}

const HEALTH: readonly string[] = ['Unhurt', 'Hurt', 'Bloodied', 'Down'] satisfies HealthStatus[];
const SIZES: readonly string[] = ['T', 'S', 'M', 'L', 'H', 'G'] satisfies Size[];
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A host's scene rebuilt from its known fields (a crafted host stands in for the DM too). Undefined when its frame or grid is bad. */
const AREA_SHAPES = ['cone', 'sphere', 'cube', 'line', 'cylinder'];
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
  const w = v.width as number, h = v.height as number, fog = cleanFog(v.fog, w, h); // a bad fog: all fogged
  const pt = (p: unknown): p is { x: number; y: number } => isRec(p) && fin(p.x) && fin(p.y);
  const areas = (Array.isArray(v.areas) ? v.areas : []).slice(0, 20).flatMap((a): Area[] => isRec(a) && AREA_SHAPES.includes(a.shape as string) && pt(a.origin) && pt(a.aim)
    && fin(a.feet) && (a.feet as number) > 0 && (a.feet as number) <= 1000 && (a.width === undefined || (fin(a.width) && (a.width as number) > 0 && (a.width as number) <= 100))
    ? [{ shape: a.shape as Area['shape'], origin: { x: a.origin.x, y: a.origin.y }, aim: { x: a.aim.x, y: a.aim.y }, feet: a.feet as number, ...(a.width !== undefined && { width: a.width as number }) }] : []);
  return { id: v.id, name: v.name, ...(typeof v.image === 'string' && HASH.test(v.image) && { image: v.image }), width: w, height: h,
    grid: gridOf(v.grid as Grid), ...(fog !== undefined && { fog }), tokens, ...(areas.length && { areas }) };
}
