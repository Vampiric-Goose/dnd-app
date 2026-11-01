// End-to-end encryption for the relay: AES-GCM with a key stretched from the join code (PBKDF2, salted with the room id). The relay
// server forwards only these sealed strings and never sees the code, so it cannot read or forge messages.

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(Array.from(u, (c) => String.fromCharCode(c)).join(''));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Seal { seal(text: string): Promise<string>; open(sealed: string): Promise<string> }

/** The cipher for one room. ponytail: 200k PBKDF2 rounds make guessing a 12-character code offline slow; raise it if codes get shorter. */
export async function sealFor(code: string, room: string): Promise<Seal> {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode(`dnd-app relay ${room}`), iterations: 200_000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return {
    async seal(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv);
      out.set(ct, 12);
      return b64(out);
    },
    async open(sealed) {
      const all = unb64(sealed);
      return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12)));
    },
  };
}
