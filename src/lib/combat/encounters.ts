// Pure (no Svelte/Vite/DOM): a fight saved into an encounter, and back. Lazy: only combat/store.ts imports it.
import type { Character, Combat, Combatant, SavedFight, Scene } from '../types.ts';

/** A deep copy of the fight (without its link) and, when a scene is given, that scene's tokens and fog. */
export function snapshotFight(c: Combat, scene: Scene | undefined): SavedFight {
  const { encounterId: _, ...combat } = structuredClone(c);
  return {
    combat,
    ...(scene && { map: { sceneId: scene.id, tokens: structuredClone(scene.tokens), ...(scene.fog !== undefined && { fog: scene.fog }) } }),
    savedAt: Date.now(),
  };
}

/**
 * The saved fight as the live one. PCs whose character is gone are dropped (named in `dropped`); a dropped PC holding the turn passes it
 * to the next combatant in the order (wrapping to a new round), as removeStep does, but nothing ticks. The PCs left lose their combatant
 * timers, concentration and reaction: their conditions live on the character, which is not rolled back.
 */
export function restoreCombat(f: SavedFight, encounterId: string, characters: Character[], campaignId: string): { combat: Combat; dropped: string[] } {
  const c = structuredClone(f.combat), alive = new Set(characters.map((x) => x.id)), dropped: string[] = [];
  const gone = new Set(c.combatants.filter((x) => x.kind === 'pc' && !(x.characterId && alive.has(x.characterId))).map((x) => { dropped.push(x.name); return x.id; }));
  const untimed = (x: Combatant): Combatant => {
    if (x.kind === 'pc') { const { durations: _d, concentrating: _c, reactionUsed: _r, ...rest } = x; return rest; }
    // as removeStep: a timer counted on a dropped combatant becomes untimed (the condition stays)
    return x.durations ? { ...x, durations: Object.fromEntries(Object.entries(x.durations).filter(([, d]) => !gone.has(d.of))) } : x;
  };
  const cs = c.combatants.filter((x) => !gone.has(x.id)).map(untimed);
  let { turn, round } = c;
  if (turn !== undefined && gone.has(turn)) {
    const i = c.combatants.findIndex((x) => x.id === turn);
    const after = c.combatants.slice(i + 1).find((x) => !gone.has(x.id));
    if (after) turn = after.id;
    else if (cs.length) { turn = cs[0].id; round++; } else turn = undefined;
  }
  return { combat: { ...c, combatants: cs, turn, round, encounterId, campaignId, updatedAt: Date.now() }, dropped };
}

/** The scene with the saved tokens (and fog, when saved): tokens of deleted characters and tokens off the scene are left out. */
export function restoreScene(s: Scene, f: SavedFight, characterIds: Set<string>): Scene {
  const m = f.map;
  if (!m) return s;
  const tokens = m.tokens.filter((t) => (!t.characterId || characterIds.has(t.characterId)) && t.x >= 0 && t.y >= 0 && t.x <= s.width && t.y <= s.height);
  return { ...s, tokens: structuredClone(tokens), fog: m.fog ?? s.fog, updatedAt: Date.now() };
}
