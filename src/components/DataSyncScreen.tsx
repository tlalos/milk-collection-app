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
type SyncStage = 'idle' | 'suppliers' | 'items' | 'complete' | 'error'

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
  const [stage, setStage] = useState<SyncStage>('idle')
  const [progress, setProgress] = useState(0)
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

  const isSyncing = stage === 'suppliers' || stage === 'items'

  async function handleSyncAll() {
    if (isSyncing) return

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setStage('suppliers')
    setProgress(0)
    setTargetStatus('suppliers', 'syncing')
    setTargetStatus('items', 'idle')
    setTargetMessage('suppliers', '')
    setTargetMessage('items', '')
    let currentTarget: SyncTarget = 'suppliers'

    try {
      const supplierTotal = await syncSuppliers(
        { mode, username },
        abortRef.current.signal,
      )
      setSupplierCount(supplierTotal)
      setSuppliersLastSync(getSuppliersLastSync())
      setTargetStatus('suppliers', 'success')
      setTargetMessage('suppliers', `${supplierTotal} suppliers synced locally.`)
      setProgress(50)
      setStage('items')
      currentTarget = 'items'
      setTargetStatus('items', 'syncing')

      const itemTotal = await syncItems(
        { mode, username },
        abortRef.current.signal,
      )
      setItemCount(itemTotal)
      setItemsLastSync(getItemsLastSync())
      setTargetStatus('items', 'success')
      setTargetMessage('items', `${itemTotal} items synced locally.`)
      setProgress(100)
      setStage('complete')
    } catch (err) {
      if ((err as Error).name === 'AbortError') return

      setStage('error')
      if (currentTarget === 'items') {
        setTargetStatus('items', 'error')
        setTargetMessage('items', getErrorMessage(err, 'Items'))
      } else {
        setTargetStatus('suppliers', 'error')
        setTargetMessage('suppliers', getErrorMessage(err, 'Supplier'))
      }
    }
  }

  const progressLabel = stage === 'suppliers'
    ? 'Syncing suppliers...'
    : stage === 'items'
      ? 'Syncing items...'
      : stage === 'complete'
        ? 'Sync complete'
        : stage === 'error'
          ? 'Sync stopped'
          : 'Ready to sync'

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

        <section className="data-sync-panel" aria-labelledby="sync-all-title">
          <div className="data-sync-panel-header">
            <div>
              <h2 id="sync-all-title">Run local sync</h2>
              <p>Syncs suppliers first, then ERP items, and replaces the local offline data.</p>
            </div>
            <span className="data-sync-badge">2 steps</span>
          </div>

          <button
            className="data-sync-button data-sync-primary-button"
            type="button"
            onClick={handleSyncAll}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <svg className="spin" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            )}
            Sync suppliers and items
          </button>

          <div className="data-sync-progress" aria-label={progressLabel}>
            <div className="data-sync-progress-top">
              <span>{progressLabel}</span>
              <strong>{progress}%</strong>
            </div>
            <div className="data-sync-progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="data-sync-steps" aria-label="Sync steps">
            <div className={`data-sync-step ${status.suppliers}`}>
              <span className="data-sync-step-dot" />
              <div>
                <strong>Suppliers</strong>
                <p>{message.suppliers || 'Waiting for sync'}</p>
              </div>
            </div>

            <div className={`data-sync-step ${status.items}`}>
              <span className="data-sync-step-dot" />
              <div>
                <strong>Items</strong>
                <p>{message.items || 'Waiting for sync'}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
