import type { Config } from 'tailwindcss'
import { heroui } from '@heroui/react'

// "Aurora Glass" palette — deep navy + aurora-blue + soft violet accent.
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
        sans: ['Inter', 'Noto Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '14px',
        sm: '10px',
        lg: '20px',
        xl: '28px',
      },
      boxShadow: {
        glass: '0 8px 28px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.6)',
        'glass-hover': '0 22px 48px rgba(74,111,165,0.22), inset 0 1px 0 rgba(255,255,255,0.5)',
      },
      backdropBlur: { glass: '22px' },
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
          '0%,100%': { boxShadow: '0 0 0 0 rgba(142,182,230,0.0)' },
          '50%': { boxShadow: '0 0 0 6px rgba(142,182,230,0.18)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.4,0,.2,1) both',
        breath: 'breath 2.4s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            background: '#f3f5fa',
            foreground: '#1a2537',
            divider: 'rgba(15, 23, 42, 0.06)',
            primary: {
              50: '#f1f5fa',
              100: '#dee8f3',
              200: '#bbd0e6',
              300: '#94b4d3',
              400: '#7099c0',
              500: '#4a6fa5',
              600: '#3c5c8a',
              700: '#304a70',
              800: '#243857',
              900: '#1a2840',
              DEFAULT: '#4a6fa5',
              foreground: '#ffffff',
            },
            secondary: {
              50: '#f5f1fb',
              100: '#e7dcf5',
              200: '#d2c0eb',
              300: '#bca3df',
              400: '#a387d2',
              500: '#8a6fc4',
              600: '#7159ab',
              700: '#5a468a',
              800: '#43356a',
              900: '#2e244a',
              DEFAULT: '#8a6fc4',
              foreground: '#ffffff',
            },
            content1: 'rgba(255, 255, 255, 0.82)',
            content2: 'rgba(255, 255, 255, 0.55)',
            content3: 'rgba(255, 255, 255, 0.35)',
            content4: 'rgba(255, 255, 255, 0.20)',
          },
        },
        dark: {
          colors: {
            background: '#080d1a',
            foreground: '#ecf1f8',
            divider: 'rgba(255,255,255,0.06)',
            primary: {
              50: '#0e1828',
              100: '#13243d',
              200: '#1c3559',
              300: '#2d4f7e',
              400: '#5483b9',
              500: '#8eb6e6',
              600: '#a4c5ec',
              700: '#bcd4f1',
              800: '#d3e3f6',
              900: '#e9f0fb',
              DEFAULT: '#8eb6e6',
              foreground: '#080d1a',
            },
            secondary: {
              50: '#1a1226',
              100: '#291b3d',
              200: '#3d2858',
              300: '#583c7d',
              400: '#7a59ad',
              500: '#b39bea',
              600: '#c1afef',
              700: '#d0c2f3',
              800: '#dfd4f7',
              900: '#eee6fb',
              DEFAULT: '#b39bea',
              foreground: '#080d1a',
            },
            content1: 'rgba(18, 26, 44, 0.74)',
            content2: 'rgba(18, 26, 44, 0.55)',
            content3: 'rgba(18, 26, 44, 0.38)',
            content4: 'rgba(18, 26, 44, 0.22)',
          },
        },
      },
    }),
  ],
}

export default config
