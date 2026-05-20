import { useEffect, useState } from 'react'
import './StartupScreen.css'

interface StartupScreenProps {
  onComplete: () => void
}

export function StartupScreen({ onComplete }: StartupScreenProps) {
  const [phase, setPhase] = useState<'logo' | 'tagline' | 'done'>('logo')

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('tagline'), 800)
    const t2 = setTimeout(() => setPhase('done'), 2200)
    const t3 = setTimeout(() => onComplete(), 2600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [onComplete])

  return (
    <div className={`startup-screen ${phase}`}>
      <div className="startup-content">
        <div className="startup-icon">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Milk bottle silhouette */}
            <path
              d="M28 14h24v6l6 10v34a6 6 0 01-6 6H28a6 6 0 01-6-6V30l6-10V14z"
              fill="white"
              fillOpacity="0.15"
              stroke="white"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <path
              d="M32 14h16v5H32V14z"
              fill="white"
              fillOpacity="0.3"
              stroke="white"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Milk fill */}
            <path
              d="M22 42h36v20a6 6 0 01-6 6H28a6 6 0 01-6-6V42z"
              fill="white"
              fillOpacity="0.9"
            />
            {/* Wavy milk line */}
            <path
              d="M22 42 Q28 38 34 42 Q40 46 46 42 Q52 38 58 42"
              fill="none"
              stroke="white"
              strokeWidth="2"
            />
          </svg>
        </div>

        <h1 className="startup-title">MilkCollect</h1>

        <p className="startup-tagline">
          Smart milk collection, even offline
        </p>
      </div>

      <div className="startup-footer">
        <div className="startup-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}
