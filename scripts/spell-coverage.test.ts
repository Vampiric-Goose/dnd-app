// Local coverage scoreboard: how well the spell reader handles the user's own 5etools books. It holds no book data; it reads the files
// at run time from SPELLS_5E (a 5etools data/spells folder) and is skipped without it, so CI and normal runs never touch it.
//   SPELLS_5E=<path to data/spells> npx vitest run scripts/spell-coverage.test.ts --silent=false
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { readSpell, type SpellRead } from '../src/lib/combat/spellText.ts';
import { spell } from '../src/lib/import/fivetools/spells.ts';

const dir = process.env.SPELLS_5E;
const FILES = ['spells-phb.json', 'spells-xge.json', 'spells-tce.json'];

/** It can be worked out here: damage it can deliver, or conditions behind a save. */
export const resolves = (x: SpellRead & Record<string, unknown>): boolean =>
  !x.manual && ((x.damage.length > 0 && !!(x.attack || x.save || x.auto || x.linger || x.rider || x.rays)) || (!!x.conditions?.length && !!x.save));

test.skipIf(!dir)('spell coverage over the local books', () => {
  const ctx = { spellClasses: () => [], listed: () => true } as never;
  const ok: string[] = [], manual: string[] = [], silent: string[] = [];
  for (const f of FILES) {
    for (const r of JSON.parse(readFileSync(join(dir!, f), 'utf8')).spell) {
      if (!r.damageInflict && !r.conditionInflict) continue;
      const x = readSpell(spell(r, ctx, r.name, r.name)) as SpellRead & Record<string, unknown>;
      if (resolves(x)) ok.push(r.name);
      else if (x.manual) manual.push(`${r.name}: ${x.manual}`);
      else silent.push(r.name);
    }
  }
  console.log(`resolves ${ok.length} · manual ${manual.length} · silent ${silent.length}`);
  console.log(`\nmanual:\n  ${manual.join('\n  ')}`);
  console.log(`\nsilent:\n  ${silent.join('\n  ')}`);
});
