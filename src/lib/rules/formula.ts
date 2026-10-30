import type { Ability, Scores } from '../types.ts';
import { ABILITIES } from './constants.ts';

export interface FormulaContext {
  level: number;
  totalLevel: number;
  prof: number;
  mods: Scores;
  col?: (label: string) => number | string | undefined;
}

// number | col[Label] | mod:ability | identifier | operator. Whitespace between tokens is skipped.
const TOKEN = /\s*(?:(\d+)|col\[([^\]]*)\]|mod:(\w+)|([A-Za-z_]\w*)|([-+*/(),]))/y;

type Tok = { k: 'num'; v: number } | { k: 'col' | 'mod' | 'id' | 'op'; v: string };

/** Evaluate a resource/bonus formula. `/` is floor division. Recursive descent, no eval. */
export function evalFormula(expr: string, ctx: FormulaContext): number {
  const bad = () => new Error('Bad formula: ' + expr);

  const toks: Tok[] = [];
  let at = 0; // a failed sticky exec resets lastIndex, so track the position ourselves
  for (;;) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(expr);
    if (!m) break;
    at = TOKEN.lastIndex;
    toks.push(m[1] !== undefined ? { k: 'num', v: Number(m[1]) } : m[2] !== undefined ? { k: 'col', v: m[2] } : m[3] !== undefined ? { k: 'mod', v: m[3] } : m[4] !== undefined ? { k: 'id', v: m[4] } : { k: 'op', v: m[5] });
  }
  if (expr.slice(at).trim() !== '') throw bad(); // unlexable text left over
  let pos = 0;
  const isOp = (v: string) => toks[pos]?.k === 'op' && toks[pos].v === v;
  const eat = (v: string) => { if (!isOp(v)) throw bad(); pos++; };

  const column = (label: string): number => {
    const v = ctx.col?.(label);
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') throw bad();
    if (v.trim().toLowerCase() === 'unlimited') return Infinity;
    const n = /\d+/.exec(v);
    if (!n) throw bad();
    return Number(n[0]);
  };

  const primary = (): number => {
    const t = toks[pos++];
    if (!t) throw bad();
    switch (t.k) {
      case 'num': return t.v;
      case 'col': return column(t.v);
      case 'mod':
        if (!ABILITIES.includes(t.v as Ability)) throw bad();
        return ctx.mods[t.v as Ability];
      case 'id':
        if (t.v === 'level') return ctx.level;
        if (t.v === 'totalLevel') return ctx.totalLevel;
        if (t.v === 'prof') return ctx.prof;
        if (t.v === 'max' || t.v === 'min') {
          eat('('); const a = sum(); eat(','); const b = sum(); eat(')');
          return t.v === 'max' ? Math.max(a, b) : Math.min(a, b);
        }
        throw bad();
      case 'op':
        if (t.v !== '(') throw bad();
        { const v = sum(); eat(')'); return v; }
    }
  };
  const unary = (): number => { if (isOp('-')) { pos++; return -unary(); } return primary(); };
  const product = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/')) {
      const mul = toks[pos++].v === '*';
      const r = unary();
      if (!mul && r === 0) throw bad();
      v = mul ? v * r : Math.floor(v / r);
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (isOp('+') || isOp('-')) v += toks[pos++].v === '+' ? product() : -product();
    return v;
  };

  const result = sum();
  if (pos !== toks.length || Number.isNaN(result)) throw bad();
  return result;
}
