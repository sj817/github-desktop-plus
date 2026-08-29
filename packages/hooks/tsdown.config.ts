import { defineConfig } from 'tsdown'

const workspaceDependencies = {
  alwaysBundle: ['@github-desktop-plus/shared'],
}

export default defineConfig([
  {
    name: 'main',
    entry: {
      index: 'src/index.ts',
    },
    outDir: 'dist/main',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    clean: true,
    dts: false,
    sourcemap: false,
    deps: workspaceDependencies,
    outputOptions: {
      entryFileNames: '[name].cjs',
    },
  },
  {
    name: 'preload:early',
    entry: {
      early: 'src/entries/early.ts',
    },
    outDir: 'dist/preload',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    clean: true,
    dts: false,
    sourcemap: false,
    deps: workspaceDependencies,
    outputOptions: {
      codeSplitting: false,
      entryFileNames: '[name].js',
    },
  },
  {
    name: 'preload:renderer',
    entry: {
      renderer: 'src/entries/renderer.ts',
    },
    outDir: 'dist/preload',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    clean: false,
    dts: false,
    sourcemap: false,
    deps: workspaceDependencies,
    outputOptions: {
      codeSplitting: false,
      entryFileNames: '[name].js',
    },
  },
])
