import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import './OcrReviewScreen.css'
import { OcrLanguageSwitch, useOcrLanguage, type OcrLanguage } from './OcrLanguage'
import { appPath } from '../ocrPaths'
import { APP_VERSION } from '../appVersion'

interface ExtractedRow {
  rowNumber: number
  collectionCenter: string | null
  liters: number | null
  fatPercent: number | null
  density: number | null
  water: number | null
  temperature: number | null
  noticeNumber: string | null
  confidence: number
  uncertainFields: string[]
}

interface ExtractedData {
  documentType: 'daily_driver_statement'
  companyName: string | null
  date: string | null
  driverName: string | null
  vehicleRegistration: string | null
  route: string | null
  rows: ExtractedRow[]
  totalLiters: number | null
  warnings: string[]
  rawTranscription: string
}

interface AttentionSummary {
  warningCount: number
  uncertainFieldCount: number
  needsAttention: boolean
}

interface CenterSuggestion { code: string; name: string; score: number }
interface CenterMatch {
  rowNumber: number
  originalName: string | null
  status: 'exact' | 'auto_replaced' | 'suggested' | 'unmatched' | 'confirmed'
  selectedCode: string | null
  selectedName: string | null
  suggestions: CenterSuggestion[]
}

interface DriverMatch {
  originalName: string | null
  status: 'auto_replaced' | 'unmatched' | 'manual'
  selectedName: string | null
  score: number
}

interface VehicleMatch {
  originalValue: string | null
  status: 'auto_replaced' | 'unmatched' | 'manual'
  selectedValue: string | null
  score: number
}

interface RouteMatch {
  status: 'resolved' | 'unmatched' | 'manual'
  selectedRoute: string | null
  date: string | null
  vehicle: string | null
  existingRoutes: string[]
  optionIndex?: number | null
}

interface RowValueSource {
  source: 'current_invoice' | 'previous_day' | 'invoice_date' | 'not_found'
  value: string | number | null
  sourceRowNumber?: number
  sourceDate?: string
}

interface RowValueSourceEntry {
  rowNumber: number
  fields: Partial<Record<'fatPercent' | 'density' | 'water' | 'temperature' | 'noticeNumber', RowValueSource>>
}

interface OcrJob {
  id: string
  sourceFile: string
  mimeType: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  reviewStatus: 'pending' | 'reviewed'
  createdAt: string
  startedAt?: string | null
  completedAt: string | null
  reviewedAt?: string | null
  fileUrl: string
  attention: AttentionSummary
  summary?: {
    date: string | null
    route: string | null
    driverName: string | null
    vehicleRegistration: string | null
  }
  data?: ExtractedData | null
  error?: string | null
  openai?: {
    responseId: string
    provider?: string
    model: string
    usage: {
      inputTokens: number
      cachedInputTokens: number
      outputTokens: number
      reasoningTokens: number
      totalTokens: number
    } | null
    cost: {
      currency: 'USD'
      estimatedUsd: number
      pricingDate: string
      ratesPerMillionTokens: { input: number; cachedInput: number; output: number }
    } | null
    durationMs?: number | null
  } | null
  excelExport?: {
    status: 'not_ready' | 'queued' | 'exporting' | 'exported' | 'failed'
    rowCount?: number
    workbook?: string
    table?: string
    error?: string | null
    progress?: { stage: 'connecting' | 'preparing' | 'sending' | 'completed'; current: number; total: number; rowNumber?: number; center?: string; range?: string }
    rowLog?: Array<{ rowNumber: number; center: string; status: 'ready' | 'sent' }>
  } | null
  centerMatches?: CenterMatch[]
  centerMatchError?: string | null
  driverMatch?: DriverMatch | null
  driverMatchError?: string | null
  vehicleMatch?: VehicleMatch | null
  vehicleMatchError?: string | null
  routeMatch?: RouteMatch | null
  routeMatchError?: string | null
  rowValueSources?: RowValueSourceEntry[]
  rowValueSourceError?: string | null
}

type QueueView = 'pending' | 'reviewed' | 'failed'
type TextField = 'companyName' | 'date' | 'driverName' | 'vehicleRegistration' | 'route'
type RowTextField = 'collectionCenter' | 'noticeNumber'
type RowNumberField = 'liters' | 'fatPercent' | 'density' | 'water' | 'temperature'
const JOBS_PER_PAGE = 5
let cachedDriverOptions: string[] | null = null
let driverOptionsRequest: Promise<string[]> | null = null
let cachedVehicleOptions: string[] | null = null
let vehicleOptionsRequest: Promise<string[]> | null = null

function loadDriverOptions() {
  if (cachedDriverOptions) return Promise.resolve(cachedDriverOptions)
  if (!driverOptionsRequest) {
    driverOptionsRequest = fetch(appPath('/api/ocr/drivers')).then(async (response) => {
      const payload = await response.json() as { drivers?: string[]; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not load drivers.')
      cachedDriverOptions = payload.drivers ?? []
      return cachedDriverOptions
    }).finally(() => { driverOptionsRequest = null })
  }
  return driverOptionsRequest
}

function loadVehicleOptions() {
  if (cachedVehicleOptions) return Promise.resolve(cachedVehicleOptions)
  if (!vehicleOptionsRequest) {
    vehicleOptionsRequest = fetch(appPath('/api/ocr/vehicles')).then(async (response) => {
      const payload = await response.json() as { vehicles?: string[]; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not load vehicles.')
      cachedVehicleOptions = payload.vehicles ?? []
      return cachedVehicleOptions
    }).finally(() => { vehicleOptionsRequest = null })
  }
  return vehicleOptionsRequest
}

function cloneData(data: ExtractedData) {
  return structuredClone(data)
}

function statusLabel(job: OcrJob, language: OcrLanguage) {
  const ro = language === 'ro'
  if (job.status === 'queued') return ro ? 'În așteptare' : 'Queued'
  if (job.status === 'processing') return ro ? 'Procesare OCR' : 'OCR processing'
  if (job.status === 'failed') return ro ? 'OCR eșuat' : 'OCR failed'
  return job.reviewStatus === 'reviewed' ? (ro ? 'Verificat' : 'Reviewed') : (ro ? 'Pregătit pentru verificare' : 'Ready for review')
}

function isFailedQueueJob(job: OcrJob) {
  return job.status === 'failed' || job.excelExport?.status === 'failed'
}

function nullableNumber(input: string) {
  if (!input.trim()) return null
  const parsed = Number(input.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function displayDate(value: string | null) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value ?? ''
}

function normalizeReferenceName(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
}

function storedDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value
}

function formatCost(job: OcrJob) {
  const value = job.openai?.cost?.estimatedUsd
  if (value == null) return null
  const usdToEur = Number(import.meta.env.VITE_USD_TO_EUR_RATE || 0.92)
  const euros = value * (Number.isFinite(usdToEur) && usdToEur > 0 ? usdToEur : 0.92)
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: euros < 0.01 ? 4 : 3,
    maximumFractionDigits: euros < 0.01 ? 4 : 3,
  }).format(euros)
}

function formatOcrDuration(job: OcrJob) {
  const elapsed = job.openai?.durationMs ?? (job.startedAt && job.completedAt ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime() : null)
  if (elapsed == null || !Number.isFinite(elapsed) || elapsed < 0) return null
  const seconds = Math.round(elapsed / 1000)
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

function applyAutomaticCenterReplacements(job: OcrJob) {
  if (!job.data || !job.centerMatches?.length) return job
  const centerMatches = job.centerMatches.map((match) => {
    if (match.selectedName || match.status !== 'suggested') return match
    const best = match.suggestions[0]
    if (!best || best.score < 0.6) return match
    const row = job.data?.rows.find((item) => item.rowNumber === match.rowNumber)
    if ((row?.collectionCenter ?? '') !== (match.originalName ?? '')) return match
    return { ...match, status: 'auto_replaced' as const, selectedCode: best.code, selectedName: best.name }
  })
  const data = {
    ...job.data,
    rows: job.data.rows.map((row) => {
      const match = centerMatches.find((item) => item.rowNumber === row.rowNumber && item.status === 'auto_replaced')
      return match?.selectedName ? { ...row, collectionCenter: match.selectedName } : row
    }),
  }
  return { ...job, data, centerMatches }
}

export function OcrReviewScreen() {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [queueView, setQueueView] = useState<QueueView>('pending')
  const [queueCollapsed, setQueueCollapsed] = useState(false)
  const [jobSearch, setJobSearch] = useState('')
  const [dataTab, setDataTab] = useState<'document' | 'centers'>('document')
  const [jobs, setJobs] = useState<OcrJob[]>([])
  const [selected, setSelected] = useState<OcrJob | null>(null)
  const [draft, setDraft] = useState<ExtractedData | null>(null)
  const [centerMatches, setCenterMatches] = useState<CenterMatch[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedSummary, setSelectedSummary] = useState<OcrJob | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loadingId, setLoadingId] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [driverOptions, setDriverOptions] = useState<string[]>([])
  const [vehicleOptions, setVehicleOptions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [reprocessingId, setReprocessingId] = useState('')
  const [rematchingReferences, setRematchingReferences] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [excelNotice, setExcelNotice] = useState<{ type: 'working' | 'success' | 'error'; message: string; progress?: OcrJob['excelExport'] extends infer T ? T : never } | null>(null)
  const [matchingCenters, setMatchingCenters] = useState(false)
  const [openCenterSuggestions, setOpenCenterSuggestions] = useState<number | null>(null)
  const [zoom, setZoom] = useState(100)
  const [panelSplit, setPanelSplit] = useState(50)
  const [columnsFit, setColumnsFit] = useState(false)
  const [page, setPage] = useState(1)
  const jobCacheRef = useRef(new Map<string, OcrJob>())
  const prefetchingRef = useRef(new Set<string>())
  const lastSavedRef = useRef('')
  const centerSearchTimersRef = useRef(new Map<number, number>())
  const previousLayoutRef = useRef({ queueCollapsed: false, panelSplit: 50 })

  function toggleColumnsFit() {
    if (columnsFit) {
      setQueueCollapsed(previousLayoutRef.current.queueCollapsed)
      setPanelSplit(previousLayoutRef.current.panelSplit)
      setColumnsFit(false)
      return
    }
    previousLayoutRef.current = { queueCollapsed, panelSplit }
    setQueueCollapsed(true)
    setPanelSplit(40)
    setColumnsFit(true)
  }

  function startPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const workspace = event.currentTarget.parentElement
    if (!workspace) return
    const bounds = workspace.getBoundingClientRect()
    const resize = (pointerEvent: PointerEvent) => {
      const percent = ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
      setPanelSplit(Math.min(72, Math.max(28, percent)))
    }
    const finish = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finish)
      document.body.classList.remove('review-resizing')
    }
    document.body.classList.add('review-resizing')
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finish)
  }

  const fetchJobDetail = useCallback(async (id: string, bypassCache = false) => {
    const cached = jobCacheRef.current.get(id)
    if (cached && !bypassCache) return cached

    const response = await fetch(appPath(`/api/ocr/jobs/${id}`))
    const payload = await response.json() as { job?: OcrJob; error?: string }
    if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not load this document.')
    jobCacheRef.current.set(id, payload.job)
    return payload.job
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const query = queueView === 'failed'
        ? 'documentCategory=daily_routes'
        : `reviewStatus=${queueView}&documentCategory=daily_routes`
      const response = await fetch(appPath(`/api/ocr/jobs?${query}`))
      const payload = await response.json() as { jobs?: OcrJob[]; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not load OCR jobs.')
      const nextJobs = queueView === 'pending'
        ? (payload.jobs ?? []).filter((job) => job.status !== 'failed')
        : queueView === 'failed'
          ? (payload.jobs ?? []).filter(isFailedQueueJob)
        : payload.jobs ?? []
      setJobs(nextJobs)
      setSelectedSummary((current) => current ? nextJobs.find((job) => job.id === current.id) ?? current : current)
      setSelected((current) => {
        if (!current) return current
        const summary = nextJobs.find((job) => job.id === current.id)
        return summary ? { ...current, ...summary, data: current.data } : current
      })
      setError('')

      for (const job of nextJobs) {
        if (job.status !== 'completed' || jobCacheRef.current.has(job.id) || prefetchingRef.current.has(job.id)) continue
        prefetchingRef.current.add(job.id)
        void fetchJobDetail(job.id).catch(() => undefined).finally(() => prefetchingRef.current.delete(job.id))
      }
    } catch (loadError) {
      setError((loadError as Error).message || 'Could not load OCR jobs.')
    }
  }, [fetchJobDetail, queueView])

  useEffect(() => {
    setSelected(null)
    setDraft(null)
    setCenterMatches([])
    setSelectedId('')
    setSelectedSummary(null)
    setSuccess('')
    setPage(1)
    void loadJobs()
    const timer = window.setInterval(() => void loadJobs(), 5000)
    return () => window.clearInterval(timer)
  }, [loadJobs])

  useEffect(() => {
    if (!draft || dataTab !== 'document') return
    void loadDriverOptions().then(setDriverOptions).catch(() => undefined)
    void loadVehicleOptions().then(setVehicleOptions).catch(() => undefined)
  }, [dataTab, Boolean(draft)])

  useEffect(() => {
    if (!selected || !draft || selected.status !== 'completed' || saving || rematchingReferences) return
    const signature = JSON.stringify({ data: draft, centerMatches })
    if (signature === lastSavedRef.current) return
    setAutoSaveStatus('saving')
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(appPath(`/api/ocr/jobs/${selected.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: draft, centerMatches }),
        })
        const payload = await response.json() as { job?: OcrJob; error?: string }
        if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not automatically save changes.')
        lastSavedRef.current = signature
        jobCacheRef.current.set(payload.job.id, payload.job)
        setSelected((current) => current?.id === payload.job!.id ? { ...payload.job!, data: draft } : current)
        setSelectedSummary((current) => current?.id === payload.job!.id ? { ...current, ...payload.job, data: undefined } : current)
        setJobs((current) => current.map((job) => job.id === payload.job!.id ? { ...job, ...payload.job, data: undefined } : job))
        setAutoSaveStatus('saved')
      } catch (saveError) {
        setAutoSaveStatus('error')
        setError((saveError as Error).message || 'Could not automatically save changes.')
      }
    }, 800)
    return () => window.clearTimeout(timer)
  }, [centerMatches, draft, rematchingReferences, saving, selected?.id, selected?.status])

  useEffect(() => () => {
    centerSearchTimersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  async function openJob(job: OcrJob) {
    setSelectedId(job.id)
    setSelectedSummary(job)
    setSuccess('')
    setZoom(100)
    setDataTab('document')
    if (job.status !== 'completed') {
      setSelected(null)
      setDraft(null)
      setLoadingId('')
      return
    }

    const cached = jobCacheRef.current.get(job.id)
    if (cached?.data) {
      const normalized = applyAutomaticCenterReplacements(cached)
      lastSavedRef.current = JSON.stringify({ data: normalized.data, centerMatches: normalized.centerMatches ?? [] })
      jobCacheRef.current.set(normalized.id, normalized)
      setSelected(normalized)
      setDraft(cloneData(normalized.data!))
      setCenterMatches(structuredClone(normalized.centerMatches ?? []))
      setLoadingId('')
      return
    }

    setLoadingId(job.id)
    setSelected(null)
    setDraft(null)
    try {
      const detail = applyAutomaticCenterReplacements(await fetchJobDetail(job.id))
      lastSavedRef.current = JSON.stringify({ data: detail.data, centerMatches: detail.centerMatches ?? [] })
      jobCacheRef.current.set(detail.id, detail)
      setSelected(detail)
      setDraft(detail.data ? cloneData(detail.data) : null)
      setCenterMatches(structuredClone(detail.centerMatches ?? []))
      setError('')
    } catch (loadError) {
      setError((loadError as Error).message || 'Could not load this document.')
    } finally {
      setLoadingId('')
    }
  }

  async function deleteDocument(job: OcrJob) {
    const prompt = isRo
      ? `Ștergeți definitiv „${job.sourceFile}”, fișierul încărcat și procesul OCR?`
      : `Permanently delete “${job.sourceFile}”, its uploaded file, and OCR process?`
    if (!window.confirm(prompt)) return
    setDeletingId(job.id)
    setError('')
    setSuccess('')
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${job.id}`), { method: 'DELETE' })
      const payload = await response.json() as { deleted?: boolean; error?: string }
      if (!response.ok || !payload.deleted) throw new Error(payload.error || 'Could not delete the document.')
      jobCacheRef.current.delete(job.id)
      if (selectedId === job.id) {
        setSelectedId('')
        setSelectedSummary(null)
        setSelected(null)
        setDraft(null)
        setCenterMatches([])
      }
      setJobs((current) => current.filter((item) => item.id !== job.id))
      setSuccess(isRo ? 'Documentul și procesul OCR au fost șterse.' : 'Document and OCR process deleted.')
      await loadJobs()
    } catch (deleteError) {
      setError((deleteError as Error).message)
    } finally {
      setDeletingId('')
    }
  }

  function updateTextField(field: TextField, input: string) {
    const value = input.trim() ? input : null
    setDraft((current) => current ? { ...current, [field]: value } : current)
    if ((field === 'date' || field === 'route') && selectedId) {
      setJobs((current) => current.map((job) => job.id === selectedId
        ? { ...job, summary: { date: null, route: null, driverName: null, vehicleRegistration: null, ...job.summary, [field]: value } }
        : job))
    }
  }

  function updateTotalLiters(input: string) {
    setDraft((current) => current ? { ...current, totalLiters: nullableNumber(input) } : current)
  }

  function updateRowText(index: number, field: RowTextField, input: string) {
    setDraft((current) => {
      if (!current) return current
      const rows = [...current.rows]
      rows[index] = {
        ...rows[index],
        [field]: input.trim() ? input : null,
        uncertainFields: rows[index].uncertainFields.filter((uncertain) => uncertain !== field),
      }
      return { ...current, rows }
    })
    if (field === 'collectionCenter') {
      const rowNumber = draft?.rows[index]?.rowNumber
      setCenterMatches((current) => current.map((match) => match.rowNumber === rowNumber ? { ...match, selectedCode: null, selectedName: null, status: match.suggestions.length ? 'suggested' : 'unmatched' } : match))
      if (rowNumber != null) scheduleCenterSearch(rowNumber, input)
    }
  }

  function scheduleCenterSearch(rowNumber: number, input: string) {
    const existing = centerSearchTimersRef.current.get(rowNumber)
    if (existing) window.clearTimeout(existing)
    if (input.trim().length < 3 || !selected) {
      if (openCenterSuggestions === rowNumber) setOpenCenterSuggestions(null)
      return
    }
    const jobId = selected.id
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(appPath(`/api/ocr/jobs/${jobId}/centers/suggest`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowNumber, name: input }),
        })
        const payload = await response.json() as { match?: CenterMatch | null; error?: string }
        if (!response.ok) throw new Error(payload.error || 'Could not search collection centers.')
        if (!payload.match) return
        setCenterMatches((current) => {
          const remaining = current.filter((match) => match.rowNumber !== rowNumber)
          return [...remaining, payload.match!].sort((left, right) => left.rowNumber - right.rowNumber)
        })
        setOpenCenterSuggestions(payload.match.suggestions.length ? rowNumber : null)
      } catch (searchError) {
        setError((searchError as Error).message || 'Could not search collection centers.')
      } finally {
        centerSearchTimersRef.current.delete(rowNumber)
      }
    }, 450)
    centerSearchTimersRef.current.set(rowNumber, timer)
  }

  function selectCenter(rowNumber: number, code: string) {
    setCenterMatches((current) => current.map((match) => {
      if (match.rowNumber !== rowNumber) return match
      const selected = match.suggestions.find((suggestion) => suggestion.code === code)
      if (!selected) return { ...match, selectedCode: null, selectedName: null, status: match.suggestions.length ? 'suggested' : 'unmatched' }
      return { ...match, selectedCode: selected.code, selectedName: selected.name, status: 'confirmed' }
    }))
    const selectedMatch = centerMatches.find((match) => match.rowNumber === rowNumber)?.suggestions.find((suggestion) => suggestion.code === code)
    if (selectedMatch) setDraft((current) => current ? { ...current, rows: current.rows.map((row) => row.rowNumber === rowNumber ? { ...row, collectionCenter: selectedMatch.name, uncertainFields: row.uncertainFields.filter((field) => field !== 'collectionCenter') } : row) } : current)
    setOpenCenterSuggestions(null)
  }

  async function findSimilarCenters() {
    if (!selected || matchingCenters) return
    setMatchingCenters(true)
    setError('')
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${selected.id}/centers/match`), { method: 'POST' })
      const payload = await response.json() as { job?: OcrJob; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not search Ref_Centers.')
      setCenterMatches(structuredClone(payload.job.centerMatches ?? []))
      setDraft(payload.job.data ? cloneData(payload.job.data) : null)
      jobCacheRef.current.set(payload.job.id, payload.job)
      setSelected(payload.job)
      setSuccess(isRo ? 'Sugestiile din Ref_Centers au fost actualizate.' : 'Ref_Centers suggestions updated.')
    } catch (matchError) {
      setError((matchError as Error).message || 'Could not search Ref_Centers.')
    } finally {
      setMatchingCenters(false)
    }
  }

  function updateRowNumber(index: number, field: RowNumberField, input: string) {
    setDraft((current) => {
      if (!current) return current
      const rows = [...current.rows]
      rows[index] = {
        ...rows[index],
        [field]: nullableNumber(input),
        uncertainFields: rows[index].uncertainFields.filter((uncertain) => uncertain !== field),
      }
      return { ...current, rows }
    })
  }

  function deleteRow(rowNumber: number) {
    const prompt = isRo
      ? `Ștergeți rândul ${rowNumber} din acest document?`
      : `Delete row ${rowNumber} from this document?`
    if (!window.confirm(prompt)) return
    setDraft((current) => current ? {
      ...current,
      rows: current.rows.filter((row) => row.rowNumber !== rowNumber),
      warnings: current.warnings.filter((warning) => !warning.includes(`row ${rowNumber}`) && !warning.includes(`rândul ${rowNumber}`)),
    } : current)
    setCenterMatches((current) => current.filter((match) => match.rowNumber !== rowNumber))
    if (openCenterSuggestions === rowNumber) setOpenCenterSuggestions(null)
  }

  async function saveDocument(markReviewed: boolean) {
    if (!selected || !draft || saving) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const saveResponse = await fetch(appPath(`/api/ocr/jobs/${selected.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: draft, centerMatches }),
      })
      const savePayload = await saveResponse.json() as { job?: OcrJob; error?: string }
      if (!saveResponse.ok || !savePayload.job) throw new Error(savePayload.error || 'Could not save corrected data.')

      let savedJob = savePayload.job
      if (markReviewed) {
        const reviewResponse = await fetch(appPath(`/api/ocr/jobs/${selected.id}/review`), { method: 'PATCH' })
        const reviewPayload = await reviewResponse.json() as { job?: OcrJob; error?: string }
        if (!reviewResponse.ok || !reviewPayload.job) throw new Error(reviewPayload.error || 'Data was saved, but the review could not be completed.')
        savedJob = reviewPayload.job
        setExcelNotice({
          type: 'working',
          message: isRo ? `Se exportă „${savedJob.sourceFile}” în Excel Online…` : `Exporting “${savedJob.sourceFile}” to Excel Online…`,
        })
        void monitorExcelExport(savedJob.id, savedJob.sourceFile)
      }

      jobCacheRef.current.set(savedJob.id, savedJob)
      lastSavedRef.current = JSON.stringify({ data: savedJob.data, centerMatches: savedJob.centerMatches ?? [] })
      if (markReviewed && queueView === 'pending') {
        setSelected(null)
        setDraft(null)
        setSelectedId('')
        setSelectedSummary(null)
        setSuccess('Corrections saved and document marked as reviewed.')
        await loadJobs()
      } else {
        setSelected(savedJob)
        setDraft(savedJob.data ? cloneData(savedJob.data) : null)
        setCenterMatches(structuredClone(savedJob.centerMatches ?? []))
        setSelectedSummary(savedJob)
        setSuccess('Corrections saved on the server.')
        await loadJobs()
      }
    } catch (saveError) {
      setError((saveError as Error).message || 'Could not save corrected data.')
    } finally {
      setSaving(false)
    }
  }

  async function monitorExcelExport(jobId: string, sourceFile: string) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
      try {
        const job = await fetchJobDetail(jobId, true)
        if (job.excelExport?.status === 'exported') {
          setExcelNotice({
            type: 'success',
            message: isRo
              ? `Export Excel finalizat: ${job.excelExport.rowCount ?? 0} rânduri din „${sourceFile}” au fost adăugate în Daily_Routes.`
              : `Excel export completed: ${job.excelExport.rowCount ?? 0} rows from “${sourceFile}” were added to Daily_Routes.`,
          })
          void loadJobs()
          return
        }
        if (job.excelExport?.status === 'failed') {
          setExcelNotice({
            type: 'error',
            message: isRo
              ? `Exportul Excel pentru „${sourceFile}” a eșuat: ${job.excelExport.error || 'eroare necunoscută'}. Deschideți documentul în fila Verificate pentru a reîncerca.`
              : `Excel export failed for “${sourceFile}”: ${job.excelExport.error || 'unknown error'}. Open it under Reviewed to retry.`,
          })
          void loadJobs()
          return
        }
        if (job.excelExport?.status === 'queued' || job.excelExport?.status === 'exporting') {
          const progress = job.excelExport.progress
          const message = progress?.stage === 'preparing'
            ? (isRo ? `Se pregătește rândul ${progress.current} din ${progress.total} pentru Excel.` : `Preparing row ${progress.current} of ${progress.total} for Excel.`)
            : progress?.stage === 'sending'
              ? (isRo ? `Se trimit ${progress.total} rânduri către Excel Online…` : `Sending ${progress.total} rows to Excel Online…`)
              : (isRo ? 'Conectare la Excel Online…' : 'Connecting to Excel Online…')
          setExcelNotice({ type: 'working', message, progress: job.excelExport })
        }
      } catch {
        // A temporary polling failure should not interrupt the server-side export.
      }
    }
    setExcelNotice({
      type: 'error',
      message: isRo ? `Exportul Excel pentru „${sourceFile}” durează neobișnuit de mult. Verificați starea în fila Verificate.` : `Excel export for “${sourceFile}” is taking unusually long. Check its status under Reviewed.`,
    })
  }

  async function reprocessDocument(job: OcrJob = selected!) {
    if (!job || reprocessingId) return
    const confirmed = window.confirm(isRo ? 'Refacem OCR pentru acest document? Datele recunoscute și corecțiile salvate vor fi înlocuite.' : 'Redo OCR for this document? The current recognised data and saved corrections will be replaced when processing completes.')
    if (!confirmed) return

    setReprocessingId(job.id)
    setError('')
    setSuccess('')
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${job.id}/reprocess`), { method: 'POST' })
      const payload = await response.json() as { job?: OcrJob; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not redo OCR for this document.')
      jobCacheRef.current.delete(job.id)
      setSelected(null)
      setDraft(null)
      setSelectedId(payload.job.id)
      setSelectedSummary(payload.job)
      setQueueView('pending')
      setSuccess(isRo ? 'Documentul a fost pus din nou în coada OCR. Rezultatul și costul nou vor apărea automat.' : 'Document queued for OCR again. The result and new cost will appear automatically.')
      await loadJobs()
    } catch (reprocessError) {
      setError((reprocessError as Error).message || 'Could not redo OCR for this document.')
    } finally {
      setReprocessingId('')
    }
  }

  async function rematchExcelReferences() {
    if (!selected || !draft || rematchingReferences) return
    setRematchingReferences(true)
    setError('')
    setSuccess('')
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${selected.id}/references/rematch`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: draft }),
      })
      const payload = await response.json() as { job?: OcrJob; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not redo Excel matching.')
      jobCacheRef.current.set(payload.job.id, payload.job)
      lastSavedRef.current = JSON.stringify({ data: payload.job.data, centerMatches: payload.job.centerMatches ?? [] })
      setSelected(payload.job)
      setDraft(payload.job.data ? cloneData(payload.job.data) : null)
      setSelectedSummary(payload.job)
      cachedDriverOptions = null
      cachedVehicleOptions = null
      const [drivers, vehicles] = await Promise.all([loadDriverOptions(), loadVehicleOptions()])
      setDriverOptions(drivers)
      setVehicleOptions(vehicles)
      setSuccess(isRo
        ? 'Potrivirea Excel pentru șofer, vehicul și rută a fost refăcută fără OCR.'
        : 'Excel matching for driver, vehicle and route was refreshed without running OCR.')
      await loadJobs()
    } catch (matchError) {
      setError((matchError as Error).message || 'Could not redo Excel matching.')
    } finally {
      setRematchingReferences(false)
    }
  }

  async function retryExcelExport() {
    if (!selected || exporting) return
    setExporting(true)
    setError('')
    try {
      const response = await fetch(appPath(`/api/ocr/jobs/${selected.id}/excel/retry`), { method: 'POST' })
      const payload = await response.json() as { job?: OcrJob; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not queue the Excel export.')
      jobCacheRef.current.set(payload.job.id, payload.job)
      setSelected(payload.job)
      setSelectedSummary(payload.job)
      setSuccess(isRo ? 'Exportul Excel a fost pus în coadă și continuă în fundal pe server.' : 'Excel export queued. It will continue in the server background.')
      setExcelNotice({ type: 'working', message: isRo ? `Se exportă „${payload.job.sourceFile}” în Excel Online…` : `Exporting “${payload.job.sourceFile}” to Excel Online…` })
      void monitorExcelExport(payload.job.id, payload.job.sourceFile)
      await loadJobs()
    } catch (exportError) {
      setError((exportError as Error).message || 'Could not queue the Excel export.')
    } finally {
      setExporting(false)
    }
  }

  const queuedCount = jobs.filter((job) => job.status === 'queued').length
  const processingCount = jobs.filter((job) => job.status === 'processing').length
  const completedCount = jobs.filter((job) => job.status === 'completed').length
  const failedCount = jobs.filter(isFailedQueueJob).length
  const queueTitle = queueView === 'pending'
    ? (isRo ? 'În așteptarea verificării' : 'Pending review')
    : queueView === 'reviewed'
      ? (isRo ? 'Documente verificate' : 'Reviewed documents')
      : (isRo ? 'Documente eșuate' : 'Failed documents')
  const emptyQueueName = queueView === 'pending'
    ? (isRo ? 'în așteptare' : 'pending')
    : queueView === 'reviewed'
      ? (isRo ? 'verificate' : 'reviewed')
      : (isRo ? 'eșuate' : 'failed')
  const normalizedSearch = jobSearch.trim().toLocaleLowerCase()
  const filteredJobs = normalizedSearch ? jobs.filter((job) => {
    const liveData = job.id === selectedId ? draft : null
    return [
      liveData?.route ?? job.summary?.route,
      liveData?.date ?? job.summary?.date,
      displayDate(liveData?.date ?? job.summary?.date ?? null),
      liveData?.driverName ?? job.summary?.driverName,
      liveData?.vehicleRegistration ?? job.summary?.vehicleRegistration,
      job.sourceFile,
    ].some((value) => String(value ?? '').toLocaleLowerCase().includes(normalizedSearch))
  }) : jobs
  const pageCount = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE))
  const visibleJobs = filteredJobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE)
  const emptyCenterCount = draft?.rows.filter((row) => !row.collectionCenter?.trim()).length ?? 0
  const rowLitersTotal = draft?.rows.reduce((total, row) => total + (typeof row.liters === 'number' && Number.isFinite(row.liters) ? row.liters : 0), 0) ?? 0
  const documentLitersTotal = typeof draft?.totalLiters === 'number' && Number.isFinite(draft.totalLiters) ? draft.totalLiters : null
  const litersDifference = documentLitersTotal == null ? null : rowLitersTotal - documentLitersTotal
  const litersMatch = litersDifference != null && Math.abs(litersDifference) < 0.01
  const formatLiters = (value: number) => new Intl.NumberFormat(language === 'ro' ? 'ro-RO' : 'en-GB', { maximumFractionDigits: 2 }).format(value)

  function rowSource(rowNumber: number, field: keyof RowValueSourceEntry['fields'], value: string | number | null) {
    const source = selected?.rowValueSources?.find((item) => item.rowNumber === rowNumber)?.fields[field]
    if (source?.source === 'not_found') return value === null || value === '' ? source : null
    return source && String(source.value) === String(value ?? '') ? source : null
  }

  function rowSourceLabel(source: RowValueSource) {
    if (source.source === 'current_invoice') return isRo ? `Din rândul ${source.sourceRowNumber} al documentului` : `From document row ${source.sourceRowNumber}`
    if (source.source === 'previous_day') return isRo ? `Din ziua precedentă: ${displayDate(source.sourceDate ?? null)}` : `From previous day: ${displayDate(source.sourceDate ?? null)}`
    if (source.source === 'not_found') return isRo ? `Nicio valoare înainte de ${displayDate(source.sourceDate ?? null)}` : `No fallback before ${displayDate(source.sourceDate ?? null)}`
    return isRo ? 'Generat din data documentului' : 'Generated from document date'
  }

  function centerNameNeedsReview(row: ExtractedRow, match?: CenterMatch) {
    const value = row.collectionCenter ?? ''
    const normalizedValue = normalizeReferenceName(value)
    if (normalizedValue.length < 2) return false
    const selectedIsExact =
      Boolean(match?.selectedName) &&
      normalizeReferenceName(match?.selectedName ?? '') === normalizedValue
    const suggestionIsExact = Boolean(
      match?.suggestions.some(
        (suggestion) => normalizeReferenceName(suggestion.name) === normalizedValue,
      ),
    )
    return !selectedIsExact && !suggestionIsExact && (!match || match.status === 'suggested' || match.status === 'unmatched')
  }

  function jobListSummary(job: OcrJob) {
    const values = job.id === selectedId && draft ? draft : job.summary
    const route = values?.route?.trim() || (isRo ? 'Rută necunoscută' : 'Unknown route')
    const date = displayDate(values?.date ?? null) || (isRo ? 'Dată necunoscută' : 'Unknown date')
    const driver = values?.driverName?.trim()
    const vehicle = values?.vehicleRegistration?.trim()
    return { route, date, driver, vehicle }
  }

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  useEffect(() => setPage(1), [jobSearch])

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => setSuccess(''), 6000)
    return () => window.clearTimeout(timer)
  }, [success])

  return (
    <div className="review-screen">
      <header className="review-header">
        <div><h1>{isRo ? 'Verificare rute zilnice' : 'Daily Routes Review'} <small>v{APP_VERSION}</small></h1><p>{isRo ? 'Verificarea documentelor de colectare zilnică' : 'Daily milk collection document verification'}</p></div>
        <div className="review-header-actions">
          <button type="button" onClick={() => { window.location.href = appPath('/ocr/upload') }}>{isRo ? 'Încărcare' : 'Upload'}</button>
          <button type="button" onClick={() => { window.location.href = appPath('/ocr/monthly-review') }}>{isRo ? 'Decont lunar' : 'Monthly Review'}</button>
          <button type="button" onClick={() => { window.location.href = appPath('/ocr/compare') }}>{isRo ? 'Comparare OCR' : 'OCR Compare'}</button>
          <button type="button" onClick={() => { window.location.href = appPath('/ocr/settings?from=review') }}>{isRo ? 'Setări OCR' : 'OCR settings'}</button>
          <button type="button" onClick={() => void loadJobs()}>{isRo ? 'Actualizați coada' : 'Refresh queue'}</button>
          <OcrLanguageSwitch language={language} onChange={setLanguage} />
        </div>
      </header>

      {error && <div className="review-global-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label={isRo ? 'Închideți eroarea' : 'Dismiss error'}>×</button></div>}
      {success && <div className="review-global-success" role="status"><span>{success}</span><button type="button" onClick={() => setSuccess('')} aria-label={isRo ? 'Închideți notificarea' : 'Dismiss notification'}>×</button></div>}
      {excelNotice && (
        <div className={`review-excel-notice ${excelNotice.type}`} role={excelNotice.type === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span aria-hidden="true">{excelNotice.type === 'working' ? '↻' : excelNotice.type === 'success' ? '✓' : '!'}</span>
          <strong>{excelNotice.message}</strong>
          <button type="button" onClick={() => setExcelNotice(null)} aria-label={isRo ? 'Închideți notificarea' : 'Dismiss notification'}>×</button>
          {excelNotice.progress && <div className="review-excel-progress">
            <div className="review-excel-progress-bar"><span style={{ width: `${excelNotice.progress.progress?.total ? Math.round((excelNotice.progress.progress.current / excelNotice.progress.progress.total) * 100) : 5}%` }} /></div>
            <div className="review-excel-row-log">{excelNotice.progress.rowLog?.map((row) => <span key={row.rowNumber}><b>{row.status === 'sent' ? '✓' : '•'} {isRo ? 'Rând' : 'Row'} {row.rowNumber}</b><small>{row.center}</small><em>{row.status === 'sent' ? (isRo ? 'Trimis' : 'Sent') : (isRo ? 'Pregătit' : 'Ready')}</em></span>)}</div>
          </div>}
        </div>
      )}

      <main className={`review-layout ${queueCollapsed ? 'queue-collapsed' : ''}`}>
        <aside className="review-queue">
          <button className="review-queue-toggle" type="button" onClick={() => setQueueCollapsed((current) => !current)} title={queueCollapsed ? (isRo ? 'Extindeți lista documentelor' : 'Expand document list') : (isRo ? 'Restrângeți lista documentelor' : 'Collapse document list')} aria-label={queueCollapsed ? (isRo ? 'Extindeți lista documentelor' : 'Expand document list') : (isRo ? 'Restrângeți lista documentelor' : 'Collapse document list')} aria-expanded={!queueCollapsed}>
            <span aria-hidden="true">{queueCollapsed ? '›' : '‹'}</span>
            {!queueCollapsed && <b>{isRo ? 'Restrângeți' : 'Collapse'}</b>}
          </button>
          <div className="review-queue-content">
          <div className="review-queue-tabs">
            <button className={queueView === 'pending' ? 'active' : ''} type="button" onClick={() => setQueueView('pending')}>{isRo ? 'În așteptare' : 'Pending'}</button>
            <button className={queueView === 'reviewed' ? 'active' : ''} type="button" onClick={() => setQueueView('reviewed')}>{isRo ? 'Verificate' : 'Reviewed'}</button>
            <button className={queueView === 'failed' ? 'active' : ''} type="button" onClick={() => setQueueView('failed')}>{isRo ? 'Eșuate' : 'Failed'}</button>
          </div>
          <label className="review-job-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder={isRo ? 'Căutați rută, dată, șofer…' : 'Search route, date, driver…'} aria-label={isRo ? 'Căutați documente' : 'Search documents'} />
            {jobSearch && <button type="button" onClick={() => setJobSearch('')} aria-label={isRo ? 'Ștergeți căutarea' : 'Clear search'}>×</button>}
          </label>
          <div className="review-queue-title"><h2>{queueTitle}</h2><span>{filteredJobs.length}</span></div>
          {queueView === 'pending' ? (
            <div className="review-queue-stats" aria-live="polite">
              <div className="queued"><strong>{queuedCount}</strong><span>{isRo ? 'În coadă' : 'Queued'}</span></div>
              <div className={processingCount > 0 ? 'processing active' : 'processing'}><strong>{processingCount}</strong><span>{processingCount > 0 && <i aria-hidden="true" />}{isRo ? 'Procesare' : 'Processing'}</span></div>
              <div className="complete"><strong>{completedCount}</strong><span>{isRo ? 'OCR finalizat' : 'OCR complete'}</span></div>
            </div>
          ) : queueView === 'failed' ? (
            <div className="review-failed-count"><strong>{failedCount}</strong> {isRo ? 'documente eșuate OCR sau Excel' : 'failed OCR or Excel documents'}</div>
          ) : (
            <div className="review-reviewed-count"><strong>{completedCount}</strong> {isRo ? 'documente verificate' : 'reviewed documents'}</div>
          )}

          {filteredJobs.length === 0 ? <p className="review-empty">{jobSearch ? (isRo ? 'Niciun document nu corespunde căutării.' : 'No documents match your search.') : (isRo ? 'Nu există documente în această listă.' : `No ${emptyQueueName} documents.`)}</p> : (
            <div className="review-job-list">
              {visibleJobs.map((job) => (
                <article className={`review-job-item ${selectedId === job.id ? 'selected' : ''} status-${job.status}`} key={job.id}>
                <button className="review-job-open" type="button" onClick={() => void openJob(job)} disabled={loadingId === job.id || deletingId === job.id}>
                  {(() => {
                    const summary = jobListSummary(job)
                    return <>
                      <span className="review-job-title"><strong>{`${summary.route} · ${summary.date}`}</strong>{job.attention?.needsAttention && <b title="OCR values need verification">!</b>}</span>
                      {(summary.driver || summary.vehicle) && (
                        <span className="review-job-meta">
                          {summary.driver && <em><b>{isRo ? 'Șofer' : 'Driver'}</b><span>{summary.driver}</span></em>}
                          {summary.vehicle && <em><b>{isRo ? 'Camion' : 'Truck'}</b><span>{summary.vehicle}</span></em>}
                        </span>
                      )}
                    </>
                  })()}
                  <span className="review-job-status"><i aria-hidden="true" />{loadingId === job.id ? (isRo ? 'Se deschide…' : 'Opening…') : statusLabel(job, language)}</span>
                  {job.attention?.needsAttention && <span className="review-attention-text">{isRo ? 'Necesită verificare' : 'Needs verification'}</span>}
                  {job.openai?.model && <span className="review-job-model">OCR: {job.openai.provider || 'openai'} · {job.openai.model}{formatOcrDuration(job) ? ` · ${formatOcrDuration(job)}` : ''}</span>}
                  {formatCost(job) && <span className="review-job-cost">OpenAI est. {formatCost(job)}</span>}
                  {job.excelExport?.status && job.excelExport.status !== 'not_ready' && <span className={`review-excel-status excel-${job.excelExport.status}`}>Excel: {job.excelExport.status}</span>}
                  <small>{new Date(job.createdAt).toLocaleString()}</small>
                </button>
                {job.status === 'failed' && (
                  <button className="review-job-reprocess" type="button" onClick={() => void reprocessDocument(job)} disabled={Boolean(reprocessingId) || deletingId === job.id}>
                    {reprocessingId === job.id ? (isRo ? 'Se adaugă în coadă…' : 'Queuing…') : (isRo ? 'Refaceți OCR' : 'Redo OCR')}
                  </button>
                )}
                <button className="review-job-delete" type="button" onClick={() => void deleteDocument(job)} disabled={deletingId === job.id} title={isRo ? 'Șterge documentul și procesul' : 'Delete document and process'} aria-label={isRo ? `Șterge ${job.sourceFile}` : `Delete ${job.sourceFile}`}>{deletingId === job.id ? '…' : '×'}</button>
                </article>
              ))}
            </div>
          )}
          {filteredJobs.length > JOBS_PER_PAGE && (
            <nav className="review-pagination" aria-label="Document pages">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>{isRo ? 'Înapoi' : 'Previous'}</button>
              <span>{isRo ? 'Pagina' : 'Page'} {page} {isRo ? 'din' : 'of'} {pageCount}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>{isRo ? 'Înainte' : 'Next'}</button>
            </nav>
          )}
          </div>
        </aside>

        <section className="review-workspace" style={{ '--source-panel': `${panelSplit}fr`, '--data-panel': `${100 - panelSplit}fr` } as CSSProperties}>
          {loadingId ? (
            <div className="review-placeholder review-loading" role="status"><span className="review-spinner" aria-hidden="true" /><strong>{isRo ? 'Se deschide documentul…' : 'Opening document…'}</strong><span>{isRo ? 'Se încarcă datele extrase și documentul sursă.' : 'Loading the extracted fields and source preview.'}</span></div>
          ) : selectedSummary && selectedSummary.status !== 'completed' ? (
            <div className="review-placeholder"><strong>{statusLabel(selectedSummary, language)}</strong><span>{isRo ? 'Documentul nu este încă pregătit. Coada se actualizează automat.' : 'This document is not ready for review yet. The queue refreshes automatically.'}</span></div>
          ) : !selected || !draft ? (
            <div className="review-placeholder"><strong>{isRo ? 'Selectați un document' : 'Select a document'}</strong><span>{isRo ? 'Alegeți un document finalizat pentru verificare sau editare.' : 'Choose a completed document to review or edit its saved data.'}</span></div>
          ) : (
            <>
              <div className="review-source-panel">
                <div className="review-panel-heading review-source-heading">
                  <div><h2>{isRo ? 'Document sursă' : 'Source document'}</h2><span>{selected.sourceFile}</span></div>
                  <div className="review-zoom-controls" aria-label="Document zoom controls">
                    <button type="button" onClick={() => setZoom((current) => Math.max(50, current - 25))} aria-label="Zoom out">−</button>
                    <span>{zoom}%</span>
                    <button type="button" onClick={() => setZoom((current) => Math.min(250, current + 25))} aria-label="Zoom in">+</button>
                    <button type="button" onClick={() => setZoom(100)}>{isRo ? 'Potrivire' : 'Fit'}</button>
                  </div>
                </div>
                {selected.mimeType === 'application/pdf' ? <iframe key={`${selected.id}-${zoom}`} src={`${selected.fileUrl}#zoom=${zoom}`} title={`Source document ${selected.sourceFile}`} /> : <div className="review-image-wrap"><img style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none' }} src={selected.fileUrl} alt={`Source document ${selected.sourceFile}`} /></div>}
              </div>

              <div className="review-panel-splitter" role="separator" aria-orientation="vertical" aria-label={isRo ? 'Redimensionați panourile documentului' : 'Resize document panels'} aria-valuemin={28} aria-valuemax={72} aria-valuenow={Math.round(panelSplit)} title={isRo ? 'Trageți pentru a ajusta lățimea' : 'Drag to adjust width'} onPointerDown={startPanelResize}>
                <span aria-hidden="true">•••</span>
              </div>

              <div className="review-data-panel">
                <div className="review-panel-heading review-data-heading">
                  <div className="review-data-title"><h2>{isRo ? 'Date recunoscute' : 'Recognised data'}</h2><span>{isRo ? 'Editați câmpurile și salvați-le pe server' : 'Edit fields and save them to the server'}</span><button className={`review-fit-columns ${columnsFit ? 'active' : ''}`} type="button" onClick={toggleColumnsFit} title={columnsFit ? (isRo ? 'Restabiliți aspectul anterior' : 'Restore previous layout') : (isRo ? 'Afișați toate coloanele' : 'Fit all columns')} aria-pressed={columnsFit}><span aria-hidden="true">↔</span>{columnsFit ? (isRo ? 'Restabiliți' : 'Restore') : (isRo ? 'Potriviți coloanele' : 'Fit columns')}</button></div>
                  <div className="review-heading-badges">
                    {formatOcrDuration(selected) && <b className="review-ocr-time-badge">{isRo ? 'Durată OCR' : 'OCR time'}: {formatOcrDuration(selected)}</b>}
                    <b className={`review-autosave-status status-${autoSaveStatus}`}>{autoSaveStatus === 'saving' ? (isRo ? 'Se salvează…' : 'Saving…') : autoSaveStatus === 'error' ? (isRo ? 'Salvare eșuată' : 'Save failed') : autoSaveStatus === 'saved' ? (isRo ? 'Salvat automat' : 'Autosaved') : (isRo ? 'Salvare automată' : 'Autosave on')}</b>
                    {selected.reviewStatus === 'reviewed' ? <b className="reviewed-badge">{isRo ? 'Verificat' : 'Reviewed'}</b> : selected.attention?.needsAttention ? <b className="attention-badge">! {isRo ? 'Necesită verificare' : 'Needs verification'}</b> : <b className="clear-badge">{isRo ? 'Fără avertizări OCR' : 'No OCR warnings'}</b>}
                  </div>
                </div>

                {selected.reviewStatus === 'reviewed' && (
                  <div className={`review-excel-export review-excel-export-top excel-${selected.excelExport?.status || 'not_ready'}`}>
                    <div>
                      <strong>Excel Online</strong>
                      <span>{selected.excelExport?.status === 'exported'
                        ? `${selected.excelExport.rowCount} ${isRo ? 'rânduri adăugate în' : 'rows added to'} Daily_Routes.`
                        : selected.excelExport?.status === 'queued' || selected.excelExport?.status === 'exporting'
                          ? (isRo ? 'Exportul rulează în fundal pe server.' : 'Export is running in the server background.')
                          : selected.excelExport?.error || (isRo ? 'Documentul verificat nu a fost încă exportat.' : 'This reviewed document has not been exported yet.')}</span>
                    </div>
                    {(selected.excelExport?.status === 'failed' || !selected.excelExport || selected.excelExport.status === 'not_ready') && <button type="button" onClick={() => void retryExcelExport()} disabled={exporting}>{exporting ? (isRo ? 'Se adaugă în coadă…' : 'Queuing…') : (isRo ? 'Exportați în Excel' : 'Export to Excel')}</button>}
                  </div>
                )}

                <div className="review-data-tabs" role="tablist" aria-label={isRo ? 'Secțiuni date' : 'Data sections'}>
                  <button className={dataTab === 'document' ? 'active' : ''} type="button" role="tab" aria-selected={dataTab === 'document'} onClick={() => setDataTab('document')}>{isRo ? 'Antet document' : 'Document details'}</button>
                  <button className={dataTab === 'centers' ? 'active' : ''} type="button" role="tab" aria-selected={dataTab === 'centers'} onClick={() => setDataTab('centers')}>
                    {isRo ? 'Centre colectare' : 'Collection centers'}
                    <span>{draft.rows.length}</span>
                    {emptyCenterCount > 0 && <b title={isRo ? 'Descrieri de centre goale' : 'Empty center descriptions'}>{emptyCenterCount}</b>}
                  </button>
                </div>

                {dataTab === 'document' ? (<div className="review-tab-content review-document-tab">

                <div className="review-fields">
                  <label>{isRo ? 'Companie' : 'Company'}<input value={draft.companyName ?? ''} onChange={(event) => updateTextField('companyName', event.target.value)} /></label>
                  <label>{isRo ? 'Data' : 'Date'}<span className="review-date-input"><input inputMode="numeric" placeholder="dd/MM/yyyy" value={displayDate(draft.date)} onChange={(event) => updateTextField('date', storedDate(event.target.value))} /><input className="review-date-picker" type="date" value={/^\d{4}-\d{2}-\d{2}$/u.test(draft.date ?? '') ? draft.date! : ''} onChange={(event) => updateTextField('date', event.target.value)} aria-label={isRo ? 'Alegeți data din calendar' : 'Choose date from calendar'} /></span></label>
                  <label>
                    <span className="review-field-label">{isRo ? 'Șofer' : 'Driver'}
                      {selected.driverMatch?.status === 'auto_replaced' && draft.driverName === selected.driverMatch.selectedName && <b className="review-driver-replaced">{isRo ? 'Înlocuit din Excel' : 'Replaced from Excel'}</b>}
                      {selected.driverMatch?.status === 'unmatched' && <b className="review-reference-unmatched">{isRo ? 'Nicio potrivire Excel' : 'No Excel match'}</b>}
                      {selected.driverMatchError && <b className="review-reference-error">{isRo ? 'Căutare Excel eșuată' : 'Excel lookup failed'}</b>}
                    </span>
                    <input list="ocr-driver-options" autoComplete="off" value={draft.driverName ?? ''} onChange={(event) => updateTextField('driverName', event.target.value)} />
                    <datalist id="ocr-driver-options">{driverOptions.map((driver) => <option value={driver} key={driver} />)}</datalist>
                  </label>
                  <label>
                    <span className="review-field-label">{isRo ? 'Vehicul' : 'Vehicle'}
                      {selected.vehicleMatch?.status === 'auto_replaced' && draft.vehicleRegistration === selected.vehicleMatch.selectedValue && <b className="review-driver-replaced">{isRo ? 'Înlocuit din Excel' : 'Replaced from Excel'}</b>}
                      {selected.vehicleMatch?.status === 'unmatched' && <b className="review-reference-unmatched">{isRo ? 'Nicio potrivire Excel' : 'No Excel match'}</b>}
                      {selected.vehicleMatchError && <b className="review-reference-error">{isRo ? 'Căutare Excel eșuată' : 'Excel lookup failed'}</b>}
                    </span>
                    <input list="ocr-vehicle-options" autoComplete="off" value={draft.vehicleRegistration ?? ''} onChange={(event) => updateTextField('vehicleRegistration', event.target.value)} />
                    <datalist id="ocr-vehicle-options">{vehicleOptions.map((vehicle) => <option value={vehicle} key={vehicle} />)}</datalist>
                  </label>
                  <label>
                    <span className="review-field-label">{isRo ? 'Rută' : 'Route'}
                      {selected.routeMatch?.status === 'resolved' && draft.route === selected.routeMatch.selectedRoute && <b className="review-driver-replaced">{isRo ? 'Obținută din Excel' : 'Retrieved from Excel'}</b>}
                      {selected.routeMatch?.status === 'unmatched' && <b className="review-reference-unmatched">{isRo ? 'Nicio potrivire Excel' : 'No Excel match'}</b>}
                      {selected.routeMatchError && <b className="review-reference-error">{isRo ? 'Căutare Excel eșuată' : 'Excel lookup failed'}</b>}
                    </span>
                    <input value={draft.route ?? ''} onChange={(event) => updateTextField('route', event.target.value)} />
                  </label>
                  <label>{isRo ? 'Total litri' : 'Total liters'}<input inputMode="decimal" value={draft.totalLiters ?? ''} onChange={(event) => updateTotalLiters(event.target.value)} /></label>
                </div>

                <div className="review-openai-usage">
                  <strong>{isRo ? 'Utilizare OCR' : 'OCR usage'}</strong>
                  {selected.openai?.usage && selected.openai.cost ? (
                    <span>
                      {isRo ? 'Estimat' : 'Estimated'} {formatCost(selected)} · {selected.openai.usage.inputTokens.toLocaleString()} input · {selected.openai.usage.outputTokens.toLocaleString()} output · {selected.openai.usage.totalTokens.toLocaleString()} total · {selected.openai.model}
                    </span>
                  ) : (
                    <span>{isRo ? 'Nu a fost înregistrat pentru acest document. Costul este urmărit pentru documentele procesate recent.' : 'Not recorded for this document. Cost tracking applies to newly processed documents.'}</span>
                  )}
                </div>

                {draft.warnings.length > 0 && <div className="review-warnings"><strong>{isRo ? 'Elemente de verificat' : 'Items to verify'}</strong><ul>{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}

                <details className="review-transcription"><summary>{isRo ? 'Transcriere brută' : 'Raw transcription'}</summary><textarea value={draft.rawTranscription} onChange={(event) => setDraft((current) => current ? { ...current, rawTranscription: event.target.value } : current)} /></details>
                </div>) : (<div className="review-tab-content review-centers-tab">

                {selected.centerMatchError && <p className="review-center-error">{selected.centerMatchError}</p>}

                <div className={`review-liters-summary ${documentLitersTotal == null ? 'unknown' : litersMatch ? 'matches' : 'mismatch'}`} aria-live="polite">
                  <div><span>{isRo ? 'Total rânduri' : 'Rows total'}</span><strong>{formatLiters(rowLitersTotal)} L</strong></div>
                  <div><span>{isRo ? 'Total OCR document' : 'Document OCR total'}</span><strong>{documentLitersTotal == null ? (isRo ? 'Nedetectat' : 'Not detected') : `${formatLiters(documentLitersTotal)} L`}</strong></div>
                  <b>{documentLitersTotal == null
                    ? (isRo ? '! Fără total OCR pentru comparație' : '! No OCR total to compare')
                    : litersMatch
                      ? (isRo ? '✓ Totalurile corespund' : '✓ Totals match')
                      : `${isRo ? '!' : '!'} ${isRo ? 'Diferență' : 'Difference'}: ${litersDifference! > 0 ? '+' : ''}${formatLiters(litersDifference!)} L`}</b>
                </div>

                <div className="review-table-wrap">
                  <table>
                    <colgroup><col className="col-row" /><col className="col-center" /><col className="col-liters" /><col className="col-fat" /><col className="col-ug" /><col className="col-water" /><col className="col-temp" /><col className="col-aviz" /><col className="col-actions" /></colgroup>
                    <thead><tr><th>#</th><th>{isRo ? 'Centru' : 'Center'}</th><th>{isRo ? 'Litri' : 'Liters'}</th><th>{isRo ? 'Grăsime %' : 'Fat %'}</th><th>U.G.</th><th>{isRo ? 'Apă' : 'Water'}</th><th>Temp.</th><th>Aviz</th><th>{isRo ? 'Acțiuni' : 'Actions'}</th></tr></thead>
                    <tbody>{draft.rows.map((row, index) => (
                      <tr className={`${row.uncertainFields.length ? 'uncertain' : ''} ${!row.collectionCenter?.trim() ? 'empty-center' : ''}`} key={row.rowNumber}>
                        <td><span className="review-row-number"><span>{row.rowNumber}{!row.collectionCenter?.trim() && <b title={isRo ? 'Descriere centru goală' : 'Empty center description'}>!</b>}</span><small title={isRo ? 'Încredere OCR' : 'OCR confidence'}>{Math.round(row.confidence * 100)}%</small></span></td>
                        {(() => {
                          const match = centerMatches.find((item) => item.rowNumber === row.rowNumber)
                          const needsReview = centerNameNeedsReview(row, match)
                          return <td><div className={`review-center-cell ${needsReview ? 'review-center-unmatched' : ''}`}>
                            <input value={row.collectionCenter ?? ''} onChange={(event) => updateRowText(index, 'collectionCenter', event.target.value)} />
                            {match ? <>
                              {openCenterSuggestions !== row.rowNumber && <select value={match.selectedCode ?? ''} onChange={(event) => selectCenter(row.rowNumber, event.target.value)} aria-label={isRo ? `Centru pentru rândul ${row.rowNumber}` : `Center for row ${row.rowNumber}`}>
                                <option value="">{match.suggestions.length ? (isRo ? `Alegeți o sugestie (${match.suggestions.length})…` : `Choose a suggestion (${match.suggestions.length})…`) : (isRo ? 'Nicio potrivire găsită (0)' : 'No match found (0)')}</option>
                                {match.suggestions.map((suggestion) => <option key={suggestion.code} value={suggestion.code}>{Math.round(suggestion.score * 100)}% · {suggestion.name} · {suggestion.code}</option>)}
                              </select>}
                              {openCenterSuggestions === row.rowNumber && match.suggestions.length > 0 && (
                                <div className="review-center-suggestion-menu" role="listbox" aria-label={isRo ? `Sugestii pentru rândul ${row.rowNumber}` : `Suggestions for row ${row.rowNumber}`}>
                                  <strong>{isRo ? `${match.suggestions.length} sugestii găsite` : `${match.suggestions.length} suggestions found`}</strong>
                                  {match.suggestions.map((suggestion) => <button type="button" role="option" key={suggestion.code} onClick={() => selectCenter(row.rowNumber, suggestion.code)}><span>{Math.round(suggestion.score * 100)}%</span><b>{suggestion.name}</b><small>{suggestion.code}</small></button>)}
                                  <button className="review-center-suggestion-close" type="button" onClick={() => setOpenCenterSuggestions(null)}>{isRo ? 'Închideți' : 'Close'}</button>
                                </div>
                              )}
                              <small className={match.status === 'auto_replaced' ? 'system-replaced' : match.selectedCode ? 'confirmed' : 'neutral'}>
                                {match.status === 'auto_replaced'
                                  ? (isRo ? `Înlocuit de sistem: „${match.originalName || '—'}” → „${match.selectedName}”` : `Replaced by system: “${match.originalName || '—'}” → “${match.selectedName}”`)
                                  : match.selectedCode
                                    ? (isRo ? `Selectat de utilizator: ${match.selectedName}` : `Selected by reviewer: ${match.selectedName}`)
                                    : (isRo ? 'Descrierea OCR a fost păstrată' : 'OCR description retained')}
                              </small>
                            </> : null}
                            {needsReview && <small className="review-center-warning">{isRo ? 'Nicio potrivire în listă' : 'No match in reference list'}</small>}
                          </div></td>
                        })()}
                        <td><input inputMode="decimal" value={row.liters ?? ''} onChange={(event) => updateRowNumber(index, 'liters', event.target.value)} /></td>
                        <td><div className="review-derived-cell"><input inputMode="decimal" value={row.fatPercent ?? ''} onChange={(event) => updateRowNumber(index, 'fatPercent', event.target.value)} />{(() => { const source = rowSource(row.rowNumber, 'fatPercent', row.fatPercent); return source && <small className={`source-${source.source}`}>{rowSourceLabel(source)}</small> })()}</div></td>
                        <td><div className="review-derived-cell"><input inputMode="decimal" value={row.density ?? ''} onChange={(event) => updateRowNumber(index, 'density', event.target.value)} />{(() => { const source = rowSource(row.rowNumber, 'density', row.density); return source && <small className={`source-${source.source}`}>{rowSourceLabel(source)}</small> })()}</div></td>
                        <td><div className="review-derived-cell"><input inputMode="decimal" value={row.water ?? ''} onChange={(event) => updateRowNumber(index, 'water', event.target.value)} />{(() => { const source = rowSource(row.rowNumber, 'water', row.water); return source && <small className={`source-${source.source}`}>{rowSourceLabel(source)}</small> })()}</div></td>
                        <td><div className="review-derived-cell"><input inputMode="decimal" value={row.temperature ?? ''} onChange={(event) => updateRowNumber(index, 'temperature', event.target.value)} />{(() => { const source = rowSource(row.rowNumber, 'temperature', row.temperature); return source && <small className={`source-${source.source}`}>{rowSourceLabel(source)}</small> })()}</div></td>
                        <td><div className="review-derived-cell"><input value={row.noticeNumber ?? ''} onChange={(event) => updateRowText(index, 'noticeNumber', event.target.value)} />{(() => { const source = rowSource(row.rowNumber, 'noticeNumber', row.noticeNumber); return source && <small className={`source-${source.source}`}>{rowSourceLabel(source)}</small> })()}</div></td>
                        <td><button className="review-row-delete" type="button" onClick={() => deleteRow(row.rowNumber)} title={isRo ? `Ștergeți rândul ${row.rowNumber}` : `Delete row ${row.rowNumber}`} aria-label={isRo ? `Ștergeți rândul ${row.rowNumber}` : `Delete row ${row.rowNumber}`}>×</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                </div>)}
                <div className={`review-save-actions tab-${dataTab}`}>
                  {dataTab === 'centers' && <button className="review-match-centers" type="button" onClick={() => void findSimilarCenters()} disabled={matchingCenters}>{matchingCenters ? (isRo ? 'Se caută…' : 'Searching…') : (isRo ? 'Căutați centre similare' : 'Find similar centers')}</button>}
                  <button className="review-reprocess" type="button" onClick={() => void reprocessDocument()} disabled={saving || Boolean(reprocessingId)}>{reprocessingId === selected.id ? (isRo ? 'Se adaugă în coadă…' : 'Queuing…') : (isRo ? 'Refaceți OCR' : 'Redo OCR')}</button>
                  <button className="review-rematch" type="button" onClick={() => void rematchExcelReferences()} disabled={saving || Boolean(reprocessingId) || rematchingReferences}>{rematchingReferences ? (isRo ? 'Se potrivește…' : 'Matching…') : (isRo ? 'Refaceți potrivirea Excel' : 'Redo Excel matching')}</button>
                  {selected.reviewStatus === 'pending' && <button className="review-complete" type="button" onClick={() => void saveDocument(true)} disabled={saving || autoSaveStatus === 'saving'}>{saving ? (isRo ? 'Se salvează…' : 'Saving…') : (isRo ? 'Marcați ca verificat și trimiteți în Excel' : 'Mark as reviewed and send to Excel')}</button>}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
