import { defineConfig } from 'vitest/config';

// Catalog checks use node:test and run separately (see package.json "test").
export default defineConfig({
  test: { include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'api/**/*.test.ts'], environment: 'node' },
});
