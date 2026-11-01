// The map's db helpers (lazy: reached from the map page only). Token builders that need the combat engine live here, not in scene.ts.
import { monsterCombatant } from '../combat/combat.ts';
import { db } from '../db.ts';
import type { Character, MonsterDef, Scene, Size } from '../types.ts';
import type { NewToken } from './scene.ts';

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
