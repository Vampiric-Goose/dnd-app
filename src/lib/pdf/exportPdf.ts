import { APP_NAME } from '../app.ts';
import type { CampaignSettings, Character, ItemDef, Sheet } from '../types.ts';
import { addDataField, appFieldValues, drawCharacter, drawItem, encodeEnvelope, itemFieldValues, type Viewer } from './appLayout.ts';

// pdf-lib is reached only through `await import('pdf-lib')`, so it stays in its own lazy chunk.

/**
 * The character in our own sheet layout. The visible fields show `sheet` as `opts.viewer` sees it; the hidden `app.data` field
 * holds the whole character (exactly what the JSON export holds), plus the settings and viewer the sheet was computed with,
 * so a re-import can tell a value someone edited in a PDF reader from one the engine derives.
 */
export async function exportCharacterPdf(c: Character, sheet: Sheet, opts: { viewer?: Viewer; settings?: CampaignSettings } = {}): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const doc = await lib.PDFDocument.create();
  doc.setTitle(`${c.name || 'Character'} (${APP_NAME})`);
  doc.setCreator(APP_NAME);
  const first = await drawCharacter(lib, doc, appFieldValues(c, sheet, opts));
  addDataField(lib, doc, first, encodeEnvelope({ format: 'dnd-app-character', version: 1, data: c, ...opts }));
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
