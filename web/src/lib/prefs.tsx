import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* per-browser only */ } }

interface Prefs {
  masked: boolean
  toggleMask: () => void
}

const Ctx = createContext<Prefs>(null as unknown as Prefs)
export const usePrefs = () => useContext(Ctx)

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  // Balances are hidden by default; same key as the classic UI so the choice carries over.
  const [masked, setMasked] = useState(() => read('fin-masked') !== '0')

  useEffect(() => {
    document.documentElement.classList.toggle('masked', masked)
  }, [masked])

  const toggleMask = useCallback(() => setMasked(m => { write('fin-masked', m ? '0' : '1'); return !m }), [])

  return <Ctx.Provider value={{ masked, toggleMask }}>{children}</Ctx.Provider>
}
