import { useState } from 'react'
import { CustomersScreen } from './components/CustomersScreen'
import { DataSyncScreen } from './components/DataSyncScreen'
import { JournalScreen } from './components/JournalScreen'
import { LoginScreen } from './components/LoginScreen'
import { MainScreen } from './components/MainScreen'
import { MilkCollectionEntryScreen } from './components/MilkCollectionEntryScreen'
import { OcrDocumentScreen } from './components/OcrDocumentScreen'
import { OcrReviewScreen } from './components/OcrReviewScreen'
import { OcrSettingsScreen } from './components/OcrSettingsScreen'
import { MonthlySettlementReviewScreen } from './components/MonthlySettlementReviewScreen'
import { OcrComparisonScreen } from './components/OcrComparisonScreen'
import { OcrAuthGate } from './components/OcrAuthGate'
import { SettingsScreen } from './components/SettingsScreen'
import { StartupScreen } from './components/StartupScreen'
import { SupplierSelectionScreen } from './components/SupplierSelectionScreen'
import { TransportScreen } from './components/TransportScreen'
import { authStore } from './store/authStore'
import { ErpPayloadDebugModal } from './components/ErpPayloadDebugModal'
import { saveCollectionToJournal, updateJournalCollectionErpStatus } from './store/journalStore'
import {
  createSuppliesOrderPayload,
  sendSuppliesOrderPayloadToErp,
} from './store/suppliesOrderStore'
import type { AuthUser } from './types/auth'
import type { SubmittedCollection, Supplier } from './types'
import type { ERP_SuppliesPickingOrder } from './types/suppliesOrder'
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
  | 'suppliers'
  | 'entry'
  | 'ocrDocuments'
  | 'ocrReview'
  | 'ocrSettings'
  | 'monthlySettlementReview'
  | 'ocrComparison'

function initialScreen(): Screen {
  if (routePathname() === '/ocr/upload') return 'ocrDocuments'
  if (routePathname() === '/ocr/review') return 'ocrReview'
  if (routePathname() === '/ocr/settings') return 'ocrSettings'
  if (routePathname() === '/ocr/monthly-review') return 'monthlySettlementReview'
  if (routePathname() === '/ocr/compare') return 'ocrComparison'
  return 'startup'
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [prevScreen, setPrevScreen] = useState<Screen>('main')
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
    setScreen('home')
  }

  function openSettings(from: Screen) {
    setPrevScreen(from)
    setScreen('settings')
  }

  function handleLogout() {
    authStore.clear()
    setUser(null)
    setSelectedSupplier(null)
    setSuccessMessage('')
    setScreen('main')
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
          onSignIn={() => setScreen('login')}
          onSettings={() => openSettings('main')}
        />
      )}

      {screen === 'login' && (
        <LoginScreen
          onLogin={handleLogin}
          onBack={() => setScreen('main')}
          initialUsername={authStore.getLastUsername()}
          initialPassword={authStore.getLastPassword()}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen(prevScreen)} />
      )}

      {screen === 'customers' && (
        <CustomersScreen onBack={() => setScreen('home')} />
      )}

      {screen === 'dataSync' && (
        user && <DataSyncScreen onBack={() => setScreen('home')} user={user} />
      )}

      {screen === 'journal' && (
        user && <JournalScreen onBack={() => setScreen('home')} user={user} />
      )}

      {screen === 'transport' && (
        <TransportScreen onBack={() => setScreen('home')} />
      )}

      {screen === 'ocrDocuments' && (
        <OcrAuthGate><OcrDocumentScreen onBack={() => { window.location.href = appPath('/') }} /></OcrAuthGate>
      )}

      {screen === 'ocrReview' && (
        <OcrAuthGate><OcrReviewScreen /></OcrAuthGate>
      )}

      {screen === 'ocrSettings' && (
        <OcrAuthGate><OcrSettingsScreen /></OcrAuthGate>
      )}

      {screen === 'monthlySettlementReview' && (
        <OcrAuthGate><MonthlySettlementReviewScreen /></OcrAuthGate>
      )}

      {screen === 'ocrComparison' && (
        <OcrAuthGate><OcrComparisonScreen /></OcrAuthGate>
      )}

      {screen === 'suppliers' && (
        <SupplierSelectionScreen
          successMessage={successMessage}
          submittedCount={submittedCollections.length}
          onBack={() => setScreen('home')}
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
              <h1>MilkCollect</h1>
              {user && (
                <span className="home-username">{user.fullName || user.username}</span>
              )}
            </div>
            <div className="home-header-right">
              <span className="offline-badge">Offline ready</span>
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
              <button className="logout-btn" onClick={handleLogout} type="button">
                Sign out
              </button>
            </div>
          </header>

          <main className="home-main">
            <p className="home-welcome">What would you like to do?</p>
            <div className="home-grid">
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
                onClick={() => setScreen('dataSync')}
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
                onClick={() => setScreen('journal')}
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
