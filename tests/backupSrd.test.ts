// R52 fix round 2: a backup can never replace the built-in SRD or carry a pack that claims a reserved source.
import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { exportBackup } from '../src/lib/backup.ts';
import { db, resetDb } from '../src/lib/db.ts';
import type { Pack } from '../src/lib/types.ts';
import { camp, importBackup } from './fixtures/records.ts';
import { srdPackFixture } from './fixtures/srdPack.ts';

beforeEach(resetDb);

const pack = (id: string, source: string, hash = 'h'): Pack => ({ id, name: id, source, importedAt: 1, hash, patches: [],
  entities: [{ kind: 'condition', id: `condition:x@${source}`, name: 'X', source, text: [] }] });
const file = (packs: Pack[]) => new Blob([JSON.stringify({ format: 'dnd-app-backup', version: 1, campaigns: [camp('c1')], packs })]);

test('restoring a backup with an srd pack leaves the built-in SRD untouched and says what was skipped', async () => {
  await db.packs.put({ ...srdPackFixture, hash: 'original' });
  const r = await importBackup(file([{ ...srdPackFixture, hash: 'evil' }, pack('pack:PHB', 'PHB'), pack('pack:S', 'SRD'), pack('pack:H', 'homebrew'), pack('pack:I', 'Hidden')]));
  expect((await db.packs.get('srd'))?.hash).toBe('original');
  expect((await db.packs.listMeta()).map((m) => m.id).sort()).toEqual(['pack:PHB', 'srd']);
  expect(r).toMatchObject({ campaigns: 1, packs: 1, skippedPacks: ['srd', 'pack:S', 'pack:H', 'pack:I'] });
});

test('db.restore itself refuses those packs', async () => {
  await db.restore({ campaigns: [], characters: [], items: [], blobs: [], packs: [pack('srd', 'SRD', 'evil'), pack('pack:S', 'SRD'), pack('pack:OK', 'PHB')] });
  expect((await db.packs.listMeta()).map((m) => m.id)).toEqual(['pack:OK']);
});

test('a normal backup of a library with the cached SRD does not carry the SRD', async () => {
  await db.packs.put(srdPackFixture);
  await db.packs.put(pack('pack:PHB', 'PHB'));
  const o = JSON.parse(await (await exportBackup({ includePacks: true })).text());
  expect(o.packs.map((p: Pack) => p.id)).toEqual(['pack:PHB']);
  expect(await importBackup(new Blob([JSON.stringify(o)]))).toEqual({ campaigns: 0, characters: 0, items: 0, packs: 1 });
});
