import { build } from 'esbuild'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const outDir = resolve(rootDir, 'generated', 'hooks')

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

run().catch(error => {
	console.error('[build-hooks] failed')
	console.error(error)
	process.exitCode = 1
})
