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
const copyHtmlTemplatePlugin = {
	name: 'copy-html-template',

	setup(build) {
		build.onEnd(() => {
			// Copy HTML templates to the dist directory
			const templates = [
				{ src: 'taskDetailsTemplate.html', name: 'Task details template' }
			];

			const distPath = path.join(__dirname, 'dist', 'panels');

			try {
				// Ensure the dist/panels directory exists
				if (!fs.existsSync(distPath)) {
					fs.mkdirSync(distPath, { recursive: true });
				}

				// Copy each template file
				for (const template of templates) {
					const srcPath = path.join(__dirname, 'src', 'panels', template.src);
					const destPath = path.join(distPath, template.src);

					if (fs.existsSync(srcPath)) {
						fs.copyFileSync(srcPath, destPath);
						console.log(`[copy-html-template] ${template.name} copied to dist/panels/`);
					}
				}
			} catch (error) {
				console.error('[copy-html-template] Error copying templates:', error);
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
			copyHtmlTemplatePlugin,
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
