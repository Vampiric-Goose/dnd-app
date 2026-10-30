// Writes the app icons into public/: node scripts/make-icons.ts
// A d20 silhouette (hexagon with an inner triangle) in the accent color on the dark background,
// drawn with 4x4 supersampling and encoded as PNG by hand (node:zlib supplies deflate and CRC).
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

type Point = [number, number];
type Rgb = [number, number, number];

const BG: Rgb = [0x14, 0x16, 0x1c]; // dark --bg in src/app.css
const ACCENT: Rgb = [0xe3, 0xb0, 0x4b]; // dark --accent in src/app.css
const SS = 4;

// Regular polygon in the unit square, first vertex at the top.
function polygon(sides: number, radius: number, cy = 0.5): Point[] {
  return Array.from({ length: sides }, (_, k) => {
    const a = ((-90 + (360 * k) / sides) * Math.PI) / 180;
    return [0.5 + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
}

// Convex test; every polygon here winds the same way.
const inside = (poly: Point[], x: number, y: number) =>
  poly.every(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
  });

const hex = polygon(6, 0.44);
// A triangle's bounding box is centered on its centroid shifted down by radius / 4.
const triCy = 0.5 + 0.31 / 4;
const triOuter = polygon(3, 0.31, triCy);
const triInner = polygon(3, 0.31 * 0.78, triCy);

const colorAt = (x: number, y: number): Rgb =>
  inside(hex, x, y) && !(inside(triOuter, x, y) && !inside(triInner, x, y)) ? ACCENT : BG;

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size: number): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 3)); // per row: filter byte 0, then RGB
  for (let py = 0; py < size; py++) {
    const row = py * (1 + size * 3);
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      for (let i = 0; i < 3; i++) raw[row + 1 + px * 3 + i] = Math.round(sum[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
] as const) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size));
  console.log(`public/${name} (${size}x${size})`);
}
