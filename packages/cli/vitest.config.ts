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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/__tests__/**',
        'vitest.config.ts',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
