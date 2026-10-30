export type DiceTerm =
  | { count: number; sides: number; sign: 1 | -1; keep?: { highest: boolean; n: number } }
  | { const: number; sign: 1 | -1 };

// One signed term: NdM, dM, NdMkhX, NdMklX, NdMdlX, or a constant. Digit caps keep a typo from hanging the tab.
const TERM = /^([+-]?)(?:(\d{0,3})d(\d{1,4})(?:(kh|kl|dl)(\d{1,3}))?|(\d{1,9}))$/;

export function parseDice(expr: string): DiceTerm[] {
  const bad = () => new Error('Bad dice: ' + expr);
  // Whitespace survives only away from signs, so '1d20 5' fails TERM. Split before each sign so every term after the first carries one; '2d6++3' leaves a bare '+' that fails TERM.
  return expr.trim().toLowerCase().replace(/\s*([+-])\s*/g, '$1').split(/(?=[+-])/).map((part): DiceTerm => {
    const m = TERM.exec(part);
    if (!m) throw bad();
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) return { const: Number(m[6]), sign };
    const count = m[2] === '' ? 1 : Number(m[2]);
    const sides = Number(m[3]);
    if (count < 1 || sides < 1) throw bad();
    if (!m[4]) return { count, sides, sign };
    const x = Number(m[5]);
    const n = m[4] === 'dl' ? count - x : x; // dlX keeps the highest N-X
    if (x < 1 || n < 1 || n > count) throw bad();
    return { count, sides, sign, keep: { highest: m[4] !== 'kl', n } };
  });
}

export function rollDice(expr: string, opts: { rng?: () => number; advantage?: 'adv' | 'dis'; crit?: boolean } = {}): { total: number; detail: string } {
  const rng = opts.rng ?? Math.random;
  const terms = parseDice(expr);
  if (opts.advantage) {
    const i = terms.findIndex((t) => 'sides' in t && t.count === 1 && t.sides === 20);
    if (i >= 0) terms[i] = { count: 2, sides: 20, sign: terms[i].sign, keep: { highest: opts.advantage === 'adv', n: 1 } };
  }
  let total = 0;
  const detail = terms.map((t, i) => {
    const lead = i === 0 ? (t.sign < 0 ? '-' : '') : t.sign < 0 ? ' - ' : ' + ';
    if ('const' in t) { total += t.sign * t.const; return lead + t.const; }
    const count = opts.crit ? t.count * 2 : t.count; // ponytail: crit doubles only the count; a keep term (never a crit in 5e) keeps its n
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(rng() * t.sides));
    const kept = t.keep ? [...rolls].sort((a, b) => (t.keep!.highest ? b - a : a - b)).slice(0, t.keep.n) : rolls;
    total += t.sign * kept.reduce((a, b) => a + b, 0);
    return `${lead}${count}d${t.sides}${t.keep ? (t.keep.highest ? 'kh' : 'kl') + t.keep.n : ''} (${rolls.join(', ')})`;
  }).join('');
  return { total, detail };
}
