// Pure (no Svelte/Vite/DOM). Join codes, the PeerJS peer id they map to, player IDs and a campaign's sync record.
import type { CampaignSync } from '../types.ts';
import { uid } from '../uid.ts';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L

/** 12 random characters from ALPHABET (crypto.getRandomValues, rejection-sampled so every character is equally likely). */
export function newJoinCode(): string {
  let out = '';
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < limit && out.length < 12) out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

/** SHA-256 of the bytes, lowercase hex. Needs a secure context (https or localhost), as images do. */
export async function sha256Bytes(b: ArrayBuffer | Uint8Array): Promise<string> {
  if (!crypto.subtle) throw new Error('Sync needs a secure connection (https): this browser offers no hashing over plain http.');
  const d = await crypto.subtle.digest('SHA-256', b as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of the text's UTF-8 bytes, lowercase hex. */
export const sha256Text = (text: string): Promise<string> => sha256Bytes(new TextEncoder().encode(text));

/** The DM's PeerJS peer id for a join code: 'dndapp-' + the first 32 hex characters of SHA-256(code). */
export const peerIdFor = async (code: string): Promise<string> => 'dndapp-' + (await sha256Text(code)).slice(0, 32);

/** The next free player ID in order A1…A9, B1…Z9. Removed IDs stay in `taken`, so they are never reused. Throws when all 234 are taken. */
export function nextPlayerId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let l = 65; l <= 90; l++) for (let d = 1; d <= 9; d++) {
    const id = String.fromCharCode(l) + d;
    if (!used.has(id)) return id;
  }
  throw new Error('This campaign has no free player IDs left.');
}

/** R5/R6: a fresh random 8-character HLC node id for this device. */
export const newNode = (): string => uid().replace(/-/g, '').slice(0, 8);

/** R6: a new hosted (dm) or joined (player) campaign sync record. */
export const newCampaignSync = (role: CampaignSync['role'], code: string): CampaignSync => ({ role, code, node: newNode() });

/** A join code from what a player typed or pasted: the code itself (any case, spaces or dashes), or a link ending in join/CODE. */
export function codeFrom(text: string): string {
  const t = text.trim().toUpperCase();
  const m = /JOIN\/([A-Z0-9]+)\s*$/.exec(t);
  const c = (m ? m[1] : t).replace(/[\s-]/g, '');
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/.test(c) ? c : '';
}
