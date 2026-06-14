import { useEffect, useMemo, useState } from 'react'
import { getJournalEntriesByDate, toLocalDateKey } from '../store/journalStore'
import type { JournalEntry } from '../types/journal'
import './JournalScreen.css'

interface JournalScreenProps {
  onBack: () => void
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

export function JournalScreen({ onBack }: JournalScreenProps) {
  const [selectedDate, setSelectedDate] = useState(toLocalDateKey())
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

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
            <span>Pickups</span>
            <strong>{entries.length}</strong>
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

        {status === 'ready' && entries.length === 0 && (
          <div className="journal-empty">
            No pickups recorded for this date.
          </div>
        )}

        {status === 'ready' && entries.length > 0 && (
          <section className="journal-list" aria-label="Pickup list">
            {entries.map((entry) => (
              <article className="journal-entry-card" key={entry.id}>
                <div className="journal-entry-main">
                  <strong>{entry.supplierName}</strong>
                  <span>{entry.milkType} · {formatTime(entry.submittedAt)}</span>
                </div>
                <span className="journal-entry-kg">{formatKg(entry.kg)}</span>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
