// Pure. Bytes to and from base64 (backups, and stage 5's blob transfer).

export function toBase64(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); // chunked: spread has an argument limit
  return btoa(s);
}

/** Throws on invalid base64. */
export const fromBase64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
