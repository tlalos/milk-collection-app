import { useState } from 'react'
import { db } from '../db/database'
import { authStore } from '../store/authStore'
import type { AuthUser } from '../types/auth'
import './LoginScreen.css'

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void
  onBack: () => void
  initialUsername?: string
  initialPassword?: string
}

export function LoginScreen({ onLogin, onBack, initialUsername = '', initialPassword = '' }: LoginScreenProps) {
  const [username, setUsername] = useState(initialUsername)
  const [password, setPassword] = useState(initialPassword)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setLoading(true)

    try {
      const allUsers = await db.offlineUsers.toArray()

      if (allUsers.length === 0) {
        setError('No users synced yet. Go back and tap "Sync users" first.')
        return
      }

      // Field names depend on the server's C# class — try common patterns.
      // Once confirmed, these helpers will resolve to the correct field.
      const getField = (u: Record<string, unknown>, ...keys: string[]): unknown =>
        keys.reduce<unknown>((acc, k) => (acc !== undefined && acc !== null ? acc : u[k]), undefined)

      const localUser = allUsers.find(u => {
        const uname = getField(u,
          'user_name', 'usr_name', 'UserName', 'username', 'Username', 'LOGIN', 'login',
        ) as string | undefined
        return uname?.trim().toLowerCase() === username.trim().toLowerCase()
      })

      if (!localUser) {
        setError('User not found. Please sync users from the main screen first.')
        return
      }

      const storedPass = getField(localUser,
        'user_password', 'usr_password', 'Password', 'password', 'PASS', 'pass',
      ) as string | undefined

      if (storedPass !== password) {
        setError('Invalid username or password.')
        return
      }

      const id       = getField(localUser, 'user_id', 'usr_id', 'Id', 'id', 'ID') as number ?? 0
      const uname    = getField(localUser, 'user_name', 'usr_name', 'UserName', 'username', 'Login', 'LOGIN') as string ?? username
      const fullName = getField(localUser, 'user_fullname', 'usr_fullname', 'FullName', 'fullname', 'NAME') as string ?? uname
      const isAdmin  = getField(localUser, 'user_isadmin', 'usr_isadmin', 'IsAdmin', 'isadmin', 'ISADMIN')
      const settings = getField(localUser, 'user_settings', 'usr_settings', 'Settings') ?? null

      const user: AuthUser = {
        id: Number(id),
        username: String(uname),
        fullName: String(fullName),
        isAdmin: isAdmin === 1 || isAdmin === true || isAdmin === '1',
        settings: settings as AuthUser['settings'],
      }

      authStore.saveOfflineSession(user, password)
      onLogin(user)
    } catch {
      setError('Error accessing local data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        {/* Back button */}
        <button className="login-back" type="button" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <h1 className="login-title">Sign in</h1>
        <p className="login-subtitle">Enter your credentials to continue</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="login-submit"
            type="submit"
            disabled={loading || !username || !password}
          >
            {loading ? <span className="login-spinner" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
