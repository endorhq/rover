import { defineConfig } from 'tsdown';

const isProd = process.env.TSUP_DEV !== 'true';

let entryPoints = ['./src/index.ts'];
if (isProd) {
  const extraEntryPoints = ['./utils/command-reference.ts'];
  entryPoints = [...entryPoints, ...extraEntryPoints];
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
  splitting: false,
  loader: {
    '.md': 'text',
  },
});
