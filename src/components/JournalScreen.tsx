import { useEffect, useMemo, useState } from 'react'
import {
  getJournalEntriesByCollection,
  getJournalEntriesByDate,
  journalEntriesToCollection,
  toLocalDateKey,
  updateJournalCollectionErpStatus,
} from '../store/journalStore'
import { sendSuppliesOrderToErp } from '../store/suppliesOrderStore'
import type { AuthUser } from '../types/auth'
import type { JournalEntry } from '../types/journal'
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
  erpStatus: JournalEntry['erpStatus']
  erpMessage: string
}

function formatKg(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`
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

  async function refreshEntries(date = selectedDate) {
    const records = await getJournalEntriesByDate(date)
    setEntries(records)
  }

  useEffect(() => {
    let isMounted = true
    setStatus('loading')

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
        erpStatus: getOrderStatus(orderEntries),
        erpMessage: messageEntry?.erpMessage ?? '',
      }
    })
  }, [entries])

  const totalKg = useMemo(
    () => entries.reduce((total, entry) => total + entry.kg, 0),
    [entries],
  )

  const totalsByMilkType = useMemo(() => {
    const totals = new Map<string, number>()

    for (const entry of entries) {
      totals.set(entry.milkType, (totals.get(entry.milkType) ?? 0) + entry.kg)
    }

    return Array.from(totals.entries())
      .map(([milkType, kg]) => ({ milkType, kg }))
      .sort((a, b) => b.kg - a.kg)
  }, [entries])

  async function handleSendToErp(collectionId: string) {
    if (sendingId) return

    setSendingId(collectionId)
    await updateJournalCollectionErpStatus(collectionId, 'sending', 'Sending order to ERP...')
    await refreshEntries()

    try {
      const orderEntries = await getJournalEntriesByCollection(collectionId)
      const collection = journalEntriesToCollection(orderEntries)
      const response = await sendSuppliesOrderToErp(collection, user)
      const message = response.newid
        ? `Sent to ERP. New document #${response.newid}.`
        : 'Sent to ERP.'
      await updateJournalCollectionErpStatus(collectionId, 'sent', message, response.newid ?? '')
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
            <span>Orders</span>
            <strong>{orders.length}</strong>
          </div>
          <div className="journal-stat">
            <span>Total quantity</span>
            <strong>{formatKg(totalKg)}</strong>
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
                    <strong>{formatKg(total.kg)}</strong>
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
                        {entry.milkType}: {formatKg(entry.kg)}
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
                  <span className="journal-entry-kg">{formatKg(order.totalKg)}</span>
                  <button
                    className={`journal-send-button ${order.erpStatus}`}
                    type="button"
                    onClick={() => handleSendToErp(order.collectionId)}
                    disabled={Boolean(sendingId)}
                  >
                    {sendingId === order.collectionId || order.erpStatus === 'sending'
                      ? 'Sending...'
                      : order.erpStatus === 'sent'
                        ? 'Send again'
                        : 'Send to ERP'}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
