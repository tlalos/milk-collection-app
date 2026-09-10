import { useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import './MonthClosureScreen.css'

type ReconciliationStatus = 'ok' | 'difference' | 'missing_monthly' | 'missing_aviz'
type PricingStatus = 'needs_price' | 'blocked' | 'saved'
type StatusFilter = 'all' | PricingStatus

interface MonthClosurePricingRow {
  id: string
  month: string
  center: string
  milkType: string
  producer: string
  liters: number
  sourceRowCount: number
  previousMonthLiters: number | null
  previousMonthRowCount: number
  previousMonthPrice?: number | null
  previousMonthCommission?: number | null
  previousMonthElectricity?: number | null
  price?: number | null
  commission?: number | null
  electricity?: number | null
  reconciliationStatus: ReconciliationStatus
  reconciliationDifferenceLiters: number
  centerAvizLiters: number
  centerMonthlyLiters: number
  centerJournalRows: number
  centerAvizLines: number
  pricingStatus: PricingStatus
  readyForPricing: boolean
}

interface MonthClosureSummary {
  rowCount: number
  centerCount: number
  producerCount: number
  totalLiters: number
  readyRowCount: number
  blockedRowCount: number
}

interface MonthClosurePayload {
  rows: MonthClosurePricingRow[]
  summary: MonthClosureSummary
  monthOptions: string[]
  selectedMonth: string
}

type PricingDraftField = 'price' | 'commission' | 'electricity'
type PricingDrafts = Record<string, Partial<Record<PricingDraftField, string>>>

const emptySummary: MonthClosureSummary = {
  rowCount: 0,
  centerCount: 0,
  producerCount: 0,
  totalLiters: 0,
  readyRowCount: 0,
  blockedRowCount: 0,
}

function formatNumber(value: number | null | undefined, maximumFractionDigits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)
}

function displayMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})$/u)
  if (!match) return value || '-'
  return `${match[2]}/${match[1]}`
}

function displayMilkType(value: string | null | undefined) {
  if (!value) return '-'
  return value.replace(/^MILK[-_\s]*/iu, '').trim() || value
}

function hasMeaningfulPreviousValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0
}

function normalizedSearch(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase()
}

function uniqueValues(rows: MonthClosurePricingRow[], selector: (row: MonthClosurePricingRow) => string) {
  return [...new Set(rows.map(selector).map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

function reconciliationLabel(status: ReconciliationStatus) {
  if (status === 'missing_monthly') return 'No journal'
  if (status === 'missing_aviz') return 'Missing aviz'
  if (status === 'difference') return 'Difference'
  return 'OK'
}

function pricingLabel(status: PricingStatus) {
  if (status === 'saved') return 'Saved'
  return status === 'blocked' ? 'Blocked' : 'Needs price'
}

export function MonthClosureScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<MonthClosurePricingRow[]>([])
  const [summary, setSummary] = useState<MonthClosureSummary>(emptySummary)
  const [monthOptions, setMonthOptions] = useState<string[]>([])
  const [pricingDrafts, setPricingDrafts] = useState<PricingDrafts>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monthFilter, setMonthFilter] = useState(() => new URLSearchParams(window.location.search).get('month') || '')
  const [centerFilter, setCenterFilter] = useState('')
  const [producerFilter, setProducerFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  async function loadRows(month = monthFilter) {
    setLoading(true)
    setError('')
    try {
      const query = month ? `?month=${encodeURIComponent(month)}` : ''
      const response = await fetch(appPath(`/api/month-closure/pricing-rows${query}`))
      const text = await response.text()
      const payload = text ? JSON.parse(text) as MonthClosurePayload & { error?: string } : { rows: [], summary: emptySummary, monthOptions: [], selectedMonth: '' }
      if (!response.ok) throw new Error(payload.error || 'Could not load month closure pricing rows.')
      setRows(payload.rows || [])
      setSummary(payload.summary || emptySummary)
      setMonthOptions(payload.monthOptions || [])
      setMonthFilter(payload.selectedMonth || month || '')
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function handleMonthChange(nextMonth: string) {
    setMonthFilter(nextMonth)
    void loadRows(nextMonth)
  }

  function updatePricingDraft(rowId: string, field: PricingDraftField, value: string) {
    setPricingDrafts((current) => ({
      ...current,
      [rowId]: {
        ...current[rowId],
        [field]: value,
      },
    }))
  }

  function pricingDraftValue(row: MonthClosurePricingRow, field: PricingDraftField) {
    const draft = pricingDrafts[row.id]?.[field]
    if (draft !== undefined) return draft
    const savedValue = field === 'price' ? row.price : field === 'commission' ? row.commission : row.electricity
    return savedValue === null || savedValue === undefined ? '' : String(savedValue)
  }

  useEffect(() => {
    void loadRows()
  }, [])

  const centerOptions = useMemo(() => uniqueValues(rows, (row) => row.center), [rows])
  const milkTypeOptions = useMemo(() => uniqueValues(rows, (row) => row.milkType), [rows])
  const hasActiveFilters = Boolean(centerFilter || producerFilter || milkTypeFilter || statusFilter !== 'all')

  const filteredRows = useMemo(() => {
    const centerNeedle = normalizedSearch(centerFilter)
    const producerNeedle = normalizedSearch(producerFilter)
    return rows.filter((row) => {
      if (monthFilter && row.month !== monthFilter) return false
      if (centerNeedle && !normalizedSearch(row.center).includes(centerNeedle)) return false
      if (producerNeedle && !normalizedSearch(row.producer).includes(producerNeedle)) return false
      if (milkTypeFilter && row.milkType !== milkTypeFilter) return false
      if (statusFilter !== 'all' && row.pricingStatus !== statusFilter) return false
      return true
    })
  }, [centerFilter, milkTypeFilter, monthFilter, producerFilter, rows, statusFilter])

  const filteredLiters = filteredRows.reduce((total, row) => total + row.liters, 0)
  const filteredReady = filteredRows.filter((row) => row.readyForPricing).length
  const filteredBlocked = filteredRows.length - filteredReady

  return (
    <div className="month-closure-screen app-shell">
      <header className="app-topbar month-closure-topbar">
        <button className="back-button month-closure-home-button" type="button" onClick={onBack} aria-label="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10.5V20h14v-9.5" />
            <path d="M9.5 20v-6h5v6" />
          </svg>
          <span>Home</span>
        </button>
        <div className="app-title-block">
          <span>Monthly workflow</span>
          <h1>Month Closure & Payments</h1>
        </div>
        <div className="month-closure-actions">
          <button type="button" onClick={() => { window.location.href = appPath('/monthly-reconciliation') }}>Reconciliation</button>
          <button type="button" onClick={() => { window.location.href = appPath('/ocr/monthly-review') }}>Monthly OCR</button>
          <button type="button" onClick={() => void loadRows()} disabled={loading}>Refresh</button>
        </div>
      </header>

      <main className="month-closure-content">
        <section className="month-closure-summary" aria-label="Month closure summary">
          <div><span>Pricing rows</span><strong>{summary.rowCount}</strong></div>
          <div><span>Centers</span><strong>{summary.centerCount}</strong></div>
          <div><span>Producers</span><strong>{summary.producerCount}</strong></div>
          <div><span>Total liters</span><strong>{formatNumber(summary.totalLiters)}</strong></div>
          <div><span>Ready</span><strong>{summary.readyRowCount}</strong></div>
          <div><span>Blocked</span><strong>{summary.blockedRowCount}</strong></div>
        </section>

        <section className="month-closure-toolbar" aria-label="Month closure filters">
          <label>
            <span>Month</span>
              <input
                type="month"
                value={monthFilter}
                onChange={(event) => {
                  handleMonthChange(event.currentTarget.value)
                }}
                onInput={(event) => {
                  handleMonthChange(event.currentTarget.value)
                }}
                list="month-closure-month-options"
              />
            <datalist id="month-closure-month-options">
              {monthOptions.map((month) => <option key={month} value={month} />)}
            </datalist>
          </label>
          <label>
            <span>Center</span>
            <input list="month-closure-center-options" value={centerFilter} onChange={(event) => setCenterFilter(event.target.value)} placeholder="Collection center..." />
            <datalist id="month-closure-center-options">
              {centerOptions.map((center) => <option key={center} value={center} />)}
            </datalist>
          </label>
          <label>
            <span>Producer</span>
            <input value={producerFilter} onChange={(event) => setProducerFilter(event.target.value)} placeholder="Producer name..." />
          </label>
          <label>
            <span>Milk type</span>
            <select value={milkTypeFilter} onChange={(event) => setMilkTypeFilter(event.target.value)}>
              <option value="">All milk types</option>
              {milkTypeOptions.map((milkType) => <option key={milkType} value={milkType}>{displayMilkType(milkType)}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All rows</option>
              <option value="needs_price">Needs price</option>
              <option value="saved">Saved</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <button
            className="month-closure-clear-filters"
            type="button"
            onClick={() => {
              setCenterFilter('')
              setProducerFilter('')
              setMilkTypeFilter('')
              setStatusFilter('all')
            }}
            disabled={!hasActiveFilters}
          >
            Clear
          </button>
        </section>

        {error && <div className="month-closure-error" role="alert">{error}</div>}

        <section className="month-closure-card">
          <div className="month-closure-card-title">
            <div>
              <h2>Pricing</h2>
              <p>
                {filteredRows.length} rows shown · {formatNumber(filteredLiters)} L · {filteredReady} ready · {filteredBlocked} blocked
                {monthFilter ? ` · ${displayMonth(monthFilter)}` : ''}
              </p>
            </div>
            <div className="month-closure-tabs" aria-label="Month closure views">
              <button className="active" type="button">Pricing</button>
              <button type="button" disabled>ERP invoices</button>
            </div>
          </div>

          <div className="month-closure-table-wrap">
            <table className="month-closure-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Center</th>
                  <th>Producer</th>
                  <th>Milk type</th>
                  <th>Qty L</th>
                  <th>Price</th>
                  <th>Comm.</th>
                  <th>Electricity</th>
                  <th>Prev price</th>
                  <th>Prev L</th>
                  <th>Journal rows</th>
                  <th>Recon</th>
                  <th>Diff L</th>
                  <th>Pricing</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={14} className="month-closure-empty">Loading pricing rows...</td></tr>}
                {!loading && filteredRows.length === 0 && <tr><td colSpan={14} className="month-closure-empty">No pricing rows found for this view.</td></tr>}
                {!loading && filteredRows.map((row) => (
                  <tr key={row.id} className={row.readyForPricing ? 'ready' : 'blocked'}>
                    <td>{displayMonth(row.month)}</td>
                    <td title={row.center}>{row.center}</td>
                    <td title={row.producer}>{row.producer}</td>
                    <td title={row.milkType}>{displayMilkType(row.milkType)}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td className="month-closure-entry-cell">
                      <div className="month-closure-entry-stack">
                        <input
                          className="month-closure-price-input"
                          inputMode="decimal"
                          aria-label={`Price for ${row.producer}`}
                          value={pricingDraftValue(row, 'price')}
                          onChange={(event) => updatePricingDraft(row.id, 'price', event.target.value)}
                        />
                      </div>
                    </td>
                    <td className="month-closure-entry-cell">
                      <div className="month-closure-entry-stack">
                        <input
                          className="month-closure-price-input"
                          inputMode="decimal"
                          aria-label={`Commission for ${row.producer}`}
                          value={pricingDraftValue(row, 'commission')}
                          onChange={(event) => updatePricingDraft(row.id, 'commission', event.target.value)}
                        />
                        {hasMeaningfulPreviousValue(row.previousMonthCommission) && (
                          <span className="month-closure-previous-hint">Prev {formatNumber(row.previousMonthCommission, 3)}</span>
                        )}
                      </div>
                    </td>
                    <td className="month-closure-entry-cell">
                      <div className="month-closure-entry-stack">
                        <input
                          className="month-closure-price-input"
                          inputMode="decimal"
                          aria-label={`Electricity for ${row.producer}`}
                          value={pricingDraftValue(row, 'electricity')}
                          onChange={(event) => updatePricingDraft(row.id, 'electricity', event.target.value)}
                        />
                        {hasMeaningfulPreviousValue(row.previousMonthElectricity) && (
                          <span className="month-closure-previous-hint">Prev {formatNumber(row.previousMonthElectricity, 3)}</span>
                        )}
                      </div>
                    </td>
                    <td>{formatNumber(row.previousMonthPrice, 3)}</td>
                    <td>{formatNumber(row.previousMonthLiters)}</td>
                    <td>{row.sourceRowCount}</td>
                    <td><span className={`month-closure-recon-badge ${row.reconciliationStatus}`}>{reconciliationLabel(row.reconciliationStatus)}</span></td>
                    <td>{formatNumber(row.reconciliationDifferenceLiters)}</td>
                    <td><span className={`month-closure-pricing-badge ${row.pricingStatus}`}>{pricingLabel(row.pricingStatus)}</span></td>
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
