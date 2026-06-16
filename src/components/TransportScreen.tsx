import { useEffect, useState, type FormEvent } from 'react'
import { getTransportDetails, saveTransportDetails } from '../store/transportStore'
import type { TransportDetails } from '../types/transport'
import './TransportScreen.css'

interface TransportScreenProps {
  onBack: () => void
  initialDriverName?: string
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function TransportScreen({ onBack, initialDriverName = '' }: TransportScreenProps) {
  const [transporterName, setTransporterName] = useState('')
  const [truckNumber, setTruckNumber] = useState('')
  const [driverName, setDriverName] = useState(initialDriverName)
  const [savedDetails, setSavedDetails] = useState<TransportDetails | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    getTransportDetails()
      .then((details) => {
        if (!isMounted) return

        if (details) {
          setTransporterName(details.transporterName)
          setTruckNumber(details.truckNumber)
          setDriverName(details.driverName)
          setSavedDetails(details)
        }

        setStatus('ready')
      })
      .catch(() => {
        if (!isMounted) return
        setStatus('error')
        setMessage('Could not load local transport details.')
      })

    return () => {
      isMounted = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('saving')
    setMessage('')

    try {
      const details = await saveTransportDetails({
        transporterName,
        truckNumber,
        driverName,
      })
      setSavedDetails(details)
      setStatus('saved')
      setMessage('Transport details saved locally.')
    } catch {
      setStatus('error')
      setMessage('Could not save transport details locally.')
    }
  }

  const canSave = transporterName.trim() && truckNumber.trim() && driverName.trim()

  return (
    <div className="transport-screen">
      <header className="transport-header">
        <button className="transport-back" onClick={onBack} type="button" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>Transport</h1>
      </header>

      <main className="transport-body">
        <section className="transport-panel" aria-labelledby="transport-title">
          <div className="transport-panel-heading">
            <h2 id="transport-title">Transport details</h2>
            <p>Enter the transporter, truck, and driver details for local use.</p>
          </div>

          <form className="transport-form" onSubmit={handleSubmit}>
            <label className="transport-field" htmlFor="transporter-name">
              <span>Transporter name</span>
              <input
                id="transporter-name"
                value={transporterName}
                onChange={(event) => setTransporterName(event.target.value)}
                autoComplete="organization"
              />
            </label>

            <label className="transport-field" htmlFor="truck-number">
              <span>Truck number</span>
              <input
                id="truck-number"
                value={truckNumber}
                onChange={(event) => setTruckNumber(event.target.value.toUpperCase())}
                autoComplete="off"
              />
            </label>

            <label className="transport-field" htmlFor="driver-name">
              <span>Driver name</span>
              <input
                id="driver-name"
                value={driverName}
                onChange={(event) => setDriverName(event.target.value)}
                autoComplete="name"
              />
            </label>

            <button className="transport-save" type="submit" disabled={!canSave || status === 'saving'}>
              {status === 'saving' ? 'Saving...' : 'Save locally'}
            </button>
          </form>
        </section>

        {message && (
          <p className={`transport-message ${status === 'error' ? 'error' : ''}`} role="status">
            {message}
          </p>
        )}

        {savedDetails && (
          <section className="transport-saved-card" aria-labelledby="transport-saved-title">
            <h2 id="transport-saved-title">Saved locally</h2>
            <div className="transport-saved-grid">
              <div className="transport-saved-item">
                <span>Transporter</span>
                <strong>{savedDetails.transporterName}</strong>
              </div>
              <div className="transport-saved-item">
                <span>Truck number</span>
                <strong>{savedDetails.truckNumber}</strong>
              </div>
              <div className="transport-saved-item">
                <span>Driver name</span>
                <strong>{savedDetails.driverName}</strong>
              </div>
            </div>
            <p className="transport-updated">
              Last saved: {formatUpdatedAt(savedDetails.updatedAt)}
            </p>
          </section>
        )}
      </main>
    </div>
  )
}
