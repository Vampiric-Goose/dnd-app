import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/dnd-app/',
  plugins: [svelte()],
  test: { environment: 'node', exclude: ['**/node_modules/**', '.claude/**'] },
});
