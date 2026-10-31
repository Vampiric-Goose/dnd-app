import type { ItemDef, MonsterDef } from '../lib/types.ts';

/**
 * A draft read from pasted text, waiting for the editor the paste dialog navigates to (`monsters/new?pasted=1`,
 * `items/new?pasted=1`). In memory only: a reload drops it, and the editor then says to paste again.
 */
export const pasted: { monster?: { draft: MonsterDef; notes: string[] }; item?: { draft: ItemDef; notes: string[] } } = {};
