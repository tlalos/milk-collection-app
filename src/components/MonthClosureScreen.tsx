import { useEffect, useMemo, useRef, useState } from 'react'
import { appPath } from '../ocrPaths'
import { getCachedOcrReferenceSuppliers, type OcrReferenceProducer } from '../store/ocrReferenceSuppliersStore'
import './MonthClosureScreen.css'

type ReconciliationStatus = 'ok' | 'difference' | 'missing_monthly' | 'missing_aviz'
type PricingStatus = 'needs_price' | 'blocked' | 'saved'
type StatusFilter = 'all' | PricingStatus
type ClosureView = 'pricing' | 'erpInvoices' | 'bankNote'
type BankTransferStatus = 'pending' | 'sent'

interface MonthClosurePricingRow {
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

function excelXmlText(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function pricingLabel(status: PricingStatus) {
  if (status === 'saved') return 'Saved'
  return status === 'blocked' ? 'Blocked' : 'Needs price'
}

export function MonthClosureScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<MonthClosurePricingRow[]>([])
  const [summary, setSummary] = useState<MonthClosureSummary>(emptySummary)
  const [monthOptions, setMonthOptions] = useState<string[]>([])
  const [pricingDrafts, setPricingDrafts] = useState<PricingDrafts>({})
  const [pricingSaveStatus, setPricingSaveStatus] = useState<PricingSaveStatus>('idle')
  const [pricingSaveMessage, setPricingSaveMessage] = useState('')
  const [bankNoteDrafts, setBankNoteDrafts] = useState<BankNoteDrafts>({})
  const [selectedBankRowIds, setSelectedBankRowIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [monthFilter, setMonthFilter] = useState(() => new URLSearchParams(window.location.search).get('month') || '')
  const [centerFilter, setCenterFilter] = useState('')
  const [producerFilter, setProducerFilter] = useState('')
  const [milkTypeFilter, setMilkTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [view, setView] = useState<ClosureView>('pricing')
  const [bulkCenter, setBulkCenter] = useState('')
  const [bulkPrice, setBulkPrice] = useState('')
  const [bulkPriceError, setBulkPriceError] = useState('')
  const bulkPriceInputRef = useRef<HTMLInputElement>(null)
  const bulkCenterTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [erpReferenceProducers, setErpReferenceProducers] = useState<OcrReferenceProducer[]>(() =>
    getCachedOcrReferenceSuppliers()?.producers || [],
  )

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

  const changedPricingRows = rows.filter((row) => Object.keys(pricingDrafts[row.id] || {}).length > 0)

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
    const cachedReferences = getCachedOcrReferenceSuppliers()
    setErpReferenceProducers(cachedReferences?.producers || [])
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
  const bankProducerOptions = useMemo(() => [...erpReferenceProducers]
    .filter((producer) => producer.producerCode && producer.producerName)
    .sort((left, right) => left.producerName.localeCompare(right.producerName, undefined, { numeric: true })),
  [erpReferenceProducers])
  const bankProducerByOption = useMemo(() => new Map(
    bankProducerOptions.map((producer) => [bankProducerOption(producer), producer]),
  ), [bankProducerOptions])
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

  const bulkCenterRows = useMemo(() => rows.filter((row) => (
    (!monthFilter || row.month === monthFilter) && row.center === bulkCenter
  )), [bulkCenter, monthFilter, rows])

  function movePricingFocus(currentInput: HTMLInputElement, field: PricingDraftField, direction: 1 | -1) {
    const visibleInputs = Array.from(document.querySelectorAll<HTMLInputElement>(
      `input[data-pricing-field="${field}"]`,
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
    const result = price === null ? null : row.liters * price
    const extraApplied = hasExtraVat(erpProducer?.extra)
    const vatStatus = erpProducer?.vatStatusName || ''
    const vatStatusAmount = result === null || extraApplied || !hasRegularVat(vatStatus) ? 0 : result * 0.11
    const extraAmount = result === null || !extraApplied ? 0 : result * 0.08
    const hasFinalValue = result !== null || commissionValue !== null || electricityValue !== null
    const finalResult = hasFinalValue ? (result ?? 0) + commission + electricity + vatStatusAmount + extraAmount : null
    return { row, erpProducer, price, commission, electricity, result, vatStatus, vatStatusAmount, extraAmount, finalResult }
  })
  const invoiceTotals = invoiceRows.reduce((totals, invoiceRow) => ({
    qty: totals.qty + invoiceRow.row.liters,
    result: totals.result + (invoiceRow.result ?? 0),
    commission: totals.commission + invoiceRow.commission,
    electricity: totals.electricity + invoiceRow.electricity,
    vatStatusAmount: totals.vatStatusAmount + invoiceRow.vatStatusAmount,
    extraAmount: totals.extraAmount + invoiceRow.extraAmount,
    final: totals.final + (invoiceRow.finalResult ?? 0),
  }), { qty: 0, result: 0, commission: 0, electricity: 0, vatStatusAmount: 0, extraAmount: 0, final: 0 })
  const matchedInvoiceRows = invoiceRows.filter((invoiceRow) => invoiceRow.erpProducer).length
  const missingInvoiceMatches = invoiceRows.length - matchedInvoiceRows
  const matchedRowsMissingTaxFields = invoiceRows.filter((invoiceRow) =>
    invoiceRow.erpProducer && !String(invoiceRow.vatStatus || '').trim() && !String(invoiceRow.erpProducer.extra ?? '').trim(),
  ).length
  const currentPricedInvoiceRows = invoiceRows.filter((invoiceRow) => invoiceRow.price !== null).length
  const previousPricedInvoiceRows = invoiceRows.filter((invoiceRow) =>
    invoiceRow.price === null && hasMeaningfulPreviousValue(invoiceRow.row.previousMonthPrice),
  ).length
  const bankRows = [...invoiceRows.reduce((grouped, invoiceRow) => {
    const producerKey = normalizedSearch(invoiceRow.row.producerCode) || invoiceRow.row.id
    const current = grouped.get(producerKey)
    if (current) {
      current.finalAmount += invoiceRow.finalResult ?? 0
      current.totalLiters += invoiceRow.row.liters
      current.hasMissingAmount = current.hasMissingAmount || invoiceRow.finalResult === null
      return grouped
    }
    grouped.set(producerKey, {
      id: producerKey,
      producerName: invoiceRow.erpProducer?.producerName || invoiceRow.row.producer,
      producerCode: invoiceRow.row.producerCode,
      erpProducer: invoiceRow.erpProducer,
      finalAmount: invoiceRow.finalResult ?? 0,
      totalLiters: invoiceRow.row.liters,
      hasMissingAmount: invoiceRow.finalResult === null,
    })
    return grouped
  }, new Map<string, {
    id: string
    producerName: string
    producerCode: string
    erpProducer: OcrReferenceProducer | null
    finalAmount: number
    totalLiters: number
    hasMissingAmount: boolean
  }>()).values()]
  const preparedBankRows = bankRows.map((bankRow) => {
    const draft = bankNoteDrafts[bankRow.id] || {}
    const connectedAccount = draft.connectedAccount || ''
    const connectedProducer = bankProducerByOption.get(connectedAccount) || null
    const paymentProducer = connectedProducer || bankRow.erpProducer
    return {
      ...bankRow,
      connectedAccount,
      connectedProducer,
      paymentProducer,
      comment: draft.comment || '',
      status: (draft.status || 'pending') as BankTransferStatus,
      exportedAmount: typeof draft.exportedAmount === 'number' ? draft.exportedAmount : null,
      exportedLiters: typeof draft.exportedLiters === 'number' ? draft.exportedLiters : null,
      exportedAt: draft.exportedAt || '',
      finalAmount: bankRow.hasMissingAmount ? null : bankRow.finalAmount,
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

  function updateBankRowStatus(rowId: string, status: BankTransferStatus) {
    const row = preparedBankRows.find((candidate) => candidate.id === rowId)
    setBankNoteDrafts((current) => {
      const nextDraft = { ...current[rowId], status }
      if (status === 'sent' && row) {
        nextDraft.exportedAmount = row.finalAmount ?? undefined
        nextDraft.exportedLiters = row.totalLiters
        nextDraft.exportedAt = new Date().toISOString()
      } else {
        delete nextDraft.exportedAmount
        delete nextDraft.exportedLiters
        delete nextDraft.exportedAt
      }
      const next = { ...current, [rowId]: nextDraft }
      saveStoredBankNoteDrafts(monthFilter, next)
      return next
    })
    setSelectedBankRowIds((current) => current.filter((id) => id !== rowId))
  }

  function exportSelectedBankRows() {
    if (!selectedBankRows.length) return
    const headers = ['Month', 'IBAN', 'Final Amount', 'Name', 'Comment', 'Connected Account', 'Liters', 'Status']
    const rowsForExcel = selectedBankRows.map((row) => [
      displayMonth(monthFilter),
      row.paymentProducer?.iban || '',
      row.finalAmount ?? 0,
      row.paymentProducer?.producerName || row.producerName,
      row.comment,
      row.connectedAccount,
      row.totalLiters,
      'Sent to bank',
    ])
    const xmlCell = (value: unknown, numeric = false) => `<Cell><Data ss:Type="${numeric ? 'Number' : 'String'}">${excelXmlText(value)}</Data></Cell>`
    const worksheetRows = [
      `<Row>${headers.map((header) => xmlCell(header)).join('')}</Row>`,
      ...rowsForExcel.map((row) => `<Row>${row.map((value, index) => xmlCell(value, index === 2 || index === 6)).join('')}</Row>`),
    ].join('')
    const workbook = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Bank note"><Table>${worksheetRows}</Table></Worksheet></Workbook>`
    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bank-note-${monthFilter || 'month'}.xls`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)

    const exportedAt = new Date().toISOString()
    setBankNoteDrafts((current) => {
      const next = { ...current }
      for (const row of selectedBankRows) {
        next[row.id] = {
          ...next[row.id],
          status: 'sent',
          exportedAmount: row.finalAmount ?? undefined,
          exportedLiters: row.totalLiters,
          exportedAt,
        }
      }
      saveStoredBankNoteDrafts(monthFilter, next)
      return next
    })
    setSelectedBankRowIds([])
  }

  return (
    <div className="month-closure-screen app-shell">
      <header className="app-topbar month-closure-topbar">
        <button className="back-button month-closure-home-button" type="button" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
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
        <section className={`month-closure-summary ${view === 'bankNote' ? 'bank' : ''}`} aria-label="Month closure summary">
          {view === 'bankNote' ? (
            <>
              <div><span>Transfers</span><strong>{preparedBankRows.length}</strong></div>
              <div><span>Selected</span><strong>{selectedBankRows.length}</strong></div>
              <div><span>Liters pending</span><strong>{formatNumber(bankPendingLiters)}</strong></div>
              <div><span>Liters exported</span><strong>{formatNumber(bankExportedLiters)}</strong></div>
              <div><span>Amount pending</span><strong>{formatMoney(bankPendingAmount)}</strong></div>
              <div><span>Amount sent</span><strong>{formatMoney(bankSentAmount)}</strong></div>
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
              <h2>{view === 'pricing' ? 'Pricing' : view === 'erpInvoices' ? 'ERP invoices' : 'Bank note'}</h2>
              <p>
                {view === 'pricing'
                  ? `${filteredRows.length} rows shown · ${formatNumber(filteredLiters)} L · ${filteredReady} ready · ${filteredBlocked} blocked`
                  : view === 'erpInvoices'
                    ? `${invoiceRows.length} invoice lines · ${formatNumber(invoiceTotals.qty)} L · ${formatMoney(invoiceTotals.final)} final preview`
                    : `${preparedBankRows.length} transfers · ${pendingBankRows.length} pending · ${sentBankRows.length} sent · ${formatMoney(bankTotal)} total`}
                {monthFilter ? ` · ${displayMonth(monthFilter)}` : ''}
              </p>
            </div>
            <div className="month-closure-tabs" aria-label="Month closure views">
              <button className={view === 'pricing' ? 'active' : ''} type="button" onClick={() => setView('pricing')}>Pricing</button>
              <button className={view === 'erpInvoices' ? 'active' : ''} type="button" onClick={() => setView('erpInvoices')}>ERP invoices</button>
              <button className={view === 'bankNote' ? 'active' : ''} type="button" onClick={() => setView('bankNote')}>Bank note</button>
            </div>
          </div>

          {view === 'pricing' && (
            <div className={`month-closure-pricing-tools ${pricingSaveStatus}`}>
              <div>
                <strong>Monthly pricing history</strong>
                <span aria-live="polite">
                  {pricingSaveStatus === 'saving' || pricingSaveStatus === 'error'
                    ? pricingSaveMessage
                    : changedPricingRows.length
                      ? `${changedPricingRows.length} edited row${changedPricingRows.length === 1 ? '' : 's'} waiting for autosave.`
                      : pricingSaveMessage || 'Autosave on. Prices, commission and electricity are stored separately for each month.'}
                </span>
              </div>
              <button type="button" onClick={() => void savePricingRows()} disabled={!changedPricingRows.length || pricingSaveStatus === 'saving'}>
                {pricingSaveStatus === 'saving' ? 'Saving...' : `Save now${changedPricingRows.length ? ` (${changedPricingRows.length})` : ''}`}
              </button>
            </div>
          )}

          {view === 'erpInvoices' && (
            <div className="month-closure-invoice-tools">
              <div>
                <strong>ERP invoice preview</strong>
                <span>
                  Result is price x qty. Extra = 1 adds 8%; otherwise regular VAT adds 11%.
                  {' '}
                  {erpReferenceProducers.length
                    ? `${erpReferenceProducers.length} ERP suppliers available. ${matchedInvoiceRows} invoice rows matched${missingInvoiceMatches ? `, ${missingInvoiceMatches} missing ERP match` : ''}${matchedRowsMissingTaxFields ? `, ${matchedRowsMissingTaxFields} matched rows missing VAT/extra` : ''}.`
                    : 'ERP supplier details not loaded. Use the OCR menu refresh button when the API is available.'}
                  {' '}
                  {`${currentPricedInvoiceRows} rows have current prices${previousPricedInvoiceRows ? `; ${previousPricedInvoiceRows} rows have previous-month prices available` : ''}.`}
                </span>
              </div>
              <button type="button" disabled>Export Excel</button>
            </div>
          )}

          {view === 'bankNote' && (
            <>
              <div className="month-closure-bank-tools">
                <div>
                  <strong>{readyBankRows} ready for bank</strong>
                  <span>{pendingBankRows.length - readyBankRows} pending rows need an IBAN or final amount. Connected account is optional.</span>
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

          <div className="month-closure-table-wrap">
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
                    <td title={row.center}>
                      <button
                        className={`month-closure-center-button ${bulkCenter === row.center ? 'active' : ''}`}
                        type="button"
                        onClick={(event) => openBulkCenterPrice(row.center, event.currentTarget)}
                      >
                        {row.center}
                      </button>
                    </td>
                    <td title={row.producer}>{row.producer}</td>
                    <td title={row.milkType}>{displayMilkType(row.milkType)}</td>
                    <td>{formatNumber(row.liters)}</td>
                    <td className="month-closure-entry-cell">
                      <div className="month-closure-entry-stack">
                        <input
                          className="month-closure-price-input"
                          inputMode="decimal"
                          aria-label={`Price for ${row.producer}`}
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
                  <th>Month</th>
                  <th>Producer name</th>
                  <th>Producer code</th>
                  <th>Producer center</th>
                  <th>Milk type</th>
                  <th>Price</th>
                  <th>Qty L</th>
                  <th>Result</th>
                  <th>Comm.</th>
                  <th>Electricity</th>
                  <th>VAT status</th>
                  <th>VAT amount</th>
                  <th>Extra</th>
                  <th>Extra amount</th>
                  <th>Final result</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={15} className="month-closure-empty">Loading invoice rows...</td></tr>}
                {!loading && invoiceRows.length === 0 && <tr><td colSpan={15} className="month-closure-empty">No invoice rows found for this view.</td></tr>}
                {!loading && invoiceRows.map((invoiceRow) => (
                  <tr key={invoiceRow.row.id} className={invoiceRow.row.readyForPricing ? 'ready' : 'blocked'}>
                    <td>{displayMonth(invoiceRow.row.month)}</td>
                    <td title={invoiceRow.erpProducer?.producerName || invoiceRow.row.producer}>{displayText(invoiceRow.erpProducer?.producerName || invoiceRow.row.producer)}</td>
                    <td>
                      <span className={`month-closure-erp-match ${invoiceRow.erpProducer ? 'matched' : 'missing'}`}>
                        {displayText(invoiceRow.row.producerCode)}
                      </span>
                    </td>
                    <td title={invoiceRow.erpProducer?.centerName || invoiceRow.row.center}>{displayText(invoiceRow.erpProducer?.centerName || invoiceRow.row.center)}</td>
                    <td>{displayMilkType(invoiceRow.row.milkType)}</td>
                    <td>
                      <div className="month-closure-invoice-value">
                        <strong>{formatMoney(invoiceRow.price, 4)}</strong>
                        {hasMeaningfulPreviousValue(invoiceRow.row.previousMonthPrice) && (
                          <span>Prev {formatMoney(invoiceRow.row.previousMonthPrice, 4)}</span>
                        )}
                      </div>
                    </td>
                    <td>{formatNumber(invoiceRow.row.liters)}</td>
                    <td>{formatMoney(invoiceRow.result)}</td>
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
                    <td>{formatMoney(invoiceRow.vatStatusAmount)}</td>
                    <td>{displayText(invoiceRow.erpProducer?.extra)}</td>
                    <td>{formatMoney(invoiceRow.extraAmount)}</td>
                    <td>{formatMoney(invoiceRow.finalResult)}</td>
                  </tr>
                ))}
                {!loading && invoiceRows.length > 0 && (
                  <tr className="month-closure-invoice-total-row">
                    <td colSpan={6}>Totals</td>
                    <td>{formatNumber(invoiceTotals.qty)}</td>
                    <td>{formatMoney(invoiceTotals.result)}</td>
                    <td>{formatMoney(invoiceTotals.commission, 4)}</td>
                    <td>{formatMoney(invoiceTotals.electricity, 4)}</td>
                    <td>-</td>
                    <td>{formatMoney(invoiceTotals.vatStatusAmount)}</td>
                    <td>-</td>
                    <td>{formatMoney(invoiceTotals.extraAmount)}</td>
                    <td>{formatMoney(invoiceTotals.final)}</td>
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
                  <th>Comment</th>
                  <th>Connected account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="month-closure-empty">Loading bank rows...</td></tr>}
                {!loading && preparedBankRows.length === 0 && (
                  <tr><td colSpan={7} className="month-closure-empty">No bank rows found for this view.</td></tr>
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
                      </td>
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
                          placeholder="Optional: choose producer..."
                        />
                      </td>
                      <td>
                        <select
                          className={`month-closure-bank-status ${bankRow.status}`}
                          value={bankRow.status}
                          onChange={(event) => updateBankRowStatus(bankRow.id, event.currentTarget.value as BankTransferStatus)}
                          aria-label={`Bank status for ${bankRow.producerName}`}
                        >
                          <option value="pending">Pending</option>
                          <option value="sent">Sent to bank</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
