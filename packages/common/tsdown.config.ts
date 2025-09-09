import { defineConfig } from 'tsdown';

const isProd = process.env.TSUP_DEV !== 'true';

export default defineConfig({
  format: ['esm'],
  entry: ['./src/index.ts'],
  outDir: './dist',
  dts: true,
  shims: true,
  clean: true,
  target: 'node20',
  platform: 'node',
  minify: isProd,
  sourcemap: !isProd,
});
