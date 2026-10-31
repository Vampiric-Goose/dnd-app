// Pure (no Svelte/Vite/DOM). The sync messages. Every message is `{ t: <type>, ... }`. Guest messages are untrusted: the host reads
// them only through parseGuestMessage, which checks each one against an explicit shape and returns a clean copy of the parts it reads.
import { characterProblem, isRec } from '../recordShape.ts';
import type { RollEntry } from '../rolls.svelte.ts';
import type { Character } from '../types.ts';
import type { Synced } from './merge.ts';
import type { CampaignForPlayers, RosterEntry } from './project.ts';

export const MAX_MESSAGE = 256 * 1024, MAX_CHUNK = 64 * 1024, MAX_PACK = 64 * 1024 * 1024;

export type GuestMsg =
  | { t: 'hello'; code: string; playerId?: string; name?: string }
  | { t: 'chars'; characters: Synced<Character>[] }
  | { t: 'deleteChar'; id: string; at: string }
  | { t: 'roll'; entry: RollEntry }
  | { t: 'packWant'; ids: string[] };

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
    default:
      return { error: 'unknown message' };
  }
}
