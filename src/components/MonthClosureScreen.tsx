import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, History, LockKeyhole } from 'lucide-react'
import { BankNoteSummary } from './BankNoteSummary'
import { BankExportDialog, type BankExportDialogHandle } from './BankExportDialog'
import { prepareBankExport, type BankExportRow } from '../bankNoteExport'
import { appPath } from '../ocrPaths'
import { matchesInvoiceSendFilter, monthlyInvoiceBlockReason, monthlyInvoiceSeries, type InvoiceSendFilter } from '../monthlyInvoiceEligibility'
import { monthlyInvoiceAmounts, pricingSubtotal } from '../monthlyInvoiceAmounts'
import { ocrConnectionSettingsStore } from '../store/ocrConnectionSettingsStore'
import { displayInvoiceDate, parseInvoiceDate } from '../invoiceDateFormat'
import { InvoiceDateDialog, type InvoiceDateDialogHandle } from './InvoiceDateDialog'
import { InvoiceResolutionDialog, type InvoiceResolutionDialogHandle } from './InvoiceResolutionDialog'
import { InvoiceBatchDialog, type InvoiceBatchDialogHandle } from './InvoiceBatchDialog'
import {
  getCachedOcrReferenceSuppliers,
  loadOcrReferenceSuppliers,
  type OcrReferenceProducer,
} from '../store/ocrReferenceSuppliersStore'
import { FloatingHorizontalScrollbar } from './FloatingHorizontalScrollbar'
import './MonthClosureScreen.css'

type ReconciliationStatus = 'ok' | 'difference' | 'missing_monthly' | 'missing_aviz'
type PricingStatus = 'needs_price' | 'blocked' | 'saved'
type StatusFilter = 'all' | PricingStatus
type ClosureView = 'pricing' | 'erpInvoices' | 'bankNote'
type BankTransferStatus = 'pending' | 'sent'

interface MonthClosurePricingRow {
  source?: 'journal' | 'aviz'
  approvalReviewRequired?: boolean
  id: string
  month: string
  center: string
  milkType: string
  producer: string
  producerCode: string
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
  producerWarning?: string | null
  duplicateProducer?: boolean
  missingLiters?: boolean
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
type PricingSaveStatus = 'idle' | 'saving' | 'saved' | 'error'
interface BankNoteDraft {
  connectedAccount?: string
  comment?: string
  status?: BankTransferStatus
  exportedAmount?: number
  exportedLiters?: number
  exportedAt?: string
}
type BankNoteDrafts = Record<string, BankNoteDraft>

const bankNoteStorageKey = 'milk-collection-bank-note-v1'

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

function formatMoney(value: number | null | undefined, maximumFractionDigits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits }).format(value)
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

function parseDraftNumber(value: string) {
  const normalized = String(value || '').trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function displayText(value: unknown) {
  const text = String(value ?? '').trim()
  return text || '-'
}

function bankProducerOption(producer: OcrReferenceProducer) {
  return `${producer.producerName} [${producer.producerCode}]`
}

function loadStoredBankNoteDrafts(month: string) {
  if (!month) return {}
  try {
    const stored = JSON.parse(localStorage.getItem(bankNoteStorageKey) || '{}') as Record<string, BankNoteDrafts>
    return stored[month] || {}
  } catch {
    return {}
  }
}

function saveStoredBankNoteDrafts(month: string, drafts: BankNoteDrafts) {
  if (!month) return
  try {
    const stored = JSON.parse(localStorage.getItem(bankNoteStorageKey) || '{}') as Record<string, BankNoteDrafts>
    stored[month] = drafts
    localStorage.setItem(bankNoteStorageKey, JSON.stringify(stored))
  } catch {
    // Keep the in-memory state when browser storage is unavailable.
  }
}

function normalizedFlag(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase()
}

function hasExtraVat(value: unknown) {
  return ['1', 'true', 'yes'].includes(normalizedFlag(value))
}

function hasRegularVat(value: unknown) {
  return normalizedFlag(value) === 'regular'
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

function monthEndDate(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return ''
  const [year, monthNumber] = month.split('-').map(Number)
  return `${month}-${new Date(year, monthNumber, 0).getDate()}`
}

function pricingLabel(status: PricingStatus) {
  if (status === 'saved') return 'Saved'
  return status === 'blocked' ? 'Blocked' : 'Needs price'
}

export function MonthClosureScreen({ onBack, bankNotePage = false }: { onBack: () => void; bankNotePage?: boolean }) {
  const [rows, setRows] = useState<MonthClosurePricingRow[]>([])
  const [summary, setSummary] = useState<MonthClosureSummary>(emptySummary)
  const [monthOptions, setMonthOptions] = useState<string[]>([])
  const [pricingDrafts, setPricingDrafts] = useState<PricingDrafts>({})
  const [pricingSaveStatus, setPricingSaveStatus] = useState<PricingSaveStatus>('idle')
  const [pricingSaveMessage, setPricingSaveMessage] = useState('')
  const [bankNoteDrafts, setBankNoteDrafts] = useState<BankNoteDrafts>({})
  const [selectedBankRowIds, setSelectedBankRowIds] = useState<string[]>([])
  const bankExportDialogRef = useRef<BankExportDialogHandle>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monthFilter, setMonthFilter] = useState(() => new URLSearchParams(window.location.search).get('month') || '')
  const [invoiceDates, setInvoiceDates] = useState<Record<string, string>>({})
  const [invoiceStatuses, setInvoiceStatuses] = useState<Record<string, string>>({})
  const [invoiceRecords, setInvoiceRecords] = useState<Record<string, { invoiceId: string; attemptCount: number }>>({})
  const [canResolveInvoices, setCanResolveInvoices] = useState(false)
  const invoiceResolutionRef = useRef<InvoiceResolutionDialogHandle>(null)
  const invoiceBatchRef = useRef<InvoiceBatchDialogHandle>(null)
  const [selectedInvoiceRowIds, setSelectedInvoiceRowIds] = useState<string[]>([])
  const [invoiceDateSaving, setInvoiceDateSaving] = useState(false)
  const [invoiceDateMessage, setInvoiceDateMessage] = useState('')
  const [invoiceSendBusy, setInvoiceSendBusy] = useState(false)
  const invoiceSendBusyRef = useRef(false)
  const [invoiceSendMessage, setInvoiceSendMessage] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null)
  const [invoicePreview, setInvoicePreview] = useState<{
    fingerprint: string; payload: unknown[];
    snapshot: { month: string; producerCode: string; producerName: string; milkType: string; invoiceDate: string; liters: number; price: number; subtotal: number; tax: number; total: number; series: number; paymentid: number; internalnum: string }
  } | null>(null)
  const invoicePreviewRef = useRef<HTMLDialogElement>(null)
  const invoiceDateSavingRef = useRef(false)
  const [bulkInvoiceDates, setBulkInvoiceDates] = useState<Record<string, string>>({})
  const invoiceDateDialogRef = useRef<InvoiceDateDialogHandle>(null)
  const invoiceDateLockedDialogRef = useRef<HTMLDialogElement>(null)
  const [invoiceDateLockStatus, setInvoiceDateLockStatus] = useState('')
  const [centerFilter, setCenterFilter] = useState('')
  const [producerFilter, setProducerFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [seriesFilter, setSeriesFilter] = useState('')
  const [invoiceSendFilter, setInvoiceSendFilter] = useState<InvoiceSendFilter>('all')
  const [view, setView] = useState<ClosureView>(bankNotePage ? 'bankNote' : 'pricing')
  const [bulkCenter, setBulkCenter] = useState('')
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkPriceError, setBulkPriceError] = useState('')
  const bulkPriceInputRef = useRef<HTMLInputElement>(null)
  const bulkCenterTriggerRef = useRef<HTMLButtonElement | null>(null)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [erpReferenceProducers, setErpReferenceProducers] = useState<OcrReferenceProducer[]>(() =>
    getCachedOcrReferenceSuppliers()?.producers || [],
  )
  const [erpReferenceLoading, setErpReferenceLoading] = useState(false)
  const [erpReferenceError, setErpReferenceError] = useState('')

  async function loadRows(month = monthFilter) {
    setLoading(true)
    setSelectedInvoiceRowIds([])
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
      const selectedMonth = payload.selectedMonth || month
      if (selectedMonth) {
        const invoiceResponse = await fetch(appPath(`/api/month-closure/invoices?month=${encodeURIComponent(selectedMonth)}`))
        const invoicePayload = await invoiceResponse.json() as { invoices?: Array<{ invoiceId: string; attemptCount: number; producerCode: string; milkType: string; invoiceDate: string; status: string }>; canResolve?: boolean; error?: string }
        if (!invoiceResponse.ok) throw new Error(invoicePayload.error || 'Could not load invoice dates.')
        const dates: Record<string, string> = {}
        const statuses: Record<string, string> = {}
        const records: Record<string, { invoiceId: string; attemptCount: number }> = {}
        for (const row of payload.rows || []) {
          const saved = invoicePayload.invoices?.find(invoice => invoice.producerCode === row.producerCode.trim().toLowerCase() && invoice.milkType === row.milkType)
            ?? invoicePayload.invoices?.find(invoice => invoice.producerCode === row.producerCode.trim().toLowerCase() && !invoice.milkType)
          if (saved) { dates[row.id] = saved.invoiceDate; statuses[row.id] = saved.status; records[row.id] = saved }
        }
        setInvoiceDates(dates)
        setInvoiceStatuses(statuses)
        setInvoiceRecords(records)
        setCanResolveInvoices(Boolean(invoicePayload.canResolve))
      }
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function previewInvoice(row: MonthClosurePricingRow) {
    if (invoiceSendBusyRef.current || invoiceDateSavingRef.current) return
    invoiceSendBusyRef.current = true
    setInvoiceSendBusy(true)
    setInvoiceSendMessage(null)
    try {
      const response = await fetch(appPath('/api/month-closure/invoice-preview'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: row.month, producerCode: row.producerCode, milkType: row.milkType,
          invoiceDate: invoiceDates[row.id] || monthEndDate(row.month), connection: await ocrConnectionSettingsStore.resolve() }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not preview invoice.')
      setInvoicePreview(payload)
      invoicePreviewRef.current?.showModal()
    } catch (error) { setInvoiceSendMessage({ tone: 'error', text: (error as Error).message }) }
    finally { invoiceSendBusyRef.current = false; setInvoiceSendBusy(false) }
  }

  async function sendInvoice() {
    if (!invoicePreview || invoiceSendBusyRef.current) return
    invoiceSendBusyRef.current = true
    setInvoiceSendBusy(true)
    setInvoiceSendMessage({ tone: 'info', text: 'Sending invoice. Do not retry while awaiting a result.' })
    const { snapshot, fingerprint } = invoicePreview
    try {
      const response = await fetch(appPath('/api/month-closure/invoice-send'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: snapshot.month, producerCode: snapshot.producerCode, milkType: snapshot.milkType,
          invoiceDate: snapshot.invoiceDate, fingerprint, confirmed: true, connection: await ocrConnectionSettingsStore.resolve() }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not confirm invoice. Check ERP before retrying.')
      setInvoiceSendMessage({ tone: 'success', text: `Invoice sent. ERP ID: ${result.erpId}` })
    } catch (error) { setInvoiceSendMessage({ tone: 'error', text: `${(error as Error).message} Refresh the status and verify ERP before retrying.` }) }
    finally {
      invoicePreviewRef.current?.close()
      setInvoicePreview(null)
      await loadRows(snapshot.month)
      invoiceSendBusyRef.current = false
      setInvoiceSendBusy(false)
    }
  }

  async function saveInvoiceDates(date: string, rowId?: string) {
    if (invoiceDateSavingRef.current || !date) return
    if (!parseInvoiceDate(displayInvoiceDate(date))) {
      setError('Enter a valid invoice date in dd/mm/yyyy format.')
      return
    }
    if (rowId && invoiceStatuses[rowId] && invoiceStatuses[rowId] !== 'DRAFT') {
      setInvoiceDateLockStatus(invoiceStatuses[rowId])
      invoiceDateLockedDialogRef.current?.showModal()
      return
    }
    invoiceDateSavingRef.current = true
    setInvoiceDateSaving(true)
    setInvoiceDateMessage('')
    setError('')
    try {
      if (!rowId) {
        const response = await fetch(appPath('/api/month-closure/invoice-dates'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month: monthFilter, invoiceDate: date }),
          signal: AbortSignal.timeout(90000),
        })
        const payload = await response.json() as { error?: string; invoices?: Array<{ producerCode: string; milkType: string; invoiceDate: string }> }
        if (!response.ok || !payload.invoices) throw new Error(payload.error || 'Could not save invoice dates.')
        const saved = new Map(payload.invoices.map(invoice => [`${invoice.producerCode.toLowerCase()}:${invoice.milkType}`, invoice.invoiceDate]))
        setInvoiceDates(current => {
          const next = { ...current }
          for (const row of rows) {
            const savedDate = saved.get(`${row.producerCode.trim().toLowerCase()}:${row.milkType}`)
            if (row.month === monthFilter && savedDate) next[row.id] = savedDate
          }
          return next
        })
        setBulkInvoiceDates(current => ({ ...current, [monthFilter]: date }))
        setInvoiceDateMessage(`${payload.invoices.length} invoice dates saved as ${displayInvoiceDate(date)}. Sent and unconfirmed invoices were not changed.`)
        invoiceDateDialogRef.current?.close()
        return
      }
      const targets = rows.filter(row => row.month === monthFilter && (!rowId || row.id === rowId) &&
        (!invoiceStatuses[row.id] || invoiceStatuses[row.id] === 'DRAFT') && /^p\S+$/i.test(row.producerCode.trim()))
      for (const row of targets) {
        const previousDate = invoiceDates[row.id] || monthEndDate(row.month)
        setInvoiceDates(current => ({ ...current, [row.id]: date }))
        try {
          const response = await fetch(appPath('/api/month-closure/invoice-date'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month: monthFilter, producerCode: row.producerCode, milkType: row.milkType, invoiceDate: date }),
          })
          const payload = await response.json() as { error?: string }
          if (!response.ok) throw new Error(`${row.producerCode}: ${payload.error || 'Date save failed'}. Earlier successful date changes are saved.`)
        } catch (error) {
          setInvoiceDates(current => ({ ...current, [row.id]: previousDate }))
          throw error
        }
      }
      if (!rowId) setBulkInvoiceDates(current => ({ ...current, [monthFilter]: date }))
      invoiceDateDialogRef.current?.close()
    } catch (saveError) {
      setError(`${(saveError as Error).message} Refresh to check saved dates before retrying.`)
      invoiceDateDialogRef.current?.close()
    }
    finally { invoiceDateSavingRef.current = false; setInvoiceDateSaving(false) }
  }

  function handleMonthChange(nextMonth: string) {
    if (invoiceDateSavingRef.current) return
    setMonthFilter(nextMonth)
    setPricingDrafts({})
    setPricingSaveStatus('idle')
    setPricingSaveMessage('')
    setSelectedBankRowIds([])
    setBulkCenter('')
    setBulkPrice('')
    setBulkPriceError('')
    void loadRows(nextMonth)
  }

  function updatePricingDraft(rowId: string, field: PricingDraftField, value: string) {
    if (rows.find(row => row.id === rowId)?.producerWarning) return
    setPricingSaveStatus((current) => current === 'saving' ? current : 'idle')
    setPricingSaveMessage('')
    setPricingDrafts((current) => ({
      ...current,
      [rowId]: {
        ...current[rowId],
        [field]: value,
      },
    }))
  }

  function updateBankNoteDraft(rowId: string, field: 'connectedAccount' | 'comment', value: string) {
    setBankNoteDrafts((current) => {
      const next = {
        ...current,
        [rowId]: {
          ...current[rowId],
          [field]: value,
        },
      }
      saveStoredBankNoteDrafts(monthFilter, next)
      return next
    })
  }

  function pricingDraftValue(row: MonthClosurePricingRow, field: PricingDraftField) {
    const draft = pricingDrafts[row.id]?.[field]
    if (draft !== undefined) return draft
    const savedValue = field === 'price' ? row.price : field === 'commission' ? row.commission : row.electricity
    return savedValue === null || savedValue === undefined ? '' : String(savedValue)
  }

  function pricingValue(row: MonthClosurePricingRow, field: PricingDraftField) {
    const draftValue = pricingDrafts[row.id]?.[field]
    if (draftValue !== undefined) return parseDraftNumber(draftValue)
    const savedValue = field === 'price' ? row.price : field === 'commission' ? row.commission : row.electricity
    return typeof savedValue === 'number' && Number.isFinite(savedValue) ? savedValue : null
  }

  const changedPricingRows = rows.filter((row) => !row.producerWarning && Object.keys(pricingDrafts[row.id] || {}).length > 0)

  async function savePricingRows() {
    if (!monthFilter || !changedPricingRows.length || pricingSaveStatus === 'saving') return
    const draftSnapshot = pricingDrafts
    const rowsToSave = changedPricingRows
    const invalidRow = rowsToSave.find((row) => (['price', 'commission', 'electricity'] as PricingDraftField[]).some((field) => {
      const draft = draftSnapshot[row.id]?.[field]
      return draft !== undefined && String(draft).trim() !== '' && (parseDraftNumber(draft) === null || Number(parseDraftNumber(draft)) < 0)
    }))
    if (invalidRow) {
      setPricingSaveStatus('error')
      setPricingSaveMessage(`Correct the invalid value for ${invalidRow.producer}.`)
      return
    }
    const missingCodeRow = rowsToSave.find((row) => !String(row.producerCode || '').trim())
    if (missingCodeRow) {
      setPricingSaveStatus('error')
      setPricingSaveMessage(`${missingCodeRow.producer} has no ERP producer code and cannot be saved.`)
      return
    }

    const savedValues = rowsToSave.map((row) => ({
      row,
      price: draftSnapshot[row.id]?.price !== undefined ? parseDraftNumber(draftSnapshot[row.id].price || '') : row.price ?? null,
      commission: draftSnapshot[row.id]?.commission !== undefined ? parseDraftNumber(draftSnapshot[row.id].commission || '') : row.commission ?? null,
      electricity: draftSnapshot[row.id]?.electricity !== undefined ? parseDraftNumber(draftSnapshot[row.id].electricity || '') : row.electricity ?? null,
    }))
    setPricingSaveStatus('saving')
    setPricingSaveMessage(`Saving ${rowsToSave.length} pricing row${rowsToSave.length === 1 ? '' : 's'}...`)
    try {
      const response = await fetch(appPath('/api/month-closure/pricing-rows'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: monthFilter,
          rows: savedValues.map(({ row, price, commission, electricity }) => ({
            producerCode: row.producerCode,
            producerName: row.producer,
            centerName: row.center,
            milkType: row.milkType,
            responsiblePrice: price,
            receiverCommission: commission,
            electricity,
          })),
        }),
      })
      const payload = await response.json() as { error?: string; total?: number }
      if (!response.ok) throw new Error(payload.error || 'Could not save monthly pricing.')
      const savedById = new Map(savedValues.map((saved) => [saved.row.id, saved]))
      setRows((current) => current.map((row) => {
        const saved = savedById.get(row.id)
        if (!saved) return row
        const hasValue = saved.price !== null || saved.commission !== null || saved.electricity !== null
        return {
          ...row,
          price: saved.price,
          commission: saved.commission,
          electricity: saved.electricity,
          pricingStatus: row.readyForPricing && hasValue ? 'saved' : row.readyForPricing ? 'needs_price' : 'blocked',
        }
      }))
      setPricingDrafts((current) => {
        const next = { ...current }
        for (const row of rowsToSave) {
          const latest = { ...(next[row.id] || {}) }
          const savedDraft = draftSnapshot[row.id] || {}
          for (const field of Object.keys(savedDraft) as PricingDraftField[]) {
            if (latest[field] === savedDraft[field]) delete latest[field]
          }
          if (Object.keys(latest).length) next[row.id] = latest
          else delete next[row.id]
        }
        return next
      })
      setPricingSaveStatus('saved')
      setPricingSaveMessage(`${payload.total || rowsToSave.length} pricing row${(payload.total || rowsToSave.length) === 1 ? '' : 's'} autosaved to monthly history.`)
    } catch (saveError) {
      setPricingSaveStatus('error')
      setPricingSaveMessage((saveError as Error).message || 'Could not save monthly pricing.')
    }
  }

  useEffect(() => {
    void loadRows()
  }, [])

  useEffect(() => {
    setBankNoteDrafts(loadStoredBankNoteDrafts(monthFilter))
    setSelectedBankRowIds([])
  }, [monthFilter])

  useEffect(() => {
    if (!changedPricingRows.length || pricingSaveStatus === 'saving' || pricingSaveStatus === 'error') return
    const timer = window.setTimeout(() => void savePricingRows(), 800)
    return () => window.clearTimeout(timer)
  }, [pricingDrafts, pricingSaveStatus])

  useEffect(() => {
    if (view !== 'erpInvoices' && view !== 'bankNote') return

    let cancelled = false
    setErpReferenceLoading(true)
    setErpReferenceError('')
    void loadOcrReferenceSuppliers()
      .then((references) => {
        if (!cancelled) setErpReferenceProducers(references.producers || [])
      })
      .catch((referenceError) => {
        if (!cancelled) {
          setErpReferenceProducers([])
          setErpReferenceError((referenceError as Error).message || 'Could not load ERP producer details.')
        }
      })
      .finally(() => {
        if (!cancelled) setErpReferenceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [view])

  useEffect(() => {
    if (!bulkCenter) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeBulkCenterPrice()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bulkCenter])

  const centerOptions = useMemo(() => uniqueValues(rows, (row) => row.center), [rows])
  const milkTypeOptions = useMemo(() => uniqueValues(rows, (row) => row.milkType), [rows])
  const erpProducerByCode = useMemo(() => new Map(
    erpReferenceProducers.map((producer) => [producer.producerCode.trim().toLocaleLowerCase(), producer]),
  ), [erpReferenceProducers])
  const bankProducerOptions = useMemo(() => {
    const producersByCode = new Map<string, OcrReferenceProducer>()
    for (const row of rows) {
      const code = String(row.producerCode || '').trim()
      const name = String(row.producer || '').trim()
      if (code && name) producersByCode.set(normalizedSearch(code), { producerCode: code, producerName: name })
    }
    for (const producer of erpReferenceProducers) {
      if (producer.producerCode && producer.producerName) {
        producersByCode.set(normalizedSearch(producer.producerCode), producer)
      }
    }
    return [...producersByCode.values()]
      .filter((producer) => normalizedSearch(producer.producerCode).startsWith('p'))
      .sort((left, right) => left.producerName.localeCompare(right.producerName, undefined, { numeric: true }))
  }, [erpReferenceProducers, rows])
  const bankProducerByOption = useMemo(() => new Map(
    bankProducerOptions.map((producer) => [bankProducerOption(producer), producer]),
  ), [bankProducerOptions])
  const hasActiveFilters = Boolean(centerFilter || producerFilter || milkTypeFilter || statusFilter !== 'all' || (view === 'erpInvoices' && (seriesFilter || invoiceSendFilter !== 'all')))

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

  const bulkCenterRows = useMemo(() => rows.filter((row) => (
    !row.producerWarning && (!monthFilter || row.month === monthFilter) && row.center === bulkCenter
  )), [bulkCenter, monthFilter, rows])

  function movePricingFocus(currentInput: HTMLInputElement, field: PricingDraftField, direction: 1 | -1) {
    const visibleInputs = Array.from(document.querySelectorAll<HTMLInputElement>(
      `input[data-pricing-field="${field}"]:not(:disabled)`,
    ))
    const currentIndex = visibleInputs.indexOf(currentInput)
    const nextInput = visibleInputs[currentIndex + direction]
    nextInput?.focus()
    nextInput?.select()
  }

  function closeBulkCenterPrice() {
    setBulkCenter('')
    setBulkPrice('')
    setBulkPriceError('')
    window.requestAnimationFrame(() => bulkCenterTriggerRef.current?.focus({ preventScroll: true }))
  }

  function openBulkCenterPrice(center: string, trigger: HTMLButtonElement) {
    const centerRows = rows.filter((row) => (!monthFilter || row.month === monthFilter) && row.center === center)
    const existingPrices = [...new Set(centerRows.map((row) => pricingDraftValue(row, 'price')).filter(Boolean))]
    bulkCenterTriggerRef.current = trigger
    setBulkCenter(center)
    setBulkPrice(existingPrices.length === 1 ? existingPrices[0] : '')
    setBulkPriceError('')
    window.requestAnimationFrame(() => {
      bulkPriceInputRef.current?.focus()
      bulkPriceInputRef.current?.select()
    })
  }

  function applyBulkCenterPrice() {
    const parsedPrice = parseDraftNumber(bulkPrice)
    if (parsedPrice === null || parsedPrice < 0) {
      setBulkPriceError('Enter a valid price.')
      return
    }
    const normalizedPrice = String(parsedPrice)
    setPricingDrafts((current) => {
      const next = { ...current }
      for (const row of bulkCenterRows) {
        if (row.producerWarning) continue
        next[row.id] = { ...next[row.id], price: normalizedPrice }
      }
      return next
    })
    closeBulkCenterPrice()
  }

  const filteredLiters = filteredRows.reduce((total, row) => total + row.liters, 0)
  const filteredReady = filteredRows.filter((row) => row.readyForPricing).length
  const filteredBlocked = filteredRows.length - filteredReady
  const invoiceRows = filteredRows.map((row) => {
    const price = pricingValue(row, 'price')
    const commissionValue = pricingValue(row, 'commission')
    const electricityValue = pricingValue(row, 'electricity')
    const commission = commissionValue ?? 0
    const electricity = electricityValue ?? 0
    const erpProducer = erpProducerByCode.get(String(row.producerCode || '').trim().toLocaleLowerCase()) || null
    const extraApplied = hasExtraVat(erpProducer?.extra)
    const vatStatus = erpProducer?.vatStatusName || ''
    const amounts = monthlyInvoiceAmounts(row.liters, price, commissionValue, electricityValue, extraApplied, hasRegularVat(vatStatus))
    const { result, adjustedPrice, roundingDifference, vatStatusAmount, extraAmount } = amounts
    const finalResult = row.approvalReviewRequired || row.producerWarning ? null : amounts.finalResult
    const series = monthlyInvoiceSeries(erpProducer?.bool2)
    const sendBlockReason = amounts.blockReason || monthlyInvoiceBlockReason(row, finalResult, Boolean(erpProducer))
      || (invoiceStatuses[row.id] && invoiceStatuses[row.id] !== 'DRAFT' ? `ERP: ${invoiceStatuses[row.id]}` : null)
      || (series === null ? 'Missing or invalid Bool2' : null)
      || (erpReferenceLoading ? 'Loading ERP details' : erpReferenceError ? 'ERP details unavailable' : null)
      || (pricingSaveStatus === 'saving' ? 'Saving prices' : pricingSaveStatus === 'error' ? 'Price save failed' : changedPricingRows.length ? 'Unsaved prices' : null)
    return { row, erpProducer, price, adjustedPrice, roundingDifference, commission, electricity, result, vatStatus, vatStatusAmount, extraAmount, finalResult, sendBlockReason, series }
  }).filter(invoiceRow => view !== 'erpInvoices' || !seriesFilter
    || (seriesFilter === 'missing' ? invoiceRow.series === null : String(invoiceRow.series) === seriesFilter))
    .filter(invoiceRow => view !== 'erpInvoices' || matchesInvoiceSendFilter(invoiceStatuses[invoiceRow.row.id], invoiceSendFilter))
  const invoiceTotals = invoiceRows.reduce((totals, invoiceRow) => ({
    qty: totals.qty + invoiceRow.row.liters,
    result: totals.result + (invoiceRow.result ?? 0),
    commission: totals.commission + invoiceRow.commission,
    electricity: totals.electricity + invoiceRow.electricity,
    vatStatusAmount: totals.vatStatusAmount + invoiceRow.vatStatusAmount,
    extraAmount: totals.extraAmount + invoiceRow.extraAmount,
    final: totals.final + (invoiceRow.finalResult ?? 0),
  }), { qty: 0, result: 0, commission: 0, electricity: 0, vatStatusAmount: 0, extraAmount: 0, final: 0 })
  const eligibleInvoiceRows = invoiceRows.filter(invoice => !invoice.sendBlockReason)
  const selectedInvoiceRows = eligibleInvoiceRows.filter(invoice => selectedInvoiceRowIds.includes(invoice.row.id))
  const allEligibleInvoicesSelected = eligibleInvoiceRows.length > 0 && selectedInvoiceRows.length === eligibleInvoiceRows.length
  const matchedInvoiceRows = invoiceRows.filter((invoiceRow) => invoiceRow.erpProducer).length
  const missingInvoiceMatches = invoiceRows.length - matchedInvoiceRows
  const matchedRowsMissingTaxFields = invoiceRows.filter((invoiceRow) =>
    invoiceRow.erpProducer && !String(invoiceRow.vatStatus || '').trim() && !String(invoiceRow.erpProducer.extra ?? '').trim(),
  ).length
  const currentPricedInvoiceRows = invoiceRows.filter((invoiceRow) => invoiceRow.price !== null).length
  const previousPricedInvoiceRows = invoiceRows.filter((invoiceRow) =>
    invoiceRow.price === null && hasMeaningfulPreviousValue(invoiceRow.row.previousMonthPrice),
  ).length
  const bankRows = invoiceRows.map(invoiceRow => ({
      id: invoiceRow.row.id,
      milkType: invoiceRow.row.milkType,
      producerName: invoiceRow.erpProducer?.producerName || invoiceRow.row.producer,
      producerCode: invoiceRow.row.producerCode,
      centers: invoiceRow.row.center.trim() ? [invoiceRow.row.center.trim()] : [],
      erpProducer: invoiceRow.erpProducer,
      finalAmount: invoiceRow.finalResult ?? 0,
      totalLiters: invoiceRow.row.liters,
      hasMissingAmount: invoiceRow.finalResult === null,
    }))
  const preparedBankRows = bankRows.map((bankRow) => {
    const legacyDraft = bankNoteDrafts[normalizedSearch(bankRow.producerCode)]
    const multipleRows = rows.filter(row => normalizedSearch(row.producerCode) === normalizedSearch(bankRow.producerCode)).length > 1
    const legacyPaymentNeedsReview = multipleRows && legacyDraft?.status === 'sent'
    const draft = bankNoteDrafts[bankRow.id] || (!multipleRows ? legacyDraft : undefined) || {}
    const connectedAccount = draft.connectedAccount || ''
    const connectedProducer = bankProducerByOption.get(connectedAccount) || null
    const paymentProducer = connectedProducer || bankRow.erpProducer
    return {
      ...bankRow,
      legacyPaymentNeedsReview,
      connectedAccount,
      connectedProducer,
      paymentProducer,
      comment: draft.comment || '',
      status: (draft.status || 'pending') as BankTransferStatus,
      exportedAmount: typeof draft.exportedAmount === 'number' ? draft.exportedAmount : null,
      exportedLiters: typeof draft.exportedLiters === 'number' ? draft.exportedLiters : null,
      exportedAt: draft.exportedAt || '',
      finalAmount: bankRow.hasMissingAmount || legacyPaymentNeedsReview ? null : bankRow.finalAmount,
    }
  })
  const pendingBankRows = preparedBankRows.filter((row) => row.status !== 'sent')
  const sentBankRows = preparedBankRows.filter((row) => row.status === 'sent')
  const eligibleBankRows = pendingBankRows.filter((row) => row.paymentProducer?.iban && row.finalAmount !== null)
  const selectedBankRows = eligibleBankRows.filter((row) => selectedBankRowIds.includes(row.id))
  const readyBankRows = eligibleBankRows.length
  const bankTotal = preparedBankRows.reduce((total, row) => total + (row.finalAmount ?? 0), 0)
  const bankPendingLiters = pendingBankRows.reduce((total, row) => total + row.totalLiters, 0)
  const bankExportedLiters = sentBankRows.reduce((total, row) => total + (row.exportedLiters ?? row.totalLiters), 0)
  const bankPendingAmount = pendingBankRows.reduce((total, row) => total + (row.finalAmount ?? 0), 0)
  const bankSentAmount = sentBankRows.reduce((total, row) => total + (row.exportedAmount ?? row.finalAmount ?? 0), 0)
  const allEligibleBankRowsSelected = eligibleBankRows.length > 0 && eligibleBankRows.every((row) => selectedBankRowIds.includes(row.id))

  function toggleBankRow(rowId: string, checked: boolean) {
    setSelectedBankRowIds((current) => checked
      ? [...new Set([...current, rowId])]
      : current.filter((id) => id !== rowId))
  }

  function toggleAllEligibleBankRows(checked: boolean) {
    setSelectedBankRowIds(checked ? eligibleBankRows.map((row) => row.id) : [])
  }

  function exportSelectedBankRows() {
    if (!selectedBankRows.length) return
    try {
      bankExportDialogRef.current?.open(monthFilter, prepareBankExport(monthFilter, selectedBankRows, rows))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare bank export.')
    }
  }

  function markBankRowsExported(month: string, exportedRows: BankExportRow[]) {
    const exportedAt = new Date().toISOString()
    setBankNoteDrafts((current) => {
      const next = { ...current }
      for (const row of exportedRows) {
        next[row.id] = {
          ...next[row.id],
          status: 'sent',
          exportedAmount: row.amount ?? undefined,
          exportedLiters: row.totalLiters,
          exportedAt,
        }
      }
      saveStoredBankNoteDrafts(month, next)
      return next
    })
    setSelectedBankRowIds([])
  }

  return (
    <div className="month-closure-screen app-shell">
      <header className="app-topbar month-closure-topbar">
        <button className="back-button month-closure-home-button" type="button" onClick={() => {
          if (bankNotePage) window.location.href = appPath(`/month-closure?month=${encodeURIComponent(monthFilter)}`)
          else onBack()
        }} aria-label={bankNotePage ? 'Back to Month Closure & Payments' : 'Back'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </button>
        <div className="app-title-block">
          <span>Monthly workflow</span>
          <h1>{bankNotePage ? 'Bank note' : 'Month Closure & Payments'}</h1>
        </div>
        <div className="month-closure-actions">
          {!bankNotePage && <button type="button"
            disabled={loading || pricingSaveStatus === 'saving' || changedPricingRows.length > 0}
            title={changedPricingRows.length ? 'Save pricing changes before opening Bank note' : undefined}
            onClick={() => { window.location.href = appPath(`/bank-note?month=${encodeURIComponent(monthFilter)}`) }}>Bank note</button>}
          <button type="button" onClick={() => { window.location.href = appPath('/monthly-reconciliation') }}>Reconciliation</button>
          <button type="button" onClick={() => { window.location.href = appPath('/ocr/monthly-review') }}>Monthly OCR</button>
          <button type="button" onClick={() => void loadRows()} disabled={loading}>Refresh</button>
        </div>
      </header>

      <main className="month-closure-content">
        <dialog ref={invoicePreviewRef} className="month-closure-date-dialog" aria-labelledby="invoice-preview-title" onCancel={event => { if (invoiceSendBusy) event.preventDefault() }}>
          <div className="month-closure-bulk-editor">
            <h2 id="invoice-preview-title">Confirm ERP invoice</h2>
            {invoicePreview && <>
              <strong>{invoicePreview.snapshot.producerName}</strong>
              <span>{invoicePreview.snapshot.producerCode} · {displayMilkType(invoicePreview.snapshot.milkType)}</span>
              <span>Date: {invoicePreview.snapshot.invoiceDate} · Series: {invoicePreview.snapshot.series}</span>
              <span>{formatNumber(invoicePreview.snapshot.liters)} L × {formatMoney(invoicePreview.snapshot.price)}</span>
              <span>Subtotal: {formatMoney(invoicePreview.snapshot.subtotal)} · Tax: {formatMoney(invoicePreview.snapshot.tax)}</span>
              <strong>Total: {formatMoney(invoicePreview.snapshot.total)}</strong>
              <span>Payment: {invoicePreview.snapshot.paymentid} · Internal number: {invoicePreview.snapshot.internalnum}</span>
              <details><summary>Request details</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflow: 'auto' }}>{JSON.stringify(invoicePreview.payload, null, 2)}</pre></details>
            </>}
            <div className="month-closure-bulk-actions">
              <button type="button" className="month-closure-cancel-bulk" disabled={invoiceSendBusy} onClick={() => invoicePreviewRef.current?.close()}>Cancel</button>
              <button type="button" className="month-closure-apply-bulk" disabled={invoiceSendBusy || !invoicePreview} onClick={() => void sendInvoice()}>{invoiceSendBusy ? 'Sending...' : 'Confirm send'}</button>
            </div>
          </div>
        </dialog>
        {invoiceSendMessage && <div className={`month-closure-notice month-closure-${invoiceSendMessage.tone}`} role={invoiceSendMessage.tone === 'error' ? 'alert' : 'status'}>{invoiceSendMessage.text}</div>}
        <section className={`month-closure-summary ${view === 'bankNote' ? 'bank' : ''}`} aria-label="Month closure summary">
          {view === 'bankNote' ? (
            <>
              <div><span>Transfers</span><strong>{preparedBankRows.length}</strong></div>
              <div><span>Selected</span><strong>{selectedBankRows.length}</strong></div>
              <div><span>Liters pending</span><strong>{formatNumber(bankPendingLiters)}</strong></div>
              <div><span>Liters exported</span><strong>{formatNumber(bankExportedLiters)}</strong></div>
              <div><span>Amount pending</span><strong>{formatMoney(bankPendingAmount)}</strong></div>
              <div><span>Amount exported</span><strong>{formatMoney(bankSentAmount)}</strong></div>
            </>
          ) : (
            <>
              <div><span>Pricing rows</span><strong>{summary.rowCount}</strong></div>
              <div><span>Centers</span><strong>{summary.centerCount}</strong></div>
              <div><span>Producers</span><strong>{summary.producerCount}</strong></div>
              <div><span>Total liters</span><strong>{formatNumber(summary.totalLiters)}</strong></div>
              <div><span>Ready</span><strong>{summary.readyRowCount}</strong></div>
              <div><span>Blocked</span><strong>{summary.blockedRowCount}</strong></div>
            </>
          )}
        </section>

        <section className={`month-closure-toolbar${view === 'erpInvoices' ? ' month-closure-toolbar-invoices' : ''}`} aria-label="Month closure filters">
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
          {view === 'erpInvoices' && <label>
            <span>ERP status</span>
            <select value={invoiceSendFilter} onChange={(event) => setInvoiceSendFilter(event.target.value as InvoiceSendFilter)}>
              <option value="all">All invoices</option>
              <option value="not_sent">Not sent</option>
              <option value="sent">Sent</option>
              <option value="verification">Needs verification</option>
              <option value="sending">Sending</option>
            </select>
          </label>}
          {view === 'erpInvoices' && <label>
            <span>Series</span>
            <select value={seriesFilter} onChange={(event) => setSeriesFilter(event.target.value)}>
              <option value="">All series</option>
              <option value="5105">5105</option>
              <option value="5106">5106</option>
              <option value="missing">Missing / invalid</option>
            </select>
          </label>}
          <button
            className="month-closure-clear-filters"
            type="button"
            onClick={() => {
              setCenterFilter('')
              setProducerFilter('')
              setMilkTypeFilter('')
              setStatusFilter('all')
              setSeriesFilter('')
              setInvoiceSendFilter('all')
            }}
            disabled={!hasActiveFilters}
          >
            Clear
          </button>
        </section>

        {error && <div className="month-closure-error" role="alert">{error}</div>}
        {invoiceDateMessage && <div className="month-closure-notice month-closure-success" role="status">{invoiceDateMessage}</div>}

        <section className="month-closure-card">
          <div className="month-closure-card-title">
            <div>
              <h2>{view === 'pricing' ? 'Pricing' : view === 'erpInvoices' ? 'ERP invoices' : 'Bank note'}</h2>
              <p>
                {view === 'pricing'
                  ? `${filteredRows.length} rows shown · ${formatNumber(filteredLiters)} L · ${filteredReady} ready · ${filteredBlocked} blocked`
                  : view === 'erpInvoices'
                    ? `${invoiceRows.length} invoice lines · ${formatNumber(invoiceTotals.qty)} L · ${formatMoney(invoiceTotals.final)} final preview`
                    : `${preparedBankRows.length} transfers · ${pendingBankRows.length} pending · ${sentBankRows.length} exported · ${formatMoney(bankTotal)} total`}
                {monthFilter ? ` · ${displayMonth(monthFilter)}` : ''}
              </p>
            </div>
            {view === 'bankNote' && <BankNoteSummary month={monthFilter} volumes={rows} payments={preparedBankRows} filtered={hasActiveFilters} loading={loading} />}
            {view === 'erpInvoices' && (
              <div className="month-closure-invoice-tools">
                <InvoiceDateDialog ref={invoiceDateDialogRef} saving={invoiceDateSaving} onApply={date => void saveInvoiceDates(date)} />
                <InvoiceBatchDialog ref={invoiceBatchRef} onFinished={async month => { await loadRows(month) }} />
                <InvoiceResolutionDialog ref={invoiceResolutionRef} onResolved={async (month, message) => {
                  setInvoiceSendMessage({ tone: 'success', text: message })
                  await loadRows(month)
                }} />
                <dialog ref={invoiceDateLockedDialogRef} className="month-closure-date-dialog" aria-labelledby="invoice-date-locked-title">
                  <div className="month-closure-bulk-editor">
                    <h2 id="invoice-date-locked-title">Invoice locked</h2>
                    <p>{invoiceDateLockStatus === 'SENT'
                      ? 'This invoice has already been sent to ERP. Its date cannot be changed.'
                      : 'This invoice is locked for ERP verification. Its date cannot be changed until its ERP status has been resolved.'}</p>
                    <div className="month-closure-bulk-actions"><button type="button" className="month-closure-cancel-bulk" onClick={() => invoiceDateLockedDialogRef.current?.close()}>Close</button></div>
                  </div>
                </dialog>
                <details className="month-closure-invoice-info">
                  <summary aria-label="ERP invoice information" title="ERP invoice information">i</summary>
                  <div className="month-closure-invoice-info-panel" role="note">
                    <strong>ERP invoice information</strong>
                    <p>Pricing subtotal is original price x liters + commission + electricity. Adjusted price is that subtotal / liters, kept to six decimals for calculation and ERP sending, and displayed to two decimals. Invoice subtotal is adjusted price x liters; any rounding difference is shown before tax. Extra = 1 adds 8%; otherwise regular VAT adds 11%. Invoice amounts are rounded to two decimals. Commission and electricity are already included, not added again. Collector invoices are pending a separate procedure.</p>
                    <p>
                      {erpReferenceProducers.length
                        ? `${erpReferenceProducers.length} ERP suppliers available. ${matchedInvoiceRows} invoice rows matched${missingInvoiceMatches ? `, ${missingInvoiceMatches} missing ERP match` : ''}${matchedRowsMissingTaxFields ? `, ${matchedRowsMissingTaxFields} matched rows missing VAT/extra` : ''}.`
                        : 'ERP supplier details not loaded. Use the OCR menu refresh button when the API is available.'}
                    </p>
                    <p>{`${currentPricedInvoiceRows} rows have current prices${previousPricedInvoiceRows ? `; ${previousPricedInvoiceRows} rows have previous-month prices available` : ''}.`}</p>
                  </div>
                </details>
                <button type="button" disabled={loading || invoiceSendBusy || invoiceDateSaving || !selectedInvoiceRows.length || selectedInvoiceRows.length > 500}
                  onClick={() => invoiceBatchRef.current?.open(selectedInvoiceRows.map(({ row }) => ({
                    month: row.month, producerCode: row.producerCode, milkType: row.milkType, invoiceDate: invoiceDates[row.id] || monthEndDate(row.month),
                  })))}>
                  Send selected ({selectedInvoiceRows.length})
                </button>
                {selectedInvoiceRows.length > 0 && <button type="button" onClick={() => setSelectedInvoiceRowIds([])}>Clear selection</button>}
                {selectedInvoiceRows.length > 500 && <span role="alert">Select up to 500 invoices per batch.</span>}
              </div>
            )}
            {!bankNotePage && <div className="month-closure-tabs" aria-label="Month closure views">
              <button className={view === 'pricing' ? 'active' : ''} type="button" onClick={() => setView('pricing')}>Pricing</button>
              <button className={view === 'erpInvoices' ? 'active' : ''} type="button" onClick={() => setView('erpInvoices')}>ERP invoices</button>
            </div>}
          </div>

          {view === 'pricing' && (
            <div className={`month-closure-pricing-tools ${pricingSaveStatus}`}>
              <div className="month-closure-save-actions">
                <span
                  className={`month-closure-save-indicator ${pricingSaveStatus}`}
                  aria-live="polite"
                  title={pricingSaveMessage || undefined}
                >
                  {pricingSaveStatus === 'saving'
                    ? 'Saving...'
                    : pricingSaveStatus === 'error'
                      ? 'Save failed'
                      : changedPricingRows.length
                        ? 'Waiting...'
                        : 'Saved'}
                </span>
                <button type="button" onClick={() => void savePricingRows()} disabled={!changedPricingRows.length || pricingSaveStatus === 'saving'}>
                  {`Save now${changedPricingRows.length ? ` (${changedPricingRows.length})` : ''}`}
                </button>
              </div>
            </div>
          )}

          {view === 'bankNote' && (
            <>
              <BankExportDialog ref={bankExportDialogRef} onExported={markBankRowsExported} />
              <div className="month-closure-bank-tools">
                <div>
                  <strong>{readyBankRows} ready for bank</strong>
                  <span>
                    {erpReferenceLoading
                      ? 'Loading producer names and IBANs from ERP...'
                      : erpReferenceError
                        ? `ERP producer details could not be loaded: ${erpReferenceError}`
                        : `${pendingBankRows.length - readyBankRows} pending rows need an IBAN or final amount. Connected account is optional.`}
                  </span>
                </div>
                <button type="button" onClick={exportSelectedBankRows} disabled={!selectedBankRows.length}>
                  Export Excel{selectedBankRows.length ? ` (${selectedBankRows.length})` : ''}
                </button>
              </div>
              <datalist id="month-closure-bank-producers">
                {bankProducerOptions.map((producer) => (
                  <option key={producer.producerCode} value={bankProducerOption(producer)} />
                ))}
              </datalist>
            </>
          )}

          {view === 'pricing' && bulkCenter && (
            <div
              className="month-closure-bulk-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.currentTarget === event.target) closeBulkCenterPrice()
              }}
            >
              <section
                className="month-closure-bulk-editor"
                role="dialog"
                aria-modal="true"
                aria-labelledby="month-closure-bulk-title"
              >
                <header className="month-closure-bulk-header">
                  <div className="month-closure-bulk-center">
                    <span>Selected center</span>
                    <h2 id="month-closure-bulk-title">{bulkCenter}</h2>
                    <small>{bulkCenterRows.length} pricing rows</small>
                  </div>
                  <button
                    className="month-closure-bulk-close"
                    type="button"
                    onClick={closeBulkCenterPrice}
                    aria-label="Close center price window"
                  >
                    X
                  </button>
                </header>
                <label>
                  <span>Price</span>
                  <input
                    ref={bulkPriceInputRef}
                    inputMode="decimal"
                    value={bulkPrice}
                    onChange={(event) => {
                      setBulkPrice(event.target.value)
                      setBulkPriceError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      applyBulkCenterPrice()
                    }}
                    aria-label={`Price for all producers in ${bulkCenter}`}
                  />
                </label>
                <div className={`month-closure-bulk-status ${bulkPriceError ? 'error' : ''}`} aria-live="polite">
                  {bulkPriceError}
                </div>
                <footer className="month-closure-bulk-actions">
                  <button className="month-closure-cancel-bulk" type="button" onClick={closeBulkCenterPrice}>
                    Cancel
                  </button>
                  <button className="month-closure-apply-bulk" type="button" onClick={applyBulkCenterPrice}>
                    Apply to center
                  </button>
                </footer>
              </section>
            </div>
          )}

          <div className="month-closure-table-wrap" ref={tableWrapRef}>
            {view === 'pricing' ? (
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
                  <th>Subtotal</th>
                  <th>Prev price</th>
                  <th>Prev L</th>
                  <th>Journal rows</th>
                  <th>Recon</th>
                  <th>Diff L</th>
                  <th>Pricing</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={15} className="month-closure-empty">Loading pricing rows...</td></tr>}
                {!loading && filteredRows.length === 0 && <tr><td colSpan={15} className="month-closure-empty">No pricing rows found for this view.</td></tr>}
                {!loading && filteredRows.map((row) => (
                  <tr key={row.id} className={row.readyForPricing ? 'ready' : 'blocked'}>
                    <td>{displayMonth(row.month)}</td>
                    <td title={row.center}>
                      <button
                        className={`month-closure-center-button ${bulkCenter === row.center ? 'active' : ''}`}
                        type="button"
                        onClick={(event) => openBulkCenterPrice(row.center, event.currentTarget)}
                      >
                        {row.center}
                      </button>
                    </td>
                    <td title={row.producer}>
                      {row.producer}
                      {row.producerWarning && <small className="month-closure-producer-warning">! {row.producerWarning}</small>}
                      {row.duplicateProducer && <small className="month-closure-producer-warning">! Duplicate</small>}
                      {row.missingLiters && <small className="month-closure-producer-warning">! Missing liters</small>}
                      <small className="month-closure-source">Source: {row.source === 'aviz' ? 'Aviz' : 'Journal'}{row.approvalReviewRequired ? ' · Needs approval review' : ''}</small>
                    </td>
                    <td title={row.milkType}>{displayMilkType(row.milkType)}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td className="month-closure-entry-cell">
                      <div className="month-closure-entry-stack">
                        <input
                          className="month-closure-price-input"
                          inputMode="decimal"
                          aria-label={`Price for ${row.producer}`}
                          disabled={Boolean(row.producerWarning)}
                          title={row.producerWarning || undefined}
                          data-pricing-field="price"
                          value={pricingDraftValue(row, 'price')}
                          onChange={(event) => updatePricingDraft(row.id, 'price', event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return
                            event.preventDefault()
                            movePricingFocus(event.currentTarget, 'price', event.shiftKey ? -1 : 1)
                          }}
                        />
                      </div>
                    </td>
                    <td className="month-closure-entry-cell">
                      <div className="month-closure-entry-stack">
                        <input
                          className="month-closure-price-input"
                          inputMode="decimal"
                          aria-label={`Commission for ${row.producer}`}
                          disabled={Boolean(row.producerWarning)}
                          title={row.producerWarning || undefined}
                          data-pricing-field="commission"
                          value={pricingDraftValue(row, 'commission')}
                          onChange={(event) => updatePricingDraft(row.id, 'commission', event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return
                            event.preventDefault()
                            movePricingFocus(event.currentTarget, 'commission', event.shiftKey ? -1 : 1)
                          }}
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
                          disabled={Boolean(row.producerWarning)}
                          title={row.producerWarning || undefined}
                          data-pricing-field="electricity"
                          value={pricingDraftValue(row, 'electricity')}
                          onChange={(event) => updatePricingDraft(row.id, 'electricity', event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter') return
                            event.preventDefault()
                            movePricingFocus(event.currentTarget, 'electricity', event.shiftKey ? -1 : 1)
                          }}
                        />
                        {hasMeaningfulPreviousValue(row.previousMonthElectricity) && (
                          <span className="month-closure-previous-hint">Prev {formatNumber(row.previousMonthElectricity, 3)}</span>
                        )}
                      </div>
                    </td>
                    <td>{formatMoney(pricingSubtotal(row.liters, pricingValue(row, 'price'), pricingValue(row, 'commission'), pricingValue(row, 'electricity')))}</td>
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
            ) : view === 'erpInvoices' ? (
            <table className="month-closure-table month-closure-invoice-table">
              <thead>
                <tr>
                  <th><div className="month-closure-date-heading">
                    <span>Invoice<br />date</span>
                    <button type="button" className="month-closure-date-all" disabled={loading || !monthFilter || !rows.length}
                      aria-label="Apply invoice date to all" title="Apply invoice date to all"
                      onClick={() => {
                        invoiceDateDialogRef.current?.open(bulkInvoiceDates[monthFilter] || monthEndDate(monthFilter))
                      }}><CalendarDays size={16} aria-hidden="true" /></button>
                  </div></th>
                  <th>Producer name</th>
                  <th>Producer center</th>
                  <th>Milk type</th>
                  <th>Adjusted price</th>
                  <th>Qty L</th>
                  <th>Subtotal</th>
                  <th title="Already included in subtotal">Comm. (incl.)</th>
                  <th title="Already included in subtotal">Elec. (incl.)</th>
                  <th>VAT status</th>
                  <th>Extra</th>
                  <th>Final result</th>
                  <th><label className="month-closure-invoice-select-all">
                    <input type="checkbox" aria-label="Select all eligible invoices shown" title="Select all eligible invoices shown"
                      checked={allEligibleInvoicesSelected}
                      ref={input => { if (input) input.indeterminate = selectedInvoiceRows.length > 0 && !allEligibleInvoicesSelected }}
                      disabled={loading || invoiceSendBusy || invoiceDateSaving || !eligibleInvoiceRows.length}
                      onChange={event => setSelectedInvoiceRowIds(event.target.checked ? eligibleInvoiceRows.map(invoice => invoice.row.id) : [])} />
                    ERP
                  </label></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={13} className="month-closure-empty">Loading invoice rows...</td></tr>}
                {!loading && invoiceRows.length === 0 && <tr><td colSpan={13} className="month-closure-empty">No invoice rows found for this view.</td></tr>}
                {!loading && invoiceRows.map((invoiceRow) => (
                  <tr key={invoiceRow.row.id} className={invoiceRow.row.readyForPricing ? 'ready' : 'blocked'}>
                    <td><div className="month-closure-compact-date">
                      {invoiceStatuses[invoiceRow.row.id] && invoiceStatuses[invoiceRow.row.id] !== 'DRAFT' ?
                        <button type="button" className="month-closure-locked-date" aria-label={`Locked invoice date for ${invoiceRow.row.producer}`} title="Invoice locked - date cannot be changed"
                          onClick={() => {
                            setInvoiceDateLockStatus(invoiceStatuses[invoiceRow.row.id])
                            invoiceDateLockedDialogRef.current?.showModal()
                          }}>
                          {(invoiceDates[invoiceRow.row.id] || monthEndDate(invoiceRow.row.month)).replace(/^(\d{2})(\d{2})-(\d{2})-(\d{2})$/, '$4/$3/$2')}
                          <LockKeyhole size={12} aria-hidden="true" />
                        </button> : <>
                      <span aria-hidden="true">{(invoiceDates[invoiceRow.row.id] || monthEndDate(invoiceRow.row.month)).replace(/^(\d{2})(\d{2})-(\d{2})-(\d{2})$/, '$4/$3/$2')}</span>
                      <input type="date" className="month-closure-invoice-date"
                      disabled={loading || invoiceDateSaving || !/^p\S+/i.test(invoiceRow.row.producerCode) || Boolean(invoiceStatuses[invoiceRow.row.id] && invoiceStatuses[invoiceRow.row.id] !== 'DRAFT')}
                      aria-label={`Invoice date for ${invoiceRow.row.producer}`}
                      value={invoiceDates[invoiceRow.row.id] || monthEndDate(invoiceRow.row.month)}
                      onChange={event => void saveInvoiceDates(event.target.value, invoiceRow.row.id)} />
                      <CalendarDays className="month-closure-row-calendar" size={14} aria-hidden="true" />
                      </>}
                    </div></td>
                    <td title={invoiceRow.erpProducer?.producerName || invoiceRow.row.producer}>{displayText(invoiceRow.erpProducer?.producerName || invoiceRow.row.producer)}
                      {invoiceRow.price === null && <small className="month-closure-collector">Collector</small>}
                      {invoiceRow.sendBlockReason && <small className={invoiceRow.sendBlockReason === 'ERP: SENT' ? 'month-closure-invoice-sent' : 'month-closure-invoice-warning'}>{invoiceRow.sendBlockReason}</small>}
                      <small className="month-closure-source">Source: {invoiceRow.row.source === 'aviz' ? 'Aviz' : 'Journal'}{invoiceRow.row.approvalReviewRequired ? ' · Needs approval review' : ''}</small></td>
                    <td title={invoiceRow.erpProducer?.centerName || invoiceRow.row.center}>{displayText(invoiceRow.erpProducer?.centerName || invoiceRow.row.center)}</td>
                    <td>{displayMilkType(invoiceRow.row.milkType)}</td>
                    <td>
                      <div className="month-closure-invoice-value">
                        <strong>{formatMoney(invoiceRow.adjustedPrice)}</strong>
                        {invoiceRow.price !== null && invoiceRow.adjustedPrice !== null && formatMoney(invoiceRow.price, 6) !== formatMoney(invoiceRow.adjustedPrice, 6) && (
                          <span>Initial {formatMoney(invoiceRow.price, 4)}</span>
                        )}
                      </div>
                    </td>
                    <td>{formatNumber(invoiceRow.row.liters)}</td>
                    <td><div className="month-closure-invoice-value">
                      <strong>{formatMoney(invoiceRow.result)}</strong>
                      {invoiceRow.roundingDifference !== null && invoiceRow.roundingDifference !== 0 && (
                        <span title="Difference from the Pricing subtotal before tax">Rounding {invoiceRow.roundingDifference > 0 ? '+' : ''}{formatMoney(invoiceRow.roundingDifference)}</span>
                      )}
                    </div></td>
                    <td>
                      <div className="month-closure-invoice-value">
                        <strong>{formatMoney(invoiceRow.commission, 4)}</strong>
                        {hasMeaningfulPreviousValue(invoiceRow.row.previousMonthCommission) && (
                          <span>Prev {formatMoney(invoiceRow.row.previousMonthCommission, 4)}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="month-closure-invoice-value">
                        <strong>{formatMoney(invoiceRow.electricity, 4)}</strong>
                        {hasMeaningfulPreviousValue(invoiceRow.row.previousMonthElectricity) && (
                          <span>Prev {formatMoney(invoiceRow.row.previousMonthElectricity, 4)}</span>
                        )}
                      </div>
                    </td>
                    <td>{displayText(invoiceRow.vatStatus)}</td>
                    <td>{displayText(invoiceRow.erpProducer?.extra)}</td>
                    <td>{formatMoney(invoiceRow.finalResult)}</td>
                    <td className="month-closure-invoice-send">
                      <div className="month-closure-invoice-actions">
                      <input type="checkbox" aria-label={`Select invoice for ${invoiceRow.row.producer} (${displayMilkType(invoiceRow.row.milkType)})`}
                        title={invoiceRow.sendBlockReason || 'Select invoice'}
                        disabled={loading || invoiceSendBusy || invoiceDateSaving || Boolean(invoiceRow.sendBlockReason)}
                        checked={!invoiceRow.sendBlockReason && selectedInvoiceRowIds.includes(invoiceRow.row.id)}
                        onChange={event => setSelectedInvoiceRowIds(current => event.target.checked ? [...current.filter(id => id !== invoiceRow.row.id), invoiceRow.row.id] : current.filter(id => id !== invoiceRow.row.id))} />
                      <button type="button" disabled={loading || invoiceSendBusy || invoiceDateSaving || Boolean(invoiceRow.sendBlockReason)}
                        title={invoiceRow.sendBlockReason || 'Preview this invoice before sending'}
                        onClick={() => void previewInvoice(invoiceRow.row)}>
                        {invoiceStatuses[invoiceRow.row.id] === 'DRAFT' && invoiceRecords[invoiceRow.row.id]?.attemptCount > 0 ? 'Resend' : 'Send'}
                      </button>
                      {invoiceRecords[invoiceRow.row.id]?.attemptCount > 0 && <button type="button"
                        className={canResolveInvoices && invoiceStatuses[invoiceRow.row.id] === 'UNCONFIRMED' ? '' : 'month-closure-invoice-history'}
                        title={canResolveInvoices && invoiceStatuses[invoiceRow.row.id] === 'UNCONFIRMED' ? 'Resolve ERP status' : 'History'}
                        aria-label={canResolveInvoices && invoiceStatuses[invoiceRow.row.id] === 'UNCONFIRMED' ? 'Resolve ERP status' : 'History'}
                        disabled={loading || invoiceSendBusy || invoiceDateSaving}
                        onClick={() => invoiceResolutionRef.current?.open(invoiceRecords[invoiceRow.row.id].invoiceId, invoiceRow.row.producer)}>
                        {canResolveInvoices && invoiceStatuses[invoiceRow.row.id] === 'UNCONFIRMED' ? 'Resolve' : <History size={16} aria-hidden="true" />}
                      </button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && invoiceRows.length > 0 && (
                  <tr className="month-closure-invoice-total-row">
                    <td colSpan={5}>Totals</td>
                    <td>{formatNumber(invoiceTotals.qty)}</td>
                    <td>{formatMoney(invoiceTotals.result)}</td>
                    <td>{formatMoney(invoiceTotals.commission, 4)}</td>
                    <td>{formatMoney(invoiceTotals.electricity, 4)}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>{formatMoney(invoiceTotals.final)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
            ) : (
            <table className="month-closure-table month-closure-bank-table">
              <thead>
                <tr>
                  <th className="month-closure-bank-check">
                    <input
                      type="checkbox"
                      checked={allEligibleBankRowsSelected}
                      onChange={(event) => toggleAllEligibleBankRows(event.currentTarget.checked)}
                      disabled={!eligibleBankRows.length}
                      aria-label="Select all pending bank rows"
                    />
                  </th>
                  <th>IBAN</th>
                  <th>Final amount</th>
                  <th>Name</th>
                  <th>Center</th>
                  <th>Comment</th>
                  <th>Connected account</th>
                  <th>Payment terms</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="month-closure-empty">Loading bank rows...</td></tr>}
                {!loading && preparedBankRows.length === 0 && (
                  <tr><td colSpan={9} className="month-closure-empty">No bank rows found for this view.</td></tr>
                )}
                {!loading && preparedBankRows.map((bankRow) => {
                  const readyForBank = Boolean(bankRow.paymentProducer?.iban && bankRow.finalAmount !== null)
                  const canSelect = readyForBank && bankRow.status !== 'sent'
                  return (
                    <tr key={bankRow.id} className={`${readyForBank ? 'ready' : 'blocked'} ${bankRow.status === 'sent' ? 'bank-sent' : ''}`}>
                      <td className="month-closure-bank-check">
                        <input
                          type="checkbox"
                          checked={selectedBankRowIds.includes(bankRow.id)}
                          onChange={(event) => toggleBankRow(bankRow.id, event.currentTarget.checked)}
                          disabled={!canSelect}
                          aria-label={`Select bank payment for ${bankRow.producerName}`}
                        />
                      </td>
                      <td title={bankRow.paymentProducer?.iban || 'IBAN missing'}>
                        <span className={`month-closure-bank-iban ${bankRow.paymentProducer?.iban ? '' : 'missing'}`}>
                          {displayText(bankRow.paymentProducer?.iban)}
                        </span>
                      </td>
                      <td className="month-closure-bank-amount">{formatMoney(bankRow.finalAmount)}</td>
                      <td title={bankRow.paymentProducer?.producerName || bankRow.producerName}>
                        {displayText(bankRow.paymentProducer?.producerName || bankRow.producerName)}
                        <small className="month-closure-source">{displayMilkType(bankRow.milkType)}</small>
                        {bankRow.legacyPaymentNeedsReview && <small className="month-closure-invoice-warning">Previous grouped payment needs review</small>}
                      </td>
                      <td className="month-closure-bank-center" title={bankRow.centers.join(', ')}>{displayText(bankRow.centers.join(', '))}</td>
                      <td>
                        <input
                          className="month-closure-bank-input"
                          value={bankRow.comment}
                          onChange={(event) => updateBankNoteDraft(bankRow.id, 'comment', event.currentTarget.value)}
                          aria-label={`Bank comment for ${bankRow.producerName}`}
                          placeholder="Payment comment..."
                        />
                      </td>
                      <td>
                        <input
                          className="month-closure-bank-account"
                          list="month-closure-bank-producers"
                          value={bankRow.connectedAccount}
                          onChange={(event) => updateBankNoteDraft(bankRow.id, 'connectedAccount', event.currentTarget.value)}
                          aria-label={`Connected account for ${bankRow.producerName}`}
                          placeholder="No connected account"
                        />
                      </td>
                      <td>{['3030', '3080'].includes(bankRow.erpProducer?.paymentTerms || '') ? bankRow.erpProducer?.paymentTerms : '-'}</td>
                      <td>
                        <span
                          className={`month-closure-bank-status ${bankRow.status}`}
                        >
                          {bankRow.status === 'sent' ? 'Exported' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
            {view === 'bankNote' && (
              <datalist id="month-closure-bank-producers">
                {bankProducerOptions.map((producer) => (
                  <option key={producer.producerCode} value={bankProducerOption(producer)}>
                    {producer.producerName}
                  </option>
                ))}
              </datalist>
            )}
          </div>
          <FloatingHorizontalScrollbar targetRef={tableWrapRef} label="Scroll month closure table horizontally" refreshKey={view} />
        </section>
      </main>
    </div>
  )
}
