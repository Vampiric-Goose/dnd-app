// Local audit: every spell of the SRD and the user's own PHB, XGE and TCE files (read at run time from SPELLS_5E, never bundled) cast
// through the real pipeline (readSpell, aimPlan, workOut) at a monster 5 ft away, one line each. Skipped without SPELLS_5E.
//   SPELLS_5E=<path to data/spells> AUDIT_OUT=<file> npx vitest run scripts/spell-audit.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import srd from '../src/data/srd.json';
import { aimPlan, workOut, type WorkIn } from '../src/lib/combat/aiming.ts';
import { targetOf } from '../src/lib/combat/resolve.ts';
import { readSpell } from '../src/lib/combat/spellText.ts';
import type { TurnAction } from '../src/lib/combat/turnActions.ts';
import { parseDice } from '../src/lib/dice.ts';
import { spell } from '../src/lib/import/fivetools/spells.ts';
import { DEFAULT_GRID } from '../src/lib/map/scene.ts';
import { SPELL_EFFECTS } from '../src/lib/rules/constants.ts';
import type { Combat, Combatant, Scene, SpellDef } from '../src/lib/types.ts';

const dir = process.env.SPELLS_5E;
const cell = (q: number) => ({ x: 35 + 70 * q, y: 35 });
const cb = (o: Partial<Combatant> & Pick<Combatant, 'id' | 'kind' | 'name'>): Combatant => ({ initMod: 0, dex: 10, tie: 0.5, conSave: 0, ...o });
const maxFaces = (expr: string) => parseDice(expr).flatMap((t) => ('const' in t ? [] : Array(t.count).fill(t.sides)));

export async function audit(s: SpellDef): Promise<string> {
  const read = readSpell(s);
  if (SPELL_EFFECTS[s.name]) return 'ok: sheet effect';
  const a: TurnAction = { id: 's', name: s.name, cost: 'action', group: 'spell', spell: { id: s.id, level: s.level, concentration: s.concentration }, cast: { read, attack: 5, dc: 13, charLevel: 5, mod: 3 } };
  const plan = aimPlan(a);
  const hurts = read.damage.length > 0, conds = !!read.conditions?.length;
  if (!plan) return read.manual ? `manual: ${read.manual}` : read.heal ? 'heal: roll button' : hurts || conds ? 'BROKEN: has effects but cannot be aimed' : 'none: no automated effect';
  const scene: Scene = { id: 's1', campaignId: 'c', name: 'F', width: 2800, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0, tokens: [
    { id: 't-c', name: 'Caster', ...cell(5), size: 'M', color: '#000000', combatantId: 'c' }, { id: 't-o', name: 'Orc', ...cell(6), size: 'M', color: '#000000', combatantId: 'o' }] };
  const k: Combat = { campaignId: 'c', round: 1, turn: 'c', groupMonsters: false, updatedAt: 0, combatants: [cb({ id: 'c', kind: 'monster', name: 'Caster' }), cb({ id: 'o', kind: 'monster', name: 'Orc' })] };
  const n = plan.count ?? 1;
  const aim: WorkIn['aim'] = { ...(n > 1 ? { targets: Array(n).fill('o') } : plan.area?.on === 'self' ? {} : { target: 'o' }), point: cell(6),
    rolled: { ...(plan.attack && { d20: Array(2 * n).fill(15) }), dmg: Array.from({ length: n }, () => plan.dice.map((d) => maxFaces(d.expr))).flat() }, toggles: [], ...(plan.choices && { dtype: plan.choices[0] }) };
  const r = await workOut({ a, features: [], actor: k.combatants[0], combat: k, scene, diagonal: '5-5-5', aim, findTarget: (id) => k.combatants.find((z) => z.id === id),
    info: (z) => ({ ...targetOf(z, {}), ac: 10 }), nameOf: (z) => z.name, magical: false, id: 'r', now: 0, rng: () => 0.01 });
  if (typeof r === 'string') return `BROKEN: ${r}`;
  const o = r.resolution.outcomes, dealt = o.reduce((t, x) => t + (x.damage ?? 0), 0), inflicted = o.some((x) => x.inflict?.length);
  if (r.resolution.linger) return `ok: placed, ${r.resolution.linger.dice.map((d) => d.expr + ' ' + d.type).join(' + ')} as a turn starts there${read.manual ? ` (${read.manual})` : ''}`;
  const bits = [`${plan.dice.map((d) => `${d.expr} ${d.type}`).join(' + ') || 'no dice'}`, `dealt ${dealt}`, ...(inflicted ? [`inflicts ${[...new Set(o.flatMap((x) => x.inflict ?? []))].join(', ')}`] : []),
    ...(read.save ? [`${read.save} save, ${read.onSave} on success`] : []), ...(read.manual ? [`note: ${read.manual}`] : [])];
  if (hurts && !dealt) return `BROKEN: no damage dealt (${bits.join('; ')})`;
  if (conds && !inflicted) return `BROKEN: conditions not inflicted (${bits.join('; ')})`;
  return `ok: ${bits.join('; ')}`;
}

test.skipIf(!dir)('spell audit', async () => {
  const ctx = { spellClasses: () => [], listed: () => true } as never, out: string[] = [];
  const books: [string, SpellDef[]][] = [['SRD', (srd as { entities: SpellDef[] }).entities.filter((e) => e.kind === 'spell')]];
  for (const f of ['phb', 'xge', 'tce']) books.push([f.toUpperCase(), JSON.parse(readFileSync(join(dir!, `spells-${f}.json`), 'utf8')).spell.map((r: { name: string }) => spell(r as never, ctx, r.name, r.name))]);
  for (const [book, list] of books) for (const s of list) out.push(`${book}\tL${s.level}\t${s.name}\t${await audit(s)}`);
  writeFileSync(process.env.AUDIT_OUT ?? 'spell-audit.tsv', out.join('\n'));
  const count = (p: string) => out.filter((l) => l.split('\t')[3].startsWith(p)).length;
  console.log(`spells ${out.length} · ok ${count('ok')} · heal ${count('heal')} · manual ${count('manual')} · none ${count('none')} · BROKEN ${count('BROKEN')}`);
});
