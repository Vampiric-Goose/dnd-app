// Hands a file to the browser as a download. Plain DOM, no Svelte.

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i; // Windows device names

/** `name.ext` safe on Windows: invalid characters and trailing dots or spaces removed, `fallback` when nothing is left. */
export function fileName(name: string, ext: string, fallback = 'character'): string {
  const base = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 100).replace(/[. ]+$/, '');
  const device = RESERVED.test(base.split('.')[0].trim()); // Windows treats "con.foo" as the device CON too
  return `${!base || device ? fallback : base}.${ext}`;
}

export function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000); // revoked once the click has had time to start the download
}

export const downloadPdf = (bytes: Uint8Array, name: string) => download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);
