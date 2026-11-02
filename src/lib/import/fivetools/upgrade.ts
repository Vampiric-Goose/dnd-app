// Re-converts books already imported when the converter gains a fix, from the raw 5etools records kept on this device (db.raw5e), so
// nobody has to import again. Lazy: store.svelte.ts loads it only when db.meta 'converter5e' is behind CONVERTER_5E.
import { db } from '../../db.ts';
import type { ItemDef, Pack } from '../../types.ts';
import { CONVERTER_5E } from '../version.ts';
import { import5etools, mergePack } from './index.ts';

/** Empty: missing, '', [] or {}. */
const blank = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) ? !v.length : typeof v === 'object' && v !== null && !Object.keys(v).length);
/**
 * Never blank what the stored copy has filled: a field the re-conversion leaves empty keeps its stored value. An upgrade can only miss
 * data (side files it didn't get, a converter slip), never mean to delete it, so a bad upgrade can't cost anyone a re-import.
 */
// ponytail: a converter fix that must remove a field reaches stored books only by a re-import
function keepFilled<T extends object>(fresh: T, old: T | undefined): T {
  if (!old) return fresh;
  const out = { ...fresh } as Record<string, unknown>;
  for (const [k, v] of Object.entries(old)) if (blank(out[k]) && !blank(v)) out[k] = v;
  return out as T;
}

/** The stored pack with the re-converted one merged in. A stored item made from a base that the converter no longer makes (a doubled
 * "Adamantine Adamantine Longsword") goes; everything else stays (merged as a re-import is), and nothing filled is blanked. */
export function upgradedPack(stored: Pack, fresh: Pack): Pack {
  const made = new Set(fresh.entities.map((e) => e.id));
  const kept = { ...stored, entities: stored.entities.filter((e) => !(e.kind === 'item' && (e as ItemDef).baseItemId && !made.has(e.id))) };
  const was = new Map(stored.entities.map((e) => [e.id, e])), wasPatch = new Map(stored.patches.map((p) => [`${p.targetId}|${p.alias}`, p]));
  return mergePack(kept, { ...fresh, entities: fresh.entities.map((e) => keepFilled(e, was.get(e.id))),
    patches: fresh.patches.map((p) => keepFilled(p, wasPatch.get(`${p.targetId}|${p.alias}`))) });
}

/** Groups raw records by their 5etools key (the raw key's first part) into one file the importer reads; the homebrew sources this device
 * already accepted are declared again (R52: official sources need no declaration). */
export const rawFile = (entries: [string, unknown][], homebrew: string[] = []): { name: string; json: Record<string, unknown> } => {
  const json: Record<string, unknown[]> = {};
  for (const [k, v] of entries) (json[k.split('|')[0]] ??= []).push(v);
  return { name: 'stored books', json: homebrew.length ? { ...json, _meta: { sources: homebrew.map((s) => ({ json: s })) } } : json };
};

/** Upgrades this device's imported books; returns how many packs changed (0 when there was nothing to do). */
export async function upgradeImports(index: () => Promise<import('../../content/index.ts').ContentIndex>): Promise<number> {
  const entries = await db.raw5e.all();
  let changed = 0;
  if (entries.length) {
    const homebrew = (await db.packs.listMeta()).filter((m) => m.homebrew && m.sharedBy === undefined).map((m) => m.source);
    const res = await import5etools([rawFile(entries, homebrew)], {
      index: await index(),
      rawLookup: async (key) => (await db.raw5e.getMany([key]))[0],
      homebrewSources: homebrew,
    });
    for (const p of res.packs) {
      const stored = await db.packs.get(p.id);
      if (!stored || stored.sharedBy !== undefined) continue; // only this device's own imports (a DM's shared copy updates from the DM)
      const next = upgradedPack(stored, p);
      if (next.hash === stored.hash) continue;
      await db.packs.put(next);
      changed++;
    }
    await db.raw5e.putMany(res.raw); // nameless subraces are kept from now on
  }
  await db.meta.set('converter5e', CONVERTER_5E);
  return changed;
}
