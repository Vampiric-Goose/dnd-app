import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: '/dnd-app/',
  plugins: [svelte()],
  // ponytail: CI runners are slow and loaded; longer timeout and 2 retries there only. Flaky session tests are a ledger leftover.
  test: { environment: 'node', exclude: ['**/node_modules/**', '.claude/**'], ...(process.env.CI && { testTimeout: 30_000, retry: 2 }) },
});
