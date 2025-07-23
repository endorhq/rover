import { defineConfig } from 'tsdown';

const isProd = process.env.TSUP_DEV !== 'true';

export default defineConfig({
	format: ['esm'],
	entry: ['./src/index.ts'],
	outDir: './dist',
	dts: false,
	shims: true,
	clean: true,
	target: 'node20',
	platform: 'node',
	minify: isProd,
	bundle: true,
	sourcemap: !isProd,
	copy: [
		{
			from: 'src/utils/docker-setup.sh',
			to: 'dist/docker-setup.sh'
		}
	]
});
