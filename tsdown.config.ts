import type { UserConfig } from 'tsdown';

export const isProd = process.env.TSUP_DEV !== 'true';

export function createConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    format: ['esm'],
    outDir: './dist',
    shims: true,
    clean: true,
    target: 'node20',
    platform: 'node',
    minify: isProd,
    sourcemap: !isProd,
    dts: true,
    entry: ['./src/index.ts'],
    ...overrides,
  };
}
