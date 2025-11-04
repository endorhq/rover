import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

export default defineConfig({
  plugins: [
    {
      name: 'text-loader',
      transform(_src, id) {
        if (id.endsWith('.md') || id.endsWith('.sh')) {
          const content = readFileSync(id, 'utf-8');
          return {
            code: `export default ${JSON.stringify(content)};`,
          };
        }
      },
    },
    {
      name: 'asset-loader',
      transform(_src, id) {
        if (id.endsWith('.yaml') || id.endsWith('.yml')) {
          return {
            code: `export default ${JSON.stringify(id)};`,
          };
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    // E2E tests run sequentially to avoid resource conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Only run e2e test files
    include: ['**/*.e2e.test.ts', '**/e2e/**/*.test.ts'],
    // Longer timeouts for e2e tests that may involve Docker containers,
    // network operations, and real AI agent interactions
    testTimeout: 1800000, // 30 minutes
    hookTimeout: 60000, // 1 minute
    // Disable coverage for e2e tests (measure integration, not code paths)
    coverage: {
      enabled: false,
    },
    // Reporter optimized for long-running tests
    reporters: ['verbose'],
  },
});
