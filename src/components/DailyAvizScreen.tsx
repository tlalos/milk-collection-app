import { useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import './DailyAvizScreen.css'

interface DailyAvizRow {
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
}

interface DailyAvizSummary {
  documentCount: number
  rowCount: number
  pendingDocumentCount: number
  reviewedDocumentCount: number
  failedDocumentCount: number
  totalLiters: number
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
}

function displayDate(value: string | null | undefined) {
  if (!value) return '-'
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
  return value
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
  const [rows, setRows] = useState<DailyAvizRow[]>([])
  const [summary, setSummary] = useState<DailyAvizSummary>(emptySummary)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [truckFilter, setTruckFilter] = useState('')
  const [centerFilter, setCenterFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
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

  useEffect(() => {
    void loadRows()
  }, [])

  const truckOptions = useMemo(() => uniqueValues(rows, (row) => row.vehicleRegistration), [rows])
  const centerOptions = useMemo(() => uniqueValues(rows, (row) => row.collectionCenter), [rows])
  const milkTypeOptions = useMemo(() => uniqueValues(rows, (row) => row.milkType), [rows])
  const hasActiveFilters = Boolean(search || truckFilter || centerFilter || milkTypeFilter || selectedDate || reviewFilter !== 'all')

  const filteredRows = useMemo(() => {
    const needle = normalizedSearch(search)
    const truckNeedle = normalizedSearch(truckFilter)
    const centerNeedle = normalizedSearch(centerFilter)
    return [...rows].sort(compareRows).filter((row) => {
      if (selectedDate && filterDateValue(row.documentDate) !== selectedDate) return false
      if (reviewFilter === 'pending' && row.reviewStatus !== 'pending') return false
      if (reviewFilter === 'reviewed' && row.reviewStatus !== 'reviewed') return false
      if (reviewFilter === 'failed' && row.jobStatus !== 'failed') return false
      if (reviewFilter === 'processing' && row.jobStatus !== 'queued' && row.jobStatus !== 'processing') return false
      if (truckNeedle && !includesFilter(row.vehicleRegistration, truckNeedle)) return false
      if (centerNeedle && !includesFilter(row.collectionCenter, centerNeedle)) return false
      if (milkTypeFilter && row.milkType !== milkTypeFilter) return false
      if (!needle) return true
      return [
        row.sourceFile,
        row.documentDate,
        row.route,
        row.driverName,
        row.noticeNumber,
        row.jobStatus,
        row.reviewStatus,
        row.excelStatus,
      ].some((value) => includesFilter(value, needle))
    })
  }, [centerFilter, milkTypeFilter, reviewFilter, rows, search, selectedDate, truckFilter])

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
        <button className="back-button daily-aviz-home-button" type="button" onClick={onBack} aria-label="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10.5V20h14v-9.5" />
            <path d="M9.5 20v-6h5v6" />
          </svg>
          <span>Home</span>
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
        </section>

        <section className="daily-aviz-toolbar" aria-label="Daily aviz filters">
          <label>
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Notice, route, driver, file..."
            />
          </label>
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
              {milkTypeOptions.map((milkType) => <option key={milkType} value={milkType}>{milkType}</option>)}
            </select>
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
              setSearch('')
              setTruckFilter('')
              setCenterFilter('')
              setMilkTypeFilter('')
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
              <p>{filteredRows.length} rows shown · {formatNumber(filteredLiters)} liters</p>
            </div>
            <button type="button" onClick={() => { window.location.href = appPath('/ocr/review') }}>
              Open OCR review
            </button>
          </div>
          <div className="daily-aviz-table-wrap">
            <table className="daily-aviz-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Aviz date</th>
                  <th>Aviz no</th>
                  <th>Truck no</th>
                  <th>Route</th>
                  <th>Driver</th>
                  <th>Center</th>
                  <th>Milk type</th>
                  <th>Liters</th>
                  <th>Fat %</th>
                  <th>Temp C</th>
                  <th>Water %</th>
                  <th>Review</th>
                  <th>Excel</th>
                  <th>File</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={16} className="daily-aviz-empty">Loading daily aviz lines...</td></tr>
                )}
                {!loading && filteredRows.length === 0 && (
                  <tr><td colSpan={16} className="daily-aviz-empty">No recognized daily aviz lines found.</td></tr>
                )}
                {!loading && filteredRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.rowNumber ?? '-'}</td>
                    <td>{displayDate(row.documentDate)}</td>
                    <td>{row.noticeNumber || '-'}</td>
                    <td>{row.vehicleRegistration || '-'}</td>
                    <td>{row.route || '-'}</td>
                    <td>{row.driverName || '-'}</td>
                    <td title={row.collectionCenter || ''}>{row.collectionCenter || '-'}</td>
                    <td>{row.milkType || '-'}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td>{formatNumber(row.fatPercent, 2)}</td>
                    <td>{formatNumber(row.temperature, 1)}</td>
                    <td>{formatNumber(row.water, 2)}</td>
                    <td>
                      <span className={`daily-aviz-badge ${row.reviewStatus}`}>
                        {statusLabel(row.reviewStatus)}
                      </span>
                    </td>
                    <td>{row.excelStatus ? <span className={`daily-aviz-badge ${row.excelStatus}`}>{statusLabel(row.excelStatus)}</span> : '-'}</td>
                    <td title={row.sourceFile}>{row.sourceFile}</td>
                    <td>
                      <div className="daily-aviz-actions">
                        <button type="button" onClick={() => openFile(row)}>File</button>
                        <button type="button" onClick={() => { window.location.href = appPath('/ocr/review') }}>Review</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
