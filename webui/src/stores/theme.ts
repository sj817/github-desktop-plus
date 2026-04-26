import { create } from 'zustand'

interface ThemeState {
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  toggle: () => void
}

const STORAGE_KEY = 'gdp.theme'
const initial = (): 'light' | 'dark' => {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const apply = (t: 'light' | 'dark') => {
  const html = document.documentElement
  html.classList.toggle('dark', t === 'dark')
  html.classList.toggle('light', t === 'light')
  localStorage.setItem(STORAGE_KEY, t)
}

const init = initial()
apply(init)

export const useTheme = create<ThemeState>((set, get) => ({
  theme: init,
  setTheme: (t) => { apply(t); set({ theme: t }) },
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    apply(next); set({ theme: next })
  },
}))
