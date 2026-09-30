import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* per-browser only */ } }

interface Prefs {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (t: Theme) => void
  masked: boolean
  toggleMask: () => void
}

const Ctx = createContext<Prefs>(null as unknown as Prefs)
export const usePrefs = () => useContext(Ctx)

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (read('gk-theme') as Theme) || 'system')
  const [systemDark, setSystemDark] = useState(() => media().matches)
  // Balances are hidden by default; same key as the classic UI so the choice carries over.
  const [masked, setMasked] = useState(() => read('fin-masked') !== '0')

  useEffect(() => {
    const m = media()
    const on = () => setSystemDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  useEffect(() => {
    document.documentElement.classList.toggle('masked', masked)
  }, [masked])

  const setTheme = useCallback((t: Theme) => { setThemeState(t); write('gk-theme', t) }, [])
  const toggleMask = useCallback(() => setMasked(m => { write('fin-masked', m ? '0' : '1'); return !m }), [])

  return <Ctx.Provider value={{ theme, resolved, setTheme, masked, toggleMask }}>{children}</Ctx.Provider>
}
