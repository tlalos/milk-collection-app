import { BackButton } from './BackButton'
import { OcrNavigation } from './OcrNavigation'
import { useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import {
  buildDailyReconciliation,
  dateKey,
  documentLiters,
  groupReconciliationDays,
  numberOrNull,
  type AvizDocument,
  type CollectionComparison,
  type MatchStatus,
  type ReceptionRow,
  type SavedLink,
} from './dailyReconciliationModel'
import './DailyReconciliationScreen.css'
import { buildCmrReconciliation, cmrTotals, type CmrDocument, type CmrLink, type CmrComparison } from './cmrReconciliationModel'
import { CmrReconciliationRows, formatCmrTotals } from './CmrReconciliationRows'

type StatusFilter = 'all' | 'collection' | 'attention' | 'no_scale' | 'others' | 'only_cmr' | 'only_scale' | 'match_available' | 'needs_review' | 'cmr_linked' | MatchStatus

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
  const [cmrDocuments, setCmrDocuments] = useState<CmrDocument[]>([])
  const [cmrLinks, setCmrLinks] = useState<CmrLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set())

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
        setCmrDocuments(Array.isArray(payload.cmrDocuments) ? payload.cmrDocuments : [])
        setCmrLinks(Array.isArray(payload.cmrLinks) ? payload.cmrLinks : [])
      } catch (loadError) {
        if (controller.signal.aborted) return
        setReceptions([])
        setDocuments([])
        setSavedLinks([])
        setCmrDocuments([])
        setCmrLinks([])
        setError(loadError instanceof Error ? loadError.message : 'Could not load daily reconciliation.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [month, refreshKey])

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRefreshKey(value => value + 1) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const monthData = useMemo(() => buildDailyReconciliation(receptions, documents, savedLinks, month), [receptions, documents, savedLinks, month])
  const cmrData = useMemo(() => buildCmrReconciliation(receptions, cmrDocuments, cmrLinks, month), [receptions, cmrDocuments, cmrLinks, month])
  const query = search.trim().toLocaleLowerCase()
  const comparisonVisible = (comparison: CollectionComparison) => {
    const statusMatches = status === 'all' || status === 'collection' || (status === 'attention' && comparison.status !== 'within_range') || comparison.status === status
    return statusMatches && comparisonMatchesSearch(comparison, query)
  }
  const unmatchedVisible = (item: typeof monthData.unmatched[number]) => {
    const statusMatches = status === 'all' || status === 'collection' || status === 'attention' || item.status === status
    return statusMatches && documentMatchesSearch(item.document, query)
  }
  const otherVisible = (row: CmrComparison) => {
    const statusMatches = status === 'all' || status === 'others' || status === row.status
      || (status === 'attention' && row.status !== 'linked') || (status === 'cmr_linked' && row.reception !== null && row.documents.length > 0)
      || (status === 'only_cmr' && row.reception === null) || (status === 'only_scale' && row.reception !== null && row.documents.length === 0)
    return statusMatches && matchesSearch(query, row.date, row.reception?.receptionId, row.reception?.vehicleRegistration,
      row.reception?.driverName, row.reception?.milkTypeLabel, row.reception?.comments,
      ...[...row.documents, ...row.suggestions].flatMap(doc => [doc.sourceFile, doc.supplier, doc.driver, doc.avizNumber, doc.vehicleRegistration]))
  }
  const visibleComparisons = monthData.comparisons.filter(comparisonVisible)
  const visibleUnmatched = monthData.unmatched.filter(unmatchedVisible)
  const visibleCmrRows = cmrData.filter(otherVisible)
  const visibleOthers = visibleCmrRows.flatMap(row => row.reception ? [row.reception] : [])
  const visibleDays = groupReconciliationDays(visibleComparisons, visibleUnmatched, visibleOthers, visibleCmrRows)
  const documentCount = visibleDays.reduce((total, day) => total + day.documentCount, 0)
  const attentionCount = visibleDays.reduce((total, day) => total + day.attentionCount, 0)
  const scaleLiters = visibleDays.some(day => day.scaleLiters === null)
    ? null : visibleDays.reduce((total, day) => total + (day.scaleLiters ?? 0), 0)
  const avizLiters = visibleDays.some(day => day.avizLiters === null)
    ? null : visibleDays.reduce((total, day) => total + (day.avizLiters ?? 0), 0)
  const differenceLiters = scaleLiters === null || avizLiters === null ? null : scaleLiters - avizLiters
  const otherScaleLiters = visibleOthers.some(row => numberOrNull(row.calculatedLiters) === null)
    ? null : visibleOthers.reduce((total, row) => total + (numberOrNull(row.calculatedLiters) ?? 0), 0)

  return <div className="daily-recon-screen app-shell">
    <header className="app-topbar daily-recon-topbar">
      <BackButton className="back-button daily-recon-back" type="button" onClick={onBack} aria-label="Back to OCR menu" />
      <OcrNavigation />
      <div className="app-title-block"><span>Daily workflow</span><h1>Daily Reconciliation</h1></div>
      <div className="daily-recon-nav">
        <button type="button" onClick={() => { window.location.href = appPath('/milk-reception') }}>Milk Reception</button>
        <button type="button" onClick={() => { window.location.href = appPath('/daily-aviz') }}>Daily Aviz</button>
      </div>
    </header>

    <main className="daily-recon-content">
      <div className="daily-recon-summary daily-recon-volume-summary" aria-label="Filtered liter totals">
        <div title="Filtered collection receptions only; excludes Other receptions"><span>Scale liters</span><strong>{loading ? '-' : formatLiters(scaleLiters)}</strong></div>
        <div title="Aviz documents matching the filters, including unmatched documents"><span>Aviz liters</span><strong>{loading ? '-' : formatLiters(avizLiters)}</strong></div>
        <div title="Filtered scale liters minus filtered aviz liters. Unavailable when quantities are missing."><span>Difference</span><strong>{loading ? '-' : formatLiters(differenceLiters)}</strong></div>
      </div>
      <div className="daily-recon-summary daily-recon-volume-summary" aria-label="Filtered Other receptions liter totals">
        <div title="Other receptions matching the filters"><span>Others scale liters</span><strong>{loading ? '-' : formatLiters(otherScaleLiters)}</strong></div>
        <div title="Filtered CMR quantities, kept in their original units"><span>Others CMR quantity</span><strong>{loading ? '-' : formatCmrTotals(cmrTotals(visibleCmrRows, 'document'))}</strong></div>
        <div title="Available confirmed comparisons only; kilograms and liters are totaled separately"><span>Others difference</span><strong>{loading ? '-' : formatCmrTotals(cmrTotals(visibleCmrRows, 'difference'))}</strong></div>
      </div>
      <div className="daily-recon-summary" aria-label="Filtered record totals">
        <div><span>Scale receptions</span><strong>{visibleComparisons.length}</strong></div>
        <div><span>Aviz documents</span><strong>{documentCount}</strong></div>
        <div><span>Scale without aviz</span><strong>{visibleComparisons.filter((item) => item.status === 'no_aviz').length}</strong></div>
        <div><span>Aviz unmatched</span><strong>{visibleUnmatched.length}</strong></div>
        <div><span>Other receptions</span><strong>{visibleOthers.length}</strong></div>
        <div><span>Collection attention</span><strong>{attentionCount}</strong></div>
        <div><span>CMR documents</span><strong>{new Set(visibleCmrRows.flatMap(row => row.documents.map(doc => doc.id))).size}</strong></div>
        <div><span>Others attention</span><strong>{visibleCmrRows.filter(row => row.status !== 'linked').length}</strong></div>
      </div>

      <div className="daily-recon-toolbar">
        <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Truck, route, aviz, driver or milk type" /></label>
        <label>Show<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
          <option value="all">All records</option>
          <option value="collection">Collection only</option>
          <option value="others">Others only</option>
          <option value="only_cmr">CMR without scale</option>
          <option value="only_scale">Others scale without CMR</option>
          <option value="match_available">CMR match available</option>
          <option value="needs_review">CMR needs review</option>
          <option value="cmr_linked">Linked CMRs</option>
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
          <div className="daily-recon-expand-actions">
            <button type="button" disabled={!visibleDays.some(day => collapsedDays.has(day.date))}
              onClick={() => setCollapsedDays(current => {
                const next = new Set(current)
                visibleDays.forEach(day => next.delete(day.date))
                return next
              })}>Expand all</button>
            <button type="button" disabled={!visibleDays.some(day => !collapsedDays.has(day.date))}
              onClick={() => setCollapsedDays(current => new Set([...current, ...visibleDays.map(day => day.date)]))}>Collapse all</button>
          </div>
          <span>{loading ? 'Loading...' : `${visibleDays.length} days shown`}</span>
        </div>
        {!loading && !error && !visibleDays.length && <div className="daily-recon-empty">No records match this month and filters.</div>}
        {visibleDays.map((day) => {
          const { comparisons, unmatched, others } = day
          const expanded = !collapsedDays.has(day.date)
          const differences = comparisons.flatMap(item => item.differenceLiters === null ? [] : [item.differenceLiters])
          const collectionDifference = differences.length ? differences.reduce((sum, value) => sum + value, 0) : null
          return <article className="daily-recon-day" key={day.date}>
            <button type="button" className="daily-recon-day-header" aria-expanded={expanded}
              aria-controls={`daily-recon-day-${day.date}`} onClick={() => setCollapsedDays(current => {
                const next = new Set(current)
                if (next.has(day.date)) next.delete(day.date)
                else next.add(day.date)
                return next
              })}>
              <span className="daily-recon-day-title"><span aria-hidden="true">{expanded ? '▾' : '▸'}</span>{weekday(day.date)} <time dateTime={day.date}>{displayDate(day.date)}</time></span>
              <span className="daily-recon-day-totals">
                <span title="Total net scale weight of the collection receptions matching the filters; unavailable if any weight is missing">
                  Collection kilos: <strong>{day.collectionNetKg === null ? '-' : `${formatNumber(day.collectionNetKg)} kg`}</strong>
                </span>
                <span title={`Sum of ${differences.length} available collection differences in the shown records`}>
                  Collection diff: <strong>{collectionDifference === null ? '-' : formatLiters(collectionDifference)}</strong>
                </span>
                <span title="Total net scale weight of the other receptions matching the filters; unavailable if any weight is missing">
                  Others kilos: <strong>{day.othersNetKg === null ? '-' : `${formatNumber(day.othersNetKg)} kg`}</strong>
                </span>
                <span title="Available confirmed CMR differences, grouped by unit">Others diff: <strong>{formatCmrTotals(cmrTotals(day.cmrComparisons, 'difference'))}</strong></span>
              </span>
              <span className="daily-recon-day-counts">
                <span>Scale <strong>{comparisons.length}</strong></span>
                <span>Aviz <strong>{comparisons.reduce((total, item) => total + item.documents.length, 0) + unmatched.length}</strong></span>
                <span>Others <strong>{others.length}</strong></span>
                <span>CMR <strong>{new Set(day.cmrComparisons.flatMap(row => row.documents.map(doc => doc.id))).size}</strong></span>
              </span>
            </button>
            <div id={`daily-recon-day-${day.date}`} hidden={!expanded} className="daily-recon-day-grid" role="table" aria-label={`Daily records for ${displayDate(day.date)}`}>
              <div className="daily-recon-grid-head" role="row">
                <span role="columnheader">Truck / route and details</span>
                <span role="columnheader">Scale final</span>
                <span role="columnheader">Aviz / CMR</span>
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
              <CmrReconciliationRows rows={day.cmrComparisons} />
            </div>
          </article>
        })}
      </section>
    </main>
  </div>
}
