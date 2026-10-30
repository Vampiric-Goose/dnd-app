// Converts the 5e-database SRD 5.1 JSON (github.com/5e-bits/5e-database @ a6212be) into src/data/srd.json:
//   node scripts/build-srd.ts <checkout>/src/2014/en     (from the repo root)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Entity, Pack } from '../src/lib/types.ts';
import { classes } from './srd/classes.ts';
import { effectTarget, SRD_EFFECTS } from './srd/effects.ts';
import { items } from './srd/items.ts';
import { backgrounds, conditions, fail, feats, type Raw } from './srd/misc.ts';
import { races } from './srd/races.ts';
import { spells } from './srd/spells.ts';

const dir = process.argv[2] ?? fail('usage: node scripts/build-srd.ts <5e-database>/src/2014/en');
const cache = new Map<string, Raw[]>();
const read = (file: string): Raw[] => {
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(join(dir, `5e-SRD-${file}.json`), 'utf8')));
  return cache.get(file)!;
};

const entities: Entity[] = [...classes(read), ...races(read), ...backgrounds(read), ...feats(read), ...spells(read), ...items(read), ...conditions(read)];
const byId = new Map<string, Entity>();
for (const e of entities) {
  if (byId.has(e.id)) fail(`duplicate id ${e.id}`);
  byId.set(e.id, e);
}

for (const [key, add] of Object.entries(SRD_EFFECTS)) {
  const e = effectTarget(id => byId.get(id), key) ?? fail(`SRD_EFFECTS: nothing at ${key}`);
  if (add.effects) e.effects = [...(e.effects ?? []), ...add.effects];
  if (add.choices) e.choices = [...(e.choices ?? []), ...add.choices];
}

// Every id one entity points at must exist.
const need = (from: string, ref: string | undefined) => { if (ref !== undefined && !byId.has(ref)) fail(`${from} -> missing ${ref}`); };
for (const e of entities) {
  if ('features' in e) for (const f of e.features) need(e.id, f.id);
  if ('classId' in e) need(e.id, e.classId);
  if ('subclassId' in e) need(e.id, e.subclassId);
  if ('raceId' in e) need(e.id, e.raceId);
  if ('startingEquipment' in e) for (const g of e.startingEquipment.choices) for (const o of g) for (const i of o.items) need(e.id, i.itemId);
  if ('alwaysPrepared' in e) for (const a of e.alwaysPrepared ?? []) for (const s of a.spells) need(e.id, s);
}

// One entity per line, so regenerating gives a readable diff.
const pack: Omit<Pack, 'entities'> = { id: 'srd', name: 'System Reference Document 5.1', source: 'SRD', importedAt: 0, hash: '', patches: [] };
const json = JSON.stringify({ ...pack, entities: [] }).replace('"entities":[]', `"entities":[\n${entities.map(e => JSON.stringify(e)).join(',\n')}\n]`);
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/srd.json', json + '\n');

const counts: Record<string, number> = {};
for (const e of entities) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
console.log(Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join('\n') + `\ntotal: ${entities.length}`);
