import { useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import {
  buildDailyReconciliation,
  dateKey,
  documentLiters,
  numberOrNull,
  type AvizDocument,
  type CollectionComparison,
  type MatchStatus,
  type ReceptionRow,
  type SavedLink,
} from './dailyReconciliationModel'
import './DailyReconciliationScreen.css'

type StatusFilter = 'all' | 'attention' | 'no_scale' | 'others' | MatchStatus

const statusLabels: Record<MatchStatus, string> = {
  within_range: 'Within 5 L',
  difference: 'Difference',
  no_aviz: 'No aviz',
  awaiting_weight: 'Missing weight',
  review: 'OCR review',
  missing_info: 'Missing key',
  conflict: 'Multiple receptions',
}

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

function formatNumber(value: unknown) {
  const number = numberOrNull(value)
  return number === null ? '-' : numberFormat.format(number)
}

function formatLiters(value: unknown) {
  return numberOrNull(value) === null ? '—' : `${formatNumber(value)} L`
}

function currentMonth() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function displayDate(value: string | null | undefined) {
  const date = dateKey(value)
  if (!date) return '-'
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function weekday(date: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))
}

function matchesSearch(query: string, ...values: Array<string | number | null | undefined>) {
  return !query || values.some((value) => String(value ?? '').toLocaleLowerCase().includes(query))
}

function comparisonMatchesSearch(comparison: CollectionComparison, query: string) {
  const { reception, documents } = comparison
  return matchesSearch(query, reception.receptionId, reception.receptionDate, reception.vehicleRegistration, reception.routeId,
    reception.driverName, ...documents.flatMap((document) => [document.sourceFile, ...document.rows.flatMap((row) => [row.noticeNumber, row.collectionCenter])]))
}

function documentMatchesSearch(document: AvizDocument, query: string) {
  return matchesSearch(query, document.documentDate, document.sourceFile, document.vehicleRegistration, document.route,
    ...document.rows.flatMap((row) => [row.noticeNumber, row.collectionCenter]))
}

function DocumentLink({ document }: { document: AvizDocument }) {
  return document.fileUrl
    ? <a href={document.fileUrl} target="_blank" rel="noopener noreferrer">{document.sourceFile || document.id}</a>
    : <span>{document.sourceFile || document.id}</span>
}

export function DailyReconciliationScreen({ onBack }: { onBack: () => void }) {
  const [month, setMonth] = useState(currentMonth)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [receptions, setReceptions] = useState<ReceptionRow[]>([])
  const [documents, setDocuments] = useState<AvizDocument[]>([])
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(appPath(`/api/daily-reconciliation/month?month=${encodeURIComponent(month)}`), { signal: controller.signal })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load daily reconciliation.')
        if (controller.signal.aborted) return
        setReceptions(Array.isArray(payload.receptions) ? payload.receptions as ReceptionRow[] : [])
        setDocuments(Array.isArray(payload.documents) ? payload.documents as AvizDocument[] : [])
        setSavedLinks(Array.isArray(payload.links) ? payload.links as SavedLink[] : [])
      } catch (loadError) {
        if (controller.signal.aborted) return
        setReceptions([])
        setDocuments([])
        setSavedLinks([])
        setError(loadError instanceof Error ? loadError.message : 'Could not load daily reconciliation.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [month, refreshKey])

  const monthData = useMemo(() => buildDailyReconciliation(receptions, documents, savedLinks, month), [receptions, documents, savedLinks, month])
  const query = search.trim().toLocaleLowerCase()
  const comparisonVisible = (comparison: CollectionComparison) => {
    const statusMatches = status === 'all' || (status === 'attention' && comparison.status !== 'within_range') || comparison.status === status
    return statusMatches && comparisonMatchesSearch(comparison, query)
  }
  const unmatchedVisible = (item: typeof monthData.unmatched[number]) => {
    const statusMatches = status === 'all' || status === 'attention' || item.status === status
    return statusMatches && documentMatchesSearch(item.document, query)
  }
  const otherVisible = (reception: ReceptionRow) => (status === 'all' || status === 'others') && matchesSearch(query,
    reception.receptionDate, reception.receptionId, reception.vehicleRegistration, reception.driverName, reception.milkTypeLabel, reception.comments)
  const visibleDays = monthData.days.filter((day) =>
    day.comparisons.some(comparisonVisible) || day.unmatched.some(unmatchedVisible) || day.others.some(otherVisible))
  const monthDocumentCount = monthData.days.reduce((total, day) => total + day.documentCount, 0)
  const attentionCount = monthData.days.reduce((total, day) => total + day.attentionCount, 0)

  return <div className="daily-recon-screen app-shell">
    <header className="app-topbar daily-recon-topbar">
      <button className="back-button daily-recon-back" type="button" onClick={onBack} aria-label="Back to OCR menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
        <span>Back</span>
      </button>
      <div className="app-title-block"><span>Daily workflow</span><h1>Daily Reconciliation</h1></div>
      <div className="daily-recon-nav">
        <button type="button" onClick={() => { window.location.href = appPath('/milk-reception') }}>Milk Reception</button>
        <button type="button" onClick={() => { window.location.href = appPath('/daily-aviz') }}>Daily Aviz</button>
      </div>
    </header>

    <main className="daily-recon-content">
      <div className="daily-recon-summary" aria-label="Month totals">
        <div><span>Scale receptions</span><strong>{monthData.comparisons.length}</strong></div>
        <div><span>Aviz documents</span><strong>{monthDocumentCount}</strong></div>
        <div><span>Scale without aviz</span><strong>{monthData.comparisons.filter((item) => item.status === 'no_aviz').length}</strong></div>
        <div><span>Aviz unmatched</span><strong>{monthData.unmatched.length}</strong></div>
        <div><span>Other receptions</span><strong>{monthData.others.length}</strong></div>
        <div><span>Collection attention</span><strong>{attentionCount}</strong></div>
      </div>

      <div className="daily-recon-toolbar">
        <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Truck, route, aviz, driver or milk type" /></label>
        <label>Show<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
          <option value="all">All records</option>
          <option value="others">Others only</option>
          <option value="attention">Needs attention</option>
          <option value="no_aviz">Scale without aviz</option>
          <option value="no_scale">Aviz without scale</option>
          <option value="difference">Difference</option>
          <option value="awaiting_weight">Missing weight</option>
          <option value="review">OCR review</option>
          <option value="missing_info">Missing key</option>
          <option value="conflict">Multiple receptions</option>
          <option value="within_range">Within 5 L</option>
        </select></label>
        <button type="button" onClick={() => { setSearch(''); setStatus('all'); setMonth(currentMonth()) }}>Clear</button>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh</button>
      </div>

      {error && <div className="daily-recon-error" role="alert">{error}</div>}

      <section className="daily-recon-ledger" aria-labelledby="daily-recon-days-title">
        <div className="daily-recon-section-heading">
          <h2 id="daily-recon-days-title">Daily records</h2>
          <span>{loading ? 'Loading...' : `${visibleDays.length} days shown`}</span>
        </div>
        {!loading && !error && !visibleDays.length && <div className="daily-recon-empty">No records match this month and filters.</div>}
        {visibleDays.map((day) => {
          const comparisons = day.comparisons.filter(comparisonVisible)
          const unmatched = day.unmatched.filter(unmatchedVisible)
          const others = day.others.filter(otherVisible)
          return <article className="daily-recon-day" key={day.date}>
            <header className="daily-recon-day-header">
              <h3>{weekday(day.date)} <time dateTime={day.date}>{displayDate(day.date)}</time></h3>
              <div className="daily-recon-day-counts">
                <span>Scale <strong>{comparisons.length}</strong></span>
                <span>Aviz <strong>{comparisons.reduce((total, item) => total + item.documents.length, 0) + unmatched.length}</strong></span>
                <span>Others <strong>{others.length}</strong></span>
              </div>
            </header>
            <div className="daily-recon-day-grid" role="table" aria-label={`Daily records for ${displayDate(day.date)}`}>
              <div className="daily-recon-grid-head" role="row">
                <span role="columnheader">Truck / route and details</span>
                <span role="columnheader">Scale final</span>
                <span role="columnheader">Aviz</span>
                <span role="columnheader">Difference</span>
              </div>
              {comparisons.map((comparison) => {
                const { reception, documents: matchedDocuments } = comparison
                const hasAviz = matchedDocuments.length > 0
                const lineCount = matchedDocuments.reduce((total, document) => total + document.rows.length, 0)
                return <div className={`daily-recon-grid-row ${comparison.status !== 'within_range' ? 'needs-attention' : ''}`} role="row" key={reception.receptionId}>
                  <div className="daily-recon-identity" role="cell">
                    <div className="daily-recon-identity-top">
                      <strong>{reception.vehicleRegistration || 'Truck missing'}</strong>
                      <span className="daily-recon-route">{reception.routeId || 'No route'}</span>
                      <span className={`daily-recon-presence ${comparison.status === 'conflict' || comparison.status === 'missing_info' ? 'unresolved' : hasAviz ? 'both' : 'scale-only'}`}>
                        {comparison.status === 'conflict' || comparison.status === 'missing_info' ? 'Unresolved' : hasAviz ? '✓ Both' : 'Only scale'}
                      </span>
                    </div>
                    <span>{reception.receptionId}</span>
                    {matchedDocuments.map((document) => <span className="daily-recon-file" key={document.id}>
                      <DocumentLink document={document} /> · {document.rows.length} lines · {document.reviewStatus || document.jobStatus}
                    </span>)}
                    {hasAviz && <small>{comparison.savedLinkCount}/{lineCount} aviz lines linked</small>}
                    <small className="daily-recon-record-status">{statusLabels[comparison.status]}</small>
                  </div>
                  <div className="daily-recon-measure" role="cell" data-label="Scale final">
                    <strong>{formatLiters(reception.calculatedLiters)}</strong>
                    <span>Net {formatNumber(reception.netQuantityKg)} kg</span>
                    <span>Loaded {formatNumber(reception.fullTruckWeightKg)} kg</span>
                    <span>Empty {formatNumber(reception.emptyTruckWeightKg)} kg</span>
                  </div>
                  <div className="daily-recon-measure" role="cell" data-label="Aviz"><strong>{formatLiters(comparison.avizLiters)}</strong></div>
                  <div className={`daily-recon-measure ${comparison.differenceLiters !== null && Math.abs(comparison.differenceLiters) > 5 ? 'difference' : ''}`} role="cell" data-label="Difference">
                    <strong>{formatLiters(comparison.differenceLiters)}</strong>
                  </div>
                </div>
              })}
              {unmatched.map(({ document, status: unmatchedStatus }) => <div className="daily-recon-grid-row needs-attention" role="row" key={`aviz-${document.id}`}>
                <div className="daily-recon-identity" role="cell">
                  <div className="daily-recon-identity-top"><strong>{document.vehicleRegistration || 'Truck missing'}</strong>
                    <span className="daily-recon-route">{document.route || 'No route'}</span>
                    <span className={`daily-recon-presence ${unmatchedStatus === 'no_scale' ? 'aviz-only' : 'unresolved'}`}>
                      {unmatchedStatus === 'no_scale' ? 'Only aviz' : 'Unresolved'}
                    </span>
                  </div>
                  <span>{displayDate(document.documentDate)}</span>
                  <span className="daily-recon-file"><DocumentLink document={document} /> · {document.rows.length} lines · {document.reviewStatus || document.jobStatus}</span>
                  <small className="daily-recon-record-status">{unmatchedStatus === 'conflict' ? 'Multiple receptions' : unmatchedStatus === 'missing_info' ? 'Missing date, truck or route' : 'No scale reception'}</small>
                </div>
                <div className="daily-recon-measure" role="cell" data-label="Scale final"><strong>—</strong></div>
                <div className="daily-recon-measure" role="cell" data-label="Aviz"><strong>{formatLiters(documentLiters(document))}</strong></div>
                <div className="daily-recon-measure" role="cell" data-label="Difference"><strong>—</strong></div>
              </div>)}
              {others.length > 0 && <div className="daily-recon-other-heading" role="row"><span role="cell">Other receptions <strong>{others.length}</strong></span></div>}
              {others.map((row) => <div className="daily-recon-grid-row daily-recon-other-row" role="row" key={row.receptionId}>
                <div className="daily-recon-identity" role="cell">
                  <div className="daily-recon-identity-top">
                    <strong>{row.vehicleRegistration || 'Truck missing'}</strong>
                    <span className="daily-recon-presence other">Other</span>
                  </div>
                  <span>{row.receptionId}</span>
                  <span>{row.milkTypeLabel || 'Milk type missing'}{row.driverName ? ` · ${row.driverName}` : ''}</span>
                  {row.comments && <span>{row.comments}</span>}
                </div>
                <div className="daily-recon-measure" role="cell" data-label="Scale final">
                  <strong>{formatLiters(row.calculatedLiters)}</strong>
                  <span>Net {formatNumber(row.netQuantityKg)} kg</span>
                  <span>Loaded {formatNumber(row.fullTruckWeightKg)} kg</span>
                  <span>Empty {formatNumber(row.emptyTruckWeightKg)} kg</span>
                </div>
                <div className="daily-recon-measure" role="cell" data-label="Aviz"><strong>—</strong></div>
                <div className="daily-recon-measure" role="cell" data-label="Difference"><strong>—</strong></div>
              </div>)}
            </div>
          </article>
        })}
      </section>
    </main>
  </div>
}
