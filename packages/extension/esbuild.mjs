import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const __dirname = import.meta.dirname;

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * @type {import('esbuild').Plugin}
 */
const copyCodiconsPlugin = {
	name: 'copy-codicons',

	setup(build) {
		build.onEnd(() => {
			// Copy HTML templates to the dist directory
			// !node_modules/@vscode/codicons/dist/codicon.css
			// !node_modules/@vscode/codicons/dist/codicon.ttf
			const files = [
				{ filename: 'codicon.css', name: 'Codicon CSS' },
				{ filename: 'codicon.ttf', name: 'Codicon Font' }
			];

			// Dist path for the codicon library
			const srcPath = path.join(__dirname, '../', '../', 'node_modules', '@vscode', 'codicons', 'dist');
			const destPath = path.join(__dirname, 'dist', 'codicons');

			try {
				// Ensure the dist/panels directory exists
				if (!fs.existsSync(srcPath)) {
					throw Error(`The ${srcPath} library is missing. Run npm install.`);
				}

				if (!fs.existsSync(destPath)) {
					fs.mkdirSync(destPath, { recursive: true })
				}

				// Copy each template file
				for (const file of files) {
					const srcFile = path.join(srcPath, file.filename);
					const destFile = path.join(destPath, file.filename);

					if (fs.existsSync(srcFile)) {
						fs.copyFileSync(srcFile, destFile);
						console.log(`[copy-codicons] ${file.name} copied to ${destFile}`);
					} else {
						throw Error(`The ${srcFile} codicon file is missing. Run npm install.`);
					}
				}
			} catch (error) {
				console.error('[copy-codicons] Error copying files:', error);
			}
		});
	},
};

/**
 * Bundle Lit components for webview consumption
 * @type {import('esbuild').BuildOptions}
 */
const webviewComponentsConfig = {
	entryPoints: {
		'tasks-webview': 'src/views/tasks-webview.mts',
		'task-details': 'src/views/task-details.mts'
	},
	bundle: true,
	format: 'iife',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'browser',
	target: 'es2022',
	outdir: 'dist/views',
	loader: {
		'.ts': 'ts',
		'.mts': 'ts'
	},
	external: [],
	define: {
		'global': 'globalThis'
	}
};

async function main() {
	// Build the extension
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.mts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		// Add loader for handling Lit decorators and ES modules
		loader: {
			'.mts': 'ts',
			'.mjs': 'js'
		},
		plugins: [
			copyCodiconsPlugin,
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Build webview components
	const webviewCtx = await esbuild.context(webviewComponentsConfig);

	if (watch) {
		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
		await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
