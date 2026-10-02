import { SESSION_KEY } from './types'

export function isSessionActive(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === 'admin'
}

export function login(username: string, password: string): boolean {
  if (username.trim() === 'admin' && password === 'Admin2026!') {
    sessionStorage.setItem(SESSION_KEY, 'admin')
    return true
  }
  return false
}

export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY)
}
