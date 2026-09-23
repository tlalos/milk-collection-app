import { Fragment, useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import './DailyReconciliationScreen.css'

type ReceptionCategory = 'COLLECTION' | 'OTHER'
type MatchStatus = 'within_range' | 'difference' | 'no_aviz' | 'awaiting_weight' | 'review' | 'missing_info' | 'conflict'
type StatusFilter = 'all' | MatchStatus
type UnmatchedStatus = 'no_scale' | 'missing_info' | 'conflict'

interface ReceptionRow {
  receptionId: string
  receptionDate: string
  vehicleRegistration: string
  vehicleCategory: string
  routeId: string
  milkTypeLabel: string
  driverName: string
  fullTruckWeightKg: number | null
  fullTruckWeighedAt: string | null
  fullTruckWeightSource: 'SCALE' | 'MANUAL' | null
  emptyTruckWeightKg: number | null
  emptyTruckWeighedAt: string | null
  emptyTruckWeightSource: 'SCALE' | 'MANUAL' | null
  netQuantityKg: number | null
  calculatedLiters: number | null
  comments: string
}

interface AvizRow {
  id: string
  jobId: string
  rowIndex: number
  sourceFile: string
  documentDate: string | null
  createdAt: string
  vehicleRegistration: string | null
  route: string | null
  rowNumber: number | null
  noticeNumber: string | null
  collectionCenter: string | null
  liters: number | null
  jobStatus: string
  reviewStatus: string
}

interface SavedLink {
  jobId: string
  rowIndex: number
  receptionId: string
  linkedAt: string | null
}

interface CollectionComparison {
  reception: ReceptionRow
  avizRows: AvizRow[]
  savedLinkCount: number
  avizLiters: number | null
  differenceLiters: number | null
  status: MatchStatus
}

interface UnmatchedAviz {
  row: AvizRow
  status: UnmatchedStatus
}

const statusLabels: Record<MatchStatus, string> = {
  within_range: 'Within 5 L',
  difference: 'Difference',
  no_aviz: 'No aviz',
  awaiting_weight: 'Waiting for weight',
  review: 'Pending OCR review',
  missing_info: 'Missing key',
  conflict: 'Multiple scale rows',
}

const statusOrder: Record<MatchStatus, number> = {
  conflict: 0,
  missing_info: 1,
  difference: 2,
  no_aviz: 3,
  awaiting_weight: 4,
  review: 5,
  within_range: 6,
}

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatNumber(value: unknown) {
  const number = numberOrNull(value)
  return number === null ? '-' : numberFormat.format(number)
}

function currentMonth() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function dateKey(value: string | null | undefined) {
  if (!value) return ''
  const iso = /^(\d{4}-\d{2}-\d{2})/u.exec(value)
  if (iso) return iso[1]
  const display = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/u.exec(value)
  if (display) return `${display[3]}-${display[2].padStart(2, '0')}-${display[1].padStart(2, '0')}`
  return ''
}

function displayDate(value: string | null | undefined) {
  const date = dateKey(value)
  if (!date) return '-'
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function displayDateTime(value: string | null | undefined) {
  if (!value) return '-'
  const date = displayDate(value)
  const time = /[T ](\d{2}:\d{2})/u.exec(value)?.[1]
  return time ? `${date} ${time}` : date
}

function displayLinkedAt(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : '-'
}

function matchKey(date: string | null | undefined, truck: string | null | undefined, route: string | null | undefined) {
  const normalized = (value: string | null | undefined) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toUpperCase().replace(/[^A-Z0-9]+/gu, '')
  const keyDate = dateKey(date)
  const keyTruck = normalized(truck)
  const keyRoute = normalized(route)
  return keyDate && keyTruck && keyRoute ? `${keyDate}|${keyTruck}|${keyRoute}` : ''
}

function categoryOf(row: ReceptionRow): ReceptionCategory {
  return row.vehicleCategory?.toUpperCase() === 'OTHER' ? 'OTHER' : 'COLLECTION'
}

function compareMonth(receptions: ReceptionRow[], avizRows: AvizRow[], month: string, savedLinks: SavedLink[]) {
  if (!/^\d{4}-\d{2}$/u.test(month)) return { comparisons: [], others: [], unmatched: [] }
  const savedLinkByRow = new Map(savedLinks.map((link) => [`${link.jobId}:${link.rowIndex}`, link]))
  const monthReceptions = receptions.filter((row) => dateKey(row.receptionDate).startsWith(month))
  const collection = monthReceptions.filter((row) => categoryOf(row) === 'COLLECTION')
  const others = monthReceptions.filter((row) => categoryOf(row) === 'OTHER')
  const monthAviz = avizRows.filter((row) => dateKey(row.documentDate || row.createdAt).startsWith(month))

  const receptionsByKey = new Map<string, ReceptionRow[]>()
  for (const reception of collection) {
    const key = matchKey(reception.receptionDate, reception.vehicleRegistration, reception.routeId)
    if (!key) continue
    receptionsByKey.set(key, [...(receptionsByKey.get(key) || []), reception])
  }

  const avizByKey = new Map<string, AvizRow[]>()
  const unmatched: UnmatchedAviz[] = []
  for (const row of monthAviz) {
    const key = matchKey(row.documentDate, row.vehicleRegistration, row.route)
    if (!key) {
      unmatched.push({ row, status: 'missing_info' })
      continue
    }
    const matches = receptionsByKey.get(key) || []
    if (matches.length !== 1) {
      unmatched.push({ row, status: matches.length > 1 ? 'conflict' : 'no_scale' })
      continue
    }
    avizByKey.set(key, [...(avizByKey.get(key) || []), row])
  }

  const comparisons: CollectionComparison[] = collection.map((reception) => {
    const key = matchKey(reception.receptionDate, reception.vehicleRegistration, reception.routeId)
    const aviz = key ? avizByKey.get(key) || [] : []
    const scaleLiters = numberOrNull(reception.calculatedLiters)
    const allAvizHaveLiters = aviz.every((row) => numberOrNull(row.liters) !== null)
    const avizLiters = aviz.length && allAvizHaveLiters
      ? aviz.reduce((total, row) => total + (numberOrNull(row.liters) || 0), 0)
      : null
    const differenceLiters = scaleLiters !== null && avizLiters !== null ? scaleLiters - avizLiters : null
    const savedLinkCount = aviz.filter((row) => savedLinkByRow.get(`${row.jobId}:${row.rowIndex}`)?.receptionId === reception.receptionId).length
    let status: MatchStatus = 'within_range'
    if (!key) status = 'missing_info'
    else if ((receptionsByKey.get(key) || []).length > 1) status = 'conflict'
    else if (!aviz.length) status = 'no_aviz'
    else if (numberOrNull(reception.fullTruckWeightKg) === null || numberOrNull(reception.emptyTruckWeightKg) === null || scaleLiters === null) status = 'awaiting_weight'
    else if (!allAvizHaveLiters || aviz.some((row) => row.reviewStatus !== 'reviewed' || row.jobStatus !== 'completed')) status = 'review'
    else if (differenceLiters !== null && Math.abs(differenceLiters) > 5) status = 'difference'
    return { reception, avizRows: aviz, savedLinkCount, avizLiters, differenceLiters, status }
  })

  return { comparisons, others, unmatched }
}

function statusNote(status: MatchStatus, savedLinkCount: number, avizCount: number) {
  if (status === 'conflict') return 'More than one collection reception has this date, truck and route. No aviz is assigned automatically.'
  if (status === 'missing_info') return 'The reception needs a date, truck and route before it can be compared.'
  if (status === 'no_aviz') return 'No daily aviz row has this exact date, truck and route.'
  if (status === 'awaiting_weight') return 'The scale entry needs both weights and calculated liters before the difference can be checked.'
  if (status === 'review') return 'At least one aviz row is unreviewed, incomplete or not finished processing.'
  if (savedLinkCount === avizCount && avizCount > 0) return 'All matching reviewed aviz lines are saved against this COLLECTION reception.'
  if (savedLinkCount > 0) return 'Some aviz lines are saved; the remaining lines are suggestions only.'
  return 'Suggested from the current OCR rows by exact date, truck and route. No link has been saved.'
}

export function DailyReconciliationScreen({ onBack }: { onBack: () => void }) {
  const [month, setMonth] = useState(currentMonth)
  const [category, setCategory] = useState<ReceptionCategory>('COLLECTION')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [receptions, setReceptions] = useState<ReceptionRow[]>([])
  const [avizRows, setAvizRows] = useState<AvizRow[]>([])
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([])
  const [linksLoading, setLinksLoading] = useState(true)
  const [linksError, setLinksError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [receptionLimitReached, setReceptionLimitReached] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [receptionResponse, avizResponse] = await Promise.all([
          fetch(appPath('/api/milk-receptions'), { signal: controller.signal }),
          fetch(appPath('/api/ocr/daily-aviz/rows'), { signal: controller.signal }),
        ])
        const [receptionPayload, avizPayload] = await Promise.all([receptionResponse.json(), avizResponse.json()])
        if (!receptionResponse.ok) throw new Error(receptionPayload.error || 'Could not load SQL receptions.')
        if (!avizResponse.ok) throw new Error(avizPayload.error || 'Could not load Daily Aviz rows.')
        if (controller.signal.aborted) return
        const loadedReceptions = Array.isArray(receptionPayload.records) ? receptionPayload.records as ReceptionRow[] : []
        setReceptions(loadedReceptions)
        setReceptionLimitReached(loadedReceptions.length >= 500)
        setAvizRows(Array.isArray(avizPayload.rows) ? avizPayload.rows as AvizRow[] : [])
      } catch (loadError) {
        if (controller.signal.aborted) return
        setReceptions([])
        setAvizRows([])
        setError(loadError instanceof Error ? loadError.message : 'Could not load reconciliation data.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    async function loadLinks() {
      setLinksLoading(true)
      setLinksError('')
      setSavedLinks([])
      if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) {
        setLinksLoading(false)
        return
      }
      try {
        const response = await fetch(appPath(`/api/daily-reconciliation/links?month=${encodeURIComponent(month)}`), { signal: controller.signal })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load saved links.')
        if (!controller.signal.aborted) setSavedLinks(Array.isArray(payload.links) ? payload.links as SavedLink[] : [])
      } catch (loadError) {
        if (!controller.signal.aborted) setLinksError(loadError instanceof Error ? loadError.message : 'Could not load saved links.')
      } finally {
        if (!controller.signal.aborted) setLinksLoading(false)
      }
    }
    void loadLinks()
    return () => controller.abort()
  }, [month, refreshKey])

  const { comparisons, others, unmatched } = useMemo(() => compareMonth(receptions, avizRows, month, savedLinks), [receptions, avizRows, month, savedLinks])
  const savedLinkByRow = useMemo(() => new Map(savedLinks.map((link) => [`${link.jobId}:${link.rowIndex}`, link])), [savedLinks])
  const query = search.trim().toLocaleLowerCase()
  const matchesSearch = (...values: Array<string | null | undefined>) => !query || values.some((value) => String(value || '').toLocaleLowerCase().includes(query))
  const visibleComparisons = comparisons.filter(({ reception, avizRows: matchedRows, status: rowStatus }) => (
    (status === 'all' || rowStatus === status)
    && matchesSearch(reception.receptionId, reception.vehicleRegistration, reception.routeId, ...matchedRows.map((row) => row.noticeNumber))
  )).sort((first, second) => statusOrder[first.status] - statusOrder[second.status] || second.reception.receptionDate.localeCompare(first.reception.receptionDate))
  const visibleOthers = others.filter((row) => matchesSearch(row.receptionId, row.vehicleRegistration, row.driverName, row.milkTypeLabel))
    .sort((first, second) => second.receptionDate.localeCompare(first.receptionDate))
  const visibleUnmatched = unmatched.filter(({ row }) => matchesSearch(row.vehicleRegistration, row.route, row.noticeNumber, row.collectionCenter))
  const needsAttention = comparisons.filter((row) => row.status !== 'within_range').length + unmatched.length
  const othersTotalLiters = others.reduce((total, row) => total + (numberOrNull(row.calculatedLiters) || 0), 0)

  return (
    <div className="daily-recon-screen app-shell">
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
        <div className="daily-recon-source-note" role="status">
          <strong>Live data</strong>
          <span>Receptions and saved links come from SQL. Unreviewed or ambiguous aviz lines are not saved. Other matches shown here are suggestions by date, truck and route.</span>
        </div>

        <div className="daily-recon-mode" role="group" aria-label="Reception category">
          <button type="button" className={category === 'COLLECTION' ? 'active' : ''} aria-pressed={category === 'COLLECTION'} onClick={() => { setCategory('COLLECTION'); setExpandedId(null) }}>Collection <span>{comparisons.length}</span></button>
          <button type="button" className={category === 'OTHER' ? 'active' : ''} aria-pressed={category === 'OTHER'} onClick={() => { setCategory('OTHER'); setExpandedId(null) }}>Others <span>{others.length}</span></button>
        </div>

        {category === 'COLLECTION' ? <div className="daily-recon-summary" aria-label="Month summary">
          <div><span>Collection rows</span><strong>{comparisons.length}</strong></div>
          <div><span>Saved aviz links</span><strong>{linksLoading ? '...' : savedLinks.length}</strong></div>
          <div><span>Within 5 L</span><strong>{comparisons.filter((row) => row.status === 'within_range').length}</strong></div>
          <div><span>Differences</span><strong>{comparisons.filter((row) => row.status === 'difference').length}</strong></div>
          <div title="Collection reception rows plus unmatched aviz lines"><span>Attention items</span><strong>{needsAttention}</strong></div>
          <div><span>Aviz lines without scale</span><strong>{unmatched.length}</strong></div>
        </div> : <div className="daily-recon-summary daily-recon-other-summary" aria-label="Other receptions summary">
          <div><span>Other rows</span><strong>{others.length}</strong></div>
          <div><span>Total liters</span><strong>{formatNumber(othersTotalLiters)}</strong></div>
          <div><span>Missing weight</span><strong>{others.filter((row) => numberOrNull(row.fullTruckWeightKg) === null || numberOrNull(row.emptyTruckWeightKg) === null).length}</strong></div>
        </div>}

        <div className="daily-recon-toolbar">
          <label>Month<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setExpandedId(null) }} /></label>
          <label>{category === 'COLLECTION' ? 'Truck, route or aviz' : 'Truck, driver or milk type'}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search..." /></label>
          {category === 'COLLECTION' && <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="all">All collection rows</option>
            <option value="difference">Difference</option>
            <option value="no_aviz">No aviz</option>
            <option value="awaiting_weight">Waiting for weight</option>
            <option value="review">Pending OCR review</option>
            <option value="missing_info">Missing key</option>
            <option value="conflict">Multiple scale rows</option>
            <option value="within_range">Within 5 L</option>
          </select></label>}
          <button type="button" onClick={() => { setSearch(''); setStatus('all'); setMonth(currentMonth()) }}>Clear</button>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>

        {receptionLimitReached && <div className="daily-recon-warning" role="alert">The reception API returned its 500-row limit. Older months may be incomplete in this view.</div>}
        {linksError && <div className="daily-recon-warning" role="alert">Saved links could not be loaded: {linksError}</div>}
        {error && <div className="daily-recon-error" role="alert">{error}</div>}

        {category === 'COLLECTION' ? <>
          <section className="daily-recon-register" aria-labelledby="daily-recon-register-title">
            <div className="daily-recon-section-heading"><div><h2 id="daily-recon-register-title">Collection receptions</h2><span>{loading ? 'Loading...' : `${visibleComparisons.length} shown`}</span></div></div>
            <div className="daily-recon-table-scroll">
              <table className="daily-recon-table">
                <thead><tr>
                  <th scope="col"><span className="sr-only">Details</span></th><th scope="col">Date</th><th scope="col">Truck / route</th>
                  <th scope="col">Loaded kg</th><th scope="col">Empty kg</th><th scope="col">Net kg</th><th scope="col">Scale L</th>
                  <th scope="col">Aviz lines</th><th scope="col">Saved</th><th scope="col">Aviz L</th><th scope="col" title="Scale liters minus aviz liters">Diff L</th><th scope="col">Status</th>
                </tr></thead>
                <tbody>
                  {visibleComparisons.map(({ reception, avizRows: matchedRows, savedLinkCount, avizLiters, differenceLiters, status: rowStatus }) => {
                    const expanded = expandedId === reception.receptionId
                    return <Fragment key={reception.receptionId}>
                      <tr className={`daily-recon-row daily-recon-row-${rowStatus}`}>
                        <td><button className="daily-recon-expand" type="button" aria-label={`${expanded ? 'Hide' : 'Show'} aviz for ${reception.receptionId}`} aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : reception.receptionId)}>{expanded ? '−' : '+'}</button></td>
                        <td>{displayDate(reception.receptionDate)}</td>
                        <td><strong>{reception.vehicleRegistration || '-'}</strong><small>{reception.routeId || 'No route'} · {reception.receptionId}</small></td>
                        <td className="daily-recon-number">{formatNumber(reception.fullTruckWeightKg)}</td>
                        <td className="daily-recon-number">{formatNumber(reception.emptyTruckWeightKg)}</td>
                        <td className="daily-recon-number">{formatNumber(reception.netQuantityKg)}</td>
                        <td className="daily-recon-number">{formatNumber(reception.calculatedLiters)}</td>
                        <td className="daily-recon-number">{matchedRows.length}</td>
                        <td className="daily-recon-number">{linksLoading ? '-' : savedLinkCount}</td>
                        <td className="daily-recon-number">{formatNumber(avizLiters)}</td>
                        <td className="daily-recon-number">{formatNumber(differenceLiters)}</td>
                        <td><span className={`daily-recon-status ${rowStatus}`}>{statusLabels[rowStatus]}</span></td>
                      </tr>
                      {expanded && <tr className="daily-recon-detail-row"><td colSpan={12}>
                        <div className="daily-recon-detail">
                          <div className="daily-recon-scale-times">
                            <span>Loaded: <strong>{reception.fullTruckWeightSource === 'SCALE' ? `Scale · ${displayDateTime(reception.fullTruckWeighedAt)}` : reception.fullTruckWeightSource === 'MANUAL' ? 'Manual' : 'Unknown source'}</strong></span>
                            <span>Empty: <strong>{reception.emptyTruckWeightSource === 'SCALE' ? `Scale · ${displayDateTime(reception.emptyTruckWeighedAt)}` : reception.emptyTruckWeightSource === 'MANUAL' ? 'Manual' : 'Unknown source'}</strong></span>
                          </div>
                          <p>{statusNote(rowStatus, savedLinkCount, matchedRows.length)}</p>
                          {matchedRows.length ? <table><thead><tr><th>Aviz no.</th><th>Center</th><th>Liters</th><th>OCR review</th><th>Link</th><th>Linked at</th><th>Source file</th></tr></thead>
                            <tbody>{matchedRows.map((row) => {
                              const savedLink = savedLinkByRow.get(`${row.jobId}:${row.rowIndex}`)
                              const isSaved = savedLink?.receptionId === reception.receptionId
                              return <tr key={`${row.jobId}:${row.rowIndex ?? row.id}`}><td>{row.noticeNumber || '-'}</td><td>{row.collectionCenter || '-'}</td><td>{formatNumber(row.liters)}</td><td>{row.reviewStatus || row.jobStatus}</td><td>{isSaved ? 'Saved' : 'Suggested'}</td><td>{isSaved ? displayLinkedAt(savedLink.linkedAt) : '-'}</td><td>{row.sourceFile || '-'}</td></tr>
                            })}</tbody>
                          </table> : <span className="daily-recon-no-aviz">No uniquely matching aviz rows.</span>}
                        </div>
                      </td></tr>}
                    </Fragment>
                  })}
                  {!loading && !visibleComparisons.length && <tr><td colSpan={12} className="daily-recon-empty">No collection receptions match this month and filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="daily-recon-register" aria-labelledby="daily-recon-unmatched-title">
            <div className="daily-recon-section-heading"><div><h2 id="daily-recon-unmatched-title">Aviz lines without unique scale reception</h2><span>{loading ? 'Loading...' : `${visibleUnmatched.length} shown`}</span></div></div>
            <div className="daily-recon-table-scroll"><table className="daily-recon-table daily-recon-unmatched-table">
              <thead><tr><th>Date</th><th>Truck / route</th><th>Aviz no.</th><th>Center</th><th>Liters</th><th>OCR review</th><th>Status</th></tr></thead>
              <tbody>
                {visibleUnmatched.map(({ row, status: unmatchedStatus }) => <tr key={`${row.jobId}:${row.rowIndex ?? row.id}`}><td>{displayDate(row.documentDate)}</td><td><strong>{row.vehicleRegistration || '-'}</strong><small>{row.route || '-'}</small></td><td>{row.noticeNumber || '-'}</td><td>{row.collectionCenter || '-'}</td><td className="daily-recon-number">{formatNumber(row.liters)}</td><td>{row.reviewStatus || row.jobStatus}</td><td><span className={`daily-recon-status ${unmatchedStatus}`}>{unmatchedStatus === 'conflict' ? 'Multiple scale rows' : unmatchedStatus === 'missing_info' ? 'Missing key' : 'No scale row'}</span></td></tr>)}
                {!loading && !visibleUnmatched.length && <tr><td colSpan={7} className="daily-recon-empty">No unmatched aviz rows for this month and search.</td></tr>}
              </tbody>
            </table></div>
          </section>
        </> : <section className="daily-recon-register" aria-labelledby="daily-recon-others-title">
          <div className="daily-recon-section-heading"><div><h2 id="daily-recon-others-title">Other receptions</h2><span>{loading ? 'Loading...' : `${visibleOthers.length} shown · not matched to aviz`}</span></div></div>
          <div className="daily-recon-table-scroll"><table className="daily-recon-table daily-recon-others-table">
            <thead><tr><th>Date</th><th>Truck</th><th>Driver</th><th>Milk type</th><th>Loaded kg</th><th>Empty kg</th><th>Net kg</th><th>Liters</th><th>Comments</th></tr></thead>
            <tbody>
              {visibleOthers.map((row) => <tr key={row.receptionId}><td>{displayDate(row.receptionDate)}</td><td><strong>{row.vehicleRegistration || '-'}</strong><small>{row.receptionId}</small></td><td>{row.driverName || '-'}</td><td>{row.milkTypeLabel || '-'}</td><td className="daily-recon-number">{formatNumber(row.fullTruckWeightKg)}</td><td className="daily-recon-number">{formatNumber(row.emptyTruckWeightKg)}</td><td className="daily-recon-number">{formatNumber(row.netQuantityKg)}</td><td className="daily-recon-number">{formatNumber(row.calculatedLiters)}</td><td>{row.comments || '-'}</td></tr>)}
              {!loading && !visibleOthers.length && <tr><td colSpan={9} className="daily-recon-empty">No other receptions match this month and search.</td></tr>}
            </tbody>
          </table></div>
        </section>}
      </main>
    </div>
  )
}
