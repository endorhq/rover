import { defineConfig } from 'tsdown';

const isProd = process.env.TSUP_DEV !== 'true';

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
  loader: {
    '.md': 'text',
    '.yml': 'asset',
    '.yaml': 'asset',
    '.sh': 'text',
  },
});
