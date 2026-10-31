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
  return entriesProblem(c.inventory as unknown[], 'inventory');
}

/** A campaign, with its loot entries checked like a character's inventory. */
export const campaignProblem = (r: unknown): string | undefined => problem(r, SHAPES.campaign) ?? entriesProblem((r as Rec).loot as unknown[], 'loot');
