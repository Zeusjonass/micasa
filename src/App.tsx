import { AuthProvider, useAuth } from './context/AuthContext'
import { LoginScreen } from './components/auth/LoginScreen'
import { AppShell } from './components/layout/AppShell'

function Gate() {
  const { authed } = useAuth()
  return authed ? <AppShell /> : <LoginScreen />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
