import { build } from 'esbuild'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const outDir = resolve(rootDir, 'generated', 'hooks')

// Built by Vite (pnpm run build:ui), not esbuild — see src/settings-ui.
const settingsUiBundle = resolve(rootDir, 'src', 'settings-ui', 'dist', 'gdp-settings-ui.js')
const settingsUiOut = resolve(outDir, 'preload', 'gdp-settings-ui.js')

const jobs = [
	{
		entry: resolve(rootDir, 'src', 'hooks', 'index.ts'),
		outfile: resolve(outDir, 'index.js'),
		platform: 'node',
		format: 'cjs',
		target: 'node22',
		external: ['electron'],
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'index.ts'),
		outfile: resolve(outDir, 'preload', 'index.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'navbar.ts'),
		outfile: resolve(outDir, 'preload', 'navbar.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'recent-repositories.ts'),
		outfile: resolve(outDir, 'preload', 'recent-repositories.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'update-interceptor.ts'),
		outfile: resolve(outDir, 'preload', 'update-interceptor.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'copilot-hijack.ts'),
		outfile: resolve(outDir, 'preload', 'copilot-hijack.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'open-with.ts'),
		outfile: resolve(outDir, 'preload', 'open-with.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
		external: ['electron'],
	},
	{
		entry: resolve(rootDir, 'src', 'hooks', 'preload', 'gdp-dialog', 'index.ts'),
		outfile: resolve(outDir, 'preload', 'gdp-dialog.js'),
		platform: 'browser',
		format: 'iife',
		target: 'chrome120',
		external: ['electron'],
	},
]

async function run() {
	await rm(outDir, { recursive: true, force: true })
	await mkdir(resolve(outDir, 'preload'), { recursive: true })

	await copySettingsUi()

	await Promise.all(
		jobs.map(({ entry, outfile, ...options }) =>
			build({
				entryPoints: [entry],
				outfile,
				bundle: true,
				charset: 'utf8',
				legalComments: 'none',
				logLevel: 'info',
				sourcemap: false,
				...options,
			})
		)
	)

	console.log(`Built ${jobs.length} hook bundles into ${outDir}`)
}

/**
 * The settings UI ships as a prebuilt IIFE that the Rust launcher embeds, so
 * something must always exist at that path. A placeholder keeps `cargo build`
 * working before the first `pnpm run build:ui` (and in dev, where the UI is
 * served from Vite and the bundle is never injected).
 */
async function copySettingsUi() {
	if (existsSync(settingsUiBundle)) {
		await copyFile(settingsUiBundle, settingsUiOut)
		console.log('Copied settings-ui bundle')
		return
	}
	await writeFile(
		settingsUiOut,
		'/* placeholder — run `pnpm run build:ui` to produce the real bundle */\n',
		'utf8'
	)
	console.warn('[build-hooks] settings-ui bundle missing; wrote placeholder')
}

run().catch(error => {
	console.error('[build-hooks] failed')
	console.error(error)
	process.exitCode = 1
})
