import { APP_NAME } from '../app.ts';
import { playerCharacter } from '../items/playerView.ts';
import type { CampaignSettings, Character, ItemDef, MonsterDef, Sheet } from '../types.ts';
import { addDataField, appFieldValues, drawCharacter, drawItem, drawMonster, encodeEnvelope, itemFieldValues, monsterFieldValues, type Viewer } from './appLayout.ts';

// pdf-lib is reached only through `await import('pdf-lib')`, so it stays in its own lazy chunk.

/**
 * The character in our own sheet layout. The visible fields show `sheet` as `opts.viewer` sees it; the hidden `app.data` field
 * holds the character (the real one for the DM; for a player the player-safe copy, R51), plus the settings and viewer the sheet
 * was computed with, so a re-import can tell a value someone edited in a PDF reader from one the engine derives.
 */
export async function exportCharacterPdf(real: Character, sheet: Sheet, opts: { viewer?: Viewer; settings?: CampaignSettings } = {}): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const c = opts.viewer === 'player' ? playerCharacter(real) : real;
  const doc = await lib.PDFDocument.create();
  doc.setTitle(`${c.name || 'Character'} (${APP_NAME})`);
  doc.setCreator(APP_NAME);
  const { page, cuts } = await drawCharacter(lib, doc, appFieldValues(c, sheet, opts));
  addDataField(lib, doc, page, encodeEnvelope({ format: 'dnd-app-character', version: 1, data: c, ...opts, ...(Object.keys(cuts).length && { cuts }) }));
  return doc.save();
}

/** One item card. It prints and embeds exactly the item it is given: callers pass `playerItem(...)` when exporting for a player. */
export async function exportItemPdf(item: ItemDef): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.create();
  doc.setTitle(`${item.name} (${APP_NAME})`);
  doc.setCreator(APP_NAME);
  const page = await drawItem(lib, doc, itemFieldValues(item));
  addDataField(lib, doc, page, encodeEnvelope({ format: 'dnd-app-item', version: 1, data: item }));
  return doc.save();
}

/** One monster stat block (DM information: the Monsters page offers it only in DM view). Only one-line fields are read back, so cuts aren't stored. */
export async function exportMonsterPdf(m: MonsterDef): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.create();
  doc.setTitle(`${m.name} (${APP_NAME})`);
  doc.setCreator(APP_NAME);
  const page = await drawMonster(lib, doc, monsterFieldValues(m));
  addDataField(lib, doc, page, encodeEnvelope({ format: 'dnd-app-monster', version: 1, data: m }));
  return doc.save();
}
