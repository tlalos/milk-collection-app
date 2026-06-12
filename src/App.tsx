import { useState } from 'react'
import { CustomersScreen } from './components/CustomersScreen'
import { DataSyncScreen } from './components/DataSyncScreen'
import { LoginScreen } from './components/LoginScreen'
import { MainScreen } from './components/MainScreen'
import { MilkCollectionEntryScreen } from './components/MilkCollectionEntryScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { StartupScreen } from './components/StartupScreen'
import { SupplierSelectionScreen } from './components/SupplierSelectionScreen'
import { authStore } from './store/authStore'
import type { AuthUser } from './types/auth'
import type { SubmittedCollection, Supplier } from './types'
import './App.css'

type Screen =
  | 'startup'
  | 'main'
  | 'login'
  | 'settings'
  | 'home'
  | 'customers'
  | 'dataSync'
  | 'suppliers'
  | 'entry'

export function App() {
  const [screen, setScreen] = useState<Screen>('startup')
  const [prevScreen, setPrevScreen] = useState<Screen>('main')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [submittedCollections, setSubmittedCollections] = useState<SubmittedCollection[]>([])
  const [successMessage, setSuccessMessage] = useState('')

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

  function submitCollection(collection: SubmittedCollection) {
    setSubmittedCollections((current) => [collection, ...current])
    setSuccessMessage(`Collection submitted for ${collection.supplier.name}.`)
    setSelectedSupplier(null)
    setScreen('suppliers')
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
        <DataSyncScreen onBack={() => setScreen('home')} />
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
            </div>
          </main>
        </div>
      )}
    </>
  )
}
