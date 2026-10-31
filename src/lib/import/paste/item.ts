import { newHomebrewId } from '../../items/homebrew.ts';
import type { ItemDef, ItemType, Rarity } from '../../types.ts';
import { cleanPasted, refusal, rich } from './clean.ts';

// Pure (no Svelte/Vite/DOM), loaded lazily by the paste dialog. Reads a 2014 magic item in the book's layout into a draft ItemDef.
// Never throws: what it can't read becomes a note.

const TYPES: Record<string, ItemType> = {
  'wondrous item': 'wondrous', weapon: 'weapon', armor: 'armor', shield: 'shield', ammunition: 'ammunition', potion: 'potion', ring: 'ring', rod: 'rod',
  scroll: 'scroll', staff: 'staff', wand: 'wand', tool: 'tool', gear: 'gear', 'adventuring gear': 'gear',
};
const RARITY = /\b(very rare|uncommon|common|rare|legendary|artifact|rarity varies)\b/i;
const LINE = new RegExp(`^(${Object.keys(TYPES).join('|')})\\b\\s*(?:\\(([^)]*)\\))?\\s*,`, 'i');

/** `refused`: the paste was not read (see `refusal`); the dialog shows it instead of opening the editor. */
export function parseItemText(s: string): { draft: ItemDef; notes: string[]; refused?: string } {
  const notes: string[] = [];
  const d: ItemDef = { kind: 'item', id: newHomebrewId(), name: 'Pasted item', source: 'Homebrew', text: [], type: 'wondrous', magic: true };
  const refused = refusal(s, 'item');
  if (refused) return { draft: d, notes, refused };
  const lines = cleanPasted(s).split('\n').filter(Boolean);
  if (!lines.length) return { draft: d, notes: ['Nothing to read: paste an item.'] };
  let i = 0;
  if (!LINE.test(lines[0])) d.name = lines[i++];
  const head = LINE.exec(lines[i] ?? '');
  if (head) {
    const l = lines[i++];
    d.type = TYPES[head[1].toLowerCase()];
    if (head[2]) notes.push(`"${head[1]} (${head[2]})": the base ${head[1].toLowerCase()}'s stats were not copied; choose a base item in the editor.`);
    const r = RARITY.exec(l)?.[1].toLowerCase();
    if (r) d.rarity = (r === 'rarity varies' ? 'varies' : r) as Rarity;
    else notes.push('No rarity was found.');
    const att = /\(requires attunement\s*([^)]*)\)/i.exec(l);
    if (att) d.attunement = att[1].trim() ? att[1].trim() : true;
  } else notes.push('No type and rarity line (such as "Wondrous item, rare") was found; a wondrous item was assumed.');
  d.text = rich(lines.slice(i));
  if (!d.text.length) notes.push('No description was found.');
  return { draft: d, notes };
}
