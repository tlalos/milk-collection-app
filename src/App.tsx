import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CustomersScreen } from './components/CustomersScreen'
import { DataSyncScreen } from './components/DataSyncScreen'
import { JournalScreen } from './components/JournalScreen'
import { LoginScreen } from './components/LoginScreen'
import { MainScreen } from './components/MainScreen'
import { MilkCollectionEntryScreen } from './components/MilkCollectionEntryScreen'
import { MilkReceptionScreen } from './components/MilkReceptionScreen'
import { DailyAvizScreen } from './components/DailyAvizScreen'
import { MonthClosureScreen } from './components/MonthClosureScreen'
import { MonthlyReconciliationScreen } from './components/MonthlyReconciliationScreen'
import { OcrDocumentScreen } from './components/OcrDocumentScreen'
import { OcrArchiveHistoryScreen } from './components/OcrArchiveHistoryScreen'
import { OcrReviewScreen } from './components/OcrReviewScreen'
import { OcrSettingsScreen } from './components/OcrSettingsScreen'
import { MonthlySettlementReviewScreen } from './components/MonthlySettlementReviewScreen'
import { OcrComparisonScreen } from './components/OcrComparisonScreen'
import { OcrAuthGate } from './components/OcrAuthGate'
import { SettingsScreen } from './components/SettingsScreen'
import { StartupScreen } from './components/StartupScreen'
import { SupplierSelectionScreen } from './components/SupplierSelectionScreen'
import { TransportScreen } from './components/TransportScreen'
import { WebUsersScreen } from './components/WebUsersScreen'
import { authStore } from './store/authStore'
import { ocrConnectionSettingsStore } from './store/ocrConnectionSettingsStore'
import { ErpPayloadDebugModal } from './components/ErpPayloadDebugModal'
import { saveCollectionToJournal, updateJournalCollectionErpStatus } from './store/journalStore'
import { settingsStore } from './store/settingsStore'
import { syncOfflineUsers } from './sync/syncOfflineUsers'
import {
  createSuppliesOrderPayload,
  sendSuppliesOrderPayloadToErp,
} from './store/suppliesOrderStore'
import { ApiError, testLoginConnection } from './api/client'
import type { AuthUser } from './types/auth'
import type { SubmittedCollection, Supplier } from './types'
import type { ERP_SuppliesPickingOrder } from './types/suppliesOrder'
import type { AppSettings } from './types/settings'
import './App.css'
import './components/OcrHeaderControls.css'
import { appPath, routePathname } from './ocrPaths'

type Screen =
  | 'startup'
  | 'main'
  | 'login'
  | 'settings'
  | 'home'
  | 'customers'
  | 'dataSync'
  | 'journal'
  | 'transport'
  | 'milkReception'
  | 'dailyAviz'
  | 'monthClosure'
  | 'monthlyReconciliation'
  | 'suppliers'
  | 'entry'
  | 'ocrDocuments'
  | 'ocrArchiveHistory'
  | 'ocrReview'
  | 'ocrSettings'
  | 'webUsers'
  | 'monthlySettlementReview'
  | 'ocrComparison'

type HomeMenuGroup = 'milkCollection' | 'ocr' | null
type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'
type SyncStatus = 'idle' | 'syncing' | 'done' | 'error'

interface HomeWebUser {
  id: string
  username: string
  fullName?: string
}

function webLoginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/failed to fetch|networkerror|load failed/iu.test(message)) {
    return 'Cannot reach the MilkCollect server. Check that the local server is running.'
  }
  return message || 'Login failed.'
}

function initialScreen(): Screen {
  if (routePathname() === '/milk-collection') return 'home'
  if (routePathname() === '/ocr') return 'home'
  if (routePathname() === '/home') return 'home'
  if (routePathname() === '/ocr/upload') return 'ocrDocuments'
  if (routePathname() === '/ocr/archive-history') return 'ocrArchiveHistory'
  if (routePathname() === '/ocr/review') return 'ocrReview'
  if (routePathname() === '/ocr/settings') return 'ocrSettings'
  if (routePathname() === '/web-users') return 'webUsers'
  if (routePathname() === '/ocr/monthly-review') return 'monthlySettlementReview'
  if (routePathname() === '/ocr/compare') return 'ocrComparison'
  if (routePathname() === '/daily-aviz') return 'dailyAviz'
  if (routePathname() === '/month-closure') return 'monthClosure'
  if (routePathname() === '/monthly-reconciliation') return 'monthlyReconciliation'
  if (routePathname() === '/milk-reception') return 'milkReception'
  return 'startup'
}

function initialHomeMenuGroup(): HomeMenuGroup {
  if (routePathname() === '/milk-collection') return 'milkCollection'
  if (routePathname() === '/ocr') return 'ocr'
  if (routePathname() !== '/home') return null
  const menu = new URLSearchParams(window.location.search).get('menu')
  return menu === 'ocr' || menu === 'milkCollection' ? menu : null
}

function HomeOcrSessionButton({
  checking,
  user,
  onSignOut,
}: {
  checking: boolean
  user: HomeWebUser | null
  onSignOut: () => void
}) {
  if (checking || !user) return null

  return (
    <div className="home-header-session-pill">
      <span>{user.username}</span>
      <button type="button" onClick={onSignOut}>Web sign out</button>
    </div>
  )
}

function HomeOcrSignInPanel({
  checking,
  user,
  onLogin,
}: {
  checking: boolean
  user: HomeWebUser | null
  onLogin: (user: HomeWebUser) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

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
      const payload = await response.json() as { user?: HomeWebUser; error?: string }
      if (!response.ok || !payload.user) throw new Error(payload.error || 'Login failed.')
      onLogin(payload.user)
      setPassword('')
    } catch (loginError) {
      setError(webLoginErrorMessage(loginError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="home-access-panel">
      <div className="home-access-title">
        <div>
          <span>Web user</span>
          <h2>OCR sign in</h2>
        </div>
      </div>
      {checking ? (
        <p className="home-access-note">Checking OCR session...</p>
      ) : user ? (
        <p className="home-access-note">Signed in as <strong>{user.fullName || user.username}</strong>.</p>
      ) : (
        <form className="home-ocr-login-form" onSubmit={submit}>
          <label>
            <span>Username</span>
            <input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>Password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="home-access-error" role="alert">{error}</div>}
          <button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Web sign in'}</button>
        </form>
      )}
    </section>
  )
}

function HomeOcrConnectionPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings>(() => ocrConnectionSettingsStore.get())
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 2000)
    return () => window.clearTimeout(timer)
  }, [saved])

  function handleChange<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
    setSaved(false)
    setTestStatus('idle')
    setTestMessage('')
  }

  function handleSave() {
    ocrConnectionSettingsStore.set(settings)
    setSaved(true)
  }

  async function handleTest() {
    if (testStatus === 'testing') return
    setTestStatus('testing')
    setTestMessage('')
    const result = await testLoginConnection(settings)
    setTestStatus(result.ok ? 'ok' : 'fail')
    setTestMessage(result.message)
  }

  return (
    <section className="home-access-panel">
      <div className="home-access-title">
        <div>
          <span>OCR connection</span>
          <h2>OCR sign in settings</h2>
        </div>
        <div className="home-access-actions">
          <button className="home-access-session" type="button" onClick={onClose}>
            Hide
          </button>
          <button className={`home-access-session ${saved ? 'saved' : ''}`} type="button" onClick={handleSave}>
            {saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="home-ocr-connection-form">
        <label className="home-ocr-field home-ocr-field-wide">
          <span>Server URL</span>
          <div className="home-ocr-url-row">
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://your-api-host/api"
              value={settings.serverUrl}
              onChange={(event) => handleChange('serverUrl', event.target.value)}
            />
            <button
              className={`home-ocr-test-btn test-${testStatus}`}
              type="button"
              onClick={() => void handleTest()}
              disabled={testStatus === 'testing' || !settings.serverUrl}
            >
              {testStatus === 'testing' ? 'Testing...' : testStatus === 'ok' ? 'OK' : testStatus === 'fail' ? 'Fail' : 'Test'}
            </button>
          </div>
        </label>

        <label className="home-ocr-field">
          <span>API username</span>
          <input
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="admin"
            value={settings.apiUsername}
            onChange={(event) => handleChange('apiUsername', event.target.value)}
          />
        </label>

        <label className="home-ocr-field">
          <span>API password</span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="password"
            value={settings.apiPassword}
            onChange={(event) => handleChange('apiPassword', event.target.value)}
          />
        </label>

        <label className="home-ocr-field">
          <span>Request timeout (ms)</span>
          <input
            type="number"
            min={1000}
            max={60000}
            step={1000}
            value={settings.requestTimeoutMs}
            onChange={(event) => handleChange('requestTimeoutMs', Number(event.target.value))}
          />
        </label>

        <label className="home-ocr-field">
          <span>Default fiscal year</span>
          <input
            type="number"
            min={2000}
            max={2099}
            value={settings.defaultFiscalYear}
            onChange={(event) => handleChange('defaultFiscalYear', event.target.value)}
          />
        </label>
      </div>
      {testMessage && (
        <p className={`home-ocr-test-message ${testStatus === 'ok' ? 'ok' : 'fail'}`} role={testStatus === 'fail' ? 'alert' : undefined}>
          {testMessage}
        </p>
      )}
    </section>
  )
}

function HomeMilkUserSyncButton() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [syncError, setSyncError] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (syncStatus !== 'done') return
    const timer = window.setTimeout(() => setSyncStatus('idle'), 4000)
    return () => window.clearTimeout(timer)
  }, [syncStatus])

  async function handleSync() {
    if (syncStatus === 'syncing') return

    const settings = settingsStore.get()
    const serverUrl = settings.serverUrl
    if (!serverUrl) {
      setSyncStatus('error')
      setSyncError('No server URL configured. Open Settings first.')
      setSyncMessage('')
      return
    }

    setSyncStatus('syncing')
    setSyncError('')
    setSyncMessage('')
    abortRef.current = new AbortController()
    const timeoutMs = Math.max(1000, Number(settings.requestTimeoutMs) || 15000)
    const timeout = window.setTimeout(() => abortRef.current?.abort(), timeoutMs)

    try {
      const syncedUsers = await syncOfflineUsers(abortRef.current.signal)
      setSyncStatus('done')
      setSyncMessage(`${syncedUsers} ${syncedUsers === 1 ? 'user' : 'users'} synced for offline login.`)
    } catch (err) {
      setSyncStatus('error')
      if ((err as Error).name === 'AbortError') {
        setSyncError(`Sync timed out after ${timeoutMs} ms. Increase Request timeout in Settings and try again.`)
      } else if (err instanceof ApiError) {
        if (err.status === 0) {
          setSyncError(err.message)
        } else if (err.status === 401 || err.status === 403) {
          setSyncError(`Authentication failed (${err.status}). Check API credentials in Settings.`)
        } else if (err.status === 404) {
          setSyncError('Endpoint not found (404). Check the server URL in Settings.')
        } else {
          setSyncError(`Server error (${err.status}): ${err.message}`)
        }
      } else {
        const msg = (err as Error).message
        setSyncError(
          msg && !msg.toLowerCase().startsWith('failed to fetch')
            ? msg
            : 'Network error. Could not reach the server. Check Settings.',
        )
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return (
    <>
      <button
        className={`home-icon-btn${syncStatus === 'done' ? ' icon-btn-success' : ''}${syncStatus === 'error' ? ' icon-btn-error' : ''}`}
        type="button"
        onClick={() => void handleSync()}
        disabled={syncStatus === 'syncing'}
        aria-label="Sync users"
        title={syncStatus === 'error' && syncError ? syncError : 'Sync users'}
      >
        {syncStatus === 'done' ? (
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className={syncStatus === 'syncing' ? 'spin' : ''}>
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
          </svg>
        )}
      </button>
      {syncStatus === 'error' && syncError && (
        <div className="home-sync-notice error" role="alert">{syncError}</div>
      )}
      {syncStatus === 'done' && syncMessage && (
        <div className="home-sync-notice success" role="status">{syncMessage}</div>
      )}
    </>
  )
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [homeMenuGroup, setHomeMenuGroup] = useState<HomeMenuGroup>(initialHomeMenuGroup)
  const [showOcrConnectionSettings, setShowOcrConnectionSettings] = useState(false)
  const [homeOcrUser, setHomeOcrUser] = useState<HomeWebUser | null>(null)
  const [homeOcrChecking, setHomeOcrChecking] = useState(true)
  const [prevScreen, setPrevScreen] = useState<Screen>('main')
  const [loginReturnScreen, setLoginReturnScreen] = useState<Screen>('home')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [submittedCollections, setSubmittedCollections] = useState<SubmittedCollection[]>([])
  const [successMessage, setSuccessMessage] = useState('')
  const [pendingErpSend, setPendingErpSend] = useState<{
    collectionId: string
    collection: SubmittedCollection
    payload: ERP_SuppliesPickingOrder[]
  } | null>(null)
  const [pendingErpSending, setPendingErpSending] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch(appPath('/api/auth/session'))
      .then(async (response) => {
        const payload = await response.json() as { user?: HomeWebUser }
        if (!cancelled && response.ok && payload.user) setHomeOcrUser(payload.user)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHomeOcrChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleStartupComplete() {
    if (authStore.isLoggedIn()) {
      setUser(authStore.getUser())
      setScreen('home')
    } else {
      setScreen('main')
    }
  }

  function handleLogin(loggedInUser: AuthUser) {
    setUser(loggedInUser)
    setScreen(loginReturnScreen)
  }

  function openSettings(from: Screen) {
    setPrevScreen(from)
    setScreen('settings')
  }

  function openErpLogin(returnTo: Screen) {
    setLoginReturnScreen(returnTo)
    setScreen('login')
  }

  function openOcrMenu() {
    window.location.href = appPath('/ocr')
  }

  function openMilkCollectionMenu() {
    window.location.href = appPath('/milk-collection')
  }

  function handleLogout(returnTo: Screen = 'main') {
    authStore.clear()
    setUser(null)
    setSelectedSupplier(null)
    setSuccessMessage('')
    setScreen(returnTo)
  }

  async function handleHomeOcrSignOut() {
    await fetch(appPath('/api/auth/logout'), { method: 'POST' }).catch(() => undefined)
    setHomeOcrUser(null)
  }

  function openSupplierSelection() {
    setSelectedSupplier(null)
    setScreen('suppliers')
  }

  function openSupplierEntry(supplier: Supplier) {
    setSelectedSupplier(supplier)
    setSuccessMessage('')
    setScreen('entry')
  }

  function returnToSuppliers() {
    setSelectedSupplier(null)
    setScreen('suppliers')
  }

  async function submitCollection(collection: SubmittedCollection) {
    setSubmittedCollections((current) => [collection, ...current])
    try {
      const { collectionId, savedEntries } = await saveCollectionToJournal(collection)
      setSuccessMessage(`Collection submitted for ${collection.supplier.name}.`)
      if (savedEntries === 0) {
        setSuccessMessage(`Collection submitted for ${collection.supplier.name}. No journal rows were saved because no milk quantities were entered.`)
      } else if (!user) {
        setSuccessMessage(`Collection saved locally for ${collection.supplier.name}, but no user is signed in for ERP sync.`)
      } else {
        try {
          const payload = await createSuppliesOrderPayload(collection, user)
          setPendingErpSend({ collectionId, collection, payload })
          setSuccessMessage(`Collection saved locally for ${collection.supplier.name}. Review ERP debug values before sending.`)
        } catch (err) {
          await updateJournalCollectionErpStatus(
            collectionId,
            'failed',
            (err as Error).message || 'ERP payload could not be prepared.',
          )
          setSuccessMessage(`Collection saved locally for ${collection.supplier.name}, but ERP payload could not be prepared.`)
        }
      }
    } catch {
      setSuccessMessage(`Collection submitted for ${collection.supplier.name}, but the local journal could not be saved.`)
    }
    setSelectedSupplier(null)
    setScreen('suppliers')
  }

  async function confirmPendingErpSend() {
    if (!pendingErpSend || pendingErpSending) return

    setPendingErpSending(true)
    await updateJournalCollectionErpStatus(pendingErpSend.collectionId, 'sending', 'Sending order to ERP...')

    try {
      const erpResponse = await sendSuppliesOrderPayloadToErp(pendingErpSend.payload)
      await updateJournalCollectionErpStatus(
        pendingErpSend.collectionId,
        'sent',
        erpResponse.newid
          ? `Sent to ERP. New document #${erpResponse.newid}.`
          : 'Sent to ERP.',
        erpResponse.newid ?? '',
      )
      setSuccessMessage(
        `Collection sent to ERP for ${pendingErpSend.collection.supplier.name}${erpResponse.newid ? ` (#${erpResponse.newid})` : ''}.`,
      )
      setPendingErpSend(null)
    } catch (err) {
      await updateJournalCollectionErpStatus(
        pendingErpSend.collectionId,
        'failed',
        (err as Error).message || 'ERP sync failed.',
      )
      setSuccessMessage(`ERP sync failed for ${pendingErpSend.collection.supplier.name}.`)
    } finally {
      setPendingErpSending(false)
    }
  }

  return (
    <>
      {screen === 'startup' && (
        <StartupScreen onComplete={handleStartupComplete} />
      )}

      {screen === 'main' && (
        <MainScreen
          onSignIn={() => openErpLogin('home')}
          onSettings={() => openSettings('main')}
          onOpenMenu={() => { window.location.href = appPath('/home') }}
        />
      )}

      {screen === 'login' && (
        <LoginScreen
          onLogin={handleLogin}
          onBack={() => setScreen(loginReturnScreen === 'settings' ? 'settings' : 'main')}
          initialUsername={authStore.getLastUsername()}
          initialPassword={authStore.getLastPassword()}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          onBack={() => setScreen(prevScreen)}
          user={user}
          onErpSignIn={() => openErpLogin('settings')}
          onErpSignOut={() => handleLogout('settings')}
        />
      )}

      {screen === 'customers' && (
        <CustomersScreen onBack={openMilkCollectionMenu} />
      )}

      {screen === 'dataSync' && (
        user && <DataSyncScreen onBack={openMilkCollectionMenu} user={user} />
      )}

      {screen === 'journal' && (
        user && <JournalScreen onBack={openMilkCollectionMenu} user={user} />
      )}

      {screen === 'transport' && (
        <TransportScreen onBack={openMilkCollectionMenu} />
      )}

      {screen === 'milkReception' && (
        <OcrAuthGate requiredPermission="milk_reception" title="Web user sign in" description="Sign in as a Web user to use Milk Reception.">
          <MilkReceptionScreen onBack={openOcrMenu} />
        </OcrAuthGate>
      )}

      {screen === 'dailyAviz' && (
        <OcrAuthGate requiredPermission="daily_aviz"><DailyAvizScreen onBack={openOcrMenu} /></OcrAuthGate>
      )}

      {screen === 'monthlyReconciliation' && (
        <OcrAuthGate requiredPermission="monthly_reconciliation"><MonthlyReconciliationScreen onBack={openOcrMenu} /></OcrAuthGate>
      )}

      {screen === 'monthClosure' && (
        <OcrAuthGate requiredPermission="month_closure"><MonthClosureScreen onBack={openOcrMenu} /></OcrAuthGate>
      )}

      {screen === 'ocrDocuments' && (
        <OcrAuthGate requiredPermission="ocr_documents"><OcrDocumentScreen onBack={openOcrMenu} /></OcrAuthGate>
      )}

      {screen === 'ocrArchiveHistory' && (
        <OcrAuthGate requiredPermission="ocr_documents"><OcrArchiveHistoryScreen /></OcrAuthGate>
      )}

      {screen === 'ocrReview' && (
        <OcrAuthGate requiredPermission="ocr_documents"><OcrReviewScreen /></OcrAuthGate>
      )}

      {screen === 'ocrSettings' && (
        <OcrAuthGate requiredPermission="ocr_settings"><OcrSettingsScreen /></OcrAuthGate>
      )}

      {screen === 'webUsers' && (
        <OcrAuthGate requiredPermission="app_admin" title="Web admin sign in" description="Sign in as an admin Web user to manage Web users and tile access.">
          <WebUsersScreen onBack={() => { window.location.href = appPath('/home') }} />
        </OcrAuthGate>
      )}

      {screen === 'monthlySettlementReview' && (
        <OcrAuthGate requiredPermission="ocr_documents"><MonthlySettlementReviewScreen /></OcrAuthGate>
      )}

      {screen === 'ocrComparison' && (
        <OcrAuthGate requiredPermission="ocr_documents"><OcrComparisonScreen /></OcrAuthGate>
      )}

      {screen === 'suppliers' && (
        <SupplierSelectionScreen
          successMessage={successMessage}
          submittedCount={submittedCollections.length}
          onBack={openMilkCollectionMenu}
          onSelectSupplier={openSupplierEntry}
        />
      )}

      {screen === 'entry' && selectedSupplier && (
        <MilkCollectionEntryScreen
          supplier={selectedSupplier}
          onBack={returnToSuppliers}
          onSubmit={submitCollection}
        />
      )}

      {screen === 'home' && (
        <div className="home-screen">
          <header className="home-header">
            <div className="home-header-left">
              <div className="home-title-row">
                <h1>
                  {homeMenuGroup === 'milkCollection'
                    ? 'Milk collection'
                    : homeMenuGroup === 'ocr'
                      ? 'OCR'
                      : 'MilkCollect'}
                </h1>
                <button className="home-web-users-btn" type="button" onClick={() => { window.location.href = appPath('/web-users') }}>
                  Web Users
                </button>
              </div>
              {user && (
                <span className="home-username">{user.fullName || user.username}</span>
              )}
            </div>
            {homeMenuGroup === 'milkCollection' && (
              <div className="home-header-right">
                <HomeMilkUserSyncButton />
                <button
                  className="home-icon-btn"
                  onClick={() => openSettings('home')}
                  type="button"
                  aria-label="Settings"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            )}
            {homeMenuGroup === 'ocr' && (
              <div className="home-header-right">
                <button
                  className={`home-header-control-btn ${showOcrConnectionSettings ? 'active' : ''}`}
                  type="button"
                  onClick={() => setShowOcrConnectionSettings((current) => !current)}
                >
                  OCR connection
                </button>
                <HomeOcrSessionButton
                  checking={homeOcrChecking}
                  user={homeOcrUser}
                  onSignOut={() => void handleHomeOcrSignOut()}
                />
              </div>
            )}
          </header>

          <main className="home-main">
            <div className="home-menu-heading">
              {!homeMenuGroup && <p className="home-welcome">Choose a menu</p>}
              {homeMenuGroup && (
                <button className="home-menu-back" type="button" onClick={() => { setHomeMenuGroup(null); setShowOcrConnectionSettings(false) }}>
                  All menus
                </button>
              )}
            </div>
            <div className={`home-grid ${homeMenuGroup ? '' : 'home-group-grid'}`}>
              {!homeMenuGroup && (
                <>
                  <button
                    className="home-tile home-group-tile"
                    type="button"
                    onClick={() => { window.location.href = appPath('/milk-collection') }}
                  >
                    <div className="home-tile-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 3h8" />
                        <path d="M10 3v4l-3 5v6a3 3 0 003 3h4a3 3 0 003-3v-6l-3-5V3" />
                        <path d="M7 14h10" />
                      </svg>
                    </div>
                    <span className="home-tile-label">Milk collection</span>
                  </button>

                  <button
                    className="home-tile home-group-tile"
                    type="button"
                    onClick={() => { window.location.href = appPath('/ocr') }}
                  >
                    <div className="home-tile-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <path d="M14 2v6h6" />
                        <path d="M8 13h8" />
                        <path d="M8 17h5" />
                        <circle cx="9" cy="9" r="1" />
                      </svg>
                    </div>
                    <span className="home-tile-label">OCR</span>
                  </button>
                </>
              )}

              {homeMenuGroup === 'milkCollection' && (
                <>
              <button
                className="home-tile"
                type="button"
                onClick={openSupplierSelection}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 3h8" />
                    <path d="M10 3v4l-3 5v6a3 3 0 003 3h4a3 3 0 003-3v-6l-3-5V3" />
                    <path d="M7 14h10" />
                  </svg>
                </div>
                <span className="home-tile-label">Milk collection</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => setScreen('customers')}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                  </svg>
                </div>
                <span className="home-tile-label">Customers</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => user ? setScreen('dataSync') : openErpLogin('home')}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 01-15.39 6.36L3 16" />
                    <path d="M3 16h5v5" />
                    <path d="M3 12A9 9 0 0118.39 5.64L21 8" />
                    <path d="M21 8h-5V3" />
                  </svg>
                </div>
                <span className="home-tile-label">Data sync</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => user ? setScreen('journal') : openErpLogin('home')}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16v16H4z" />
                    <path d="M8 2v4" />
                    <path d="M16 2v4" />
                    <path d="M4 9h16" />
                    <path d="M8 13h3" />
                    <path d="M8 17h6" />
                  </svg>
                </div>
                <span className="home-tile-label">Journal</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => setScreen('transport')}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 17h4V5H2v12h3" />
                    <path d="M14 8h4l4 4v5h-3" />
                    <circle cx="7.5" cy="17.5" r="2.5" />
                    <circle cx="16.5" cy="17.5" r="2.5" />
                  </svg>
                </div>
                <span className="home-tile-label">Transport</span>
              </button>
                </>
              )}

              {homeMenuGroup === 'ocr' && (
                <>
              {!homeOcrUser && (
                <HomeOcrSignInPanel
                  checking={homeOcrChecking}
                  user={homeOcrUser}
                  onLogin={setHomeOcrUser}
                />
              )}
              {showOcrConnectionSettings ? (
                <HomeOcrConnectionPanel onClose={() => setShowOcrConnectionSettings(false)} />
              ) : null}

              <button
                className="home-tile"
                type="button"
                onClick={() => { window.location.href = appPath('/ocr/upload') }}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M8 13h8" />
                    <path d="M8 17h5" />
                    <circle cx="9" cy="9" r="1" />
                  </svg>
                </div>
                <span className="home-tile-label">OCR documents</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => { window.location.href = appPath('/ocr/archive-history') }}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16" />
                    <path d="M6 7v12a2 2 0 002 2h8a2 2 0 002-2V7" />
                    <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <path d="M9 12h6" />
                    <path d="M9 16h4" />
                  </svg>
                </div>
                <span className="home-tile-label">Backup history</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => { window.location.href = appPath('/milk-reception') }}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h16" />
                    <path d="M4 10h16" />
                    <path d="M4 15h16" />
                    <path d="M8 5v14" />
                    <path d="M16 5v14" />
                    <path d="M4 19h16" />
                  </svg>
                </div>
                <span className="home-tile-label">Milk Reception</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => { window.location.href = appPath('/daily-aviz') }}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h16" />
                    <path d="M4 10h16" />
                    <path d="M7 15h10" />
                    <path d="M7 19h6" />
                    <path d="M4 3v18" />
                    <path d="M20 3v18" />
                  </svg>
                </div>
                <span className="home-tile-label">Daily Aviz</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => { window.location.href = appPath('/monthly-reconciliation') }}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h16" />
                    <path d="M4 11h16" />
                    <path d="M4 17h8" />
                    <path d="M15 16l2 2 4-5" />
                    <path d="M8 5v12" />
                  </svg>
                </div>
                <span className="home-tile-label">Monthly Reconciliation</span>
              </button>

              <button
                className="home-tile"
                type="button"
                onClick={() => { window.location.href = appPath('/month-closure') }}
              >
                <div className="home-tile-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h16" />
                    <path d="M7 9h10" />
                    <path d="M7 13h6" />
                    <path d="M7 17h4" />
                    <path d="M15 16l2 2 4-5" />
                  </svg>
                </div>
                <span className="home-tile-label">Month Closure & Payments</span>
              </button>
                </>
              )}

            </div>
          </main>
        </div>
      )}

      {pendingErpSend && (
        <ErpPayloadDebugModal
          payload={pendingErpSend.payload}
          isSending={pendingErpSending}
          onCancel={() => setPendingErpSend(null)}
          onSend={confirmPendingErpSend}
        />
      )}
    </>
  )
}
