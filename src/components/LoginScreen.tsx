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
      // Find user in the locally-synced offline user store
      const allUsers = await db.offlineUsers.toArray()
      const localUser = allUsers.find(
        u => u.user_name.toLowerCase() === username.trim().toLowerCase()
      )

      if (!localUser) {
        setError('User not found. Please sync users from the main screen first.')
        return
      }

      if (localUser.user_password !== password) {
        setError('Invalid username or password.')
        return
      }

      const user: AuthUser = {
        id: localUser.user_id,
        username: localUser.user_name,
        fullName: localUser.user_fullname,
        isAdmin: localUser.user_isadmin === 1,
        settings: localUser.user_settings,
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
