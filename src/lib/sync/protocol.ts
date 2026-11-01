// Pure (no Svelte/Vite/DOM). The sync messages. Every message is `{ t: <type>, ... }`. Guest messages are untrusted: the host reads
// them only through parseGuestMessage, which checks each one against an explicit shape and returns a clean copy of the parts it reads.
import { INIT_MAX, INIT_MIN } from '../combat/combat.ts';
import { MAX_SIDE } from '../map/scene.ts';
import { characterProblem, isRec } from '../recordShape.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Character } from '../types.ts';
import type { Synced } from './merge.ts';
import type { CampaignForPlayers, RosterEntry, TrackerView } from './project.ts';
import type { PlayerScene } from './scene.ts';

export const MAX_MESSAGE = 256 * 1024, MAX_CHUNK = 64 * 1024, MAX_PACK = 64 * 1024 * 1024;
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
  | { t: 'move'; sceneId: string; tokenId: string; x: number; y: number /* stage 5: the player's own token, scene px */ }
  | { t: 'blobWant'; hashes: string[] /* stage 5: images of the current scene it lacks */ };

export interface PackOffer { id: string; hash: string; size: number }

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
      const { sceneId, tokenId, x, y } = raw;
      const at = (v: unknown): v is number => num(v) && v >= 0 && v <= MAX_SIDE;
      return str(sceneId, 100) && str(tokenId, 100) && at(x) && at(y) ? { t: 'move', sceneId, tokenId, x, y } : { error: 'bad move' };
    }
    case 'blobWant': {
      const h = raw.hashes;
      return Array.isArray(h) && h.length >= 1 && h.length <= 201 && h.every((x) => typeof x === 'string' && HASH.test(x)) ? { t: 'blobWant', hashes: h as string[] } : { error: 'bad blobWant' };
    }
    default:
      return { error: 'unknown message' };
  }
}
