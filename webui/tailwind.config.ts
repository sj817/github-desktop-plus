import type { Config } from 'tailwindcss'
import { heroui } from '@heroui/react'

// Morandi "Mist Ocean Blue" palette — adapted from keysida design system.
// Aesthetic principle: restrained elegance, glass depth, breathing room.
const config: Config = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans SC',
          'Microsoft YaHei UI',
          'PingFang SC',
          'system-ui',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
        lg: '20px',
        xl: '28px',
      },
      boxShadow: {
        glass: '0 4px 12px rgba(15, 23, 42, 0.04), inset 0 1px 1px rgba(255,255,255,0.5)',
        'glass-hover':
          '0 16px 40px rgba(92, 124, 153, 0.18), inset 0 1px 1px rgba(255,255,255,0.6)',
        'glow-sm': '0 0 0 1px rgba(140, 177, 217, 0.18)',
      },
      backdropBlur: {
        glass: '20px',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.34,1.56,.64,1)',
        glide: 'cubic-bezier(.4,0,.2,1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        breath: {
          '0%,100%': { boxShadow: '0 0 0 0 rgba(140,177,217,0.0)' },
          '50%': { boxShadow: '0 0 0 6px rgba(140,177,217,0.18)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.4,0,.2,1) both',
        breath: 'breath 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            background: '#f6f7f9',
            foreground: '#1f2a37',
            divider: 'rgba(15, 23, 42, 0.06)',
            primary: {
              50: '#f1f5fa',
              100: '#dbe6f1',
              200: '#bccfe2',
              300: '#9bb6d1',
              400: '#7e9dc1',
              500: '#5c7c99',
              600: '#496785',
              700: '#3a536c',
              800: '#2c3e52',
              900: '#1d2937',
              DEFAULT: '#5c7c99',
              foreground: '#ffffff',
            },
            content1: 'rgba(255, 255, 255, 0.78)',
            content2: 'rgba(255, 255, 255, 0.55)',
            content3: 'rgba(255, 255, 255, 0.32)',
            content4: 'rgba(255, 255, 255, 0.18)',
          },
        },
        dark: {
          colors: {
            background: '#0c1220',
            foreground: '#e7ecf2',
            divider: 'rgba(255,255,255,0.06)',
            primary: {
              50: '#0e1a26',
              100: '#13283a',
              200: '#1c3a55',
              300: '#2a5478',
              400: '#3d6e95',
              500: '#8cb1d9',
              600: '#a3c0e1',
              700: '#bbd1ea',
              800: '#d2e0f1',
              900: '#e8eff8',
              DEFAULT: '#8cb1d9',
              foreground: '#0c1220',
            },
            content1: 'rgba(20, 28, 44, 0.72)',
            content2: 'rgba(20, 28, 44, 0.55)',
            content3: 'rgba(20, 28, 44, 0.38)',
            content4: 'rgba(20, 28, 44, 0.22)',
          },
        },
      },
    }),
  ],
}

export default config
