import './MainScreen.css'

interface MainScreenProps {
  onSignIn: () => void
  onSettings: () => void
}

export function MainScreen({ onSignIn, onSettings }: MainScreenProps) {
  return (
    <div className="main-screen">
      {/* Settings gear — top-right */}
      <button className="main-settings-btn" type="button" onClick={onSettings} aria-label="Settings">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Hero */}
      <div className="main-hero">
        <div className="main-logo">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M26 14h28v7l7 12v35a7 7 0 01-7 7H26a7 7 0 01-7-7V33l7-12V14z"
              fill="white" fillOpacity="0.15" stroke="white" strokeWidth="2.5" strokeLinejoin="round"
            />
            <path
              d="M31 14h18v7H31V14z"
              fill="white" fillOpacity="0.25" stroke="white" strokeWidth="2" strokeLinejoin="round"
            />
            <path
              d="M19 43h42v25a7 7 0 01-7 7H26a7 7 0 01-7-7V43z"
              fill="white" fillOpacity="0.92"
            />
            <path
              d="M19 43 Q26 38 33 43 Q40 48 47 43 Q54 38 61 43"
              fill="none" stroke="white" strokeWidth="2.5"
            />
          </svg>
        </div>

        <h1 className="main-title">MilkCollect</h1>
        <p className="main-tagline">Smart milk collection management</p>

        <div className="main-features">
          <span className="main-feature-chip">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5a5.5 5.5 0 110-11 5.5 5.5 0 010 11zm.75-8.25a.75.75 0 00-1.5 0v3.5l2.25 2.25a.75.75 0 001.06-1.06L8.75 7.94V5.25z"/></svg>
            Offline ready
          </span>
          <span className="main-feature-chip">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3A1.5 1.5 0 000 4.5v7A1.5 1.5 0 001.5 13h13a1.5 1.5 0 001.5-1.5v-7A1.5 1.5 0 0014.5 3h-13zm5 2h3a.5.5 0 010 1h-3a.5.5 0 010-1zm-3 0h1a.5.5 0 010 1h-1a.5.5 0 010-1zm7 0h1a.5.5 0 010 1h-1a.5.5 0 010-1zM2 7h1v1H2V7zm2 0h1v1H4V7zm2 0h1v1H6V7zm2 0h1v1H8V7zm2 0h1v1h-1V7zm2 0h1v1h-1V7zM2 9h1v1H2V9zm2 0h5v1H4V9zm6 0h2v1h-2V9z"/></svg>
            Barcode scan
          </span>
          <span className="main-feature-chip">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM2.04 7.34A6.01 6.01 0 017.34 2.04v1.53a4.5 4.5 0 00-3.77 3.77H2.04zm0 1.32h1.53a4.5 4.5 0 003.77 3.77v1.53A6.01 6.01 0 012.04 8.66zm9.92-1.32h-1.53A4.5 4.5 0 006.66 3.57V2.04a6.01 6.01 0 015.3 5.3zm0 1.32A6.01 6.01 0 018.66 13.96v-1.53a4.5 4.5 0 003.77-3.77h1.53z"/></svg>
            Auto-sync
          </span>
        </div>
      </div>

      {/* Bottom card */}
      <div className="main-bottom">
        <button className="main-signin-btn" type="button" onClick={onSignIn}>
          Sign in
        </button>
        <p className="main-version">MilkCollect v0.1.0</p>
      </div>
    </div>
  )
}
