// Pure (no Svelte/Vite/DOM). Stage 3: everything a player receives is built here, and none of it may carry hidden data (spec 3.6):
// no loot (R50), no sync secrets or player list, no monsters, no item secrets (R51), only summaries of other players' characters.
// Stage 4: the initiative tracker's player view (trackerForPlayers).
import { budgetApplies, originOf } from '../combat/movement.ts';
import { attacksPerAction } from '../combat/turnActions.ts';
import { featureList } from '../character/play.ts';
import { entityAllowed, packAllowed, patchAllowed, restorablePack } from '../content/sources.ts';
import type { ContentIndex } from '../content/index.ts';
import { playerCharacter, restoreSecrets } from '../items/playerView.ts';
import { computeSheet } from '../rules/sheet.ts';
import type { Ability, Campaign, CampaignSettings, Character, Combat, Movement, Pack } from '../types.ts';
import { sha256Text } from './code.ts';
import type { Synced } from './merge.ts';
import type { PackOffer } from './protocol.ts';

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

export type HealthStatus = 'Unhurt' | 'Hurt' | 'Bloodied' | 'Down';

/** Spec 3.6's health words (Hurt fills the gap between full and half). Undefined without a positive max. Stage 5's tokens reuse it. */
export function healthStatus(hp: number | undefined, maxHp: number | undefined): HealthStatus | undefined {
  if (hp === undefined || maxHp === undefined || !(maxHp > 0)) return undefined;
  return hp <= 0 ? 'Down' : hp >= maxHp ? 'Unhurt' : hp * 2 <= maxHp ? 'Bloodied' : 'Hurt';
}

export interface TrackerRow { id: string; name: string; characterId?: string; init?: number; hp?: number; maxHp?: number; health?: HealthStatus;
  moved?: Movement /* a player character's turn origin and Dashes, while a budget applies */;
  econ?: TurnEcon /* the viewer's own character's pips this turn, in a running fight */ }
/** Turn panel: Actions used and extra, the Bonus action, attacks in the Attack action, the Reaction, attacks one Attack action allows. */
export interface TurnEcon { /** extra damage on its weapon hits (no mark: players learn no ids) */ rider?: { dice: string; type: string; anyAttack?: true }; used: number; extra: number; bonus: boolean; attacks: number; light?: boolean; surged?: boolean; haste?: boolean; hasted?: boolean; object?: boolean; readied?: boolean; bonusSpell?: boolean; leveledSpell?: boolean; reaction: boolean; perAction: number; /** concentrating */ conc: boolean; /** its own spell held and the slot it was cast with, to use again */ concOn?: string; concSlot?: number }
export interface TrackerView { round: number; current?: string; rows: TrackerRow[]; /** the DM asked for initiative (setup only) */ ask?: true;
  /** Targeting: the viewer's own characters' pending area saves (a pop-up each). */ saves?: SavePrompt[];
  /** Targeting: the viewer's own characters' hits waiting for a die pick (Chaos Bolt). */ picks?: PickPrompt[] }
/** No DC: only the caster learns it; the DM's device works the save out. */
export interface SavePrompt { resolution: string; characterId: string; ability: Ability; spell: string }
/** A hit waiting for its caster's player to pick the die that sets its type (Chaos Bolt): the faces and their types, never the damage. */
export interface PickPrompt { resolution: string; characterId: string; spell: string; options: { face: number; type: string }[]; leap?: true }

/**
 * The tracker as players see it, an allowlist (spec 3.6): no hidden combatants, no monsters during setup (round 0), and of everything
 * but a player's character only its name (plus a health word when the DM shows monster health). A player character carries its
 * initiative, HP and the player-view max HP (hidden item bonuses stay hidden). A DM-only character counts as "everything else" (R13).
 * Spec 1: while a budget applies, only the `viewer` player's own characters carry their movement this turn (no viewer: none do).
 * S4-R5: every row but a player's character gets its id from `alias` (the host passes opaque random ids, so no record id leaves).
 * S4-R4: on a turn players can't see (hidden, or a missing PC), `current` and `round` stay where the last visible turn left them.
 */
export function trackerForPlayers(c: Combat | undefined, characters: Character[], settings: CampaignSettings, alias: (combatantId: string) => string = (id) => id,
  viewer?: string): TrackerView | undefined {
  if (!c) return undefined;
  const byId = new Map(characters.map((ch) => [ch.id, ch]));
  const maxHp = (ch: Character) => computeSheet(ch, { settings, viewer: 'player' }).maxHp;
  const showHealth = settings.showMonsterHealth && settings.initiativeModules.hp;
  const rows: TrackerRow[] = [];
  const sent = new Map<string, string>(); // combatant id → row id
  const budget = budgetApplies(c, settings);
  for (const x of c.combatants) {
    if (x.hidden) continue;
    const ch = x.characterId === undefined ? undefined : byId.get(x.characterId);
    if (x.characterId !== undefined && !ch) continue;
    if (ch?.ownerId) {
      const m = budget && ch.ownerId === viewer ? c.movement?.[x.id] : undefined, from = originOf(m);
      const e = c.round >= 1 && ch.ownerId === viewer ? { used: 0, extra: 0, bonus: false, attacks: 0, ...x.economy } : undefined;
      rows.push({ id: x.id, name: ch.name, characterId: ch.id, ...(x.init !== undefined && { init: x.init }), hp: ch.state.hp, maxHp: maxHp(ch),
        ...(m && { moved: { ...(from && { from }), dashes: m.dashes, ...(m.mult !== undefined && { mult: m.mult }), ...(m.stood && { stood: true as const }) } }),
        ...(e && { econ: { ...e, reaction: !!x.reactionUsed, conc: !!x.concentrating, ...(x.concentrating && x.concentratingOn && { concOn: x.concentratingOn }), ...(x.concentrating && x.concentrationSlot !== undefined && { concSlot: x.concentrationSlot }), hasted: !!x.hasted && !x.hasted.ended, perAction: attacksPerAction(featureList(ch, settings)), ...(x.rider && { rider: { dice: x.rider.dice, type: x.rider.type, ...(x.rider.anyAttack && { anyAttack: true as const }) } }) } }) });
      sent.set(x.id, x.id);
      continue;
    }
    if (c.round === 0) continue;
    const health = showHealth ? (ch ? healthStatus(ch.state.hp, maxHp(ch)) : healthStatus(x.hp, x.maxHp)) : undefined;
    const id = alias(x.id);
    rows.push({ id, name: x.name, ...(health && { health }) });
    sent.set(x.id, id);
  }
  // The current turn, or the nearest visible one before it; walking back past the top of the order is the previous round.
  let round = c.round, current: string | undefined;
  const i = c.combatants.findIndex((x) => x.id === c.turn);
  for (let k = 0; c.round > 0 && i >= 0 && k < c.combatants.length && current === undefined; k++) {
    const j = i - k;
    if (j < 0 && c.round === 1) break; // no visible turn yet this fight
    current = sent.get(c.combatants[(j + c.combatants.length) % c.combatants.length].id);
    if (current !== undefined && j < 0) round = c.round - 1;
  }
  // Targeting: a pending area save reaches only the player who owns that character.
  const saves = viewer === undefined ? [] : (c.resolutions ?? []).flatMap((r) => r.outcomes.flatMap((o): SavePrompt[] => {
    const ch = o.pending ? byId.get(c.combatants.find((x) => x.id === o.id)?.characterId ?? '') : undefined;
    return ch && ch.ownerId === viewer ? [{ resolution: r.id, characterId: ch.id, ability: r.ability ?? 'dex', spell: r.action }] : [];
  }));
  const picks = viewer === undefined ? [] : (c.resolutions ?? []).flatMap((r) => {
    const ch = byId.get(c.combatants.find((x) => x.id === r.actor)?.characterId ?? '');
    return ch && ch.ownerId === viewer ? r.outcomes.flatMap((o): PickPrompt[] => (o.choose ? [{ resolution: r.id, characterId: ch.id, spell: r.action,
      options: o.choose.map(({ face, type }) => ({ face, type })), ...(o.leap && { leap: true as const }) }] : [])) : [];
  });
  return { round, ...(current !== undefined && { current }), rows, ...(c.round === 0 && c.askInit && { ask: true as const }), ...(saves.length && { saves }), ...(picks.length && { picks }) };
}

/** Stage 5's movement gate: the characterId whose turn it is, if any. */
export const currentActor = (v: TrackerView | undefined): string | undefined => v?.rows.find((r) => r.id === v.current)?.characterId;

/** A player's own character as sent to them: `playerCharacter` (item player views only, R51), with its sync meta. */
export const characterForPlayer = (c: Synced<Character>): Synced<Character> => playerCharacter(c);

/**
 * R8: the inverse of characterForPlayer for a character coming back from its player. Every entry the DM's stored copy also has gets back
 * its real `item`, `view` and `sourceId`, and its stored `chargesUsed` when the player view hid the charges (R56's rule). The player's play
 * state (quantity, equipped, attuned, notes) is kept, and entries new to the DM stay as they are. The host runs it before mergeCharacter.
 */
export const unprojectCharacter = (incoming: Synced<Character>, stored: Synced<Character>): Synced<Character> => restoreSecrets(incoming, stored);

/** A pack as players get it, serialized, with the hash and byte size of exactly that JSON (R6). Undefined when nothing may be sent. */
export async function playerPack(p: Pack | undefined): Promise<{ json: string; offer: PackOffer } | undefined> {
  const fp = p && restorablePack(p) ? packForPlayers(p) : undefined; // never the built-in SRD; never monsters (packForPlayers)
  if (!fp) return undefined;
  const json = JSON.stringify(fp);
  return { json, offer: { id: fp.id, hash: await sha256Text(json), size: new TextEncoder().encode(json).length } };
}
