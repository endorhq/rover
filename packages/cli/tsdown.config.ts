import { defineConfig } from 'tsdown';
import path from 'path';
import { createConfig, isProd } from '../../tsdown.config.js';

// For dev builds, resolve workspace packages to their TypeScript source
// This ensures source maps point to original .ts files, not compiled dist
// Note: telemetry is excluded because it uses build-time __BUILD_CONFIG__ define
const devAliases = isProd
  ? {}
  : {
      'rover-core': path.resolve(__dirname, '../core/src/index.ts'),
      'rover-schemas': path.resolve(__dirname, '../schemas/src/index.ts'),
    };

let entryPoints: Record<string, string> = { index: './src/index.ts' };

if (!isProd) {
  entryPoints = {
    ...entryPoints,
    'utils/command-reference': './utils/command-reference.ts',
  };
}

export default defineConfig(
  createConfig({
    entry: entryPoints,
    dts: false,
    alias: devAliases,
    loader: {
      '.md': 'text',
      '.yml': 'asset',
      '.yaml': 'asset',
      '.sh': 'text',
    },
  })
);
