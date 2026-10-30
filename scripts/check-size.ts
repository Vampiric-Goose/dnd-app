// Fails the build if the JS needed on first load exceeds the gzipped budget: node scripts/check-size.ts
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET = 150 * 1024;
const BASE = '/dnd-app/'; // vite.config.ts base

const html = readFileSync('dist/index.html', 'utf8');
const tags = [
  ...html.matchAll(/<script\b[^>]*\btype="module"[^>]*>/g),
  ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*>/g),
];
const files = new Set(
  tags.flatMap((m) => {
    const url = /\b(?:src|href)="([^"]+)"/.exec(m[0])?.[1];
    return url ? [url.replace(BASE, '')] : [];
  }),
);
if (files.size === 0) {
  console.error('No module scripts found in dist/index.html. Did the build run?');
  process.exit(1);
}

let total = 0;
for (const file of files) {
  const size = gzipSync(readFileSync(`dist/${file}`), { level: 9 }).length;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${file}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  total gzipped (budget ${BUDGET / 1024} KB)`);
if (total > BUDGET) {
  console.error('Over budget.');
  process.exit(1);
}
