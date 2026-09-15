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

interface AvizCenterCorrectionDraft {
  row: MonthlyReconciliationRow
  detail?: MonthlyReconciliationAvizRow
  targetCenter: string
}

interface AvizCenterCorrectionPayload {
  updatedJobs: number
  updatedRows: number
  reconciliation: MonthlyReconciliationPayload
  error?: string
}

interface ReferenceCenterOption {
  code?: string | null
  name: string
}

type OcrIssueSource = 'monthly' | 'daily'

interface OcrIssue {
  id: string
  source: OcrIssueSource
  type: string
  problem: string
  jobId: string
  sourceFile: string
  fileUrl: string
  month: string
  documentDate: string | null
  rowNumber: number | string | null
  producer: string | null
  center: string | null
  headerCenter: string | null
  referenceCenter: string | null
  milkType: string | null
  liters: number | null
  noticeNumber: string | null
}

interface OcrIssuesPayload {
  issues: OcrIssue[]
  summary: {
    total: number
    monthly: number
    daily: number
  }
  referenceErrors?: Array<{ source: OcrIssueSource; message: string }>
  error?: string
}

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

function initialMonthFilter() {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('month') || ''
}

function issueValue(issue: OcrIssue) {
  return issue.source === 'monthly'
    ? issue.producer || '-'
    : issue.center || '-'
}

function OcrIssueSection({ title, issues }: { title: string; issues: OcrIssue[] }) {
  return (
    <section className="monthly-recon-ocr-issue-section">
      <h3>
        {title}
        <span>{issues.length}</span>
      </h3>
      {issues.length === 0 ? (
        <p className="monthly-recon-ocr-issue-empty">No possible mistakes found.</p>
      ) : (
        <div className="monthly-recon-ocr-issue-table-wrap">
          <table className="monthly-recon-ocr-issue-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Document</th>
                <th>Row</th>
                <th>Problem</th>
                <th>Name</th>
                <th>Header / Ref center</th>
                <th>Milk</th>
                <th>Liters</th>
                <th>Aviz</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <td>{issue.month ? displayMonth(issue.month) : '-'}</td>
                  <td title={issue.sourceFile}>{issue.sourceFile || issue.jobId}</td>
                  <td>{issue.rowNumber ?? '-'}</td>
                  <td>{issue.problem}</td>
                  <td title={issueValue(issue)}>{issueValue(issue)}</td>
                  <td title={[issue.headerCenter, issue.referenceCenter].filter(Boolean).join(' / ')}>
                    {[issue.headerCenter, issue.referenceCenter].filter(Boolean).join(' / ') || '-'}
                  </td>
                  <td>{issue.milkType || '-'}</td>
                  <td>{formatNumber(issue.liters)}</td>
                  <td>{issue.noticeNumber || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function MonthlyReconciliationScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<MonthlyReconciliationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monthFilter, setMonthFilter] = useState(initialMonthFilter)
  const [centerFilter, setCenterFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showJournalCenters, setShowJournalCenters] = useState(false)
  const [correctionDraft, setCorrectionDraft] = useState<AvizCenterCorrectionDraft | null>(null)
  const [correctionSaving, setCorrectionSaving] = useState(false)
  const [referenceCenters, setReferenceCenters] = useState<ReferenceCenterOption[]>([])
  const [referenceCentersLoaded, setReferenceCentersLoaded] = useState(false)
  const [referenceCentersError, setReferenceCentersError] = useState('')
  const [notice, setNotice] = useState('')
  const [ocrIssues, setOcrIssues] = useState<OcrIssue[]>([])
  const [ocrIssueErrors, setOcrIssueErrors] = useState<Array<{ source: OcrIssueSource; message: string }>>([])
  const [ocrIssuesLoading, setOcrIssuesLoading] = useState(false)
  const [showOcrIssues, setShowOcrIssues] = useState(false)

  async function loadRows() {
    setLoading(true)
    setError('')
    setNotice('')
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

  async function loadOcrIssues() {
    setOcrIssuesLoading(true)
    try {
      const response = await fetch(appPath('/api/ocr/issues'))
      const text = await response.text()
      const payload = text ? JSON.parse(text) as OcrIssuesPayload : { issues: [], summary: { total: 0, monthly: 0, daily: 0 } }
      if (!response.ok) throw new Error(payload.error || 'Could not load OCR issues.')
      setOcrIssues(payload.issues || [])
      setOcrIssueErrors(payload.referenceErrors || [])
    } catch (loadError) {
      setOcrIssues([])
      setOcrIssueErrors([{ source: 'monthly', message: (loadError as Error).message || 'Could not load OCR issues.' }])
    } finally {
      setOcrIssuesLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
    void loadOcrIssues()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadReferenceCenters() {
      try {
        const response = await fetch(appPath('/api/monthly-reconciliation/reference-centers'))
        const payload = await response.json() as { centers?: ReferenceCenterOption[] }
        if (!response.ok) throw new Error('Could not load reference centers.')
        if (!cancelled) {
          setReferenceCenters((payload.centers || []).filter((center) => center?.name))
          setReferenceCentersLoaded(true)
          setReferenceCentersError('')
        }
      } catch (loadError) {
        if (!cancelled) {
          setReferenceCenters([])
          setReferenceCentersLoaded(true)
          setReferenceCentersError((loadError as Error).message || 'Could not load tblCenters.')
        }
      }
    }
    void loadReferenceCenters()
    return () => {
      cancelled = true
    }
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
  const visibleOcrIssues = useMemo(
    () => ocrIssues.filter((issue) => !monthFilter || issue.month === monthFilter),
    [monthFilter, ocrIssues],
  )
  const monthlyOcrIssues = visibleOcrIssues.filter((issue) => issue.source === 'monthly')
  const dailyOcrIssues = visibleOcrIssues.filter((issue) => issue.source === 'daily')
  const journalCenters = useMemo(() => {
    const centers = new Map<string, { center: string; liters: number; rowCount: number; milkTypes: Set<string>; hasAvizMatch: boolean; hasDifference: boolean }>()
    for (const row of rows) {
      if (monthFilter && row.month !== monthFilter) continue
      if (row.monthlyRowCount <= 0) continue
      const key = normalizedSearch(row.center)
      if (!key) continue
      const current = centers.get(key) ?? { center: row.center, liters: 0, rowCount: 0, milkTypes: new Set<string>(), hasAvizMatch: false, hasDifference: false }
      current.liters += row.monthlyLiters
      current.rowCount += row.monthlyRowCount
      if (row.milkType) current.milkTypes.add(row.milkType)
      if (row.avizLineCount > 0) current.hasAvizMatch = true
      if (row.status === 'difference') current.hasDifference = true
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

  function sortedJournalCenterOptions(row: MonthlyReconciliationRow) {
    return journalCenters
      .filter((item) => normalizedSearch(item.center) !== normalizedSearch(row.center))
      .sort((left, right) => {
        const leftMissing = left.hasAvizMatch ? 1 : 0
        const rightMissing = right.hasAvizMatch ? 1 : 0
        if (leftMissing !== rightMissing) return leftMissing - rightMissing
        const leftSameMilk = left.milkTypes.has(row.milkType) ? 0 : 1
        const rightSameMilk = right.milkTypes.has(row.milkType) ? 0 : 1
        if (leftSameMilk !== rightSameMilk) return leftSameMilk - rightSameMilk
        return left.center.localeCompare(right.center, undefined, { numeric: true })
      })
  }

  function centerCorrectionOptions(row: MonthlyReconciliationRow) {
    const currentCenter = normalizedSearch(row.center)
    const journalByCenter = new Map(sortedJournalCenterOptions(row).map((item) => [normalizedSearch(item.center), item]))
    const options = new Map<string, { center: string; label: string; priority: number; hasJournalRows: boolean }>()

    for (const center of referenceCenters) {
      const key = normalizedSearch(center.name)
      if (!key || key === currentCenter) continue
      const journal = journalByCenter.get(key)
      options.set(key, {
        center: center.name,
        label: journal
          ? `Has monthly journal rows · ${journal.milkTypeLabel || 'Milk type unknown'} · ${formatNumber(journal.liters)} L`
          : 'Official center from tblCenters',
        priority: journal ? 0 : 1,
        hasJournalRows: Boolean(journal),
      })
    }

    return [...options.values()].sort((left, right) =>
      left.priority - right.priority ||
      left.center.localeCompare(right.center, undefined, { numeric: true }))
  }

  function bestJournalCenterTarget(row: MonthlyReconciliationRow) {
    const rowCenter = normalizedSearch(row.center)
    return centerCorrectionOptions(row).find((item) => {
      const optionCenter = normalizedSearch(item.center)
      return item.hasJournalRows && (optionCenter.includes(rowCenter) || rowCenter.includes(optionCenter))
    })?.center || ''
  }

  function openCorrectionDialog(row: MonthlyReconciliationRow, detail?: MonthlyReconciliationAvizRow) {
    setError('')
    setNotice('')
    setCorrectionDraft({ row, detail, targetCenter: bestJournalCenterTarget(row) })
  }

  async function applyAvizCenterCorrection() {
    if (!correctionDraft || correctionSaving) return
    const targetCenter = correctionDraft.targetCenter.trim()
    if (!targetCenter) {
      setError('Choose the new center name.')
      return
    }
    setCorrectionSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(appPath('/api/ocr/monthly-reconciliation/aviz-center'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: correctionDraft.row.month,
          fromCenter: correctionDraft.row.center,
          milkType: correctionDraft.row.milkType,
          toCenter: targetCenter,
          jobId: correctionDraft.detail?.jobId,
          rowNumber: correctionDraft.detail?.rowNumber,
        }),
      })
      const payload = await response.json() as AvizCenterCorrectionPayload
      if (!response.ok) throw new Error(payload.error || 'Could not update the aviz center.')
      setRows(payload.reconciliation.rows || [])
      setExpandedId(null)
      setCorrectionDraft(null)
      setNotice(`Updated ${payload.updatedRows} daily aviz row${payload.updatedRows === 1 ? '' : 's'} in ${payload.updatedJobs} document${payload.updatedJobs === 1 ? '' : 's'}.`)
    } catch (saveError) {
      setError((saveError as Error).message || 'Could not update the aviz center.')
    } finally {
      setCorrectionSaving(false)
    }
  }

  function openFile(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="monthly-recon-screen app-shell">
      <header className="app-topbar monthly-recon-topbar">
        <button className="back-button monthly-recon-home-button" type="button" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
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
          <button
            className="monthly-recon-header-button"
            type="button"
            onClick={() => {
              setShowOcrIssues((current) => !current)
              if (!showOcrIssues) void loadOcrIssues()
            }}
            aria-expanded={showOcrIssues}
          >
            OCR issues ({visibleOcrIssues.length})
          </button>
          <button
            className="monthly-recon-header-button"
            type="button"
            onClick={() => {
              void loadRows()
              void loadOcrIssues()
            }}
            disabled={loading || ocrIssuesLoading}
          >
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
              onInput={(event) => setMonthFilter(event.currentTarget.value)}
              onChange={(event) => setMonthFilter(event.currentTarget.value)}
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
        {notice && <div className="monthly-recon-success" role="status">{notice}</div>}
        {showOcrIssues && (
          <section className="monthly-recon-ocr-issues" aria-label="OCR issues report">
            <div className="monthly-recon-ocr-issues-title">
              <div>
                <h2>OCR issues</h2>
                <p>
                  Read-only report from saved OCR jobs and current reference lists.
                  {monthFilter && <> Showing {displayMonth(monthFilter)}.</>}
                </p>
              </div>
              <button type="button" onClick={() => void loadOcrIssues()} disabled={ocrIssuesLoading}>
                {ocrIssuesLoading ? 'Refreshing...' : 'Refresh report'}
              </button>
            </div>
            {ocrIssueErrors.length > 0 && (
              <div className="monthly-recon-ocr-issue-warning">
                {ocrIssueErrors.map((item, index) => (
                  <p key={`${item.source}-${index}`}>{item.message}</p>
                ))}
              </div>
            )}
            <OcrIssueSection title="Monthly settlement OCR" issues={monthlyOcrIssues} />
            <OcrIssueSection title="Daily aviz OCR" issues={dailyOcrIssues} />
          </section>
        )}

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
                    <li
                      key={normalizedSearch(item.center)}
                      className={[
                        item.hasAvizMatch ? '' : 'missing-aviz',
                        item.hasDifference ? 'has-difference' : '',
                      ].filter(Boolean).join(' ')}
                      title={
                        item.hasDifference
                          ? `${item.center}: matching aviz center has a difference`
                          : item.hasAvizMatch
                            ? item.center
                            : `${item.center}: no matching aviz center for this month`
                      }
                    >
                      <span>
                        {(item.hasDifference || !item.hasAvizMatch) && <em aria-hidden="true">!</em>}
                        {item.center}
                      </span>
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
                              <div className="monthly-recon-detail-heading">
                                <h3>Daily aviz rows</h3>
                                {row.avizRows.length > 0 && (
                                  <button type="button" onClick={() => openCorrectionDialog(row)}>Change aviz center</button>
                                )}
                              </div>
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
                                        <td>
                                          <div className="monthly-recon-file-actions">
                                            <button type="button" onClick={() => openFile(detail.fileUrl)}>Open</button>
                                            <button
                                              className="monthly-recon-row-edit"
                                              type="button"
                                              onClick={() => openCorrectionDialog(row, detail)}
                                              title="Change center for this aviz row"
                                              aria-label={`Change center for aviz row ${detail.noticeNumber || detail.rowNumber || ''}`}
                                            >
                                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                <path d="M12 20h9" />
                                                <path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5z" />
                                              </svg>
                                            </button>
                                          </div>
                                        </td>
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

        {correctionDraft && (
          <div className="monthly-recon-modal-backdrop" role="presentation">
            <section className="monthly-recon-modal" role="dialog" aria-modal="true" aria-labelledby="monthly-recon-correction-title">
              <h2 id="monthly-recon-correction-title">Change aviz center</h2>
              <p>
                Change {correctionDraft.detail ? '1' : correctionDraft.row.avizLineCount} daily aviz row{(correctionDraft.detail || correctionDraft.row.avizLineCount === 1) ? '' : 's'} for {displayMonth(correctionDraft.row.month)}.
              </p>
              <div className="monthly-recon-correction-from">
                <span>From</span>
                <b>{correctionDraft.row.center}</b>
                <small>{correctionDraft.row.milkType}</small>
              </div>
              <label>
                <span>New center</span>
                <input
                  list="monthly-recon-correction-options"
                  value={correctionDraft.targetCenter}
                  onChange={(event) => {
                    const targetCenter = event.currentTarget.value
                    setCorrectionDraft((current) => current ? { ...current, targetCenter } : current)
                  }}
                  placeholder="Choose or type center name..."
                />
              </label>
              <small className={`monthly-recon-reference-count ${referenceCentersError ? 'error' : ''}`}>
                {referenceCentersError
                  ? referenceCentersError
                  : referenceCentersLoaded
                    ? `${referenceCenters.length} official centers from tblCenters`
                    : 'Loading tblCenters...'}
              </small>
              <datalist id="monthly-recon-correction-options">
                {centerCorrectionOptions(correctionDraft.row).map((item) => (
                  <option key={normalizedSearch(item.center)} value={item.center}>
                    {item.label}
                  </option>
                ))}
              </datalist>
              <div className="monthly-recon-modal-actions">
                <button type="button" onClick={() => setCorrectionDraft(null)} disabled={correctionSaving}>Cancel</button>
                <button type="button" onClick={() => void applyAvizCenterCorrection()} disabled={correctionSaving || !correctionDraft.targetCenter.trim()}>
                  {correctionSaving ? 'Updating...' : `Update ${correctionDraft.detail ? '1' : correctionDraft.row.avizLineCount} row${(correctionDraft.detail || correctionDraft.row.avizLineCount === 1) ? '' : 's'}`}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
