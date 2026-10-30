// 5etools `_copy` / `_mod` resolution.
import { arr, fail, mapStrings, type Raw } from './common.ts';

export type Lookup = (key: string) => Promise<Raw | undefined>;
export const rawKey = (kind: string, name: string, source: string) => `${kind}|${String(name).toLowerCase()}|${String(source).toUpperCase()}`;

// Not inherited by a copy unless `_preserve` names them (as 5etools does): a copy is a different entity.
const UNCOPIED = ['srd', 'srd52', 'basicRules', 'basicRules2024', 'reprintedAs', 'otherSources', 'additionalSources', 'page', 'hasFluff', 'hasFluffImages', '_versions'];
const SKIP_TXT = new Set(['name', 'type', 'source']);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

const matches = (rep: Raw, el: Raw, i: number): boolean =>
  typeof rep === 'string' ? el === rep || el?.name === rep
  : typeof rep?.index === 'number' ? i === rep.index
  : rep?.regex !== undefined ? new RegExp(rep.regex, rep.flags).test(typeof el === 'string' ? el : el?.name ?? '')
  : false;

// Own properties only: an inherited member (`toString`, `valueOf`) is a shared builtin, never something to read or descend into.
const own = (o: Raw, k: string): Raw => (Object.hasOwn(o, k) ? o[k] : undefined);
/** `o[k]` when it is an own object, else a fresh object stored there (a non-object own value is replaced). */
const child = (o: Raw, k: string): Raw => {
  const v = own(o, k);
  return v !== null && typeof v === 'object' ? v : (o[k] = {});
};

const replaceTxt = (x: Raw, re: RegExp, by: string): Raw => mapStrings(x, s => s.replace(re, by), SKIP_TXT);

/** Applies one `_mod` entry to `root[path]` (a dotted path such as `inherits.entries`; `_` = root itself, `*` = every property for replaceTxt). */
function applyMod(root: Raw, path: string, m: Raw, warn: (msg: string) => void): void {
  const parts = path === '_' || path === '*' ? [path] : path.split('.');
  // Homebrew files are untrusted: a `__proto__`/`constructor`/`prototype` segment would walk into Object.prototype.
  const bad = [...parts, ...(m?.prop !== undefined ? String(m.prop).split('.') : [])].find(k => UNSAFE.has(k));
  if (bad !== undefined) { warn(`_mod path "${path}${m?.prop ? ` / ${m.prop}` : ''}" uses "${bad}"; skipped`); return; }
  const obj = parts.slice(0, -1).reduce(child, root), prop = parts[parts.length - 1];
  if (m === 'remove') { if (Object.hasOwn(obj, prop)) delete obj[prop]; return; }
  const items = () => structuredClone(arr(m.items));
  const list = (): Raw[] => arr(own(obj, prop));
  switch (m.mode) {
    case 'appendArr': obj[prop] = [...list(), ...items()]; break;
    case 'appendIfNotExistsArr': {
      const have = new Set(list().map(x => JSON.stringify(x)));
      obj[prop] = [...list(), ...items().filter(x => !have.has(JSON.stringify(x)))];
      break;
    }
    case 'prependArr': obj[prop] = [...items(), ...list()]; break;
    case 'insertArr': { const l = list(); l.splice(m.index ?? l.length, 0, ...items()); obj[prop] = l; break; }
    case 'replaceArr': {
      const l = list(), i = l.findIndex((el, n) => matches(m.replace, el, n));
      if (i < 0) { warn(`replaceArr: "${JSON.stringify(m.replace)}" not found in ${prop}`); break; }
      l.splice(i, 1, ...items());
      obj[prop] = l;
      break;
    }
    case 'removeArr': {
      const names = arr(m.names), drop = arr(m.items).map(x => JSON.stringify(x));
      obj[prop] = list().filter(el => !names.some(n => el === n || el?.name === n) && !drop.includes(JSON.stringify(el)));
      break;
    }
    case 'replaceTxt': {
      const re = new RegExp(m.replace, m.flags ?? 'g');
      if (prop === '*') for (const k of Object.keys(obj)) { if (!SKIP_TXT.has(k)) obj[k] = replaceTxt(own(obj, k), re, m.with ?? ''); }
      else if (Object.hasOwn(obj, prop)) obj[prop] = replaceTxt(obj[prop], re, m.with ?? '');
      break;
    }
    case 'setProp': {
      if (m.prop === undefined) { obj[prop] = structuredClone(m.value); break; } // `"inherits.namePrefix": { mode: 'setProp', value }`
      let at = prop === '_' ? obj : child(obj, prop);
      const path = String(m.prop).split('.');
      for (const k of path.slice(0, -1)) at = child(at, k);
      at[path[path.length - 1]] = structuredClone(m.value);
      break;
    }
    default: warn(`unsupported _mod mode "${m?.mode}" on ${prop} skipped`);
  }
}

/** The entity with its `_copy` chain resolved (batch first, then stored raw entities, both through `lookup`). */
export async function resolveCopy(kind: string, e: Raw, lookup: Lookup, warn: (msg: string) => void, depth = 0): Promise<Raw> {
  if (!e?._copy) return e;
  if (depth > 20) fail('_copy chain too deep');
  const c = e._copy;
  const src = (await lookup(rawKey(kind, c.name, c.source))) ?? fail(`_copy source "${c.name}" (${c.source}) not found`);
  const parent = structuredClone(await resolveCopy(kind, src, lookup, warn, depth + 1));
  for (const k of UNCOPIED) if (!c._preserve?.[k]) delete parent[k];
  const { _copy, ...own } = e;
  const out = { ...parent, ...structuredClone(own) };
  for (const [prop, mods] of Object.entries(c._mod ?? {})) for (const m of arr(mods)) applyMod(out, prop, m, warn);
  return out;
}
