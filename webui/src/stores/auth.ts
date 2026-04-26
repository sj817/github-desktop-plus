import { create } from 'zustand'
import { Auth, ApiError } from '@/api/client'

interface AuthState {
  status: 'pending' | 'ok' | 'unauth' | 'error'
  expiresInSecs: number
  error?: string
  bootstrap: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Bootstrap flow:
 *   1. If URL has ?t=<token>, POST /api/auth/exchange to swap for HttpOnly cookie.
 *   2. history.replaceState removes ?t= from address bar.
 *   3. GET /api/auth/status to confirm session.
 */
export const useAuth = create<AuthState>((set, get) => ({
  status: 'pending',
  expiresInSecs: 0,
  bootstrap: async () => {
    try {
      const u = new URL(location.href)
      const token = u.searchParams.get('t')
      if (token) {
        try {
          await Auth.exchange(token)
        } catch (e) {
          const msg = e instanceof ApiError ? e.code : 'exchange_failed'
          set({ status: 'unauth', error: msg })
          return
        } finally {
          u.searchParams.delete('t')
          history.replaceState(null, '', u.toString())
        }
      }
      await get().refresh()
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : 'unknown' })
    }
  },
  refresh: async () => {
    try {
      const s = await Auth.status()
      set({ status: s.authed ? 'ok' : 'unauth', expiresInSecs: s.expires_in_secs })
    } catch (e) {
      set({ status: 'unauth', error: e instanceof ApiError ? e.code : 'unknown' })
    }
  },
}))
