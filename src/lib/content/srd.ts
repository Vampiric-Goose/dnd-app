// The one src/lib module allowed Vite-only syntax: `?url` makes srd.json a separately fetched, content-hashed asset.
import srdUrl from '../../data/srd.json?url';
import { db } from '../db.ts';
import type { Pack } from '../types.ts';

/** The SRD pack: from IndexedDB while its stored hash is the current asset url, otherwise fetched and cached. */
export async function loadSrd(): Promise<Pack> {
  const cached = await db.packs.get('srd').catch(() => undefined); // no IndexedDB (e.g. private mode): just fetch
  if (cached?.hash === srdUrl) return cached;
  const res = await fetch(srdUrl);
  if (!res.ok) throw new Error(`Could not load the SRD (HTTP ${res.status})`);
  const pack: Pack = { ...(await res.json()), hash: srdUrl, importedAt: Date.now() };
  await db.packs.put(pack).catch(e => console.warn('SRD not cached:', e)); // still usable this session
  return pack;
}
