/** The size that fits inside a `maxSide` square, keeping the aspect ratio. Never upscales. */
export function fitWithin(w: number, h: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Shrinks an image to fit `maxSide` and re-encodes it (browser only: needs a canvas). Browsers that can't encode `type` fall back to PNG. */
export async function resizeImage(file: Blob, maxSide: number, type = 'image/webp', quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const { w, h } = fitWithin(bmp.width, bmp.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality));
}

/**
 * The largest side this device decodes a map image to: a desktop 8192; a phone or tablet by its memory (Chrome reports it), else 4096
 * (iOS reports none, and its canvases stop at 4096²). The scene keeps its size: a smaller bitmap is drawn stretched to it.
 */
export function deviceSide(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (navigator.maxTouchPoints === 0) return 8192;
  return mem === undefined ? 4096 : mem >= 8 ? 8192 : mem >= 4 ? 4096 : 2048;
}

/** An image decoded to fit `side` (`w` × `h` its full size); browsers that ignore the resize options decode it whole. */
export function decodeWithin(blob: Blob, w: number, h: number, side: number): Promise<ImageBitmap> {
  if (Math.max(w, h) <= side) return createImageBitmap(blob);
  const fit = fitWithin(w, h, side);
  return createImageBitmap(blob, { resizeWidth: fit.w, resizeHeight: fit.h, resizeQuality: 'high' });
}
