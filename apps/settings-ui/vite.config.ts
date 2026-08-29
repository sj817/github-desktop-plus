import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GDP_SETTINGS_UI_GLOBAL } from '@github-desktop-plus/shared'
import { SETTINGS_DEV_PORT } from './dev-config.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Fold the emitted stylesheet into the JS bundle.
 *
 * The production bundle is handed to GitHub Desktop as a single string and run
 * through `webContents.executeJavaScript` — there is no HTML document we could
 * add a <link> to, so the CSS has to travel with the code. `mount()` picks the
 * global up and writes one <style> tag into the host document.
 */
function inlineCss(): Plugin {
  return {
    name: 'gdp-inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      let css = ''
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && fileName.endsWith('.css')) {
          css += typeof output.source === 'string' ? output.source : ''
          delete bundle[fileName]
        }
      }
      if (css === '') return

      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.isEntry) {
          output.code = `globalThis.__GDP_SETTINGS_UI_CSS__=${JSON.stringify(css)};\n${output.code}`
        }
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  root: here,
  plugins: [react(), tailwindcss(), inlineCss()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  server: {
    port: SETTINGS_DEV_PORT,
    strictPort: true,
    host: '127.0.0.1',
    // The IPC contract lives in packages/shared, outside this Vite root.
    fs: { allow: [path.resolve(here, '..', '..')] },
  },
  define:
    command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : undefined,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    cssCodeSplit: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(here, 'src', 'mount.tsx'),
      name: GDP_SETTINGS_UI_GLOBAL,
      formats: ['iife'],
      fileName: () => 'gdp-settings-ui.js',
    },
    rollupOptions: {
      output: {
        // An IIFE build only declares `var __GDP_SETTINGS_UI__`, and the hook
        // evaluates this bundle inside a wrapper function — so the var would be
        // function-scoped and the dialog shell would never see it. Publish it
        // explicitly.
        footer: `globalThis.${GDP_SETTINGS_UI_GLOBAL}=${GDP_SETTINGS_UI_GLOBAL};`,
      },
    },
  },
}))
