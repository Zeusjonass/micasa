import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isSessionActive, login as loginUser, logout as logoutUser } from '../lib/auth'

type AuthContextValue = {
  authed: boolean
  login: (username: string, password: string) => boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => isSessionActive())

  const login = useCallback((username: string, password: string) => {
    const ok = loginUser(username, password)
    setAuthed(ok)
    return ok
  }, [])

  const logout = useCallback(() => {
    logoutUser()
    setAuthed(false)
  }, [])

  const value = useMemo(() => ({ authed, login, logout }), [authed, login, logout])
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext)
  if (!ctx) throw new Error('AuthProvider required')
  return ctx
}
