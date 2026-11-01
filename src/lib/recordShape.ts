// Pure (no Svelte/Vite/DOM): the shape check shared by backup/JSON import and PDF import.
import { effectOk } from './character/customEffect.ts';
import { soundItem } from './items/homebrew.ts'; // homebrew imports isRec from here: a cycle, safe because both sides only call at run time
import type { ItemDef } from './types.ts';

export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

// What storage and the app rely on, nothing deeper: a file passing this can still hold bad values.
export type Shape = { objs?: string[]; arrs?: string[]; kind?: string };
export const SHAPES = {
  campaign: { objs: ['settings'], arrs: ['enabledPacks', 'loot'] },
  character: { objs: ['build', 'state'], arrs: ['inventory'] },
  item: { kind: 'item' },
  monster: { kind: 'monster' },
  pack: { arrs: ['entities', 'patches'] },
} satisfies Record<string, Shape>;

/** What is wrong with a record read from a file, or undefined when it has the expected shape. */
export function problem(r: unknown, { objs = [], arrs = [], kind }: Shape): string | undefined {
  if (!isRec(r)) return 'is not an object';
  if (typeof r.id !== 'string') return 'has no id';
  for (const k of objs) if (!isRec(r[k])) return `has no ${k}`;
  for (const k of arrs) if (!Array.isArray(r[k])) return `has no ${k} list`;
  if (kind && r.kind !== kind) return `is not an ${kind}`;
}

/** Inventory or loot entries: each holds a sound item and a numeric quantity. */
const entriesProblem = (list: unknown[], what: string): string | undefined => {
  const i = list.findIndex((e) => !isRec(e) || !soundItem(e.item as ItemDef) || typeof e.quantity !== 'number' || !Number.isFinite(e.quantity));
  return i < 0 ? undefined : `has a damaged ${what} entry (${i + 1})`;
};

// An HLC (`wall:counter:node`), an inventory position (`<hlc>/NNNNNN`), or the position of an unstamped entry (`/NNNNNN`).
const CLOCK = /^(\d{15}:\d{6}:[A-Za-z0-9_-]{1,16})?(\/\d{6})?$/;
const MAX_CLOCKS = 5000;
const DAY = 86_400_000;
/** I2: every value a well-formed clock whose wall time is at most a day ahead, and no more than MAX_CLOCKS of them. */
const clocks = (v: unknown, latest: number) => isRec(v) && Object.keys(v).length <= MAX_CLOCKS
  && Object.values(v).every((x) => typeof x === 'string' && x !== '' && CLOCK.test(x) && (x[0] === '/' || Number(x.slice(0, 15)) <= latest));
/** Stage 3: a character's optional sync meta, `{ clock: Record<string, string>, gone: Record<string, string> }`. */
const syncOk = (s: unknown) => { const latest = Date.now() + DAY; return isRec(s) && clocks(s.clock, latest) && clocks(s.gone, latest); };

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
/** N3: the per-key state maps the merge splits: slotsUsed a list of at most 20 numbers, the other two records of at most 200 numbers. */
const counts = (v: unknown) => isRec(v) && Object.keys(v).length <= 200 && Object.values(v).every(finite);
const stateProblem = (s: Rec): string | undefined =>
  !Array.isArray(s.slotsUsed) || s.slotsUsed.length > 20 || !s.slotsUsed.every(finite) ? 'has damaged state.slotsUsed'
    : !counts(s.resourcesUsed) ? 'has damaged state.resourcesUsed' : !counts(s.hitDiceUsed) ? 'has damaged state.hitDiceUsed' : undefined;

/** I2: a character deep enough that the sheet, the lists and the creator can read it without throwing. */
export function characterProblem(r: unknown): string | undefined {
  const shallow = problem(r, SHAPES.character);
  if (shallow) return shallow;
  const c = r as Rec, b = c.build as Rec;
  if (typeof c.name !== 'string') return 'has no name';
  if (!Array.isArray(b.levels)) return 'has no build.levels list';
  for (const k of ['subclasses', 'choices', 'spells', 'baseScores']) if (!isRec(b[k])) return `has no build.${k}`;
  for (const k of ['embedded', 'overrides', 'currency', 'details']) if (!isRec(c[k])) return `has no ${k}`;
  if (!Array.isArray(c.customEffects)) return 'has no customEffects list';
  const bad = c.customEffects.findIndex((e) => !effectOk(e));
  if (bad >= 0) return `has a damaged custom effect (${bad + 1})`;
  if (c.sync !== undefined && !syncOk(c.sync)) return 'has damaged sync clocks';
  const why = stateProblem(c.state as Rec);
  if (why) return why;
  return entriesProblem(c.inventory as unknown[], 'inventory');
}

/** R60/4: only what the Characters list itself reads (name, build.levels, embedded). The full characterProblem stays on import. */
export function characterListProblem(r: unknown): string | undefined {
  const shallow = problem(r, SHAPES.character);
  if (shallow) return shallow;
  const c = r as Rec;
  if (typeof c.name !== 'string') return 'has no name';
  if (!Array.isArray((c.build as Rec).levels)) return 'has no build.levels list';
  if (!isRec(c.embedded)) return 'has no embedded';
}

/** Stage 4: a prepared encounter: string ids and name, at most 50 lines of `{ monsterId: string, name?: string, count: integer 1–99 }`. */
export function encounterProblem(r: unknown): string | undefined {
  if (!isRec(r) || typeof r.id !== 'string' || typeof r.campaignId !== 'string' || typeof r.name !== 'string') return 'is incomplete';
  if (!Array.isArray(r.monsters) || r.monsters.length > 50) return 'has a damaged monster list';
  const i = r.monsters.findIndex((l) => !isRec(l) || typeof l.monsterId !== 'string' || (l.name !== undefined && typeof l.name !== 'string') || !Number.isInteger(l.count) || (l.count as number) < 1 || (l.count as number) > 99);
  return i < 0 ? undefined : `has a damaged monster line (${i + 1})`;
}

const SIZES = ['T', 'S', 'M', 'L', 'H', 'G'];
const between = (v: unknown, lo: number, hi: number) => finite(v) && (v as number) >= lo && (v as number) <= hi;
/** Stage 5: a battle map scene: its sides, grid and tokens within what the map page and the players' view rely on. */
export function sceneProblem(r: unknown): string | undefined {
  if (!isRec(r) || typeof r.id !== 'string' || typeof r.campaignId !== 'string' || typeof r.name !== 'string') return 'is incomplete';
  for (const k of ['width', 'height']) if (!Number.isInteger(r[k]) || !between(r[k], 1, 4096)) return `has a bad ${k}`;
  const g = r.grid;
  if (!isRec(g) || !['square', 'hex-flat', 'hex-pointy'].includes(g.type as string) || !between(g.size, 10, 500) || !finite(g.offsetX) || !finite(g.offsetY)
    || typeof g.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(g.color) || !between(g.opacity, 0, 1) || !between(g.feet, 1, 100)) return 'has a damaged grid';
  if (!Array.isArray(r.tokens) || r.tokens.length > 200) return 'has a damaged token list';
  const i = r.tokens.findIndex((t) => !isRec(t) || typeof t.id !== 'string' || typeof t.name !== 'string' || !finite(t.x) || !finite(t.y)
    || !SIZES.includes(t.size as string) || typeof t.color !== 'string');
  if (i >= 0) return `has a damaged token (${i + 1})`;
  if (r.fog !== undefined && typeof r.fog !== 'string') return 'has damaged fog';
}

/** A campaign, with its loot entries checked like a character's inventory. */
export const campaignProblem = (r: unknown): string | undefined => problem(r, SHAPES.campaign) ?? entriesProblem((r as Rec).loot as unknown[], 'loot');
