import { useState } from 'react'
import { StartupScreen } from './components/StartupScreen'
import { MainScreen } from './components/MainScreen'
import { LoginScreen } from './components/LoginScreen'
import { SettingsScreen } from './components/SettingsScreen'
import { authStore } from './store/authStore'
import type { AuthUser } from './types/auth'
import './App.css'

type Screen = 'startup' | 'main' | 'login' | 'settings' | 'home'

export function App() {
  const [screen, setScreen] = useState<Screen>('startup')
  const [prevScreen, setPrevScreen] = useState<Screen>('main')
  const [user, setUser] = useState<AuthUser | null>(null)

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
    setScreen('main')
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
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen(prevScreen)} />
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
            <p className="home-welcome">Welcome. Ready to collect.</p>
            <button className="eva-button" type="button">eva</button>
          </main>
        </div>
      )}
    </>
  )
}
