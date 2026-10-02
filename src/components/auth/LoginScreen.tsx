import { useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'

export function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const ok = login(username, password)
    if (!ok) setError('Usuario o contraseña incorrectos.')
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <p className="text-2xl font-medium text-ink">MiCasa</p>
          <p className="mt-1 text-sm text-ink-soft">Generación de contratos</p>
        </div>
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-line bg-cream p-7"
        >
          <label className="block text-sm font-medium text-ink">
            Usuario
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-2 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[16px] text-ink outline-none focus:ring-2 focus:ring-forest/30"
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-ink">
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[16px] text-ink outline-none focus:ring-2 focus:ring-forest/30"
            />
          </label>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <button
            type="submit"
            className="mt-6 w-full rounded-xl bg-forest px-4 py-2.5 text-sm font-semibold text-cream hover:bg-forest-2"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}
