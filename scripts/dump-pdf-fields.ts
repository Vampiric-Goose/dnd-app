// Prints every form field of a PDF: JSON-quoted name (so trailing spaces show), type, page and position.
//   node scripts/dump-pdf-fields.ts "<file>.pdf"
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/dump-pdf-fields.ts <file.pdf>');
  process.exit(2);
}

const doc = await PDFDocument.load(readFileSync(file), { updateMetadata: false });
const pages = doc.getPages();
const fields = doc.getForm().getFields();
for (const f of fields) {
  const w = f.acroField.getWidgets()[0];
  const r = w?.getRectangle();
  const page = w ? pages.findIndex((p) => p.ref === w.P()) + 1 : 0;
  const where = r ? `p${page} x=${Math.round(r.x)} y=${Math.round(r.y)}` : 'no widget';
  console.log(`${JSON.stringify(f.getName())}\t${f.constructor.name}\t${where}`);
}
console.error(`${fields.length} fields`);
