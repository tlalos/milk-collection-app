import { Fragment, useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import './MilkDeliveriesScreen.css'

type DeliveryStatus = 'DRAFT' | 'AWAITING_GREECE' | 'COMPLETE'
type WeightField = 'loadedWeightKg' | 'emptyWeightKg'
type WeighbridgeSource = 'server' | 'local-agent'

interface MilkTypeOption {
  code: string
  label: string
  densityFactor: number
}

interface MilkDelivery {
  id: string
  deliveryId?: string
  deliveryDate: string
  deliveryTime: string
  truckNumber: string
  tractorNumber: string
  aviz: string
  milkType: string
  milkTypeLabel: string
  densityFactor: number
  loadedWeightKg: number | string | null
  loadedWeighedAt: string
  emptyWeightKg: number | string | null
  emptyWeighedAt: string
  netQuantityKg: number | null
  calculatedLiters: number | null
  deliveryCategory: string
  departureComments: string
  greeceWeight: number | string | null
  invoiceNumber: string
  differenceAmount: number | null
  arrivalComments: string
  status: DeliveryStatus
  isNew?: boolean
}

interface WeighbridgeClientConfig {
  source: WeighbridgeSource
  agentUrl: string
}

const milkTypes: MilkTypeOption[] = [
  { code: 'MILK-COW', label: 'Cow', densityFactor: 1.03 },
  { code: 'MILK-SHEEP', label: 'Sheep', densityFactor: 1.036 },
  { code: 'MILK-COW-GREECE', label: 'Standardized', densityFactor: 1.03 },
]

const defaultWeighbridgeConfig: WeighbridgeClientConfig = {
  source: 'server',
  agentUrl: 'http://127.0.0.1:8795',
}

function localIsoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function emptyDelivery(deliveryDate: string): MilkDelivery {
  return {
    id: `new-${Date.now()}`,
    deliveryDate: deliveryDate || localIsoDate(),
    deliveryTime: '',
    truckNumber: '',
    tractorNumber: '',
    aviz: '',
    milkType: milkTypes[0].code,
    milkTypeLabel: milkTypes[0].label,
    densityFactor: milkTypes[0].densityFactor,
    loadedWeightKg: '',
    loadedWeighedAt: '',
    emptyWeightKg: '',
    emptyWeighedAt: '',
    netQuantityKg: null,
    calculatedLiters: null,
    deliveryCategory: 'SALES',
    departureComments: '',
    greeceWeight: '',
    invoiceNumber: '',
    differenceAmount: null,
    arrivalComments: '',
    status: 'DRAFT',
    isNew: true,
  }
}

function numericValue(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function withCalculations(delivery: MilkDelivery) {
  const loaded = numericValue(delivery.loadedWeightKg)
  const empty = numericValue(delivery.emptyWeightKg)
  const greece = numericValue(delivery.greeceWeight)
  const netQuantityKg = loaded !== null && empty !== null && loaded >= empty ? loaded - empty : null
  const calculatedLiters = netQuantityKg !== null && delivery.densityFactor > 0 ? netQuantityKg / delivery.densityFactor : null
  const differenceAmount = calculatedLiters !== null && greece !== null ? calculatedLiters - greece : null
  return { ...delivery, netQuantityKg, calculatedLiters, differenceAmount }
}

function formatNumber(value: number | null, digits = 0) {
  if (value === null || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
}

function formatWeightTime(value: string) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function localDateTimeText(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  const usable = Number.isFinite(date.getTime()) ? date : new Date()
  const two = (part: number) => String(part).padStart(2, '0')
  return `${usable.getFullYear()}-${two(usable.getMonth() + 1)}-${two(usable.getDate())}T${two(usable.getHours())}:${two(usable.getMinutes())}:${two(usable.getSeconds())}`
}

function localTimeText(value: unknown) {
  const date = value ? new Date(String(value)) : new Date()
  const usable = Number.isFinite(date.getTime()) ? date : new Date()
  return `${String(usable.getHours()).padStart(2, '0')}:${String(usable.getMinutes()).padStart(2, '0')}`
}

function statusLabel(status: DeliveryStatus) {
  if (status === 'AWAITING_GREECE') return 'Awaiting Greece'
  if (status === 'COMPLETE') return 'Complete'
  return 'Draft'
}

function SaveIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5z" /><path d="M8 3v6h8V3" /><path d="M8 21v-7h8v7" /></svg>
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M7 7l1 14h8l1-14" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>
}

function ScaleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20h12" /><path d="M8 20l2-9h4l2 9" /><path d="M12 11V5" /><path d="M8 5h8" /><path d="M7 5 4 11h6z" /><path d="M17 5l-3 6h6z" /></svg>
}

export function MilkDeliveriesScreen({ onBack }: { onBack: () => void }) {
  const [records, setRecords] = useState<MilkDelivery[]>([])
  const [selectedDate, setSelectedDate] = useState(localIsoDate)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | DeliveryStatus>('ALL')
  const [expandedId, setExpandedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [scaleReadingTarget, setScaleReadingTarget] = useState('')
  const [weighbridgeConfig, setWeighbridgeConfig] = useState(defaultWeighbridgeConfig)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    void loadWeighbridgeConfig()
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), 180)
    return () => window.clearTimeout(timer)
  }, [search, statusFilter])

  const visibleRecords = useMemo(
    () => records
      .filter((record) => !selectedDate || record.deliveryDate === selectedDate)
      .map(withCalculations),
    [records, selectedDate],
  )

  async function loadRecords() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      const response = await fetch(appPath(`/api/milk-deliveries?${params.toString()}`))
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not load milk deliveries.')
      setRecords((payload.records || []).map(normalizeRecord))
      setExpandedId('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load milk deliveries.')
    } finally {
      setLoading(false)
    }
  }

  async function loadWeighbridgeConfig() {
    try {
      const response = await fetch(appPath('/api/weighbridge/config'))
      const payload = await response.json()
      const received = payload.weighbridge || {}
      setWeighbridgeConfig({
        source: received.source === 'local-agent' ? 'local-agent' : 'server',
        agentUrl: String(received.agentUrl || defaultWeighbridgeConfig.agentUrl).replace(/\/+$/u, ''),
      })
    } catch {
      setWeighbridgeConfig(defaultWeighbridgeConfig)
    }
  }

  function currentWeightUrl() {
    if (weighbridgeConfig.source === 'local-agent') {
      const baseUrl = weighbridgeConfig.agentUrl.replace(/\/+$/u, '') || defaultWeighbridgeConfig.agentUrl
      return `${baseUrl}/current-weight`
    }
    return appPath('/api/weighbridge/current-weight')
  }

  function addDelivery() {
    const record = emptyDelivery(selectedDate || localIsoDate())
    setRecords((current) => [record, ...current.filter((item) => !item.isNew)])
    setExpandedId(record.id)
    setNotice('')
    setError('')
  }

  function updateRecord(id: string, patch: Partial<MilkDelivery>) {
    setRecords((current) => current.map((record) => {
      if (record.id !== id) return record
      const next = { ...record, ...patch }
      if (patch.milkType) {
        const option = milkTypes.find((item) => item.code === patch.milkType)
        if (option) {
          next.milkTypeLabel = option.label
          next.densityFactor = option.densityFactor
        }
      }
      return withCalculations(next)
    }))
    setError('')
  }

  async function readScaleWeight(record: MilkDelivery, field: WeightField) {
    const target = `${record.id}:${field}`
    const label = field === 'loadedWeightKg' ? 'Loaded kg' : 'Empty kg'
    setScaleReadingTarget(target)
    setError('')
    setNotice(`Reading scale for ${label}...`)
    try {
      const response = await fetch(currentWeightUrl(), { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not read the scale.')
      const reading = payload.reading || {}
      const weight = Number(reading.weightKg)
      if (!Number.isFinite(weight)) throw new Error('The scale returned a value that could not be used.')
      if (reading.stable === false) throw new Error('The scale reading is not stable yet.')
      updateRecord(record.id, {
        [field]: String(weight),
        [field === 'loadedWeightKg' ? 'loadedWeighedAt' : 'emptyWeighedAt']: localDateTimeText(reading.capturedAt),
        ...(field === 'loadedWeightKg' && !record.deliveryTime ? { deliveryTime: localTimeText(reading.capturedAt) } : {}),
      })
      setNotice(`${label} filled from scale: ${formatNumber(weight)} kg.`)
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Could not read the scale.')
      setNotice('')
    } finally {
      setScaleReadingTarget('')
    }
  }

  async function saveRecord(record: MilkDelivery, status: DeliveryStatus = record.status) {
    const prepared = withCalculations({ ...record, status })
    setSavingId(record.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(record.isNew ? appPath('/api/milk-deliveries') : appPath(`/api/milk-deliveries/${encodeURIComponent(record.id)}`), {
        method: record.isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prepared),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not save milk delivery.')
      const saved = normalizeRecord(payload.record)
      setRecords((current) => current.map((item) => item.id === record.id ? saved : item))
      setExpandedId(saved.id)
      setNotice(status === 'DRAFT' ? 'Delivery draft saved.' : status === 'AWAITING_GREECE' ? 'Delivery marked sent and awaiting Greece.' : 'Delivery completed.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save milk delivery.')
    } finally {
      setSavingId('')
    }
  }

  async function deleteRecord(record: MilkDelivery) {
    if (record.isNew) {
      setRecords((current) => current.filter((item) => item.id !== record.id))
      setExpandedId('')
      return
    }
    if (!window.confirm(`Delete milk delivery ${record.aviz || record.id}?\n\nThis cannot be undone.`)) return
    setSavingId(record.id)
    setError('')
    try {
      const response = await fetch(appPath(`/api/milk-deliveries/${encodeURIComponent(record.id)}`), { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not delete milk delivery.')
      setRecords((current) => current.filter((item) => item.id !== record.id))
      setExpandedId('')
      setNotice('Milk delivery deleted.')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete milk delivery.')
    } finally {
      setSavingId('')
    }
  }

  function renderWeightInput(record: MilkDelivery, field: WeightField) {
    const target = `${record.id}:${field}`
    const label = field === 'loadedWeightKg' ? 'Loaded kg' : 'Empty kg'
    const weighedAt = field === 'loadedWeightKg' ? record.loadedWeighedAt : record.emptyWeighedAt
    return (
      <div className="delivery-weight-entry">
        <div className="delivery-weight-input-stack">
          <input inputMode="decimal" value={record[field] ?? ''} onChange={(event) => updateRecord(record.id, { [field]: event.target.value })} />
          {weighedAt && <small>{formatWeightTime(weighedAt)}</small>}
        </div>
        <button type="button" title={`Read scale into ${label}`} aria-label={`Read scale into ${label}`} disabled={Boolean(scaleReadingTarget)} onClick={() => void readScaleWeight(record, field)}>
          {scaleReadingTarget === target ? '...' : <ScaleIcon />}
        </button>
      </div>
    )
  }

  return (
    <div className="milk-deliveries-screen">
      <header className="app-topbar milk-deliveries-topbar">
        <button className="back-button" type="button" onClick={onBack}>Back</button>
        <div className="app-title-block"><p>Factory dispatch workflow</p><h1>Milk Deliveries</h1></div>
      </header>

      <main className="milk-deliveries-content">
        <section className="milk-deliveries-toolbar" aria-label="Delivery register controls">
          <label><span>Delivery date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
          <label className="delivery-search-field"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="AVIZ, truck, milk type or destination..." /></label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | DeliveryStatus)}><option value="ALL">All statuses</option><option value="DRAFT">Draft</option><option value="AWAITING_GREECE">Awaiting Greece</option><option value="COMPLETE">Complete</option></select></label>
          <button type="button" onClick={addDelivery}>Add delivery</button>
          <button className="secondary" type="button" onClick={() => setSelectedDate(selectedDate ? '' : localIsoDate())}>{selectedDate ? 'Show all dates' : 'Today'}</button>
        </section>

        {notice && <div className="milk-deliveries-notice">{notice}</div>}
        {error && <div className="milk-deliveries-error">{error}</div>}

        <section className="milk-deliveries-list">
          <div className="milk-deliveries-list-heading">
            <div><h2>Delivery register</h2><p>{loading ? 'Loading deliveries...' : `${visibleRecords.length} rows shown`}</p></div>
            <span>Excel-like entry</span>
          </div>
          <div className="milk-deliveries-table-scroll">
            <table className="milk-deliveries-entry-table">
              <thead><tr><th /><th>Date</th><th>Truck</th><th>Tractor</th><th>AVIZ</th><th>Milk type</th><th>Loaded kg</th><th>Empty kg</th><th>Net kg</th><th>Liters</th><th>Category</th><th>Comments</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {!visibleRecords.length && <tr><td className="milk-deliveries-empty" colSpan={14}>No deliveries saved for this date. Select Add delivery to start.</td></tr>}
                {visibleRecords.map((record) => {
                  const expanded = expandedId === record.id
                  const arrivalEnabled = record.status !== 'DRAFT'
                  return (
                    <Fragment key={record.id}>
                      <tr className={`delivery-register-row ${record.status.toLocaleLowerCase()}`}>
                        <td><button className="delivery-expand" type="button" onClick={() => setExpandedId(expanded ? '' : record.id)} aria-label={expanded ? 'Collapse delivery' : 'Expand delivery'}>{expanded ? '-' : '+'}</button></td>
                        <td><input type="date" value={record.deliveryDate} onChange={(event) => updateRecord(record.id, { deliveryDate: event.target.value })} /></td>
                        <td><input value={record.truckNumber} onChange={(event) => updateRecord(record.id, { truckNumber: event.target.value.toUpperCase() })} placeholder="Truck" /></td>
                        <td><input value={record.tractorNumber} onChange={(event) => updateRecord(record.id, { tractorNumber: event.target.value.toUpperCase() })} placeholder="Tractor" /></td>
                        <td><input value={record.aviz} onChange={(event) => updateRecord(record.id, { aviz: event.target.value.toUpperCase() })} placeholder="AVIZ" /></td>
                        <td><select value={record.milkType} onChange={(event) => updateRecord(record.id, { milkType: event.target.value })}>{milkTypes.map((milk) => <option key={milk.code} value={milk.code}>{milk.label}</option>)}</select></td>
                        <td>{renderWeightInput(record, 'loadedWeightKg')}</td>
                        <td>{renderWeightInput(record, 'emptyWeightKg')}</td>
                        <td><output className="delivery-readonly-value" aria-label="Net kg">{formatNumber(record.netQuantityKg)}</output></td>
                        <td><output className="delivery-readonly-value" aria-label="Liters">{formatNumber(record.calculatedLiters)}</output></td>
                        <td><select value={record.deliveryCategory} onChange={(event) => updateRecord(record.id, { deliveryCategory: event.target.value })}><option value="SALES">Sales</option><option value="OTHERS">Others</option></select></td>
                        <td><input value={record.departureComments} onChange={(event) => updateRecord(record.id, { departureComments: event.target.value })} placeholder="Comments..." /></td>
                        <td><span className={`delivery-status ${record.status.toLocaleLowerCase()}`}>{statusLabel(record.status)}</span></td>
                        <td><div className="delivery-row-actions"><button type="button" title="Save" aria-label="Save delivery row" disabled={savingId === record.id} onClick={() => void saveRecord(record)}>{savingId === record.id ? '...' : <SaveIcon />}</button><button className="danger" type="button" title="Delete" aria-label="Delete delivery row" disabled={savingId === record.id} onClick={() => void deleteRecord(record)}><TrashIcon /></button></div></td>
                      </tr>

                      {expanded && <tr className="milk-delivery-detail-row"><td colSpan={14}><div className="milk-delivery-inline-form">
                        <section className={`milk-delivery-stage arrival-stage ${arrivalEnabled ? '' : 'locked'}`}>
                          <div className="milk-delivery-stage-heading"><span>2</span><div><h3>Arrival in Greece</h3><p>Excel columns M-P</p></div><strong>{record.status === 'COMPLETE' ? 'Recorded' : arrivalEnabled ? 'Awaiting details' : 'Available after sending'}</strong></div>
                          <fieldset disabled={!arrivalEnabled}><div className="milk-delivery-fields arrival-fields">
                            <label><span>Weight from Greece *</span><input inputMode="decimal" value={record.greeceWeight ?? ''} onChange={(event) => updateRecord(record.id, { greeceWeight: event.target.value })} placeholder="0" /></label>
                            <label><span>Invoice number *</span><input value={record.invoiceNumber} onChange={(event) => updateRecord(record.id, { invoiceNumber: event.target.value.toUpperCase() })} placeholder="Invoice number" /></label>
                            <label className="calculated-field"><span>Difference</span><output>{formatNumber(record.differenceAmount)}</output></label>
                            <label className="comments-field"><span>Comments / destination</span><textarea rows={2} value={record.arrivalComments} onChange={(event) => updateRecord(record.id, { arrivalComments: event.target.value })} placeholder="Destination and arrival notes..." /></label>
                          </div></fieldset>
                        </section>
                        <div className="milk-delivery-inline-actions"><button className="secondary" type="button" onClick={() => setExpandedId('')}>Close</button>{record.status === 'DRAFT' && <button className="secondary" type="button" onClick={() => void saveRecord(record, 'DRAFT')}>Save draft</button>}{record.status === 'DRAFT' && <button type="button" onClick={() => void saveRecord(record, 'AWAITING_GREECE')}>Mark sent</button>}{record.status !== 'DRAFT' && <button type="button" onClick={() => void saveRecord(record, 'COMPLETE')}>{record.status === 'COMPLETE' ? 'Save changes' : 'Mark complete'}</button>}</div>
                      </div></td></tr>}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}

function normalizeRecord(record: MilkDelivery): MilkDelivery {
  const milk = milkTypes.find((option) => option.code === record.milkType)
  return withCalculations({
    ...record,
    id: record.id || record.deliveryId || '',
    milkType: record.milkType || milkTypes[0].code,
    milkTypeLabel: record.milkTypeLabel || milk?.label || milkTypes[0].label,
    densityFactor: Number(record.densityFactor || milk?.densityFactor || milkTypes[0].densityFactor),
    loadedWeighedAt: record.loadedWeighedAt || '',
    emptyWeighedAt: record.emptyWeighedAt || '',
    departureComments: record.departureComments || '',
    arrivalComments: record.arrivalComments || '',
    invoiceNumber: record.invoiceNumber || '',
    isNew: false,
  })
}
