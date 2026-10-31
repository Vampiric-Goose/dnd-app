// 5etools `_copy` / `_mod` resolution, including the bestiary's `_templates` and its creature modes (skills, senses, spells, scaling).
import { slug } from '../../content/ids.ts';
import { abilityMod, SKILL_ABILITY } from '../../rules/constants.ts';
import { crProf, crXp, okXp } from '../../rules/monsters.ts';
import { arr, fail, mapStrings, type Raw } from './common.ts';

export type Lookup = (key: string) => Promise<Raw | undefined>;
export const rawKey = (kind: string, name: string, source: string) => `${kind}|${String(name).toLowerCase()}|${String(source).toUpperCase()}`;

// Not inherited by a copy unless `_preserve` names them (as 5etools does): a copy is a different entity.
const UNCOPIED = ['srd', 'srd52', 'basicRules', 'basicRules2024', 'reprintedAs', 'otherSources', 'additionalSources', 'page', 'hasFluff', 'hasFluffImages', '_versions'];
const SKIP_TXT = new Set(['name', 'type', 'source']);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const SIZES = ['T', 'S', 'M', 'L', 'H', 'G'];
/** Spell groups keyed by uses (`daily: { '1e': [...] }`), and the plain lists. */
const PER = ['daily', 'rest', 'restLong', 'recharge', 'weekly', 'monthly', 'yearly', 'legendary', 'charges'];
const FLAT = ['constant', 'will', 'ritual'];

const matches = (rep: Raw, el: Raw, i: number): boolean =>
  typeof rep === 'string' ? el === rep || el?.name === rep
  : typeof rep?.index === 'number' ? i === rep.index
  : rep?.regex !== undefined ? new RegExp(rep.regex, rep.flags).test(typeof el === 'string' ? el : el?.name ?? '')
  : false;

const isObj = (o: Raw): boolean => o !== null && typeof o === 'object' && !Array.isArray(o);
// Own properties only: an inherited member (`toString`, `valueOf`) is a shared builtin, never something to read or descend into.
const own = (o: Raw, k: string): Raw => (o !== null && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined);
/** `o[k]` when it is an own object, else a fresh object stored there (a non-object own value is replaced). */
const child = (o: Raw, k: string): Raw => {
  const v = own(o, k);
  return v !== null && typeof v === 'object' ? v : (o[k] = {});
};
/** Keys from a file are untrusted: `o.__proto__ = x` would replace an object's prototype. */
const put = (o: Raw, k: string, v: Raw) => { if (!UNSAFE.has(k)) o[k] = v; };
const entries = (o: Raw): [string, Raw][] => (isObj(o) ? Object.entries(o).filter(([k]) => !UNSAFE.has(k)) : []);
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const sortLower = (l: Raw[]) => l.sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const replaceTxt = (x: Raw, re: RegExp, by: string): Raw => mapStrings(x, s => s.replace(re, by), SKIP_TXT);

/**
 * Applies `f` to every spell list of the creature's first spellcasting entry (as 5etools does) that the spell mod `m` names:
 * `spells[level].spells`, `will`/`constant`/`ritual`, and `daily['1e']`-style groups. `f` gets the current list and the mod's part.
 */
function spellLists(root: Raw, m: Raw, f: (list: Raw[], arg: Raw) => Raw[], warn: (msg: string) => void): Raw | undefined {
  const sc = arr(own(root, 'spellcasting'))[0];
  if (!isObj(sc)) { warn(`${m.mode}: the creature has no spellcasting; skipped`); return undefined; }
  for (const [lvl, arg] of entries(m.spells)) { const at = child(child(sc, 'spells'), lvl); at.spells = f(arr(own(at, 'spells')), arg); }
  for (const p of FLAT) if (m[p] !== undefined) sc[p] = f(arr(own(sc, p)), m[p]);
  for (const p of PER) for (const [k, arg] of entries(m[p])) { const at = child(sc, p); put(at, k, f(arr(own(at, k)), arg)); }
  return sc;
}

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
    // ---- creature modes (5etools applies these to the creature itself, whatever the path) ----
    case 'addSkills': { // 1 = proficient, 2 = expertise; an existing higher bonus is kept
      const skill = child(root, 'skill'), pb = crProf(String(own(own(root, 'cr'), 'cr') ?? own(root, 'cr'))) ?? 2;
      for (const [name, times] of entries(m.skills)) {
        const s = slug(name);
        if (!Object.hasOwn(SKILL_ABILITY, s) || typeof times !== 'number') { warn(`addSkills: unknown skill "${name}" skipped`); continue; }
        const total = times * pb + abilityMod(Number(own(root, SKILL_ABILITY[s as keyof typeof SKILL_ABILITY])) || 10);
        if (!(parseInt(own(skill, name)) >= total)) put(skill, name, signed(total));
      }
      break;
    }
    case 'addSenses': { // a sense the creature already has is only ever lengthened
      const senses = [...arr(own(root, 'senses'))];
      for (const s of arr(m.senses)) {
        if (typeof s?.type !== 'string' || typeof s.range !== 'number') continue;
        const re = new RegExp(`${escapeRe(s.type)} (\\d+)`, 'i'), i = senses.findIndex(x => re.test(String(x)));
        if (i < 0) senses.push(`${s.type} ${s.range} ft.`);
        else if (+re.exec(String(senses[i]))![1] < s.range) senses[i] = `${s.type} ${s.range} ft.`;
      }
      root.senses = senses;
      break;
    }
    case 'addSpells': {
      const sc = spellLists(root, m, (l, a) => sortLower([...l, ...arr(Array.isArray(a) ? a : a?.spells)]), warn);
      if (sc) for (const [lvl, a] of entries(m.spells)) for (const [k, v] of entries(a)) if (k !== 'spells') put(child(sc, 'spells')[lvl], k, v); // slots, lower
      break;
    }
    case 'replaceSpells':
      spellLists(root, m, (l, reps) => {
        const out = [...l];
        for (const r of arr(reps)) {
          const i = out.indexOf(r?.replace);
          if (i < 0) warn(`replaceSpells: "${r?.replace}" not found`);
          else out.splice(i, 1, ...arr(r.with));
        }
        return sortLower(out);
      }, warn);
      break;
    case 'removeSpells': spellLists(root, m, (l, names) => l.filter(s => !arr(names).includes(s)), warn); break;
    case 'maxSize': {
      const max = SIZES.indexOf(m.max), cur = arr(own(root, 'size')).map(s => SIZES.indexOf(s)).sort((a, b) => a - b);
      if (max < 0 || cur.some(i => i < 0)) { warn(`maxSize: unknown size`); break; }
      const keep = cur.filter(i => i <= max);
      root.size = (keep.length ? keep : [max]).map(i => SIZES[i]);
      break;
    }
    case 'scalarAddProp': case 'scalarMultProp': { // `save: { prop: '*', scalar: -2 }`; '+4' strings stay strings
      const at = own(obj, prop);
      if (!isObj(at) || typeof m.scalar !== 'number') break;
      for (const k of m.prop === '*' ? Object.keys(at) : [String(m.prop)]) {
        let n = m.mode === 'scalarAddProp' ? Number(own(at, k)) + m.scalar : Number(own(at, k)) * m.scalar;
        if (m.floor) n = Math.floor(n);
        if (Number.isFinite(n)) put(at, k, typeof at[k] === 'string' ? signed(n) : n);
      }
      break;
    }
    case 'scalarAddHit': case 'scalarAddDc': {
      if (!Object.hasOwn(obj, prop) || typeof m.scalar !== 'number') break;
      obj[prop] = mapStrings(obj[prop], s => (m.mode === 'scalarAddHit'
        ? s.replace(/\{@hit ([-+]?\d+)\}/g, (_, n) => `{@hit ${+n + m.scalar}}`)
        : s.replace(/\{@dc (\d+)(?:\|[^}]+)?\}/g, (_, n) => `{@dc ${+n + m.scalar}}`)));
      break;
    }
    case 'scalarMultXp': { // XP is the CR's unless the record carries its own (`cr: { cr, xp }`)
      if (!(Number.isFinite(m.scalar) && m.scalar >= 0)) { warn(`scalarMultXp: scalar ${m.scalar} is not a finite number >= 0; skipped`); break; }
      const c = isObj(own(root, 'cr')) ? root.cr : (root.cr = { cr: own(root, 'cr') });
      const xp = (okXp(c.xp) ? c.xp : crXp(String(c.cr)) ?? 0) * m.scalar;
      const v = m.floor ? Math.floor(xp) : Math.round(xp);
      if (okXp(v)) c.xp = v; else warn(`scalarMultXp: XP ${v} out of range; skipped`);
      break;
    }
    case 'prefixSuffixStringProp': {
      const at = own(obj, prop), k = String(m.prop);
      if (typeof own(at, k) === 'string') at[k] = `${m.prefix ?? ''}${at[k]}${m.suffix ?? ''}`;
      break;
    }
    default: warn(`unsupported _mod mode "${m?.mode}" on ${prop} skipped`);
  }
}

export interface CopyOptions {
  /** Builds the lookup key from the `_copy` object (class-family records key on their parent class too). */
  keyOf?: (kind: string, c: Raw) => string;
  /** The resolved `monsterTemplate` a `_copy._templates` entry names, or undefined to leave it out (the caller warns why). */
  template?: (ref: Raw) => Promise<Raw | undefined>;
}

/**
 * The entity with its `_copy` chain resolved (batch first, then stored raw entities, both through `lookup`).
 * `_copy._templates` apply after the copy's own fields: each template's `apply._root` fills fields the record doesn't set itself,
 * then the copy's `_mod`, then each template's `apply._mod`.
 */
export async function resolveCopy(kind: string, e: Raw, lookup: Lookup, warn: (msg: string) => void, opts: CopyOptions = {}, depth = 0): Promise<Raw> {
  if (!e?._copy) return e;
  if (depth > 20) fail('_copy chain too deep');
  const c = e._copy, keyOf = opts.keyOf ?? ((k: string, x: Raw) => rawKey(k, x.name, x.source));
  const src = (await lookup(keyOf(kind, c))) ?? fail(`_copy source "${c.name}" (${c.source}) not found`);
  const parent = structuredClone(await resolveCopy(kind, src, lookup, warn, opts, depth + 1));
  for (const k of UNCOPIED) if (!c._preserve?.[k]) delete parent[k];
  const { _copy, ...mine } = e;
  const out = { ...parent, ...structuredClone(mine) };
  const applies: Raw[] = [];
  for (const ref of arr(c._templates)) { const t = await opts.template?.(ref); if (isObj(t?.apply)) applies.push(t.apply); }
  for (const a of applies) for (const [k, v] of entries(a._root)) if (!Object.hasOwn(mine, k)) out[k] = structuredClone(v);
  const mods = [c._mod, ...applies.map(a => a._mod)];
  for (const mod of mods) for (const [prop, ms] of Object.entries(isObj(mod) ? mod : {})) for (const m of arr(ms)) applyMod(out, prop, m, warn);
  return out;
}
