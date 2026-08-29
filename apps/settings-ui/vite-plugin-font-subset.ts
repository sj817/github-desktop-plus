import type { Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let fontFaceCss = ''

export function getFontFaceCss(): string {
  return fontFaceCss
}

export function subsetFontPlugin(): Plugin {
  const normalPath = path.resolve(__dirname, 'src/assets/fonts/MiSans-Normal.ttf')
  const mediumPath = path.resolve(__dirname, 'src/assets/fonts/MiSans-Medium.ttf')

  return {
    name: 'gdp-font-subset',
    async buildStart() {
      if (!fs.existsSync(normalPath)) {
        console.warn(`[font-subset] Font file not found at ${normalPath}`)
        return
      }

      const srcDir = path.resolve(__dirname, 'src')
      const localesDir = path.resolve(__dirname, '../../resources/locales')
      const textSet = new Set<string>()

      // Add ASCII printable characters
      for (let i = 32; i <= 126; i++) {
        textSet.add(String.fromCharCode(i))
      }

      function scanDir(dir: string) {
        if (!fs.existsSync(dir)) return
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'fonts') {
              scanDir(fullPath)
            }
          } else if (/\.(tsx?|json|jsx?|html)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8')
            for (const char of content) {
              textSet.add(char)
            }
          }
        }
      }

      scanDir(srcDir)
      scanDir(localesDir)

      const text = Array.from(textSet).join('')
      const normalBuf = fs.readFileSync(normalPath)
      const normalSubset = await subsetFont(normalBuf, text, { targetFormat: 'woff2' })
      const normalBase64 = Buffer.from(normalSubset).toString('base64')

      let fontRules = `@font-face {
  font-family: 'MiSans';
  src: url('data:font/woff2;charset=utf-8;base64,${normalBase64}') format('woff2');
  font-weight: 100 400;
  font-style: normal;
  font-display: swap;
}\n`

      if (fs.existsSync(mediumPath)) {
        const mediumBuf = fs.readFileSync(mediumPath)
        const mediumSubset = await subsetFont(mediumBuf, text, { targetFormat: 'woff2' })
        const mediumBase64 = Buffer.from(mediumSubset).toString('base64')
        fontRules += `@font-face {
  font-family: 'MiSans';
  src: url('data:font/woff2;charset=utf-8;base64,${mediumBase64}') format('woff2');
  font-weight: 500 900;
  font-style: normal;
  font-display: swap;
}\n`
      }

      fontFaceCss = fontRules
      console.log(
        `[font-subset] MiSans font subsetting complete: ${(normalSubset.length / 1024).toFixed(
          2
        )} KB (${textSet.size} glyphs)`
      )
    },
    generateBundle(_options, bundle) {
      if (!fontFaceCss) return
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type === 'asset' && fileName.endsWith('.css')) {
          output.source = fontFaceCss + (typeof output.source === 'string' ? output.source : '')
        }
      }
    },
  }
}
