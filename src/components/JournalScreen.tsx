import { useEffect, useMemo, useState } from 'react'
import {
  deleteJournalCollection,
  deleteJournalEntriesByDate,
  getJournalEntriesByCollection,
  getJournalEntriesByDate,
  journalEntriesToCollection,
  toLocalDateKey,
  updateJournalCollectionErpStatus,
} from '../store/journalStore'
import {
  createSuppliesOrderPayload,
  sendSuppliesOrderPayloadToErp,
} from '../store/suppliesOrderStore'
import { ErpPayloadDebugModal } from './ErpPayloadDebugModal'
import type { AuthUser } from '../types/auth'
import type { JournalEntry } from '../types/journal'
import type { ERP_SuppliesPickingOrder } from '../types/suppliesOrder'
import './JournalScreen.css'

interface JournalScreenProps {
  onBack: () => void
  user: AuthUser
}

interface JournalOrder {
  collectionId: string
  supplierName: string
  supplierCode: string
  submittedAt: string
  entries: JournalEntry[]
  totalKg: number
  measure: string
  erpStatus: JournalEntry['erpStatus']
  erpMessage: string
}

function formatQuantity(value: number, measure = 'kg') {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${measure || 'kg'}`
}

function getSharedMeasure(entries: JournalEntry[]) {
  const measures = entries
    .map((entry) => entry.itemMeasure?.trim())
    .filter((measure): measure is string => Boolean(measure))
  const normalizedMeasures = new Set(measures.map((measure) => measure.toLowerCase()))

  if (normalizedMeasures.size === 1) return measures[0]
  if (normalizedMeasures.size > 1) return 'units'
  return 'kg'
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getOrderStatus(entries: JournalEntry[]): JournalEntry['erpStatus'] {
  if (entries.some((entry) => entry.erpStatus === 'sending')) return 'sending'
  if (entries.some((entry) => entry.erpStatus === 'failed')) return 'failed'
  if (entries.every((entry) => entry.erpStatus === 'sent')) return 'sent'
  return 'pending'
}

export function JournalScreen({ onBack, user }: JournalScreenProps) {
  const [selectedDate, setSelectedDate] = useState(toLocalDateKey())
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingAll, setClearingAll] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [debugPayload, setDebugPayload] = useState<{
    collectionId: string
    payload: ERP_SuppliesPickingOrder[]
  } | null>(null)

  async function refreshEntries(date = selectedDate) {
    const records = await getJournalEntriesByDate(date)
    setEntries(records)
  }

  useEffect(() => {
    let isMounted = true
    setStatus('loading')
    setConfirmDeleteId(null)
    setConfirmClearAll(false)

    getJournalEntriesByDate(selectedDate)
      .then((records) => {
        if (!isMounted) return
        setEntries(records)
        setStatus('ready')
      })
      .catch(() => {
        if (!isMounted) return
        setEntries([])
        setStatus('error')
      })

    return () => {
      isMounted = false
    }
  }, [selectedDate])

  const orders = useMemo<JournalOrder[]>(() => {
    const grouped = new Map<string, JournalEntry[]>()

    for (const entry of entries) {
      const current = grouped.get(entry.collectionId) ?? []
      current.push(entry)
      grouped.set(entry.collectionId, current)
    }

    return Array.from(grouped.entries()).map(([collectionId, orderEntries]) => {
      const first = orderEntries[0]
      const messageEntry = [...orderEntries].reverse().find((entry) => entry.erpMessage)

      return {
        collectionId,
        supplierName: first.supplierName,
        supplierCode: first.supplierCode,
        submittedAt: first.submittedAt,
        entries: orderEntries,
        totalKg: orderEntries.reduce((total, entry) => total + entry.kg, 0),
        measure: getSharedMeasure(orderEntries),
        erpStatus: getOrderStatus(orderEntries),
        erpMessage: messageEntry?.erpMessage ?? '',
      }
    })
  }, [entries])

  const totalKg = useMemo(
    () => entries.reduce((total, entry) => total + entry.kg, 0),
    [entries],
  )
  const totalMeasure = useMemo(() => getSharedMeasure(entries), [entries])

  const totalsByMilkType = useMemo(() => {
    const totals = new Map<string, number>()
    const measures = new Map<string, string>()

    for (const entry of entries) {
      totals.set(entry.milkType, (totals.get(entry.milkType) ?? 0) + entry.kg)
      if (entry.itemMeasure && !measures.has(entry.milkType)) {
        measures.set(entry.milkType, entry.itemMeasure)
      }
    }

    return Array.from(totals.entries())
      .map(([milkType, kg]) => ({ milkType, kg, measure: measures.get(milkType) ?? 'kg' }))
      .sort((a, b) => b.kg - a.kg)
  }, [entries])

  async function handleSendToErp(collectionId: string) {
    if (sendingId || deletingId || clearingAll) return

    setSendingId(collectionId)
    try {
      const orderEntries = await getJournalEntriesByCollection(collectionId)
      const collection = journalEntriesToCollection(orderEntries)
      const payload = await createSuppliesOrderPayload(collection, user)
      setDebugPayload({ collectionId, payload })
    } catch (err) {
      await updateJournalCollectionErpStatus(
        collectionId,
        'failed',
        (err as Error).message || 'ERP sync failed.',
      )
    } finally {
      setSendingId(null)
      await refreshEntries()
    }
  }

  async function confirmSendToErp() {
    if (!debugPayload || sendingId || deletingId || clearingAll) return

    setSendingId(debugPayload.collectionId)
    await updateJournalCollectionErpStatus(debugPayload.collectionId, 'sending', 'Sending order to ERP...')
    await refreshEntries()

    try {
      const response = await sendSuppliesOrderPayloadToErp(debugPayload.payload)
      const message = response.newid
        ? `Sent to ERP. New document #${response.newid}.`
        : 'Sent to ERP.'
      await updateJournalCollectionErpStatus(debugPayload.collectionId, 'sent', message, response.newid ?? '')
      setDebugPayload(null)
    } catch (err) {
      await updateJournalCollectionErpStatus(
        debugPayload.collectionId,
        'failed',
        (err as Error).message || 'ERP sync failed.',
      )
    } finally {
      setSendingId(null)
      await refreshEntries()
    }
  }

  async function handleDeleteCollection(collectionId: string) {
    if (sendingId || deletingId || clearingAll) return

    if (confirmDeleteId !== collectionId) {
      setConfirmDeleteId(collectionId)
      setConfirmClearAll(false)
      return
    }

    setDeletingId(collectionId)
    setDebugPayload((current) => current?.collectionId === collectionId ? null : current)

    try {
      await deleteJournalCollection(collectionId)
      setConfirmDeleteId(null)
    } finally {
      setDeletingId(null)
      await refreshEntries()
    }
  }

  async function handleClearAllForDate() {
    if (sendingId || deletingId || clearingAll || entries.length === 0) return

    if (!confirmClearAll) {
      setConfirmClearAll(true)
      setConfirmDeleteId(null)
      return
    }

    setClearingAll(true)
    setDebugPayload(null)

    try {
      await deleteJournalEntriesByDate(selectedDate)
      setConfirmClearAll(false)
    } finally {
      setClearingAll(false)
      await refreshEntries()
    }
  }

  return (
    <div className="journal-screen">
      <header className="journal-header">
        <button className="journal-back" onClick={onBack} type="button" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1>Journal</h1>
        <button
          className={`journal-clear-button ${confirmClearAll ? 'confirm' : ''}`}
          type="button"
          onClick={handleClearAllForDate}
          disabled={status !== 'ready' || entries.length === 0 || Boolean(sendingId || deletingId || clearingAll)}
        >
          {clearingAll ? 'Clearing...' : confirmClearAll ? 'Confirm clear' : 'Clear all'}
        </button>
      </header>

      <main className="journal-body">
        <section className="journal-date-panel">
          <label htmlFor="journal-date">Collection date</label>
          <input
            id="journal-date"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </section>

        <section className="journal-summary" aria-label="Journal totals">
          <div className="journal-stat">
            <span>Pickups</span>
            <strong>{orders.length}</strong>
          </div>
          <div className="journal-stat">
            <span>Total quantity</span>
            <strong>{formatQuantity(totalKg, totalMeasure)}</strong>
          </div>

          {totalsByMilkType.length > 0 && (
            <div className="journal-type-totals" aria-label="Total quantity per milk type">
              <div className="journal-section-heading">
                <span>By milk type</span>
              </div>

              <div className="journal-type-total-list">
                {totalsByMilkType.map((total) => (
                  <div className="journal-type-total" key={total.milkType}>
                    <span>{total.milkType}:</span>
                    <strong>{formatQuantity(total.kg, total.measure)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {status === 'loading' && (
          <div className="journal-empty">Loading journal...</div>
        )}

        {status === 'error' && (
          <div className="journal-error">Could not load the local journal.</div>
        )}

        {status === 'ready' && orders.length === 0 && (
          <div className="journal-empty">
            No supply orders recorded for this date.
          </div>
        )}

        {status === 'ready' && orders.length > 0 && (
          <section className="journal-list" aria-label="Supply order list">
            {orders.map((order) => (
              <article className="journal-entry-card" key={order.collectionId}>
                <div className="journal-entry-main">
                  <strong>{order.supplierName}</strong>
                  <span>{order.supplierCode} - {formatTime(order.submittedAt)}</span>
                  <div className="journal-entry-lines">
                    {order.entries.map((entry) => (
                      <span key={entry.id ?? `${order.collectionId}-${entry.milkType}`}>
                        {entry.milkType}: {formatQuantity(entry.kg, entry.itemMeasure)}
                      </span>
                    ))}
                  </div>
                  {order.erpMessage && (
                    <p className={`journal-erp-message ${order.erpStatus}`}>
                      {order.erpMessage}
                    </p>
                  )}
                </div>
                <div className="journal-entry-actions">
                  <span className="journal-entry-kg">{formatQuantity(order.totalKg, order.measure)}</span>
                  <button
                    className={`journal-send-button ${order.erpStatus}`}
                    type="button"
                    onClick={() => handleSendToErp(order.collectionId)}
                    disabled={Boolean(sendingId || deletingId || clearingAll)}
                  >
                    {sendingId === order.collectionId || order.erpStatus === 'sending'
                      ? 'Sending...'
                      : order.erpStatus === 'sent'
                        ? 'Send again'
                        : 'Send to ERP'}
                  </button>
                  <button
                    className={`journal-delete-button ${confirmDeleteId === order.collectionId ? 'confirm' : ''}`}
                    type="button"
                    onClick={() => handleDeleteCollection(order.collectionId)}
                    disabled={Boolean(sendingId || deletingId || clearingAll)}
                    aria-label={`Delete ${order.supplierName} pickup`}
                    title="Delete pickup"
                  >
                    {deletingId === order.collectionId ? (
                      'Deleting...'
                    ) : confirmDeleteId === order.collectionId ? (
                      'Confirm'
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v5" />
                        <path d="M14 11v5" />
                      </svg>
                    )}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
      {debugPayload && (
        <ErpPayloadDebugModal
          payload={debugPayload.payload}
          isSending={sendingId === debugPayload.collectionId}
          onCancel={() => setDebugPayload(null)}
          onSend={confirmSendToErp}
        />
      )}
    </div>
  )
}
