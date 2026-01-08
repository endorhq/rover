import { defineConfig } from 'tsdown';
import path from 'path';

const isProd = process.env.TSUP_DEV !== 'true';

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

export default defineConfig({
  format: ['esm'],
  entry: entryPoints,
  outDir: './dist',
  dts: false,
  shims: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  minify: isProd,
  sourcemap: !isProd,
  // Resolve to TypeScript source for proper source maps in dev
  alias: devAliases,
  loader: {
    '.md': 'text',
    '.yml': 'asset',
    '.yaml': 'asset',
    '.sh': 'text',
  },
});
