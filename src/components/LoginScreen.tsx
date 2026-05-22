import { useState, useRef } from 'react'
import { login } from '../api/authApi'
import { authStore } from '../store/authStore'
import { ApiError } from '../api/client'
import type { AuthUser } from '../types/auth'
import './LoginScreen.css'

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    setError(null)
    setLoading(true)

    abortRef.current = new AbortController()

    try {
      const response = await login(
        { Username: username, Password: password },
        abortRef.current.signal,
      )
      authStore.save(response)
      onLogin({
        id: response.user_id,
        username: response.user_name,
        fullName: response.user_fullname,
        isAdmin: response.user_isadmin === 1,
        settings: response.user_settings,
      })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404 || err.status === 401) {
          setError('Invalid username or password.')
        } else {
          setError(`Server error (${err.status}). Please try again.`)
        }
      } else if ((err as Error).name !== 'AbortError') {
        setError('Network error. Check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M16 8h16v4l4 7v21a4 4 0 01-4 4H16a4 4 0 01-4-4V19l4-7V8z"
              fill="#1a6b3c" fillOpacity="0.12" stroke="#1a6b3c" strokeWidth="2" strokeLinejoin="round"
            />
            <path
              d="M19 8h10v4H19V8z"
              fill="#1a6b3c" fillOpacity="0.2" stroke="#1a6b3c" strokeWidth="1.5" strokeLinejoin="round"
            />
            <path
              d="M12 26h24v14a4 4 0 01-4 4H16a4 4 0 01-4-4V26z"
              fill="#1a6b3c" fillOpacity="0.85"
            />
            <path
              d="M12 26 Q16 22 20 26 Q24 30 28 26 Q32 22 36 26"
              fill="none" stroke="#1a6b3c" strokeWidth="1.5"
            />
          </svg>
        </div>

        <h1 className="login-title">MilkCollect</h1>
        <p className="login-subtitle">Sign in to continue</p>

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
