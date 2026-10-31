// Pure (no Svelte/Vite/DOM). Stage 3: everything a player receives is built here, and none of it may carry hidden data (spec 3.6):
// no loot (R50), no sync secrets or player list, no monsters, no item secrets (R51), only summaries of other players' characters.
import { entityAllowed, packAllowed, patchAllowed } from '../content/sources.ts';
import type { ContentIndex } from '../content/index.ts';
import { playerCharacter } from '../items/playerView.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { Campaign, CampaignSettings, Character, Pack } from '../types.ts';
import type { Synced } from './merge.ts';

export interface CampaignForPlayers { id: string; name: string; settings: CampaignSettings; enabledPacks: string[] }
export interface RosterEntry { id: string; ownerId: string; name: string; portrait?: string; race: string; classes: string; level: number; hp: number; maxHp: number; conditions: string[] }

// ponytail: JSON round trip, as in playerView: plain data, and it copes with Svelte $state proxies.
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The campaign as players get it: an allowlist, so loot, sync (join code, player list) and anything added later stay home. */
export const campaignForPlayers = (c: Campaign): CampaignForPlayers =>
  ({ id: c.id, name: c.name, settings: clone(c.settings), enabledPacks: [...c.enabledPacks] });

/** What the party sees of a character: who it is and how it is doing. HP max is the player-view sheet's (hidden item bonuses stay hidden). */
export function rosterEntry(c: Character, index: ContentIndex, settings: CampaignSettings): RosterEntry {
  const name = (id: string | undefined) => (id ? index.resolve(id)?.name ?? c.embedded[id]?.name : undefined);
  const levels = new Map<string, number>();
  for (const { classId } of c.build.levels) levels.set(classId, (levels.get(classId) ?? 0) + 1);
  return {
    id: c.id, ownerId: c.ownerId ?? '', name: c.name,
    ...(c.details.portrait !== undefined && { portrait: c.details.portrait }),
    race: name(c.build.subraceId) ?? name(c.build.raceId) ?? '',
    classes: [...levels].map(([id, n]) => `${name(id) ?? id} ${n}`).join(' / '), // as characterSummary: "Fighter 3 / Wizard 1"
    level: c.build.levels.length, hp: c.state.hp, maxHp: computeSheet(c, { settings, viewer: 'player' }).maxHp, conditions: [...c.state.conditions],
  };
}

/** A pack as players get it: no monsters or monster patches (lair, regional), nothing 2024. Undefined when nothing is left or the pack is not allowed. */
export function packForPlayers(p: Pack): Pack | undefined {
  if (!packAllowed(p)) return undefined;
  const entities = p.entities.filter((e) => e.kind !== 'monster' && entityAllowed(e));
  const patches = p.patches.filter((x) => !x.targetId.startsWith('monster:') && !x.lair && !x.regional && patchAllowed(x));
  return entities.length || patches.length ? { ...p, entities, patches } : undefined;
}

/** A player's own character as sent to them: `playerCharacter` (item player views only, R51), with its sync meta. */
export const characterForPlayer = (c: Synced<Character>): Synced<Character> => playerCharacter(c);
