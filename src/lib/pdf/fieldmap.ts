import type { ContentIndex } from '../content/index.ts';
import type { Character } from '../types.ts';
import { official2014 } from './maps/official2014.ts';

// Pure (no Svelte/Vite/DOM). A field map reads one official sheet's form fields into a Character.
export interface FieldMap {
  id: string;
  detect(names: Set<string>): boolean;
  toCharacter(fields: Record<string, string | boolean>, index?: ContentIndex): Character;
}

/** importPdf tries these in order when a PDF has no `app.data`. */
export const FIELD_MAPS: FieldMap[] = [official2014];
