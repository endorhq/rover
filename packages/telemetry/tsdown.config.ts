import { defineConfig } from 'tsdown';
import { createConfig, isProd } from '../../tsdown.config.js';

const prodConfig = {
  apiKey: 'phc_PaRcEsRKkwITcZO0wvq9PrwRCFWM215zRwBCMmAdhS7',
  host: 'https://eu.i.posthog.com',
};

const devConfig = {
  apiKey: 'phc_tmy7HDRkmsVRlmzWp1kk21i2GLmlp1AEoJeXcwnHks2',
  host: 'https://eu.i.posthog.com',
};

const selectedConfig = isProd ? prodConfig : devConfig;

export default defineConfig(
  createConfig({
    define: {
      __BUILD_CONFIG__: JSON.stringify(selectedConfig),
    },
  })
);
