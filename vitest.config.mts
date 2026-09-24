import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Only the pure scoring modules under src/lib are covered. They import
 * nothing from Tauri at runtime (bindings are type-only imports there), so
 * they run in plain Node with no webview or Rust side.
 */
export default defineConfig({
  test: {
    include: ['src/lib/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
