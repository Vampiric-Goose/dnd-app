/** The size that fits inside a `maxSide` square, keeping the aspect ratio. Never upscales. */
export function fitWithin(w: number, h: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
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
