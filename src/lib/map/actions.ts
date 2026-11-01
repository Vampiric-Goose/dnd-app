// Pure (no Svelte/Vite/DOM). Declared actions: an arrow a player or the DM draws on the battle map ("I'm going for that goblin"). The
// record and its validation live here, so a future kind ('attack', 'spell', 'roll', …) is: add it to ACTION_KINDS and give its `data`
// a check in cleanActionRequest. The board is live table state on the DM's device: never persisted, never backed up.
import { currentRun } from '../combat/combat.ts';
import { isRec } from '../recordShape.ts';
import type { PlayerScene } from '../sync/scene.ts';
import type { Combat, Combatant, Scene, Token } from '../types.ts';
import { decodeFog, isRevealed } from './fog.ts';
import type { Pt } from './grid.ts';

export const ACTION_KINDS = ['intent'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionEnd = { tokenId: string } | { x: number; y: number };
export interface ActionRequest { sceneId: string; from: ActionEnd; to: ActionEnd; kind: ActionKind; data?: unknown }
export interface DeclaredAction extends ActionRequest { id: string; by: string /* player ID or 'dm' */; endsWith?: string /* combatant id */; duringFight?: true; at: number }
export type PlayerAction = Omit<DeclaredAction, 'endsWith' | 'duringFight'>;

export const MAX_ACTIONS = 100;

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanEnd(v: unknown): ActionEnd | undefined {
  if (!isRec(v)) return undefined;
  if (v.tokenId !== undefined) return str(v.tokenId, 100) ? { tokenId: v.tokenId } : undefined;
  return fin(v.x) && fin(v.y) ? { x: v.x, y: v.y } : undefined;
}

/** A request rebuilt from its known fields (shape only; who may draw what is actionProblem's), or undefined. */
export function cleanActionRequest(v: unknown): ActionRequest | undefined {
  if (!isRec(v) || !str(v.sceneId, 100) || !(ACTION_KINDS as readonly unknown[]).includes(v.kind)) return undefined;
  const from = cleanEnd(v.from), to = cleanEnd(v.to);
  if (!from || !to) return undefined;
  const kind = v.kind as ActionKind;
  if (kind === 'intent' && v.data !== undefined) return undefined; // an intent carries no payload
  return { sceneId: v.sceneId, from, to, kind };
}

/** Guest side: the host's list rebuilt entry by entry (a crafted host stands in for the DM too), at most MAX_ACTIONS. */
export function cleanActions(v: unknown): PlayerAction[] {
  return (Array.isArray(v) ? v : []).flatMap((a): PlayerAction[] => {
    const r = cleanActionRequest(a);
    return r && isRec(a) && str(a.id, 100) && str(a.by, 100) && fin(a.at) ? [{ ...r, id: a.id, by: a.by, at: a.at }] : [];
  }).slice(0, MAX_ACTIONS);
}

const tokenOf = (e: ActionEnd): string | undefined => ('tokenId' in e ? e.tokenId : undefined);

/** The combatant a token stands for: a monster's linked combatant, or a PC's by character. */
const combatantFor = (c: Combat, t: Token): Combatant | undefined =>
  c.combatants.find((x) => (t.combatantId !== undefined && x.id === t.combatantId) || (t.characterId !== undefined && x.characterId === t.characterId));

/** While a fight runs: the source token's combatant (its turn ends the action), and the mark that combat ending ends it. */
export function expiry(r: ActionRequest, s: Scene | undefined, c: Combat | undefined): { endsWith?: string; duringFight?: true } {
  if (!c || c.round < 1) return {};
  const id = tokenOf(r.from), t = id === undefined ? undefined : s?.tokens.find((x) => x.id === id);
  const endsWith = t && combatantFor(c, t)?.id;
  return { ...(endsWith !== undefined && { endsWith }), duringFight: true };
}

/** The DM's board: one action per player, one per source token (plus one with none) for the DM. */
export class ActionBoard {
  #list: DeclaredAction[] = [];
  #run = new Set<string>();

  list(): DeclaredAction[] { return [...this.#list]; }

  set(a: DeclaredAction): void {
    const slot = (x: DeclaredAction) => x.by === a.by && (a.by !== 'dm' || tokenOf(x.from) === tokenOf(a.from));
    this.#list = [...this.#list.filter((x) => !slot(x)), a].slice(-MAX_ACTIONS);
  }

  /** A player clears their own (`id` or not); 'dm' clears `id`, or every action. */
  clear(by: string, id?: string): boolean {
    return this.#keep((x) => !((by === 'dm' || x.by === by) && (id === undefined || x.id === id)));
  }

  /**
   * The fight changed: actions of a turn that ended (in the previous run, not the new one) go, and those of combatants no longer in it
   * (a removed monster, another fight resumed). No fight: everything made during one goes.
   */
  onCombat(c: Combat | undefined): boolean {
    const was = this.#run, run = c ? currentRun(c) : new Set<string>();
    this.#run = run;
    if (!c) return this.#keep((x) => x.endsWith === undefined && !x.duringFight);
    const ids = new Set(c.combatants.map((x) => x.id));
    return this.#keep((x) => x.endsWith === undefined || (ids.has(x.endsWith) && !(was.has(x.endsWith) && !run.has(x.endsWith))));
  }

  /** Another scene is shown (or none): actions on any other go. */
  onScene(shownSceneId: string | undefined): boolean {
    return this.#keep((x) => x.sceneId === shownSceneId);
  }

  #keep(f: (x: DeclaredAction) => boolean): boolean {
    const n = this.#list.length;
    this.#list = this.#list.filter(f);
    return this.#list.length !== n;
  }
}

/** A point end players may use or see: inside the scene and, with fog on (the view carries it), not fogged. */
function pointOk(v: PlayerScene, p: Pt): boolean {
  if (!(p.x >= 0 && p.x <= v.width && p.y >= 0 && p.y <= v.height)) return false;
  return v.fog === undefined || isRevealed(decodeFog(v.fog, v.width, v.height), v.width, v.height, p);
}
/** In the players' view: a token end of a visible token (the view has no hidden or fogged one), or an allowed point. */
const shows = (v: PlayerScene, e: ActionEnd) => ('tokenId' in e ? v.tokens.some((t) => t.id === e.tokenId) : pointOk(v, e));

/** Why a player's request is refused (undefined = allowed). The host decides which refusals are crafted (a violation) and which stale. */
export function actionProblem(r: ActionRequest, view: PlayerScene | undefined, ownTokenIds: Set<string>): string | undefined {
  if (!view || r.sceneId !== view.id) return 'not the shown scene';
  const from = tokenOf(r.from);
  if (from !== undefined && !ownTokenIds.has(from)) return 'not their token';
  if (!shows(view, r.from)) return 'the source is not visible';
  if (!shows(view, r.to)) return 'the target is not visible';
}

/** What players get: actions on the shown scene whose ends they can all see, without the DM's bookkeeping. */
export function actionsForPlayers(list: DeclaredAction[], view: PlayerScene | undefined): PlayerAction[] {
  if (!view) return [];
  return list.filter((a) => a.sceneId === view.id && shows(view, a.from) && shows(view, a.to))
    .map(({ endsWith: _e, duringFight: _d, ...a }) => a);
}
