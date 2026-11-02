// The map's db helpers (lazy: reached from the map page only). Token builders that need the combat engine live here, not in scene.ts.
import { addCombatants, monsterCombatant, pcCombatant } from '../combat/combat.ts';
import { fightScene, prepareStart, remove, updateCombat } from '../combat/store.ts';
import { db } from '../db.ts';
import type { CampaignSettings, Character, Combat, Combatant, MonsterDef, Scene, Sheet, Size } from '../types.ts';
import { addTokens, patchToken, removeTokens, tokensFromCombat, type NewToken } from './scene.ts';

/** db.scenes.update on the fresh record (a player's move made since the page read it survives), stamping updatedAt. */
export const editScene = (id: string, fn: (s: Scene) => Scene): Promise<Scene | undefined> =>
  db.scenes.update(id, (s) => { const out = fn(s); return out === s ? s : { ...out, updatedAt: Date.now() }; });

/** Size from the stat block's first size; HP as the tracker would give it. */
export function tokenForMonster(m: MonsterDef, name: string, hpMode: 'average' | 'roll', rng?: () => number): NewToken {
  const { hp, maxHp } = monsterCombatant(m, name, hpMode, rng);
  return { name, size: m.size[0] ?? 'M', monsterId: m.id, ...(hp !== undefined && { hp, maxHp }) };
}

export const tokenForCharacter = (c: Character, size: Size): NewToken =>
  ({ name: c.name, size, characterId: c.id }); // M6: no portrait copy: the token shows the character's current one

/**
 * Pure. A PC token adds its character (addCombatants skips one already in); a monster token already linked to a live combatant is skipped;
 * any other monster token becomes a combatant with the token's name, hp/maxHp (when set) and hidden flag, and the token is linked to it.
 * `missing` names the tokens whose monster or character is gone. Tokens with neither are left out.
 */
export function combatantsFromTokens(s: Scene, ids: string[], c: Combat, chars: Character[], sheetOf: (c: Character) => Sheet,
  lookup: (id: string) => MonsterDef | undefined, hpMode: 'average' | 'roll', rng: () => number = Math.random): { combat: Combat; scene: Scene; missing: string[] } {
  const list: Combatant[] = [], links = new Map<string, string>(), missing: string[] = [];
  for (const id of ids) {
    const t = s.tokens.find((x) => x.id === id);
    if (!t) continue;
    if (t.characterId) {
      const ch = chars.find((x) => x.id === t.characterId);
      if (ch) list.push(pcCombatant(ch, sheetOf(ch), rng)); else missing.push(t.name);
    } else if (t.monsterId) {
      if (t.combatantId && c.combatants.some((x) => x.id === t.combatantId)) continue;
      const m = lookup(t.monsterId);
      if (!m) { missing.push(t.name); continue; }
      const x = monsterCombatant(m, t.name, hpMode, rng);
      list.push({ ...x, ...(t.hp !== undefined && { hp: t.hp }), ...(t.maxHp !== undefined && { maxHp: t.maxHp }), ...(t.hidden && { hidden: true }) });
      links.set(t.id, x.id);
    }
  }
  if (!list.length) return { combat: c, scene: s, missing };
  const combat = addCombatants(c, list), inFight = new Set(combat.combatants.map((x) => x.id));
  let scene = s;
  for (const [tokenId, combatantId] of links) if (inFight.has(combatantId)) scene = patchToken(scene, tokenId, { combatantId }); // MAX_COMBATANTS may stop some
  return { combat, scene, missing };
}

/** The DM map's Add to combat: the combat gains the selected tokens (a new one in setup when there is none) and the tokens are linked. */
export async function addTokensToCombat(cid: string, sceneId: string, ids: string[], o: { chars: Character[]; sheetOf: (c: Character) => Sheet;
  lookup: (id: string) => MonsterDef | undefined; settings: CampaignSettings }): Promise<{ missing: string[] }> {
  const s = await db.scenes.get(sceneId);
  if (!s) return { missing: [] };
  let r: ReturnType<typeof combatantsFromTokens> | undefined;
  await updateCombat(cid, (c) => { r = combatantsFromTokens(s, ids, c, o.chars, o.sheetOf, o.lookup, o.settings.monsterHp); return r.combat; });
  const linked = r!.scene.tokens.filter((t, i) => t.combatantId !== s.tokens[i].combatantId);
  if (linked.length) await editScene(sceneId, (fresh) => linked.reduce((x, t) => (x.tokens.some((y) => y.id === t.id) ? patchToken(x, t.id, { combatantId: t.combatantId }) : x), fresh));
  return { missing: r!.missing };
}

/**
 * The map's Start combat: the scene is shown and every token on it joins the fight; monsters and the DM's own characters roll, and round 1
 * starts as soon as the players' characters have rolled (at once with none). Returns who it waits for, and tokens it could not add.
 */
export async function startFight(cid: string, sceneId: string, o: Parameters<typeof addTokensToCombat>[3]): Promise<{ missing: string[]; waiting: string[] }> {
  const s = await db.scenes.get(sceneId);
  if (!s) return { missing: [], waiting: [] };
  if (!s.shown) await db.scenes.show(cid, sceneId);
  const { missing } = await addTokensToCombat(cid, sceneId, s.tokens.map((t) => t.id), o);
  const waiting = await prepareStart(cid, new Set(o.chars.filter((c) => c.ownerId).map((c) => c.id)));
  return { missing, waiting };
}

/**
 * Combatants placed on the shown scene (else the most recently updated one, fightScene): one token per monster combatant that no token
 * links to yet, and (W5, a resumed fight) one per PC whose character has no token there, near the scene's centre. Returns how many were
 * placed, and why not all were: no scene, or the scene is full (MAX_TOKENS). The caller says so.
 */
export async function placeCombatants(cid: string, added: Combatant[], lookup: (id: string) => MonsterDef | undefined): Promise<{ placed: number; why?: 'no scene' | 'full' }> {
  const target = await fightScene(cid);
  if (!target) return { placed: 0, why: 'no scene' };
  let placed = 0, wanted = 0;
  await editScene(target.id, (s) => {
    const linked = new Set(s.tokens.map((t) => t.combatantId)), chars = new Set(s.tokens.map((t) => t.characterId));
    const list: NewToken[] = added.flatMap((x): NewToken[] => {
      // ponytail: PC tokens are Medium (a Small PC takes the same one square in 2014); the DM map's Add uses the race's size
      if (x.kind === 'pc') return x.characterId && !chars.has(x.characterId) ? [{ name: x.name, size: 'M', characterId: x.characterId, ...(x.hidden && { hidden: true }) }] : [];
      return x.kind !== 'monster' || linked.has(x.id) ? [] : [{
        name: x.name, size: (x.monsterId && lookup(x.monsterId)?.size[0]) || 'M', combatantId: x.id,
        ...(x.monsterId && { monsterId: x.monsterId }), ...(x.hp !== undefined && { hp: x.hp }), ...(x.maxHp !== undefined && { maxHp: x.maxHp }), ...(x.hidden && { hidden: true }),
      }];
    });
    const out = list.length ? addTokens(s, list) : s;
    placed = out.tokens.length - s.tokens.length;
    wanted = list.length;
    return out;
  });
  return placed < wanted ? { placed, why: 'full' } : { placed };
}

// One roster (the user's ruling, 11-02): the fight and the map hold the same creatures. Added on either side, a creature is on both;
// removed from either, it leaves both.

/** Every fighter no token on any scene links to (a character: none on the fight's scene) gets one there (placeCombatants). */
export async function placeUnplaced(cid: string, lookup: (id: string) => MonsterDef | undefined): ReturnType<typeof placeCombatants> {
  const combat = await db.combat.get(cid);
  if (!combat) return { placed: 0 };
  const linked = new Set((await db.scenes.list(cid)).flatMap((s) => s.tokens.map((t) => t.combatantId)));
  const out = combat.combatants.filter((x) => !linked.has(x.id));
  return out.length ? placeCombatants(cid, out, lookup) : { placed: 0 };
}

/** Tokens put on the map join the fight when there is one (addTokensToCombat); with none they stay map-only. */
export async function joinFight(cid: string, sceneId: string, ids: string[], o: Parameters<typeof addTokensToCombat>[3]): Promise<{ missing: string[] }> {
  return (await db.combat.get(cid)) ? addTokensToCombat(cid, sceneId, ids, o) : { missing: [] };
}

/** Tokens taken off the map, and the fighters they link to out of the fight. */
export async function dropTokens(cid: string, sceneId: string, ids: string[]): Promise<void> {
  const gone = new Set(ids), s = await db.scenes.get(sceneId);
  const fighters = (s?.tokens ?? []).flatMap((t) => (gone.has(t.id) && t.combatantId ? [t.combatantId] : []));
  await editScene(sceneId, (x) => removeTokens(x, ids));
  const combat = await db.combat.get(cid);
  for (const id of fighters) if (combat?.combatants.some((x) => x.id === id)) await remove(cid, id);
}

/** A combatant removed mid-fight leaves the map too (the HP write-back first keeps its other tokens' HP, final M2); a failed write-back still removes it. */
export async function removeCombatant(cid: string, combatantId: string): ReturnType<typeof remove> {
  try { await endCombatWriteBack(cid); } catch (e) { console.warn(e); }
  const out = await remove(cid, combatantId);
  for (const s of await db.scenes.list(cid)) {
    const ids = s.tokens.filter((t) => t.combatantId === combatantId).map((t) => t.id);
    if (ids.length) await editScene(s.id, (x) => removeTokens(x, ids));
  }
  return out;
}

/** Before a fight ends (End combat, or a saved one resumed over it): its monsters leave every scene, as they leave the fight. */
export async function clearFightTokens(cid: string): Promise<void> {
  const fighters = new Set((await db.combat.get(cid))?.combatants.filter((x) => x.kind === 'monster').map((x) => x.id));
  for (const s of await db.scenes.list(cid)) {
    const ids = s.tokens.filter((t) => t.combatantId && fighters.has(t.combatantId)).map((t) => t.id);
    if (ids.length) await editScene(s.id, (x) => removeTokens(x, ids));
  }
}

/** Every scene of the campaign takes the fight's HP onto its linked tokens. */
export async function endCombatWriteBack(cid: string): Promise<void> {
  const combat = await db.combat.get(cid);
  for (const s of await db.scenes.list(cid)) await editScene(s.id, (x) => tokensFromCombat(x, combat));
}
