import { defineConfig } from 'tsdown';

const isProd = process.env.TSUP_DEV !== 'true';

// Import configs to inject at build time
const prodConfig = {
  apiKey: 'phc_PaRcEsRKkwITcZO0wvq9PrwRCFWM215zRwBCMmAdhS7',
  host: 'https://eu.i.posthog.com',
};

const devConfig = {
  apiKey: 'phc_tmy7HDRkmsVRlmzWp1kk21i2GLmlp1AEoJeXcwnHks2',
  host: 'https://eu.i.posthog.com',
};

const selectedConfig = isProd ? prodConfig : devConfig;

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
  define: {
    __BUILD_CONFIG__: JSON.stringify(selectedConfig),
  },
});
