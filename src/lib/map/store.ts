// The map's db helpers (lazy: reached from the map page only). Token builders that need the combat engine live here, not in scene.ts.
import { addCombatants, monsterCombatant, pcCombatant } from '../combat/combat.ts';
import { updateCombat } from '../combat/store.ts';
import { db } from '../db.ts';
import type { CampaignSettings, Character, Combat, Combatant, MonsterDef, Scene, Sheet, Size } from '../types.ts';
import { addTokens, patchToken, tokensFromCombat, type NewToken } from './scene.ts';

/** db.scenes.update on the fresh record (a player's move made since the page read it survives), stamping updatedAt. */
export const editScene = (id: string, fn: (s: Scene) => Scene): Promise<Scene | undefined> =>
  db.scenes.update(id, (s) => { const out = fn(s); return out === s ? s : { ...out, updatedAt: Date.now() }; });

/** Size from the stat block's first size; HP as the tracker would give it. */
export function tokenForMonster(m: MonsterDef, name: string, hpMode: 'average' | 'roll', rng?: () => number): NewToken {
  const { hp, maxHp } = monsterCombatant(m, name, hpMode, rng);
  return { name, size: m.size[0] ?? 'M', monsterId: m.id, ...(hp !== undefined && { hp, maxHp }) };
}

export const tokenForCharacter = (c: Character, size: Size): NewToken =>
  ({ name: c.name, size, characterId: c.id, ...(c.details.portrait && { portrait: c.details.portrait }) });

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
 * An encounter's new combatants placed on the shown scene (else the most recently updated one): one token per monster combatant that no
 * token links to yet, near the scene's centre. Returns how many were placed (0: no scene; the caller says so).
 */
export async function placeCombatants(cid: string, added: Combatant[], lookup: (id: string) => MonsterDef | undefined): Promise<number> {
  const scenes = await db.scenes.list(cid);
  const target = scenes.find((s) => s.shown) ?? scenes.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!target) return 0;
  let placed = 0;
  await editScene(target.id, (s) => {
    const linked = new Set(s.tokens.map((t) => t.combatantId));
    const list: NewToken[] = added.filter((x) => x.kind === 'monster' && !linked.has(x.id)).map((x) => ({
      name: x.name, size: (x.monsterId && lookup(x.monsterId)?.size[0]) || 'M', combatantId: x.id,
      ...(x.monsterId && { monsterId: x.monsterId }), ...(x.hp !== undefined && { hp: x.hp }), ...(x.maxHp !== undefined && { maxHp: x.maxHp }), ...(x.hidden && { hidden: true }),
    }));
    const out = list.length ? addTokens(s, list) : s;
    placed = out.tokens.length - s.tokens.length;
    return out;
  });
  return placed;
}

/** Before a fight ends: every scene of the campaign takes the fight's HP onto its linked tokens. */
export async function endCombatWriteBack(cid: string): Promise<void> {
  const combat = await db.combat.get(cid);
  for (const s of await db.scenes.list(cid)) await editScene(s.id, (x) => tokensFromCombat(x, combat));
}
