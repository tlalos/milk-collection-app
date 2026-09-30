import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { FloatingHorizontalScrollbar } from './FloatingHorizontalScrollbar'
import { appPath } from '../ocrPaths'
import { failedDailyErpRecovery, sendDailyRouteDetailsToErp, type DailyRouteCenterMatch, type DailyRouteExtractedData, type DailyRouteErpExport, type DailyRouteErpRowLog } from '../store/dailyRouteErpStore'
import './DailyAvizScreen.css'

interface DailyAvizRow {
  erpSendBlocker?: string | null
  erpSendSource?: unknown
  erpRowResult?: DailyRouteErpRowLog | null
  id: string
  jobId: string
  sourceFile: string
  fileUrl: string
  documentDate: string | null
  route: string | null
  driverName: string | null
  vehicleRegistration: string | null
  jobStatus: 'queued' | 'processing' | 'completed' | 'failed'
  reviewStatus: 'pending' | 'reviewed'
  excelStatus: 'not_ready' | 'queued' | 'exporting' | 'exported' | 'failed' | null
  erpStatus: 'not_ready' | 'queued' | 'exporting' | 'exported' | 'failed' | 'sent' | null
  createdAt: string
  completedAt: string | null
  rowNumber: number | null
  collectionCenter: string | null
  milkType: string | null
  liters: number | null
  fatPercent: number | null
  density: number | null
  water: number | null
  temperature: number | null
  noticeNumber: string | null
  confidence: number | null
  uncertainFields: string[]
  receptionMatch?: DailyAvizReceptionMatch
}

interface DailyAvizReceptionMatch {
  status: 'matched' | 'no_match' | 'incomplete' | 'conflict'
  matchCount: number
  receptionId: string | null
  receptionDate: string | null
  truck: string | null
  route: string | null
  netQuantityKg: number | null
  calculatedLiters: number | null
}

interface DailyAvizSummary {
  documentCount: number
  rowCount: number
  pendingDocumentCount: number
  reviewedDocumentCount: number
  failedDocumentCount: number
  totalLiters: number
  receptionMatchedCount: number
  receptionNoMatchCount: number
  receptionIssueCount: number
}

interface DailyAvizPayload {
  rows: DailyAvizRow[]
  summary: DailyAvizSummary
}

type ReviewFilter = 'all' | 'pending' | 'reviewed' | 'failed' | 'processing'

const emptySummary: DailyAvizSummary = {
  documentCount: 0,
  rowCount: 0,
  pendingDocumentCount: 0,
  reviewedDocumentCount: 0,
  failedDocumentCount: 0,
  totalLiters: 0,
  receptionMatchedCount: 0,
  receptionNoMatchCount: 0,
  receptionIssueCount: 0,
}

function displayDate(value: string | null | undefined) {
  if (!value) return '-'
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (isoMatch) return `${Number(isoMatch[3])}/${Number(isoMatch[2])}/${isoMatch[1].slice(-2)}`
  const displayMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u)
  if (displayMatch) return `${Number(displayMatch[1])}/${Number(displayMatch[2])}/${displayMatch[3].slice(-2)}`
  return value
}

function displayMonth(value: string) {
  const monthMatch = value.match(/^(\d{4})-(\d{2})$/u)
  if (!monthMatch) return value || '-'
  return `${monthMatch[2]}/${monthMatch[1]}`
}

function filterDateValue(value: string | null | undefined) {
  if (!value) return ''
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (isoMatch) return value
  const displayMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u)
  if (!displayMatch) return ''
  const day = displayMatch[1].padStart(2, '0')
  const month = displayMatch[2].padStart(2, '0')
  return `${displayMatch[3]}-${month}-${day}`
}

function filterMonthValue(value: string | null | undefined) {
  return filterDateValue(value).slice(0, 7)
}

function dateSortValue(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim()
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  const displayMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u)
  const timestamp = isoMatch
    ? Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    : displayMatch
      ? Date.UTC(Number(displayMatch[3]), Number(displayMatch[2]) - 1, Number(displayMatch[1]))
      : Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

function uploadSortValue(value: string | null | undefined) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareRows(left: DailyAvizRow, right: DailyAvizRow) {
  const leftDate = dateSortValue(left.documentDate)
  const rightDate = dateSortValue(right.documentDate)
  const leftNeedsRecognition = left.jobStatus !== 'completed' || leftDate === null
  const rightNeedsRecognition = right.jobStatus !== 'completed' || rightDate === null
  if (leftNeedsRecognition !== rightNeedsRecognition) return leftNeedsRecognition ? -1 : 1
  if (leftDate !== null && rightDate !== null && leftDate !== rightDate) return rightDate - leftDate
  if (left.jobId !== right.jobId) return uploadSortValue(right.createdAt) - uploadSortValue(left.createdAt)
  return (left.rowNumber ?? 0) - (right.rowNumber ?? 0)
}

function formatNumber(value: number | null | undefined, maximumFractionDigits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)
}

function statusLabel(status: string | null | undefined) {
  if (!status) return '-'
  return status.replace('_', ' ')
}

function ErpDocumentStatus({ row, kind }: { row: DailyAvizRow; kind: 'aviz' | 'nir' }) {
  const result = row.erpRowResult
  const document = result?.documents?.find((item) => item.kind === kind)
  const legacyAviz = kind === 'aviz' && result && !result.documents?.length
  const status = document?.status ?? (legacyAviz ? result.status : result ? 'unrecorded' : 'ready')
  const labels: Record<string, string> = { ready: 'Not sent', sent: 'Sent', failed: 'Failed', sending: 'Sending', unconfirmed: 'Unconfirmed', unrecorded: 'No recorded result' }
  const id = document?.newid ?? (legacyAviz ? result.newid : undefined)
  const message = document?.message || result?.message || ''
  return <div className="daily-aviz-erp-result" title={message}>
    <span className={`daily-aviz-badge erp-${status}`}>{labels[status]}</span>
    {id && <small>ERP #{id}</small>}
    {document?.completedAt && <small>{new Date(document.completedAt).toLocaleString('en-GB')}</small>}
    {(status === 'failed' || status === 'unconfirmed') && <small>{message}</small>}
  </div>
}

function displayMilkType(value: string | null | undefined) {
  if (!value) return '-'
  return value.replace(/^MILK[-_\s]*/iu, '').trim() || value
}

function receptionStatusLabel(match: DailyAvizReceptionMatch | null | undefined) {
  if (!match) return 'Unknown'
  if (match.status === 'matched') return 'Matched'
  if (match.status === 'no_match') return 'No scale'
  if (match.status === 'conflict') return 'Conflict'
  return 'Incomplete'
}

function receptionStatusTitle(row: DailyAvizRow) {
  const match = row.receptionMatch
  if (!match) return 'Reception status was not calculated.'
  const key = [
    `date ${displayDate(row.documentDate)}`,
    `truck ${row.vehicleRegistration || '-'}`,
    `route ${row.route || '-'}`,
  ].join(', ')
  if (match.status === 'matched') {
    return `Matched against reception ${match.receptionId || '-'} (${key}). ${formatNumber(match.netQuantityKg, 2)} kg, ${formatNumber(match.calculatedLiters, 2)} L.`
  }
  if (match.status === 'no_match') return `No milk reception row matches ${key}.`
  if (match.status === 'conflict') return `${match.matchCount} milk reception rows match ${key}; this should be checked.`
  return `Cannot compare with reception because the OCR row is missing date, truck, or route.`
}

function initialMonthFilter() {
  const requestedMonth = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('month')
  if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) return requestedMonth
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

function normalizedSearch(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase()
}

function includesFilter(value: unknown, needle: string) {
  return normalizedSearch(value).includes(needle)
}

function uniqueValues(rows: DailyAvizRow[], selector: (row: DailyAvizRow) => string | null) {
  return [...new Set(rows.map(selector).map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

export function DailyAvizScreen({ onBack }: { onBack: () => void }) {
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [confirmSend, setConfirmSend] = useState<DailyAvizRow | null>(null)
  const [sendingRowId, setSendingRowId] = useState('')
  const sendingRef = useRef(false)
  const [sendFeedback, setSendFeedback] = useState<{ id: string; message: string; failed: boolean } | null>(null)
  const [rows, setRows] = useState<DailyAvizRow[]>([])
  const [summary, setSummary] = useState<DailyAvizSummary>(emptySummary)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [truckFilter, setTruckFilter] = useState('')
  const [centerFilter, setCenterFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(initialMonthFilter)
  const [selectedDate, setSelectedDate] = useState('')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')

  async function loadRows() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(appPath('/api/ocr/daily-aviz/rows'))
      const text = await response.text()
      const payload = text ? JSON.parse(text) as DailyAvizPayload & { error?: string } : { rows: [], summary: emptySummary }
      if (!response.ok) throw new Error(payload.error || 'Could not load daily aviz lines.')
      setRows(payload.rows || [])
      setSummary(payload.summary || emptySummary)
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function sendRow(row: DailyAvizRow) {
    if (sendingRef.current || row.erpSendBlocker !== null) return
    sendingRef.current = true
    setSendingRowId(row.id)
    setConfirmSend(null)
    setSendFeedback({ id: row.id, message: 'Preparing Aviz and NIR...', failed: false })
    type SendJob = { id: string; data: DailyRouteExtractedData; centerMatches: DailyRouteCenterMatch[]; erpExport: DailyRouteErpExport }
    let job: SendJob | null = null
    let latest: DailyRouteErpExport | null = null
    const persist = async (state: DailyRouteErpExport) => {
      latest = state
      const response = await fetch(appPath(`/api/ocr/jobs/${job!.id}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: job!.data, centerMatches: job!.centerMatches, erpExport: state }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not save ERP results.')
      setRows(current => current.map(item => item.jobId === job!.id ? {
        ...item, erpRowResult: state.rowLog?.find(log => log.rowNumber === item.rowNumber) ?? item.erpRowResult,
        erpSendBlocker: 'ERP send in progress. Wait for completion.',
      } : item))
    }
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${row.jobId}/erp-send-row`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowNumber: row.rowNumber, expectedSource: row.erpSendSource }),
      })
      const payload = await response.json() as { job?: SendJob; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not start this ERP send.')
      job = payload.job
      latest = job.erpExport
      setSendFeedback({ id: row.id, message: 'Sending Aviz, then NIR...', failed: false })
      const result = await sendDailyRouteDetailsToErp(job.data, job.centerMatches ?? [], undefined, persist,
        { state: job.erpExport, rowNumber: row.rowNumber!, initial: true })
      await persist(result)
      const sent = result.rowLog?.find(log => log.rowNumber === row.rowNumber)?.status === 'sent'
      setSendFeedback({ id: row.id, failed: !sent, message: sent ? 'Aviz and NIR sent.' : 'Send incomplete. Check the results and use Verify / recover row in OCR review.' })
    } catch (sendError) {
      let message = (sendError as Error).message
      if (job && latest) {
        try { await persist(failedDailyErpRecovery(latest, message)) }
        catch { message += ' Final status could not be saved. Check ERP before retrying.' }
      }
      setSendFeedback({ id: row.id, message, failed: true })
    } finally {
      await loadRows()
      sendingRef.current = false
      setSendingRowId('')
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  const truckOptions = useMemo(() => uniqueValues(rows, (row) => row.vehicleRegistration), [rows])
  const centerOptions = useMemo(() => uniqueValues(rows, (row) => row.collectionCenter), [rows])
  const milkTypeOptions = useMemo(() => uniqueValues(rows, (row) => row.milkType), [rows])
  const monthOptions = useMemo(() => uniqueValues(rows, (row) => filterMonthValue(row.documentDate)), [rows])
  const hasActiveFilters = Boolean(truckFilter || centerFilter || milkTypeFilter || selectedMonth || selectedDate || reviewFilter !== 'all')

  const filteredRows = useMemo(() => {
    const truckNeedle = normalizedSearch(truckFilter)
    const centerNeedle = normalizedSearch(centerFilter)
    return [...rows].sort(compareRows).filter((row) => {
      if (selectedMonth && filterMonthValue(row.documentDate) !== selectedMonth) return false
      if (selectedDate && filterDateValue(row.documentDate) !== selectedDate) return false
      if (reviewFilter === 'pending' && row.reviewStatus !== 'pending') return false
      if (reviewFilter === 'reviewed' && row.reviewStatus !== 'reviewed') return false
      if (reviewFilter === 'failed' && row.jobStatus !== 'failed') return false
      if (reviewFilter === 'processing' && row.jobStatus !== 'queued' && row.jobStatus !== 'processing') return false
      if (truckNeedle && !includesFilter(row.vehicleRegistration, truckNeedle)) return false
      if (centerNeedle && !includesFilter(row.collectionCenter, centerNeedle)) return false
      if (milkTypeFilter && row.milkType !== milkTypeFilter) return false
      return true
    })
  }, [centerFilter, milkTypeFilter, reviewFilter, rows, selectedDate, selectedMonth, truckFilter])

  const filteredLiters = filteredRows.reduce(
    (total, row) => total + (typeof row.liters === 'number' && Number.isFinite(row.liters) ? row.liters : 0),
    0,
  )

  function openFile(row: DailyAvizRow) {
    window.open(row.fileUrl || appPath(`/api/ocr/jobs/${row.jobId}/file`), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="daily-aviz-screen app-shell">
      <header className="app-topbar daily-aviz-topbar">
        <button className="back-button daily-aviz-home-button" type="button" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </button>
        <div className="app-title-block">
          <span>OCR documents</span>
          <h1>Daily Aviz</h1>
        </div>
        <button className="daily-aviz-refresh" type="button" onClick={() => void loadRows()} disabled={loading}>
          Refresh
        </button>
      </header>

      <main className="daily-aviz-content">
        <section className="daily-aviz-summary" aria-label="Daily aviz summary">
          <div><span>Documents</span><strong>{summary.documentCount}</strong></div>
          <div><span>Aviz lines</span><strong>{summary.rowCount}</strong></div>
          <div><span>Pending docs</span><strong>{summary.pendingDocumentCount}</strong></div>
          <div><span>Failed docs</span><strong>{summary.failedDocumentCount}</strong></div>
          <div><span>Total liters</span><strong>{formatNumber(summary.totalLiters)}</strong></div>
          <div><span>Reception matched</span><strong>{summary.receptionMatchedCount}</strong></div>
          <div><span>Reception issues</span><strong>{summary.receptionIssueCount}</strong></div>
        </section>

        <section className="daily-aviz-toolbar" aria-label="Daily aviz filters">
          <label>
            <span>Truck</span>
            <input
              list="daily-aviz-truck-options"
              value={truckFilter}
              onChange={(event) => setTruckFilter(event.target.value)}
              placeholder="Truck no..."
            />
            <datalist id="daily-aviz-truck-options">
              {truckOptions.map((truck) => <option key={truck} value={truck} />)}
            </datalist>
          </label>
          <label>
            <span>Center</span>
            <input
              list="daily-aviz-center-options"
              value={centerFilter}
              onChange={(event) => setCenterFilter(event.target.value)}
              placeholder="Collection center..."
            />
            <datalist id="daily-aviz-center-options">
              {centerOptions.map((center) => <option key={center} value={center} />)}
            </datalist>
          </label>
          <label>
            <span>Milk type</span>
            <select value={milkTypeFilter} onChange={(event) => setMilkTypeFilter(event.target.value)}>
              <option value="">All milk types</option>
              {milkTypeOptions.map((milkType) => <option key={milkType} value={milkType}>{displayMilkType(milkType)}</option>)}
            </select>
          </label>
          <label>
            <span>Month</span>
            <input
              type="month"
              value={selectedMonth}
              onInput={(event) => setSelectedMonth(event.currentTarget.value)}
              onChange={(event) => setSelectedMonth(event.currentTarget.value)}
              list="daily-aviz-month-options"
            />
            <datalist id="daily-aviz-month-options">
              {monthOptions.map((month) => <option key={month} value={month} />)}
            </datalist>
          </label>
          <label>
            <span>Aviz date</span>
            <input
              type="date"
              lang="en-US"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </label>
          <label>
            <span>Status</span>
            <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as ReviewFilter)}>
              <option value="all">All lines</option>
              <option value="pending">Pending review</option>
              <option value="reviewed">Reviewed</option>
              <option value="processing">Processing documents</option>
              <option value="failed">Failed documents</option>
            </select>
          </label>
          <button
            className="daily-aviz-clear-filters"
            type="button"
            onClick={() => {
              setTruckFilter('')
              setCenterFilter('')
              setMilkTypeFilter('')
              setSelectedMonth('')
              setSelectedDate('')
              setReviewFilter('all')
            }}
            disabled={!hasActiveFilters}
          >
            Clear
          </button>
        </section>

        {error && <div className="daily-aviz-error" role="alert">{error}</div>}

        <section className="daily-aviz-table-card">
          <div className="daily-aviz-table-title">
            <div>
              <h2>Recognized aviz lines</h2>
              <p>{filteredRows.length} rows shown{selectedMonth ? ` · ${displayMonth(selectedMonth)}` : ''} · {formatNumber(filteredLiters)} liters</p>
            </div>
            <button type="button" onClick={() => { window.location.href = appPath('/ocr/review') }}>
              Open OCR review
            </button>
          </div>
          <div className="daily-aviz-table-wrap" ref={tableWrapRef}>
            <table className="daily-aviz-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Aviz date</th>
                  <th>Aviz no</th>
                  <th>Truck no / Route</th>
                  <th>Reception</th>
                  <th>Driver</th>
                  <th>Center</th>
                  <th>Milk type</th>
                  <th>Liters</th>
                  <th>Review</th>
                  <th>Aviz ERP</th>
                  <th>NIR ERP</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={13} className="daily-aviz-empty">Loading daily aviz lines...</td></tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr><td colSpan={13} className="daily-aviz-empty">No recognized daily aviz lines found.</td></tr>
                )}
                {!loading && filteredRows.map((row) => (
                  <Fragment key={row.id}>
                  <tr className={`reception-row-${row.receptionMatch?.status || 'unknown'}`}>
                    <td><div className="daily-aviz-line">
                      <button type="button" className="daily-aviz-expand"
                        aria-expanded={expandedRows.has(row.id)} aria-controls={`quality-${row.id}`}
                        aria-label={`${expandedRows.has(row.id) ? 'Hide' : 'Show'} quality for line ${row.rowNumber ?? '-'}, ${row.collectionCenter || '-'}`}
                        title={expandedRows.has(row.id) ? 'Hide quality' : 'Show quality'}
                        onClick={() => setExpandedRows(current => {
                          const next = new Set(current)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })}>{expandedRows.has(row.id) ? '-' : '+'}</button>
                      {row.rowNumber ?? '-'}
                    </div></td>
                    <td>{displayDate(row.documentDate)}</td>
                    <td>{row.noticeNumber || '-'}</td>
                    <td className="daily-aviz-truck-route">{row.vehicleRegistration || '-'} / {row.route || '-'}</td>
                    <td>
                      <span className={`daily-aviz-badge reception-${row.receptionMatch?.status || 'unknown'}`} title={receptionStatusTitle(row)}>
                        {receptionStatusLabel(row.receptionMatch)}
                      </span>
                    </td>
                    <td>{row.driverName || '-'}</td>
                    <td title={row.collectionCenter || ''}>{row.collectionCenter || '-'}</td>
                    <td title={row.milkType || ''}>{displayMilkType(row.milkType)}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td>
                      <span className={`daily-aviz-badge ${row.reviewStatus}`}>
                        {statusLabel(row.reviewStatus)}
                      </span>
                    </td>
                    <td><ErpDocumentStatus row={row} kind="aviz" /></td>
                    <td><ErpDocumentStatus row={row} kind="nir" /></td>
                    <td>
                      <div className="daily-aviz-actions">
                        <button className="daily-aviz-file-icon" type="button" title="Open file" aria-label={`Open file for aviz ${row.noticeNumber || '-'}, line ${row.rowNumber ?? '-'}`} onClick={() => openFile(row)}><span aria-hidden="true">📄</span></button>
                        <button type="button" disabled={Boolean(sendingRowId) || row.erpSendBlocker !== null}
                          title={row.erpSendBlocker || 'Send Aviz and NIR for this row'}
                          onClick={() => setConfirmSend(row)}>{sendingRowId === row.id ? 'Sending...' : 'Send to ERP'}</button>
                      </div>
                    </td>
                  </tr>
                  {confirmSend?.id === row.id && <tr><td colSpan={13} className="daily-aviz-quality-cell">
                    <div className="daily-aviz-send-confirm">
                      <span>Send 1 Aviz + 1 NIR: {row.collectionCenter} · {displayDate(row.documentDate)} · Aviz {row.noticeNumber} · {formatNumber(row.liters)} L · {displayMilkType(row.milkType)}?</span>
                      <button type="button" disabled={Boolean(sendingRowId)} onClick={() => void sendRow(confirmSend)}>Confirm send</button>
                      <button type="button" onClick={() => setConfirmSend(null)}>Cancel</button>
                    </div>
                  </td></tr>}
                  {sendFeedback?.id === row.id && <tr><td colSpan={13} className="daily-aviz-quality-cell">
                    <p className={sendFeedback.failed ? 'daily-aviz-send-error' : ''} role={sendFeedback.failed ? 'alert' : 'status'}>{sendFeedback.message}</p>
                  </td></tr>}
                  {expandedRows.has(row.id) && <tr>
                    <td colSpan={13} className="daily-aviz-quality-cell">
                      <dl id={`quality-${row.id}`} className="daily-aviz-quality" aria-label="Milk quality">
                        <div><dt>Fat %</dt><dd>{formatNumber(row.fatPercent, 2)}</dd></div>
                        <div><dt>Water %</dt><dd>{formatNumber(row.water, 2)}</dd></div>
                        <div><dt>Density</dt><dd>{formatNumber(row.density, 3)}</dd></div>
                        <div><dt>Temperature °C</dt><dd>{formatNumber(row.temperature, 2)}</dd></div>
                        <div><dt>Alcohol</dt><dd>—</dd></div>
                        <div><dt>Antibiotic</dt><dd>—</dd></div>
                        <div><dt>pH</dt><dd>—</dd></div>
                      </dl>
                    </td>
                  </tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <FloatingHorizontalScrollbar targetRef={tableWrapRef} label="Scroll daily aviz table horizontally" />
        </section>
      </main>
    </div>
  )
}
