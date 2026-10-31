// Pure (no Svelte/Vite/DOM): the shape check shared by backup/JSON import and PDF import.

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
