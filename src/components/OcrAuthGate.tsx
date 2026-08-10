import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { appPath } from '../ocrPaths'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import './OcrAuthGate.css'

interface User { id: string; username: string }

export function OcrAuthGate({ children }: { children: ReactNode }) {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    void fetch(appPath('/api/auth/session')).then(async (response) => {
      const payload = await response.json() as { user?: User }
      if (response.ok && payload.user) setUser(payload.user)
    }).catch(() => undefined).finally(() => setChecking(false))
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(appPath('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload = await response.json() as { user?: User; error?: string }
      if (!response.ok || !payload.user) throw new Error(payload.error || 'Login failed.')
      setUser(payload.user)
      setPassword('')
    } catch (loginError) {
      setError((loginError as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function signOut() {
    await fetch(appPath('/api/auth/logout'), { method: 'POST' }).catch(() => undefined)
    setUser(null)
  }

  if (checking) return <div className="ocr-auth-loading"><span />{isRo ? 'Se verifică sesiunea…' : 'Checking session…'}</div>
  if (!user) return (
    <main className="ocr-auth-screen">
      <section className="ocr-auth-card">
        <div className="ocr-auth-language"><OcrLanguageSwitch language={language} onChange={setLanguage} /></div>
        <div className="ocr-auth-mark">M</div>
        <h1>{isRo ? 'Autentificare' : 'Sign in'}</h1>
        <p>{isRo ? 'Autentificați-vă pentru încărcarea și verificarea documentelor OCR.' : 'Sign in to upload and review OCR documents.'}</p>
        <form onSubmit={submit}>
          <label>{isRo ? 'Utilizator' : 'Username'}<input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>{isRo ? 'Parolă' : 'Password'}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <div className="ocr-auth-error" role="alert">{isRo ? 'Utilizator sau parolă incorectă.' : error}</div>}
          <button type="submit" disabled={submitting}>{submitting ? (isRo ? 'Se autentifică…' : 'Signing in…') : (isRo ? 'Autentificare' : 'Sign in')}</button>
        </form>
      </section>
    </main>
  )

  return <div className="ocr-auth-content">{children}<button className="ocr-auth-signout" type="button" onClick={() => void signOut()}>{user.username} · {isRo ? 'Ieșire' : 'Sign out'}</button></div>
}
