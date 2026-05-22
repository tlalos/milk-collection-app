import { useState, useRef } from 'react'
import { login } from '../api/authApi'
import { authStore } from '../store/authStore'
import { settingsStore } from '../store/settingsStore'
import { ApiError } from '../api/client'
import type { AuthUser } from '../types/auth'
import './LoginScreen.css'

interface LoginScreenProps {
  onLogin: (user: AuthUser) => void
  onBack: () => void
  initialUsername?: string
  initialPassword?: string
}

const currentYear = new Date().getFullYear()
const fiscalYearOptions = [currentYear, currentYear - 1]

export function LoginScreen({ onLogin, onBack, initialUsername = '', initialPassword = '' }: LoginScreenProps) {
  const [username, setUsername] = useState(initialUsername)
  const [password, setPassword] = useState(initialPassword)
  const [fiscalYear, setFiscalYear] = useState<number>(
    () => Number(authStore.getLastFiscalYear()) || currentYear
  )
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
        { Username: username, Password: password, fiscalyear: String(fiscalYear) },
        abortRef.current.signal,
      )
      authStore.save(response, String(fiscalYear))
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

          <div className="login-field">
            <label htmlFor="fiscalYear">Fiscal year</label>
            <div className="login-select-wrap">
              <select
                id="fiscalYear"
                value={fiscalYear}
                onChange={e => setFiscalYear(Number(e.target.value))}
                disabled={loading}
              >
                {fiscalYearOptions.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <svg className="login-select-arrow" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
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
