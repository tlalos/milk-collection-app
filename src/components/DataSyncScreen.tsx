import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { db } from '../db/database'
import { settingsStore } from '../store/settingsStore'
import { getItemsLastSync, syncItems } from '../sync/syncItems'
import { getSuppliersLastSync, syncSuppliers } from '../sync/syncSuppliers'
import './DataSyncScreen.css'

interface DataSyncScreenProps {
  onBack: () => void
}

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'
type SyncTarget = 'suppliers' | 'items'

function formatDateTime(value: string | null) {
  if (!value) return 'Never'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function DataSyncScreen({ onBack }: DataSyncScreenProps) {
  const settings = settingsStore.get()
  const [mode, setMode] = useState('ALL')
  const [username, setUsername] = useState(settings.apiUsername)
  const [supplierCount, setSupplierCount] = useState(0)
  const [itemCount, setItemCount] = useState(0)
  const [suppliersLastSync, setSuppliersLastSync] = useState<string | null>(getSuppliersLastSync())
  const [itemsLastSync, setItemsLastSync] = useState<string | null>(getItemsLastSync())
  const [status, setStatus] = useState<Record<SyncTarget, SyncStatus>>({
    suppliers: 'idle',
    items: 'idle',
  })
  const [message, setMessage] = useState<Record<SyncTarget, string>>({
    suppliers: '',
    items: '',
  })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    db.suppliers.count()
      .then(setSupplierCount)
      .catch(() => setSupplierCount(0))
    db.items.count()
      .then(setItemCount)
      .catch(() => setItemCount(0))

    return () => abortRef.current?.abort()
  }, [])

  function setTargetStatus(target: SyncTarget, nextStatus: SyncStatus) {
    setStatus((current) => ({ ...current, [target]: nextStatus }))
  }

  function setTargetMessage(target: SyncTarget, nextMessage: string) {
    setMessage((current) => ({ ...current, [target]: nextMessage }))
  }

  function getErrorMessage(err: unknown, label: string) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) {
        return `Authentication failed (${err.status}). Check API credentials in Settings.`
      }

      if (err.status === 404) {
        return `${label} endpoint not found (404). Check the server URL in Settings.`
      }

      return `Server error (${err.status}): ${err.message}`
    }

    return (err as Error).message || 'Network error. Check Settings and try again.'
  }

  async function handleSupplierSync() {
    if (status.suppliers === 'syncing') return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setTargetStatus('suppliers', 'syncing')
    setTargetMessage('suppliers', '')

    try {
      const count = await syncSuppliers(
        { mode, username },
        abortRef.current.signal,
      )
      setSupplierCount(count)
      setSuppliersLastSync(getSuppliersLastSync())
      setTargetStatus('suppliers', 'success')
      setTargetMessage('suppliers', `${count} suppliers synced locally.`)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return

      setTargetStatus('suppliers', 'error')
      setTargetMessage('suppliers', getErrorMessage(err, 'Supplier'))
    }
  }

  async function handleItemSync() {
    if (status.items === 'syncing') return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setTargetStatus('items', 'syncing')
    setTargetMessage('items', '')

    try {
      const count = await syncItems(
        { mode, username },
        abortRef.current.signal,
      )
      setItemCount(count)
      setItemsLastSync(getItemsLastSync())
      setTargetStatus('items', 'success')
      setTargetMessage('items', `${count} items synced locally.`)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return

      setTargetStatus('items', 'error')
      setTargetMessage('items', getErrorMessage(err, 'Items'))
    }
  }

  return (
    <div className="data-sync-screen">
      <header className="data-sync-header">
        <button className="data-sync-back" onClick={onBack} type="button" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>Data sync</h1>
      </header>

      <main className="data-sync-body">
        <section className="data-sync-summary" aria-label="Local data status">
          <div className="data-sync-stat">
            <span>Suppliers</span>
            <strong>{supplierCount}</strong>
          </div>
          <div className="data-sync-stat">
            <span>Supplier sync</span>
            <strong>{formatDateTime(suppliersLastSync)}</strong>
          </div>
          <div className="data-sync-stat">
            <span>Items</span>
            <strong>{itemCount}</strong>
          </div>
          <div className="data-sync-stat">
            <span>Item sync</span>
            <strong>{formatDateTime(itemsLastSync)}</strong>
          </div>
        </section>

        <section className="data-sync-panel" aria-labelledby="sync-parameters-title">
          <div className="data-sync-panel-header">
            <div>
              <h2 id="sync-parameters-title">Sync parameters</h2>
              <p>These values are sent to each offline ERP list endpoint.</p>
            </div>
            <span className="data-sync-badge">Shared</span>
          </div>

          <div className="data-sync-fields">
            <label className="data-sync-field" htmlFor="supplier-sync-mode">
              <span>Mode</span>
              <input
                id="supplier-sync-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                autoComplete="off"
              />
            </label>

            <label className="data-sync-field" htmlFor="supplier-sync-username">
              <span>Username</span>
              <input
                id="supplier-sync-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
              />
            </label>
          </div>
        </section>

        <section className="data-sync-panel" aria-labelledby="supplier-sync-title">
          <div className="data-sync-panel-header">
            <div>
              <h2 id="supplier-sync-title">Supplier local sync</h2>
              <p>Downloads suppliers from ERP and replaces the local offline supplier list.</p>
            </div>
            <span className="data-sync-badge">Step 1</span>
          </div>

          <button
            className="data-sync-button"
            type="button"
            onClick={handleSupplierSync}
            disabled={status.suppliers === 'syncing'}
          >
            {status.suppliers === 'syncing' ? (
              <svg className="spin" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            )}
            Sync suppliers
          </button>

          {message.suppliers && (
            <p className={`data-sync-message ${status.suppliers === 'error' ? 'error' : 'success'}`} role="status">
              {message.suppliers}
            </p>
          )}
        </section>

        <section className="data-sync-panel" aria-labelledby="item-sync-title">
          <div className="data-sync-panel-header">
            <div>
              <h2 id="item-sync-title">Item local sync</h2>
              <p>Downloads ERP items for supplies and milk collection and stores them locally.</p>
            </div>
            <span className="data-sync-badge">Step 2</span>
          </div>

          <button
            className="data-sync-button"
            type="button"
            onClick={handleItemSync}
            disabled={status.items === 'syncing'}
          >
            {status.items === 'syncing' ? (
              <svg className="spin" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            )}
            Sync items
          </button>

          {message.items && (
            <p className={`data-sync-message ${status.items === 'error' ? 'error' : 'success'}`} role="status">
              {message.items}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}
