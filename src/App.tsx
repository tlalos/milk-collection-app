import { useState } from 'react'
import { StartupScreen } from './components/StartupScreen'
import './App.css'

type Screen = 'startup' | 'home'

export function App() {
  const [screen, setScreen] = useState<Screen>('startup')

  return (
    <>
      {screen === 'startup' && (
        <StartupScreen onComplete={() => setScreen('home')} />
      )}

      {screen === 'home' && (
        <div className="home-screen">
          <header className="home-header">
            <h1>MilkCollect</h1>
            <span className="offline-badge">Offline ready</span>
          </header>
          <main className="home-main">
            <p className="home-welcome">Welcome. Ready to collect.</p>
          </main>
        </div>
      )}
    </>
  )
}
