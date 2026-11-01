import type { CampaignSettings, Character, RichText, SpellDef } from '../types.ts';
import { enumerateChoices, getKind, raceParts, walkLevels } from './choices.ts';

// Pure (no Svelte/Vite/DOM): view helpers for the character sheet.

export type DeathState = 'ok' | 'dying' | 'stable' | 'dead';

/** Dead wins; above 0 HP is ok; at 0 HP the character is stable or dying. */
export const deathState = (s: Character['state']): DeathState => (s.dead ? 'dead' : s.hp > 0 ? 'ok' : s.stable ? 'stable' : 'dying');

export interface FeatureItem { source: string; name: string; text: RichText }

/** Every trait, feature and chosen option the character has, in the order a player meets them. Reads only `embedded`. */
export function featureList(c: Character, settings: CampaignSettings): FeatureItem[] {
  const lookup = (id: string) => c.embedded[id];
  const out: FeatureItem[] = [];
  // N12: a race's text repeats its traits; list the traits, or the race text when it has none.
  const { race, sub } = raceParts(c, lookup);
  for (const r of [race, sub]) {
    if (!r) continue;
    if (r.traits.length) for (const t of r.traits) out.push({ source: r.name, name: t.name, text: t.text });
    else if (r.text.length) out.push({ source: 'Race', name: r.name, text: r.text });
  }
  const bg = getKind(lookup, c.build.backgroundId, 'background');
  if (bg) out.push({ source: bg.name, name: bg.feature.name, text: bg.feature.text });
  for (const s of walkLevels(c, lookup, settings)) for (const f of s.features) out.push({ source: `${s.cls?.name ?? 'Class'} ${s.classLevel}`, name: f.name, text: f.text });
  for (const { choice, answer, sourceName } of enumerateChoices(c, lookup, settings)) {
    const ids = answer?.type === 'ids' ? answer.ids : answer?.type === 'asi' && answer.featId ? [answer.featId] : [];
    if (choice.type === 'option') for (const t of choice.options) if (ids.includes(t.name)) out.push({ source: sourceName, name: t.name, text: t.text });
    const kind = choice.type === 'optionalFeature' ? 'optionalFeature' : choice.type === 'feat' || choice.type === 'asi' ? 'feat' : undefined;
    if (kind) for (const id of ids) { const e = getKind(lookup, id, kind); if (e) out.push({ source: sourceName, name: e.name, text: e.text }); }
  }
  return out;
}

export interface SheetSpell { spell: SpellDef; prepared: boolean; always: boolean }

/** A casting class's spells (known, prepared and always prepared), by level then name. Reads only `embedded`. */
export function spellList(c: Character, classId: string): SheetSpell[] {
  const lookup = (id: string) => c.embedded[id];
  const picked = c.build.spells[classId] ?? { known: [], prepared: [] };
  const level = c.build.levels.filter((l) => l.classId === classId).length;
  const cls = getKind(lookup, classId, 'class');
  const sub = cls && getKind(lookup, c.build.subclasses[classId], 'subclass');
  const always = new Set([cls?.spellcasting?.alwaysPrepared, sub?.spellcasting?.alwaysPrepared, sub?.alwaysPrepared].flatMap((a) => (a ?? []).filter((x) => x.level <= level).flatMap((x) => x.spells)));
  return [...new Set([...picked.known, ...picked.prepared, ...always])]
    .flatMap((id) => { const spell = getKind(lookup, id, 'spell'); return spell ? [{ spell, prepared: picked.prepared.includes(id) || always.has(id), always: always.has(id) }] : []; })
    .sort((a, b) => a.spell.level - b.spell.level || a.spell.name.localeCompare(b.spell.name));
}

/** The array with index `i` set to `n`, holes filled with 0 (slotsUsed is sparse until a slot is spent). */
export function setAt(arr: number[], i: number, n: number): number[] {
  const out = Array.from({ length: Math.max(arr.length, i + 1) }, (_, k) => arr[k] ?? 0);
  out[i] = n;
  return out;
}

/** 'Hill Dwarf · Fighter 3 / Wizard 1', read from the embedded copies so it works whatever books are loaded. */
export function characterSummary(c: Character): string {
  const n: Record<string, number> = {};
  for (const l of c.build.levels) n[l.classId] = (n[l.classId] ?? 0) + 1;
  const race = c.embedded[c.build.subraceId ?? '']?.name ?? c.embedded[c.build.raceId]?.name;
  return [race, Object.entries(n).map(([id, lv]) => `${c.embedded[id]?.name ?? id} ${lv}`).join(' / ')].filter(Boolean).join(' · ');
}
