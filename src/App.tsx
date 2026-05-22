import { useState } from 'react'
import { StartupScreen } from './components/StartupScreen'
import { LoginScreen } from './components/LoginScreen'
import { authStore } from './store/authStore'
import type { AuthUser } from './types/auth'
import './App.css'

type Screen = 'startup' | 'login' | 'home'

export function App() {
  const [screen, setScreen] = useState<Screen>('startup')
  const [user, setUser] = useState<AuthUser | null>(null)

  function handleStartupComplete() {
    if (authStore.isLoggedIn()) {
      setUser(authStore.getUser())
      setScreen('home')
    } else {
      setScreen('login')
    }
  }

  function handleLogin(loggedInUser: AuthUser) {
    setUser(loggedInUser)
    setScreen('home')
  }

  function handleLogout() {
    authStore.clear()
    setUser(null)
    setScreen('login')
  }

  return (
    <>
      {screen === 'startup' && (
        <StartupScreen onComplete={handleStartupComplete} />
      )}

      {screen === 'login' && (
        <LoginScreen onLogin={handleLogin} />
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
