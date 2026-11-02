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

// Disagreements ruled harmless (Task 9): the PHB's tags name conditions its utility spells mention but never inflict by a save (the SRD
// wording doesn't); Light's and Reverse Gravity's saves are an object holder's and a grab at something fixed, not damage or a condition;
// Lightning Lure pulls one creature, then the 15-foot radius is only where it takes the damage.
const RULED = new Set(['Greater Invisibility conditions', 'Invisibility conditions', 'Mislead conditions', 'Project Image conditions', 'Sequester conditions',
  'Silence conditions', 'Light no save', 'Reverse Gravity no save', 'Lightning Lure no area']);
const DEBUFFS = new Set(['Bane', 'Faerie Fire']);
const SHORT: Record<string, string> = { strength: 'Str', dexterity: 'Dex', constitution: 'Con', intelligence: 'Int', wisdom: 'Wis', charisma: 'Cha' };
/** Where the read and the book's own tags disagree: damage types, save, attack kind, area shape and size. */
export function disagree(s: SpellDef): string[] {
  const m = s.mech, r = readSpell(s), out: string[] = [];
  if (!m) return out;
  const types = new Set([...r.damage.map((d) => d.type).filter(Boolean), ...(r.choices ?? [])]), want = new Set(m.types ?? []);
  const missing = [...want].filter((x) => !types.has(x)), extra = [...types].filter((x) => want.size && !want.has(x));
  if ((missing.length && !r.manual) || extra.length) out.push(`types ${[...types].join('/') || '-'} vs book ${[...want].join('/')}`);
  if (m.save?.length && r.save && !m.save.map((x) => SHORT[x] ?? x.charAt(0).toUpperCase() + x.slice(1)).includes(r.save)) out.push(`save ${r.save} vs book ${m.save.join('/')}`);
  if (m.save?.length && !r.save && !r.manual && !r.rider) out.push(`no save vs book ${m.save.join('/')}`);
  if (m.attack && r.attack !== m.attack && !r.manual) out.push(`attack ${r.attack ?? '-'} vs book ${m.attack}`);
  if (m.area && r.area && (r.area.shape !== m.area.shape || r.area.feet !== m.area.feet)) out.push(`area ${r.area.shape} ${r.area.feet} vs book ${m.area.shape} ${m.area.feet}`);
  if (m.area && !r.area && !r.burst && !r.manual && (r.save || r.damage.length)) out.push(`no area vs book ${m.area.shape} ${m.area.feet}`);
  return out;
}

export async function audit(s: SpellDef): Promise<string> {
  const read = readSpell(s);
  const sm = read.summon;
  if (sm) return `summon: ${'creature' in sm ? sm.creature : 'forms' in sm ? sm.forms.join(', ') : sm.options.map((x) => `${x.count}×CR${x.cr} ${x.type ?? ''}`).join(' / ')}${'times' in sm && sm.times ? ` (×${sm.times.map((t) => `${t.x} at ${t.slot}`).join(', ')})` : ''}`;
  if (read.rider) return `ok: rider, ${read.rider.dice} ${read.rider.type || 'weapon'}${read.rider.once ? ' on the next hit' : ''}`;
  const a: TurnAction = { id: 's', name: s.name, cost: 'action', group: 'spell', spell: { id: s.id, level: s.level, concentration: s.concentration }, cast: { read, attack: 5, dc: 13, charLevel: 5, mod: 3 } };
  const plan = aimPlan(a);
  // a buff must be aimed at allies (helps); a debuff by its save (Bane, Faerie Fire); Haste marks its own target (final review: Holy Aura)
  if (SPELL_EFFECTS[s.name]) return plan?.helps || (DEBUFFS.has(s.name) && read.save) || s.name === 'Haste' ? 'ok: effect' : 'BROKEN: a buff not aimed at allies';
  const hurts = read.damage.length > 0, conds = !!read.conditions?.length;
  if (!plan) return read.manual ? `manual: ${read.manual}` : read.heal ? 'heal: roll button' : hurts || conds ? 'BROKEN: has effects but cannot be aimed' : 'none: no automated effect';
  const scene: Scene = { id: 's1', campaignId: 'c', name: 'F', width: 2800, height: 700, grid: { ...DEFAULT_GRID }, shown: true, updatedAt: 0, tokens: [
    { id: 't-c', name: 'Caster', ...cell(5), size: 'M', color: '#000000', combatantId: 'c' }, { id: 't-o', name: 'Orc', ...cell(6), size: 'M', color: '#000000', combatantId: 'o' }] };
  const k: Combat = { campaignId: 'c', round: 1, turn: 'c', groupMonsters: false, updatedAt: 0, combatants: [cb({ id: 'c', kind: 'monster', name: 'Caster' }), cb({ id: 'o', kind: 'monster', name: 'Orc' })] };
  const n = plan.upTo ? 1 : plan.count ?? 1;
  const aim: WorkIn['aim'] = { ...(plan.count ? { targets: Array(n).fill('o') } : plan.area?.on === 'self' ? {} : { target: plan.helps && plan.reach === 'self' ? 'c' : 'o' }), point: cell(6),
    rolled: { ...(plan.attack && { d20: Array(2 * n).fill(15) }), dmg: Array.from({ length: n }, () => plan.dice.map((d) => maxFaces(d.expr))).flat() }, toggles: [], ...(plan.choices && { dtype: plan.choices[0] }) };
  const r = await workOut({ a, features: [], actor: k.combatants[0], combat: k, scene, diagonal: '5-5-5', aim, findTarget: (id) => k.combatants.find((z) => z.id === id),
    info: (z) => ({ ...targetOf(z, {}), ac: 10 }), nameOf: (z) => z.name, magical: false, id: 'r', now: 0, rng: () => 0.01 });
  if (typeof r === 'string') return read.manual ? `manual: ${read.manual}` : `BROKEN: ${r}`;
  const o = r.resolution.outcomes, dealt = o.reduce((t, x) => t + (x.damage ?? 0), 0), inflicted = o.some((x) => x.inflict?.length);
  const healed = o.reduce((t, x) => t + (x.heal ?? 0) + (x.temp ?? 0), 0);
  if (r.resolution.linger) return `ok: placed, ${r.resolution.linger.dice.map((d) => d.expr + ' ' + d.type).join(' + ')} as a turn starts there${read.manual ? ` (${read.manual})` : ''}`;
  const bits = [`${plan.dice.map((d) => `${d.expr} ${d.type}`).join(' + ') || 'no dice'}`, `dealt ${dealt}`, ...(healed ? [`healed ${healed >= 1e6 ? 'all' : healed}`] : []), ...(inflicted ? [`inflicts ${[...new Set(o.flatMap((x) => x.inflict ?? []))].join(', ')}`] : []),
    ...(read.save ? [`${read.save} save, ${read.onSave} on success`] : []), ...(read.manual ? [`note: ${read.manual}`] : [])];
  if (read.manual && !dealt && !inflicted && !healed) return `manual: ${read.manual}`;
  if (hurts && !dealt) return `BROKEN: no damage dealt (${bits.join('; ')})`;
  if (conds && !inflicted) return `BROKEN: conditions not inflicted (${bits.join('; ')})`;
  return `ok: ${bits.join('; ')}`;
}

test.skipIf(!dir)('spell audit', async () => {
  const ctx = { spellClasses: () => [], listed: () => true } as never, out: string[] = [];
  const books: [string, SpellDef[]][] = [['SRD', (srd as { entities: SpellDef[] }).entities.filter((e) => e.kind === 'spell')]];
  for (const f of ['phb', 'xge', 'tce']) books.push([f.toUpperCase(), JSON.parse(readFileSync(join(dir!, `spells-${f}.json`), 'utf8')).spell.map((r: { name: string }) => spell(r as never, ctx, r.name, r.name))]);
  const dis: string[] = [];
  // the SRD has no book tags: its read is held to its PHB twin's, field by field (the same spell, other wording)
  const phb = new Map(books[1][1].map((s) => [s.name.toLowerCase(), readSpell(s)]));
  const key = (r: ReturnType<typeof readSpell>) => ({ attack: r.attack, save: r.save, onSave: r.onSave, dice: r.damage.map((d) => d.dice).join('+'),
    area: r.area && `${r.area.shape} ${r.area.feet}`, burst: r.burst, conditions: r.conditions?.join('/'), heal: r.heal?.dice, perSlot: r.perSlot?.dice, lingering: r.lingering, rounds: r.rounds });
  for (const s of books[0][1]) {
    const twin = phb.get(s.name.toLowerCase());
    if (!twin) continue;
    const a = key(readSpell(s)), b = key(twin);
    for (const f of Object.keys(a) as (keyof typeof a)[]) if (String(a[f]) !== String(b[f]) && !RULED.has(`${s.name} ${f}`)) dis.push(`DISAGREE\tSRD\t${s.name}\t${f} ${a[f] ?? '-'} vs PHB ${b[f] ?? '-'}`);
  }
  for (const [book, list] of books) for (const s of list) {
    out.push(`${book}\tL${s.level}\t${s.name}\t${await audit(s)}`);
    for (const d of disagree(s)) if (!RULED.has(`${s.name} ${d.split(" vs ")[0]}`)) dis.push(`DISAGREE\t${book}\t${s.name}\t${d}`);
  }
  writeFileSync(process.env.AUDIT_OUT ?? 'spell-audit.tsv', [...out, ...dis].join('\n'));
  const count = (p: string) => out.filter((l) => l.split('\t')[3].startsWith(p)).length;
  console.log(`spells ${out.length} · disagree ${dis.length} · ok ${count('ok')} · heal ${count('heal')} · manual ${count('manual')} · none ${count('none')} · BROKEN ${count('BROKEN')}`);
});
