// Pure (no Svelte/Vite/DOM): the standard PDF fonts only draw WinAnsi (Windows-1252).

// The Windows-1252 characters above U+00A0's range that are not Latin-1 (0x80 to 0x9F in the code page).
const EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((ch) => ch.codePointAt(0)));

/** `s` with every character the font cannot draw replaced by one '?' (per code point, so an emoji is one '?'). Newlines stay; tabs become spaces. */
export function toWinAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const n = ch.codePointAt(0)!;
    if (ch === '\n') out += ch;
    else if (ch === '\r') continue;
    else if (ch === '\t') out += ' ';
    else out += (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || EXTRA.has(n) ? ch : '?';
  }
  return out;
}
