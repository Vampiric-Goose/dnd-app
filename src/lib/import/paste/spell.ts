import { slug } from '../../content/ids.ts';
import type { SpellDef } from '../../types.ts';
import { uid } from '../../uid.ts';
import { cleanPasted, refusal, rich } from './clean.ts';

// Pure (no Svelte/Vite/DOM), loaded lazily by the paste dialog. Reads a 2014 spell in the book's layout into a draft SpellDef.
// Never throws: what it can't read becomes a note.

/** R3: pasted spells live in the local homebrew pack "My spells" (source MYSPELLS), so their ids carry that source. */
export const MY_SPELLS = 'MYSPELLS';
export const newSpellId = (): string => `spell:homebrew-${uid().slice(0, 8)}@${MY_SPELLS}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function blankSpell(): SpellDef {
  return { kind: 'spell', id: newSpellId(), name: 'Pasted spell', source: MY_SPELLS, text: [], level: 1, school: 'evocation', castingTime: '1 action', range: 'Self', components: {}, duration: 'Instantaneous', concentration: false, ritual: false, classes: [] };
}

/** `refused`: the paste was not read (see `refusal`); the dialog shows it instead of opening the editor. */
export function parseSpellText(s: string): { draft: SpellDef; notes: string[]; refused?: string } {
  const notes: string[] = [];
  const d = blankSpell();
  const refused = refusal(s, 'spell');
  if (refused) return { draft: d, notes, refused };
  const lines = cleanPasted(s).split('\n').filter(Boolean);
  if (!lines.length) return { draft: d, notes: ['Nothing to read: paste a spell.'] };
  const seen = new Set<string>();
  const body: string[] = [], higher: string[] = [];
  let i = 0;
  if (!/^(\d)(st|nd|rd|th)[- ]level|cantrip/i.test(lines[0])) d.name = lines[i++];
  for (; i < lines.length; i++) {
    const l = lines[i];
    let x: RegExpExecArray | null;
    if (!seen.has('level') && (x = /^(\d)(?:st|nd|rd|th)[- ]level (\w+)(.*)$/i.exec(l))) { d.level = +x[1]; d.school = x[2].toLowerCase(); d.ritual = /\britual\b/i.test(x[3]); seen.add('level'); }
    else if (!seen.has('level') && (x = /^(\w+) cantrip(.*)$/i.exec(l))) { d.level = 0; d.school = x[1].toLowerCase(); seen.add('level'); }
    else if ((x = /^Casting Time:?\s*(.+)$/i.exec(l))) { d.castingTime = x[1]; seen.add('time'); }
    else if ((x = /^Range:?\s*(.+)$/i.exec(l))) { d.range = x[1]; seen.add('range'); }
    else if ((x = /^Components:?\s*(.+)$/i.exec(l))) {
      const m = /\bM\s*\((.+)\)/.exec(x[1]);
      const head = x[1].replace(/\(.+\)/, '');
      d.components = { ...(/\bV\b/.test(head) && { v: true }), ...(/\bS\b/.test(head) && { s: true }), ...(m ? { m: m[1].trim() } : /\bM\b/.test(head) && { m: 'material component' }) };
      seen.add('components');
    } else if ((x = /^Duration:?\s*(.+)$/i.exec(l))) {
      const c = /^Concentration,?\s*(.+)$/i.exec(x[1]);
      d.concentration = !!c;
      d.duration = cap(c ? c[1] : x[1]);
      seen.add('duration');
    } else if ((x = /^Classes:?\s*(.+)$/i.exec(l))) d.classes = x[1].split(',').map((c) => slug(c.trim())).filter(Boolean);
    else if ((x = /^At Higher Levels\.?\s*(.*)$/i.exec(l))) { if (x[1]) higher.push(x[1]); seen.add('higher'); }
    else (seen.has('higher') ? higher : body).push(l);
  }
  for (const [k, label] of [['level', 'level and school line (such as "2nd-level evocation")'], ['time', 'Casting Time'], ['range', 'Range'], ['components', 'Components'], ['duration', 'Duration']] as const) {
    if (!seen.has(k)) notes.push(`No ${label} was found; the default was used.`);
  }
  if (!body.length) notes.push('No description was found.');
  d.text = rich(body);
  if (higher.length) d.higherLevels = rich(higher);
  if (!d.classes.length) notes.push('No class list was found; choose the classes in the editor.');
  return { draft: d, notes };
}
