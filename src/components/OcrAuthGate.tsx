import { BackButton } from './BackButton'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { WebSignInHelp } from './WebSignInHelp'
import { WebAccountMenu } from './WebAccountMenu'
import { OcrNavigationContext, hasOcrNavigation } from './OcrNavigation'
import { appPath } from '../ocrPaths'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import './OcrAuthGate.css'

interface User {
  id: string
  username: string
  fullName?: string
  isAdmin?: boolean
  permissions?: string[]
}

interface OcrAuthGateProps {
  children: ReactNode
  requiredPermission?: string | string[]
  title?: string
  description?: string
  onUserChange?: (user: User | null) => void
  contentClassName?: string
}

function canAccess(user: User | null, permission: string | string[] = '') {
  if (!permission || (Array.isArray(permission) && permission.length === 0)) return true
  if (!user) return false
  if (user.isAdmin) return true
  return Array.isArray(permission)
    ? permission.every((item) => user.permissions?.includes(item))
    : Boolean(user.permissions?.includes(permission))
}

function loginErrorMessage(error: unknown, isRo: boolean) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/failed to fetch|networkerror|load failed/iu.test(message)) {
    return isRo
      ? 'Serverul MilkCollect nu poate fi contactat. Verificați dacă serverul local este pornit.'
      : 'Cannot reach the MilkCollect server. Check that the local server is running.'
  }
  return message || (isRo ? 'Autentificarea a eșuat.' : 'Login failed.')
}

export function OcrAuthGate({ children, requiredPermission = '', title = '', description = '', onUserChange, contentClassName = '' }: OcrAuthGateProps) {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const signInForm = useRef<HTMLFormElement>(null)

  useEffect(() => {
    void fetch(appPath('/api/auth/session')).then(async (response) => {
      const payload = await response.json() as { user?: User }
      if (response.ok && payload.user) {
        setUser(payload.user)
        onUserChange?.(payload.user)
      }
    }).catch(() => undefined).finally(() => setChecking(false))
  }, [onUserChange])

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
      setPassword('')
      setUser(payload.user)
      onUserChange?.(payload.user)
    } catch (loginError) {
      setError(loginErrorMessage(loginError, isRo))
    } finally {
      setSubmitting(false)
    }
  }

  async function signOut() {
    await fetch(appPath('/api/auth/logout'), { method: 'POST' }).catch(() => undefined)
    setUser(null)
    onUserChange?.(null)
  }

  if (checking) return <div className="ocr-auth-loading"><span />{isRo ? 'Se verifică sesiunea…' : 'Checking session…'}</div>
  if (!user) return (
    <main className="ocr-auth-screen">
      <section className="ocr-auth-card">
        <div className="ocr-auth-language"><OcrLanguageSwitch language={language} onChange={setLanguage} /></div>
        <div className="ocr-auth-mark">M</div>
        <h1>{title || (isRo ? 'Autentificare utilizator web' : 'Web user sign in')}</h1>
        <p>{description || (isRo ? 'Autentificați-vă ca utilizator web pentru acces la această pagină.' : 'Sign in as a Web user to access this page.')}</p>
        <WebSignInHelp formRef={signInForm} isRo={isRo} />
        <form ref={signInForm} onSubmit={submit}>
          <label>{isRo ? 'Utilizator' : 'Username'}<input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>{isRo ? 'Parolă' : 'Password'}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <div className="ocr-auth-error" role="alert">{error}</div>}
          <button type="submit" disabled={submitting}>{submitting ? (isRo ? 'Se autentifică…' : 'Signing in…') : (isRo ? 'Autentificare web' : 'Web sign in')}</button>
        </form>
        <BackButton className="ocr-auth-menu-link" type="button" onClick={() => { window.location.href = appPath('/ocr') }} aria-label={isRo ? 'Înapoi la meniul OCR' : 'Back to OCR menu'} />
      </section>
    </main>
  )

  if (!canAccess(user, requiredPermission)) return (
    <main className="ocr-auth-screen">
      <section className="ocr-auth-card">
        <div className="ocr-auth-language"><OcrLanguageSwitch language={language} onChange={setLanguage} /></div>
        <div className="ocr-auth-mark">M</div>
        <h1>{isRo ? 'Acces restricționat' : 'No access'}</h1>
        <p>{isRo ? 'Acest utilizator nu are permisiune pentru această pagină.' : 'This user does not have permission for this page.'}</p>
        <BackButton type="button" onClick={() => { window.location.href = appPath('/ocr') }} aria-label={isRo ? 'Înapoi la meniul OCR' : 'Back to OCR menu'} />
        <button className="ocr-auth-menu-link" type="button" onClick={() => void signOut()}>
          {user.username} · {isRo ? 'Ieșire web' : 'Web sign out'}
        </button>
      </section>
    </main>
  )

  return (
    <OcrNavigationContext.Provider value={{ user, isRo }}>
    <div className={`ocr-auth-content${hasOcrNavigation() ? ' ocr-has-navigation' : ''} ${contentClassName}`}>
      {children}
      <div className="ocr-auth-session">
        <OcrLanguageSwitch language={language} onChange={setLanguage} />
        <WebAccountMenu username={user.username} onSignOut={signOut} isRo={isRo} />
      </div>
    </div>
    </OcrNavigationContext.Provider>
  )
}
