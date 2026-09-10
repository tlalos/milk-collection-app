import { Fragment, useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import './MonthlyReconciliationScreen.css'

type ReconciliationStatus = 'ok' | 'difference' | 'missing_monthly' | 'missing_aviz'

interface MonthlyReconciliationAvizRow {
  id: string
  jobId: string
  sourceFile: string
  fileUrl: string
  documentDate: string | null
  route: string | null
  driverName: string | null
  vehicleRegistration: string | null
  rowNumber: number | null
  noticeNumber: string | null
  liters: number | null
}

interface MonthlyReconciliationJournalRow {
  id: string
  jobId: string
  sourceFile: string
  fileUrl: string
  documentDate: string | null
  rowNumber: number | null
  producer: string | null
  centerName: string | null
  milkType: string | null
  liters: number | null
  confidence: number | null
}

interface MonthlyReconciliationRow {
  id: string
  month: string
  center: string
  milkType: string
  avizLiters: number
  monthlyLiters: number
  differenceLiters: number
  differencePercent: number | null
  status: ReconciliationStatus
  avizLineCount: number
  monthlyRowCount: number
  avizRows: MonthlyReconciliationAvizRow[]
  monthlyRows: MonthlyReconciliationJournalRow[]
}

interface MonthlyReconciliationSummary {
  groupCount: number
  okCount: number
  differenceCount: number
  missingMonthlyCount: number
  missingAvizCount: number
  totalAvizLiters: number
  totalMonthlyLiters: number
}

interface MonthlyReconciliationPayload {
  rows: MonthlyReconciliationRow[]
  summary: MonthlyReconciliationSummary
}

type StatusFilter = 'all' | ReconciliationStatus

const emptySummary: MonthlyReconciliationSummary = {
  groupCount: 0,
  okCount: 0,
  differenceCount: 0,
  missingMonthlyCount: 0,
  missingAvizCount: 0,
  totalAvizLiters: 0,
  totalMonthlyLiters: 0,
}

function formatNumber(value: number | null | undefined, maximumFractionDigits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)
}

function displayDate(value: string | null | undefined) {
  if (!value) return '-'
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`
  return value
}

function displayMonth(value: string) {
  const monthMatch = value.match(/^(\d{4})-(\d{2})$/u)
  if (!monthMatch) return value || '-'
  return `${monthMatch[2]}/${monthMatch[1]}`
}

function normalizedSearch(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase()
}

function includesFilter(value: unknown, needle: string) {
  return normalizedSearch(value).includes(needle)
}

function uniqueValues(rows: MonthlyReconciliationRow[], selector: (row: MonthlyReconciliationRow) => string | null) {
  return [...new Set(rows.map(selector).map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

function statusLabel(status: ReconciliationStatus) {
  if (status === 'missing_monthly') return 'No journal'
  if (status === 'missing_aviz') return 'Missing aviz'
  if (status === 'difference') return 'Difference'
  return 'OK'
}

export function MonthlyReconciliationScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<MonthlyReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [centerFilter, setCenterFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showJournalCenters, setShowJournalCenters] = useState(false)

  async function loadRows() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(appPath('/api/ocr/monthly-reconciliation/rows'))
      const text = await response.text()
      const payload = text ? JSON.parse(text) as MonthlyReconciliationPayload & { error?: string } : { rows: [], summary: emptySummary }
      if (!response.ok) throw new Error(payload.error || 'Could not load monthly reconciliation.')
      setRows(payload.rows || [])
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  const centerOptions = useMemo(() => uniqueValues(rows, (row) => row.center), [rows])
  const milkTypeOptions = useMemo(() => uniqueValues(rows, (row) => row.milkType), [rows])
  const monthOptions = useMemo(() => uniqueValues(rows, (row) => row.month), [rows])
  const hasActiveFilters = Boolean(monthFilter || centerFilter || milkTypeFilter || statusFilter !== 'all')

  const filteredRows = useMemo(() => {
    const centerNeedle = normalizedSearch(centerFilter)
    return rows.filter((row) => {
      if (monthFilter && row.month !== monthFilter) return false
      if (centerNeedle && !includesFilter(row.center, centerNeedle)) return false
      if (milkTypeFilter && row.milkType !== milkTypeFilter) return false
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      return true
    })
  }, [centerFilter, milkTypeFilter, monthFilter, rows, statusFilter])

  const filteredAvizLiters = filteredRows.reduce((total, row) => total + row.avizLiters, 0)
  const filteredMonthlyLiters = filteredRows.reduce((total, row) => total + row.monthlyLiters, 0)
  const receivedJournalCenters = new Set(
    filteredRows
      .filter((row) => row.monthlyRowCount > 0)
      .map((row) => `${row.month}|${normalizedSearch(row.center)}`),
  ).size
  const avizCenters = new Set(
    filteredRows
      .filter((row) => row.avizLineCount > 0)
      .map((row) => `${row.month}|${normalizedSearch(row.center)}`),
  ).size
  const tableRows = useMemo(() => filteredRows.filter((row) => row.avizLineCount > 0), [filteredRows])
  const tableAvizLiters = tableRows.reduce((total, row) => total + row.avizLiters, 0)
  const tableMonthlyLiters = tableRows.reduce((total, row) => total + row.monthlyLiters, 0)
  const tableDifference = tableMonthlyLiters - tableAvizLiters
  const journalCenters = useMemo(() => {
    const centers = new Map<string, { center: string; liters: number; rowCount: number; milkTypes: Set<string> }>()
    for (const row of rows) {
      if (monthFilter && row.month !== monthFilter) continue
      if (row.monthlyRowCount <= 0) continue
      const key = normalizedSearch(row.center)
      if (!key) continue
      const current = centers.get(key) ?? { center: row.center, liters: 0, rowCount: 0, milkTypes: new Set<string>() }
      current.liters += row.monthlyLiters
      current.rowCount += row.monthlyRowCount
      if (row.milkType) current.milkTypes.add(row.milkType)
      centers.set(key, current)
    }
    return [...centers.values()]
      .map((item) => ({
        ...item,
        liters: Number(item.liters.toFixed(3)),
        milkTypeLabel: [...item.milkTypes].sort().join(', '),
      }))
      .sort((left, right) => left.center.localeCompare(right.center, undefined, { numeric: true }))
  }, [monthFilter, rows])

  function openFile(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="monthly-recon-screen app-shell">
      <header className="app-topbar monthly-recon-topbar">
        <button className="back-button monthly-recon-home-button" type="button" onClick={onBack} aria-label="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10.5V20h14v-9.5" />
            <path d="M9.5 20v-6h5v6" />
          </svg>
          <span>Home</span>
        </button>
        <div className="app-title-block">
          <span>OCR documents</span>
          <h1>Monthly Reconciliation</h1>
        </div>
        <div className="monthly-recon-actions">
          <button
            className="monthly-recon-header-button"
            type="button"
            onClick={() => { window.location.href = appPath('/ocr/review') }}
          >
            Daily OCR
          </button>
          <button
            className="monthly-recon-header-button"
            type="button"
            onClick={() => { window.location.href = appPath('/ocr/monthly-review') }}
          >
            Monthly OCR
          </button>
          <button className="monthly-recon-header-button" type="button" onClick={() => void loadRows()} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      <main className="monthly-recon-content">
        <section className="monthly-recon-summary" aria-label="Monthly reconciliation summary">
          <div><span>Journals</span><strong>{receivedJournalCenters}</strong></div>
          <div><span>Centers in aviz</span><strong>{avizCenters}</strong></div>
          <div><span>Aviz liters</span><strong>{formatNumber(filteredAvizLiters)}</strong></div>
          <div><span>Monthly liters</span><strong>{formatNumber(filteredMonthlyLiters)}</strong></div>
        </section>

        <section className="monthly-recon-toolbar" aria-label="Monthly reconciliation filters">
          <label>
            <span>Month</span>
            <input
              type="month"
              value={monthFilter}
              onChange={(event) => setMonthFilter(event.target.value)}
              list="monthly-recon-month-options"
            />
            <datalist id="monthly-recon-month-options">
              {monthOptions.map((month) => <option key={month} value={month} />)}
            </datalist>
          </label>
          <label>
            <span>Center</span>
            <input
              list="monthly-recon-center-options"
              value={centerFilter}
              onChange={(event) => setCenterFilter(event.target.value)}
              placeholder="Collection center..."
            />
            <datalist id="monthly-recon-center-options">
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
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All rows</option>
              <option value="ok">OK</option>
              <option value="difference">Differences</option>
              <option value="missing_monthly">No journal</option>
            </select>
          </label>
          <button
            className="monthly-recon-clear-filters"
            type="button"
            onClick={() => {
              setMonthFilter('')
              setCenterFilter('')
              setMilkTypeFilter('')
              setStatusFilter('all')
            }}
            disabled={!hasActiveFilters}
          >
            Clear
          </button>
        </section>

        {error && <div className="monthly-recon-error" role="alert">{error}</div>}

        <section className="monthly-recon-table-card">
          <div className="monthly-recon-table-title">
            <div>
              <h2>
                Monthly journals Vs Aviz
                {monthFilter && <span>{displayMonth(monthFilter)}</span>}
                <button
                  className="monthly-recon-journals-toggle"
                  type="button"
                  onClick={() => setShowJournalCenters((current) => !current)}
                  aria-expanded={showJournalCenters}
                >
                  Journals
                  <strong>{journalCenters.length}</strong>
                </button>
              </h2>
              <p>
                {tableRows.length} aviz centers shown · {formatNumber(tableAvizLiters)} aviz L · {formatNumber(tableMonthlyLiters)} monthly L · {formatNumber(tableDifference)} diff L
              </p>
            </div>
          </div>
          {showJournalCenters && (
            <div className="monthly-recon-journal-centers" aria-label="Received journal centers">
              {journalCenters.length === 0 ? (
                <p>No journal centers for this month.</p>
              ) : (
                <ul>
                  {journalCenters.map((item) => (
                    <li key={normalizedSearch(item.center)}>
                      <span title={item.center}>{item.center}</span>
                      {item.milkTypeLabel && <small>{item.milkTypeLabel}</small>}
                      <b>{formatNumber(item.liters)} L</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="monthly-recon-table-wrap">
            <table className="monthly-recon-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Center</th>
                  <th>Milk type</th>
                  <th>Aviz L</th>
                  <th>Monthly L</th>
                  <th>Diff L</th>
                  <th>Diff %</th>
                  <th>Aviz lines</th>
                  <th>Journal rows</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={10} className="monthly-recon-empty">Loading monthly reconciliation...</td></tr>
                )}
                {!loading && tableRows.length === 0 && (
                  <tr><td colSpan={10} className="monthly-recon-empty">No aviz centers found for this view.</td></tr>
                )}
                {!loading && tableRows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className={`monthly-recon-row ${row.status}`}>
                      <td>
                        <button
                          className="monthly-recon-expand"
                          type="button"
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                          aria-label={expandedId === row.id ? 'Collapse details' : 'Expand details'}
                        >
                          {expandedId === row.id ? '-' : '+'}
                        </button>
                      </td>
                      <td className={`monthly-recon-center-cell ${row.status}`} title={row.center}>
                        {row.monthlyRowCount === 0 && <span className="monthly-recon-center-alert">!</span>}
                        <span>{row.center}</span>
                      </td>
                      <td>{row.milkType}</td>
                      <td>{formatNumber(row.avizLiters)}</td>
                      <td>{formatNumber(row.monthlyLiters)}</td>
                      <td>{formatNumber(row.differenceLiters)}</td>
                      <td>{row.differencePercent == null ? '-' : `${formatNumber(row.differencePercent, 2)}%`}</td>
                      <td>{row.avizLineCount}</td>
                      <td>{row.monthlyRowCount}</td>
                      <td><span className={`monthly-recon-badge ${row.status}`}>{statusLabel(row.status)}</span></td>
                    </tr>
                    {expandedId === row.id && (
                      <tr key={`${row.id}-details`}>
                        <td colSpan={10} className="monthly-recon-detail-cell">
                          <div className="monthly-recon-detail-grid">
                            <section className="monthly-recon-detail-panel">
                              <h3>Daily aviz rows</h3>
                              {row.avizRows.length === 0 ? (
                                <p>No daily aviz rows for this center.</p>
                              ) : (
                                <table className="monthly-recon-daily-detail-table">
                                  <thead>
                                    <tr>
                                      <th>Date</th>
                                      <th>Truck</th>
                                      <th>Route</th>
                                      <th>Notice</th>
                                      <th>Liters</th>
                                      <th>File</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.avizRows.map((detail) => (
                                      <tr key={detail.id}>
                                        <td>{displayDate(detail.documentDate)}</td>
                                        <td>{detail.vehicleRegistration || '-'}</td>
                                        <td>{detail.route || '-'}</td>
                                        <td>{detail.noticeNumber || '-'}</td>
                                        <td>{formatNumber(detail.liters)}</td>
                                        <td><button type="button" onClick={() => openFile(detail.fileUrl)}>Open</button></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </section>
                            <section className="monthly-recon-detail-panel">
                              <h3>Monthly journal rows</h3>
                              {row.monthlyRows.length === 0 ? (
                                <p>No monthly journal rows for this center.</p>
                              ) : (
                                <table className="monthly-recon-journal-detail-table">
                                  <thead>
                                    <tr>
                                      <th>Date</th>
                                      <th>Producer</th>
                                      <th>Liters</th>
                                      <th>File</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.monthlyRows.map((detail) => (
                                      <tr key={detail.id}>
                                        <td>{displayDate(detail.documentDate)}</td>
                                        <td title={detail.producer || detail.centerName || ''}>{detail.producer || detail.centerName || '-'}</td>
                                        <td>{formatNumber(detail.liters)}</td>
                                        <td><button type="button" onClick={() => openFile(detail.fileUrl)}>Open</button></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
