// Publisher signatures (the user's ruling, 11-02: "your copy wins"). A device whose imported books should take priority over a DM's copy
// signs them with a key made in its own browser: the private half can't be read out of it. A DM's device takes a signed book only when the
// signature checks against a key listed here (its public half, which is no secret) and it is newer than the last one it took.
const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const, SIG = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** The public halves (base64 SPKI) whose signed books win over a DM's copy. */
export const TRUSTED_KEYS: readonly string[] = [
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEgCjR5Sp8MbP5xm9MgHKhaKp3roCkGu0tO9DNsTsvPV4iO4URIn85Vfu9TrrFIbfGQgLLHR05HAZwyG1UaFutWA==', // the app's owner
];

const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const signed = (at: number, json: string) => new TextEncoder().encode(`${at}\n${json}`);

/** A new key pair; the private half can sign but never be exported. */
export const newKey = () => crypto.subtle.generateKey(ALG, false, ['sign', 'verify']) as Promise<CryptoKeyPair>;

/** The public half as base64 SPKI: what goes in TRUSTED_KEYS. */
export const publicText = async (k: CryptoKey) => b64(await crypto.subtle.exportKey('spki', k));

/** The signature over a book's JSON and the time it was signed at. */
export const sign = async (k: CryptoKey, at: number, json: string) => b64(await crypto.subtle.sign(SIG, k, signed(at, json)));

/** Whether one of the trusted keys signed exactly this JSON at this time. */
export async function verify(trusted: readonly string[], at: number, json: string, sig: string): Promise<boolean> {
  for (const t of trusted) {
    try {
      const k = await crypto.subtle.importKey('spki', unb64(t), ALG, false, ['verify']);
      if (await crypto.subtle.verify(SIG, k, unb64(sig), signed(at, json))) return true;
    } catch { /* not a key, or not a signature */ }
  }
  return false;
}
