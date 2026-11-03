// Pure (no Svelte/Vite/DOM). The sync messages. Every message is `{ t: <type>, ... }`. Guest messages are untrusted: the host reads
// them only through parseGuestMessage, which checks each one against an explicit shape and returns a clean copy of the parts it reads.
import { INIT_MAX, INIT_MIN } from '../combat/combat.ts';
import type { ReactOption } from '../combat/reactions.ts';
import { cleanActionRequest, type ActionRequest, type PlayerAction } from '../map/actions.ts';
import { MAX_SIDE } from '../map/scene.ts';
import { characterProblem, isRec } from '../recordShape.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Character } from '../types.ts';
import type { Synced } from './merge.ts';
import type { CampaignForPlayers, ReactPrompt, RosterEntry, TrackerView } from './project.ts';
import type { PlayerScene } from './scene.ts';

export const MAX_MESSAGE = 256 * 1024, MAX_CHUNK = 64 * 1024, MAX_PACK = 64 * 1024 * 1024;
/** A pack stream's chunk size (characters), and the send buffer below which the next chunk goes. */
export const CHUNK_CHARS = 20_000, LOW_WATER = MAX_CHUNK * 4;
/** M4: chunk boundaries every CHUNK_CHARS, moved back one unit so a surrogate pair is never split (a binary transport would mangle each half). */
export function cuts(json: string): number[] {
  const out = [0];
  while (out.at(-1)! < json.length) {
    let end = Math.min(out.at(-1)! + CHUNK_CHARS, json.length);
    const u = json.charCodeAt(end - 1);
    if (end < json.length && u >= 0xd800 && u <= 0xdbff) end--;
    out.push(end);
  }
  return out;
}

export { INIT_MAX, INIT_MIN } from '../combat/combat.ts'; // one source (M2)
/** Stage 5: images players get (scene backgrounds, portraits): at most MAX_BLOB bytes, BLOB_CHUNK bytes (60 000 base64 chars) per chunk. */
export const MAX_BLOB = 8 * 1024 * 1024, BLOB_CHUNK = 45_000;
export const IMAGE_TYPES: readonly string[] = ['image/webp', 'image/png', 'image/jpeg', 'image/gif'];
/** A blob's key: SHA-256, lowercase hex. */
export const HASH = /^[0-9a-f]{64}$/;

export type GuestMsg =
  | { t: 'hello'; code: string; playerId?: string; name?: string }
  | { t: 'chars'; characters: Synced<Character>[] }
  | { t: 'deleteChar'; id: string; at: string }
  | { t: 'roll'; entry: RollEntry }
  | { t: 'packWant'; ids: string[] }
  | { t: 'initiative'; characterId: string; total: number /* stage 4: the player's own roll, an integer INIT_MIN–INIT_MAX */ }
  | { t: 'move'; sceneId: string; tokenId: string; x: number; y: number /* stage 5: the player's own token, scene px */;
      /** The squares it walks (1–200 token centres, from the one next to it to x/y); none: a straight route (an old client). */ path?: { x: number; y: number }[] }
  | { t: 'blobWant'; hashes: string[] /* stage 5: images of the current scene it lacks */ }
  | { t: 'use'; characterId: string; action: string; slot?: number; target?: string /* turn panel: the player's own character does something (a TurnAction id) */; aim?: Aim; summon?: SummonPick }
  | { t: 'save'; resolution: string; characterId: string; d20: number /* targeting: the player's own save roll for a pending area save */ }
  | { t: 'signedChunk'; id: string; at: number; sig: string; seq: number; total: number; data: string /* a trusted publisher's own book, in order (signing.ts) */ }
  | { t: 'pick'; characterId: string; resolution: string; type: string /* targeting: the die picked for a hit waiting on it (Chaos Bolt), by its type */ }
  | { t: 'leap'; characterId: string; resolution: string; aim: Aim /* targeting: a leaping spell's next target (Chaos Bolt), from that result's creature */ }
  | { t: 'react'; ask: string; characterId: string; option: ReactOption['id'] | 'pass'; slot?: number; aim?: Aim; d20?: number /* an answer to an open reaction card */ }
  | { t: 'endTurn'; characterId: string /* the player's own character ends its turn */ }
  | { t: 'action'; action: ActionRequest /* declared action: the player's arrow (replaces their last) */ }
  | { t: 'clearAction' /* the player's arrow goes */ }
  | { t: 'drag'; sceneId: string; tokenId: string; x: number; y: number /* live drag preview of the player's own token (never stored) */ }
  | { t: 'dragEnd'; sceneId: string; tokenId: string /* that drag ended */ };

import type { Aim, UseOutcome } from '../combat/aiming.ts';
export type { Aim, UseOutcome };
export interface PackOffer { id: string; hash: string; size: number }
/** A live drag preview: the token at `at`, or (no `at`) the drag ended. Never stored. */
export interface Preview { tokenId: string; at?: { x: number; y: number } }

export type HostMsg =
  | { t: 'welcome'; playerId: string; campaign: CampaignForPlayers; roster: RosterEntry[]; packs: PackOffer[] }
  | { t: 'rejected'; reason: string }
  | { t: 'chars'; characters: Synced<Character>[] }
  | { t: 'deleteChar'; id: string; at: string }
  | { t: 'notYours'; id: string /* M1: the DM moved or reassigned it; the guest takes it out of the campaign */ }
  | { t: 'roster'; roster: RosterEntry[] }
  | { t: 'roll'; entry: RollEntry; from?: string /* player ID; absent for the DM */ }
  | { t: 'packChunk'; id: string; hash: string; seq: number; total: number; data: string }
  | { t: 'settings'; campaign: CampaignForPlayers }
  | { t: 'tracker'; tracker: TrackerView | null /* stage 4: trackerForPlayers; null = no fight */ }
  | { t: 'scene'; scene: PlayerScene | null /* stage 5: sceneForPlayers; null = no scene shown */ }
  | { t: 'blobChunk'; hash: string; type: string; size: number; seq: number; total: number; data: string /* base64 */ }
  | { t: 'actions'; actions: PlayerAction[] /* declared actions players may see (actionsForPlayers) */ }
  | { t: 'drag'; tokenId: string; x: number; y: number /* someone drags a token this player sees (a preview, never stored) */ }
  | { t: 'dragEnd'; tokenId: string }
  | { t: 'reactions'; prompts: ReactPrompt[]; waiting: boolean /* the player's own reaction cards, and whether the fight waits on one of their characters */ }
  | { t: 'useRefused'; reason: string /* turn panel: a use the DM's device turned down (nothing was spent), or their spell countered (paid) */ }
  | ({ t: 'outcome' } & UseOutcome)
  | { t: 'bye'; reason: string };

/** Serialized length (UTF-16 units, close enough to bytes for a limit). */
export const size = (msg: unknown): number => JSON.stringify(msg)?.length ?? 0;

/** A `__proto__` own key anywhere, an object with another prototype, or nesting past 64 levels. */
function poisoned(v: unknown, depth = 0): boolean {
  if (typeof v !== 'object' || v === null) return false;
  if (depth > 64 || Object.hasOwn(v, '__proto__')) return true;
  if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) return true;
  return Object.values(v).some((x) => poisoned(x, depth + 1));
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const PLAYER_ID = /^[A-Z][1-9]$/;
/** A hybrid logical clock value (hlc.ts). */
export const HLC = /^\d{15}:\d{6}:[A-Za-z0-9_-]{1,16}$/;

/** A public roll, rebuilt from its known fields only. Undefined when any is missing or the roll is private (R6: never sent). */
export function cleanRoll(e: unknown): RollEntry | undefined {
  if (!isRec(e) || e.public !== true || !str(e.id, 100) || !str(e.label, 200) || !str(e.expr, 200) || !num(e.total) || !str(e.detail, 2000) || !num(e.at)) return undefined;
  return { id: e.id, label: e.label, expr: e.expr, total: e.total, detail: e.detail, at: e.at, public: true };
}

const ints = (v: unknown, max: number, lo: number, hi: number): v is number[] =>
  Array.isArray(v) && v.length <= max && v.every((n) => Number.isInteger(n) && n >= lo && n <= hi);
/** An aim rebuilt from its known fields, or null when malformed. Whether the dice fit the action is the host's check (resolve.ts). */
function cleanAim(a: unknown): Aim | null {
  if (!isRec(a) || !isRec(a.rolled)) return null;
  const { target, targets, point, toggles, dtype } = a, { d20, mode, dmg } = a.rolled;
  if (target !== undefined && !str(target, 100)) return null;
  if (targets !== undefined && !(Array.isArray(targets) && targets.length >= 1 && targets.length <= 12 && targets.every((x) => str(x, 100)))) return null;
  if (dtype !== undefined && !str(dtype, 20)) return null;
  if (point !== undefined && !(isRec(point) && num(point.x) && num(point.y) && point.x >= 0 && point.y >= 0 && point.x <= MAX_SIDE && point.y <= MAX_SIDE)) return null;
  if ((d20 !== undefined && !ints(d20, 24, 0, 99)) || (mode !== undefined && mode !== 'adv' && mode !== 'dis')) return null;
  if (!Array.isArray(dmg) || dmg.length > 24 || !dmg.every((f) => ints(f, 80, 0, 999))) return null;
  if (!Array.isArray(toggles) || toggles.length > 2 || !toggles.every((t) => t === 'gwm' || t === 'ss')) return null;
  return { ...(target !== undefined && { target }), ...(targets !== undefined && { targets: targets as string[] }), ...(point !== undefined && { point: { x: point.x as number, y: point.y as number } }),
    rolled: { ...(d20 !== undefined && { d20: d20 as number[] }), ...(mode !== undefined && { mode: mode as 'adv' | 'dis' }), dmg: dmg as number[][] }, toggles: toggles as Aim['toggles'],
    ...(dtype !== undefined && { dtype }) };
}

const REACT_OPTIONS: readonly string[] = ['oa', 'counterspell', 'shield', 'uncanny', 'parry', 'rebuke'];
/** A summon cast's pick (summons.ts): the option, the creatures (monster ids from the shared books), a spirit's variant. */
export interface SummonPick { option?: number; monsterIds: string[]; variant?: string }
/** null: malformed. */
function cleanSummon(x: unknown): SummonPick | null {
  if (typeof x !== 'object' || x === null) return null;
  const { option, monsterIds, variant } = x as Record<string, unknown>;
  if (!Array.isArray(monsterIds) || monsterIds.length < 1 || monsterIds.length > 8 || !monsterIds.every((m) => typeof m === 'string' && m.length <= 200)) return null;
  if (option !== undefined && !(Number.isInteger(option) && (option as number) >= 0 && (option as number) < 8)) return null;
  if (variant !== undefined && !(typeof variant === 'string' && variant.length <= 40)) return null;
  return { monsterIds: monsterIds as string[], ...(option !== undefined && { option: option as number }), ...(variant !== undefined && { variant: variant as string }) };
}

/** A guest message checked against its shape, or why not. Ownership and 2024 checks need the campaign and are the host's. */
export function parseGuestMessage(raw: unknown): GuestMsg | { error: string } {
  if (!isRec(raw) || poisoned(raw)) return { error: 'malformed' };
  switch (raw.t) {
    case 'hello': {
      const playerId = raw.playerId as string | undefined;
      if (!str(raw.code, 64) || (playerId !== undefined && !(typeof playerId === 'string' && PLAYER_ID.test(playerId))) || (raw.name !== undefined && !str(raw.name, 60))) return { error: 'bad hello' };
      const name = (raw.name as string | undefined)?.trim();
      return { t: 'hello', code: raw.code, ...(playerId !== undefined && { playerId }), ...(name && { name }) };
    }
    case 'chars': {
      if (!Array.isArray(raw.characters) || !raw.characters.length) return { error: 'bad chars' };
      const why = raw.characters.map(characterProblem).find((w) => w);
      return why ? { error: `character ${why}` } : { t: 'chars', characters: raw.characters as Synced<Character>[] };
    }
    case 'deleteChar':
      return str(raw.id, 100) && typeof raw.at === 'string' && HLC.test(raw.at) ? { t: 'deleteChar', id: raw.id, at: raw.at } : { error: 'bad deleteChar' };
    case 'roll': {
      const entry = cleanRoll(raw.entry);
      return entry ? { t: 'roll', entry } : { error: 'bad roll' };
    }
    case 'packWant':
      return Array.isArray(raw.ids) && raw.ids.length <= 1000 && raw.ids.every((x) => str(x, 200)) ? { t: 'packWant', ids: raw.ids as string[] } : { error: 'bad packWant' };
    case 'initiative': {
      const { characterId: id, total: n } = raw;
      return str(id, 100) && Number.isInteger(n) && (n as number) >= INIT_MIN && (n as number) <= INIT_MAX ? { t: 'initiative', characterId: id, total: n as number } : { error: 'bad initiative' };
    }
    case 'move': {
      const { sceneId, tokenId, x, y, path } = raw;
      const at = (v: unknown): v is number => num(v) && v >= 0 && v <= MAX_SIDE;
      const pts = path === undefined || (Array.isArray(path) && path.length >= 1 && path.length <= 200 && path.every((p) => isRec(p) && at(p.x) && at(p.y)));
      return str(sceneId, 100) && str(tokenId, 100) && at(x) && at(y) && pts
        ? { t: 'move', sceneId, tokenId, x, y, ...(Array.isArray(path) && { path: path.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })) }) } : { error: 'bad move' };
    }
    case 'blobWant': {
      const h = raw.hashes;
      return Array.isArray(h) && h.length >= 1 && h.length <= 201 && h.every((x) => typeof x === 'string' && HASH.test(x)) ? { t: 'blobWant', hashes: h as string[] } : { error: 'bad blobWant' };
    }
    case 'use': {
      const { characterId, action, slot, target } = raw, aim = raw.aim === undefined ? undefined : cleanAim(raw.aim), summon = raw.summon === undefined ? undefined : cleanSummon(raw.summon);
      return str(characterId, 100) && str(action, 200) && (slot === undefined || (Number.isInteger(slot) && (slot as number) >= 1 && (slot as number) <= 9))
        && (target === undefined || str(target, 100)) && aim !== null && summon !== null
        ? { t: 'use', characterId, action, ...(slot !== undefined && { slot: slot as number }), ...(target !== undefined && { target: target as string }), ...(aim && { aim }), ...(summon && { summon }) } : { error: 'bad use' };
    }
    case 'signedChunk': {
      const { id, at, sig, seq, total, data } = raw;
      return str(id, 200) && Number.isSafeInteger(at) && (at as number) > 0 && str(sig, 200) && Number.isSafeInteger(seq) && Number.isSafeInteger(total) && (total as number) >= 1
        && (seq as number) >= 0 && (seq as number) < (total as number) && (total as number) <= Math.ceil(MAX_PACK / CHUNK_CHARS) && str(data, CHUNK_CHARS)
        ? { t: 'signedChunk', id, at: at as number, sig, seq: seq as number, total: total as number, data } : { error: 'bad signedChunk' };
    }
    case 'pick': {
      const { resolution, characterId, type } = raw;
      return str(resolution, 100) && str(characterId, 100) && str(type, 20) ? { t: 'pick', resolution, characterId, type } : { error: 'bad pick' };
    }
    case 'leap': {
      const { resolution, characterId } = raw, aim = cleanAim(raw.aim);
      return str(resolution, 100) && str(characterId, 100) && aim && aim.target !== undefined ? { t: 'leap', resolution, characterId, aim } : { error: 'bad leap' };
    }
    case 'save': {
      const { resolution, characterId, d20 } = raw;
      return str(resolution, 100) && str(characterId, 100) && Number.isInteger(d20) && (d20 as number) >= 1 && (d20 as number) <= 20
        ? { t: 'save', resolution, characterId, d20: d20 as number } : { error: 'bad save' };
    }
    case 'react': {
      const { ask, characterId, option, slot, d20 } = raw, aim = raw.aim === undefined ? undefined : cleanAim(raw.aim);
      return str(ask, 100) && str(characterId, 100) && (option === 'pass' || (typeof option === 'string' && REACT_OPTIONS.includes(option)))
        && (slot === undefined || (Number.isInteger(slot) && (slot as number) >= 1 && (slot as number) <= 9))
        && (d20 === undefined || (Number.isInteger(d20) && (d20 as number) >= 1 && (d20 as number) <= 20)) && aim !== null
        ? { t: 'react', ask, characterId, option: option as ReactOption['id'] | 'pass', ...(slot !== undefined && { slot: slot as number }), ...(aim && { aim }), ...(d20 !== undefined && { d20: d20 as number }) } : { error: 'bad react' };
    }
    case 'endTurn':
      return str(raw.characterId, 100) ? { t: 'endTurn', characterId: raw.characterId } : { error: 'bad endTurn' };
    case 'action': {
      const action = cleanActionRequest(raw.action);
      return action ? { t: 'action', action } : { error: 'bad action' };
    }
    case 'clearAction': return { t: 'clearAction' };
    case 'drag': {
      const { sceneId, tokenId, x, y } = raw;
      const at = (v: unknown): v is number => num(v) && v >= 0 && v <= MAX_SIDE;
      return str(sceneId, 100) && str(tokenId, 100) && at(x) && at(y) ? { t: 'drag', sceneId, tokenId, x, y } : { error: 'bad drag' };
    }
    case 'dragEnd':
      return str(raw.sceneId, 100) && str(raw.tokenId, 100) ? { t: 'dragEnd', sceneId: raw.sceneId, tokenId: raw.tokenId } : { error: 'bad dragEnd' };
    default:
      return { error: 'unknown message' };
  }
}
