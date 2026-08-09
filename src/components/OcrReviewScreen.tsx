import { useCallback, useEffect, useRef, useState } from 'react'
import './OcrReviewScreen.css'
import { OcrLanguageSwitch, useOcrLanguage, type OcrLanguage } from './OcrLanguage'

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

interface OcrJob {
  id: string
  sourceFile: string
  mimeType: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  reviewStatus: 'pending' | 'reviewed'
  createdAt: string
  completedAt: string | null
  reviewedAt?: string | null
  fileUrl: string
  attention: AttentionSummary
  data?: ExtractedData | null
  error?: string | null
  openai?: {
    responseId: string
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
  } | null
  excelExport?: {
    status: 'not_ready' | 'queued' | 'exporting' | 'exported' | 'failed'
    rowCount?: number
    workbook?: string
    table?: string
    error?: string | null
  } | null
  centerMatches?: CenterMatch[]
  centerMatchError?: string | null
}

type QueueView = 'pending' | 'reviewed'
type TextField = 'companyName' | 'date' | 'driverName' | 'vehicleRegistration' | 'route'
type RowTextField = 'collectionCenter' | 'noticeNumber'
type RowNumberField = 'liters' | 'fatPercent' | 'density' | 'water' | 'temperature'
const JOBS_PER_PAGE = 5

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

function nullableNumber(input: string) {
  if (!input.trim()) return null
  const parsed = Number(input.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function formatCost(job: OcrJob) {
  const value = job.openai?.cost?.estimatedUsd
  if (value == null) return null
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`
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
  const [saving, setSaving] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [excelNotice, setExcelNotice] = useState<{ type: 'working' | 'success' | 'error'; message: string } | null>(null)
  const [matchingCenters, setMatchingCenters] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [page, setPage] = useState(1)
  const jobCacheRef = useRef(new Map<string, OcrJob>())
  const prefetchingRef = useRef(new Set<string>())

  const fetchJobDetail = useCallback(async (id: string, bypassCache = false) => {
    const cached = jobCacheRef.current.get(id)
    if (cached && !bypassCache) return cached

    const response = await fetch(`/api/ocr/jobs/${id}`)
    const payload = await response.json() as { job?: OcrJob; error?: string }
    if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not load this document.')
    jobCacheRef.current.set(id, payload.job)
    return payload.job
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const response = await fetch(`/api/ocr/jobs?reviewStatus=${queueView}`)
      const payload = await response.json() as { jobs?: OcrJob[]; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not load OCR jobs.')
      const nextJobs = payload.jobs ?? []
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

  function updateTextField(field: TextField, input: string) {
    setDraft((current) => current ? { ...current, [field]: input.trim() ? input : null } : current)
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
    }
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
  }

  async function findSimilarCenters() {
    if (!selected || matchingCenters) return
    setMatchingCenters(true)
    setError('')
    try {
      const response = await fetch(`/api/ocr/jobs/${selected.id}/centers/match`, { method: 'POST' })
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

  async function saveDocument(markReviewed: boolean) {
    if (!selected || !draft || saving) return
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const saveResponse = await fetch(`/api/ocr/jobs/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: draft, centerMatches }),
      })
      const savePayload = await saveResponse.json() as { job?: OcrJob; error?: string }
      if (!saveResponse.ok || !savePayload.job) throw new Error(savePayload.error || 'Could not save corrected data.')

      let savedJob = savePayload.job
      if (markReviewed) {
        const reviewResponse = await fetch(`/api/ocr/jobs/${selected.id}/review`, { method: 'PATCH' })
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
      } catch {
        // A temporary polling failure should not interrupt the server-side export.
      }
    }
    setExcelNotice({
      type: 'error',
      message: isRo ? `Exportul Excel pentru „${sourceFile}” durează neobișnuit de mult. Verificați starea în fila Verificate.` : `Excel export for “${sourceFile}” is taking unusually long. Check its status under Reviewed.`,
    })
  }

  async function reprocessDocument() {
    if (!selected || reprocessing) return
    const confirmed = window.confirm(isRo ? 'Refacem OCR pentru acest document? Datele recunoscute și corecțiile salvate vor fi înlocuite.' : 'Redo OCR for this document? The current recognised data and saved corrections will be replaced when processing completes.')
    if (!confirmed) return

    setReprocessing(true)
    setError('')
    setSuccess('')
    try {
      const response = await fetch(`/api/ocr/jobs/${selected.id}/reprocess`, { method: 'POST' })
      const payload = await response.json() as { job?: OcrJob; error?: string }
      if (!response.ok || !payload.job) throw new Error(payload.error || 'Could not redo OCR for this document.')
      jobCacheRef.current.delete(selected.id)
      setSelected(null)
      setDraft(null)
      setSelectedId(payload.job.id)
      setSelectedSummary(payload.job)
      setQueueView('pending')
      setSuccess(isRo ? 'Documentul a fost pus din nou în coada OCR. Rezultatul și costul nou vor apărea automat.' : 'Document queued for OCR again. The result and new cost will appear automatically.')
    } catch (reprocessError) {
      setError((reprocessError as Error).message || 'Could not redo OCR for this document.')
    } finally {
      setReprocessing(false)
    }
  }

  async function retryExcelExport() {
    if (!selected || exporting) return
    setExporting(true)
    setError('')
    try {
      const response = await fetch(`/api/ocr/jobs/${selected.id}/excel/retry`, { method: 'POST' })
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
  const failedCount = jobs.filter((job) => job.status === 'failed').length
  const pageCount = Math.max(1, Math.ceil(jobs.length / JOBS_PER_PAGE))
  const visibleJobs = jobs.slice((page - 1) * JOBS_PER_PAGE, page * JOBS_PER_PAGE)
  const emptyCenterCount = draft?.rows.filter((row) => !row.collectionCenter?.trim()).length ?? 0

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  return (
    <div className="review-screen">
      <header className="review-header">
        <div><h1>{isRo ? 'Verificare OCR' : 'OCR Review'}</h1><p>{isRo ? 'Verificarea documentelor în back-office' : 'Back-office document verification'}</p></div>
        <OcrLanguageSwitch language={language} onChange={setLanguage} />
        <button type="button" onClick={() => void loadJobs()}>{isRo ? 'Actualizați coada' : 'Refresh queue'}</button>
      </header>

      {error && <p className="review-global-error" role="alert">{error}</p>}
      {success && <p className="review-global-success" role="status">{success}</p>}
      {excelNotice && (
        <div className={`review-excel-notice ${excelNotice.type}`} role={excelNotice.type === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span aria-hidden="true">{excelNotice.type === 'working' ? '↻' : excelNotice.type === 'success' ? '✓' : '!'}</span>
          <strong>{excelNotice.message}</strong>
          <button type="button" onClick={() => setExcelNotice(null)} aria-label={isRo ? 'Închideți notificarea' : 'Dismiss notification'}>×</button>
        </div>
      )}

      <main className="review-layout">
        <aside className="review-queue">
          <div className="review-queue-tabs">
            <button className={queueView === 'pending' ? 'active' : ''} type="button" onClick={() => setQueueView('pending')}>{isRo ? 'În așteptare' : 'Pending'}</button>
            <button className={queueView === 'reviewed' ? 'active' : ''} type="button" onClick={() => setQueueView('reviewed')}>{isRo ? 'Verificate' : 'Reviewed'}</button>
          </div>
          <div className="review-queue-title"><h2>{queueView === 'pending' ? (isRo ? 'În așteptarea verificării' : 'Pending review') : (isRo ? 'Documente verificate' : 'Reviewed documents')}</h2><span>{jobs.length}</span></div>
          {queueView === 'pending' ? (
            <div className="review-queue-stats" aria-live="polite">
              <div className="queued"><strong>{queuedCount}</strong><span>{isRo ? 'În coadă' : 'Queued'}</span></div>
              <div className="processing"><strong>{processingCount}</strong><span>{isRo ? 'Procesare' : 'Processing'}</span></div>
              <div className="complete"><strong>{completedCount}</strong><span>{isRo ? 'OCR finalizat' : 'OCR complete'}</span></div>
              {failedCount > 0 && <div className="failed"><strong>{failedCount}</strong><span>{isRo ? 'Eșuat' : 'Failed'}</span></div>}
            </div>
          ) : (
            <div className="review-reviewed-count"><strong>{completedCount}</strong> {isRo ? 'documente verificate' : 'reviewed documents'}</div>
          )}

          {jobs.length === 0 ? <p className="review-empty">{isRo ? 'Nu există documente în această listă.' : `No ${queueView} documents.`}</p> : (
            <div className="review-job-list">
              {visibleJobs.map((job) => (
                <button className={`${selectedId === job.id ? 'selected' : ''} status-${job.status}`} type="button" key={job.id} onClick={() => void openJob(job)} disabled={loadingId === job.id}>
                  <span className="review-job-title"><strong>{job.sourceFile}</strong>{job.attention?.needsAttention && <b title="OCR values need verification">!</b>}</span>
                  <span className="review-job-status"><i aria-hidden="true" />{loadingId === job.id ? (isRo ? 'Se deschide…' : 'Opening…') : statusLabel(job, language)}</span>
                  {job.attention?.needsAttention && <span className="review-attention-text">{isRo ? 'Necesită verificare' : 'Needs verification'}</span>}
                  {formatCost(job) && <span className="review-job-cost">OpenAI est. {formatCost(job)}</span>}
                  {job.excelExport?.status && job.excelExport.status !== 'not_ready' && <span className={`review-excel-status excel-${job.excelExport.status}`}>Excel: {job.excelExport.status}</span>}
                  <small>{new Date(job.createdAt).toLocaleString()}</small>
                </button>
              ))}
            </div>
          )}
          {jobs.length > JOBS_PER_PAGE && (
            <nav className="review-pagination" aria-label="Document pages">
              <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>{isRo ? 'Înapoi' : 'Previous'}</button>
              <span>{isRo ? 'Pagina' : 'Page'} {page} {isRo ? 'din' : 'of'} {pageCount}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>{isRo ? 'Înainte' : 'Next'}</button>
            </nav>
          )}
        </aside>

        <section className="review-workspace">
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

              <div className="review-data-panel">
                <div className="review-panel-heading review-data-heading">
                  <div><h2>{isRo ? 'Date recunoscute' : 'Recognised data'}</h2><span>{isRo ? 'Editați câmpurile și salvați-le pe server' : 'Edit fields and save them to the server'}</span></div>
                  {selected.reviewStatus === 'reviewed' ? <b className="reviewed-badge">{isRo ? 'Verificat' : 'Reviewed'}</b> : selected.attention?.needsAttention ? <b className="attention-badge">! {isRo ? 'Necesită verificare' : 'Needs verification'}</b> : <b className="clear-badge">{isRo ? 'Fără avertizări OCR' : 'No OCR warnings'}</b>}
                </div>

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
                  <label>{isRo ? 'Data' : 'Date'}<input type="date" value={draft.date ?? ''} onChange={(event) => updateTextField('date', event.target.value)} /></label>
                  <label>{isRo ? 'Șofer' : 'Driver'}<input value={draft.driverName ?? ''} onChange={(event) => updateTextField('driverName', event.target.value)} /></label>
                  <label>{isRo ? 'Vehicul' : 'Vehicle'}<input value={draft.vehicleRegistration ?? ''} onChange={(event) => updateTextField('vehicleRegistration', event.target.value)} /></label>
                  <label>{isRo ? 'Rută' : 'Route'}<input value={draft.route ?? ''} onChange={(event) => updateTextField('route', event.target.value)} /></label>
                  <label>{isRo ? 'Total litri' : 'Total liters'}<input inputMode="decimal" value={draft.totalLiters ?? ''} onChange={(event) => updateTotalLiters(event.target.value)} /></label>
                </div>

                <div className="review-openai-usage">
                  <strong>{isRo ? 'Utilizare OpenAI' : 'OpenAI usage'}</strong>
                  {selected.openai?.usage && selected.openai.cost ? (
                    <span>
                      {isRo ? 'Estimat' : 'Estimated'} {formatCost(selected)} USD · {selected.openai.usage.inputTokens.toLocaleString()} input · {selected.openai.usage.outputTokens.toLocaleString()} output · {selected.openai.usage.totalTokens.toLocaleString()} total · {selected.openai.model}
                    </span>
                  ) : (
                    <span>{isRo ? 'Nu a fost înregistrat pentru acest document. Costul este urmărit pentru documentele procesate recent.' : 'Not recorded for this document. Cost tracking applies to newly processed documents.'}</span>
                  )}
                </div>

                {selected.reviewStatus === 'reviewed' && (
                  <div className={`review-excel-export excel-${selected.excelExport?.status || 'not_ready'}`}>
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

                {draft.warnings.length > 0 && <div className="review-warnings"><strong>{isRo ? 'Elemente de verificat' : 'Items to verify'}</strong><ul>{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}

                <details className="review-transcription"><summary>{isRo ? 'Transcriere brută' : 'Raw transcription'}</summary><textarea value={draft.rawTranscription} onChange={(event) => setDraft((current) => current ? { ...current, rawTranscription: event.target.value } : current)} /></details>
                </div>) : (<div className="review-tab-content review-centers-tab">

                <div className="review-center-lookup">
                  <div>
                    <strong>{isRo ? 'Potrivire centre' : 'Center matching'}</strong>
                    <span>{isRo ? 'Descrierile cu potrivire de minimum 60% sunt înlocuite automat din Ref_Centers.' : 'Descriptions with a match of at least 60% are replaced automatically from Ref_Centers.'}</span>
                  </div>
                  <button type="button" onClick={() => void findSimilarCenters()} disabled={matchingCenters}>{matchingCenters ? (isRo ? 'Se caută…' : 'Searching…') : (isRo ? 'Căutați centre similare' : 'Find similar centers')}</button>
                </div>
                {selected.centerMatchError && <p className="review-center-error">{selected.centerMatchError}</p>}

                <div className="review-table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>{isRo ? 'Centru' : 'Center'}</th><th>{isRo ? 'Litri' : 'Liters'}</th><th>{isRo ? 'Grăsime %' : 'Fat %'}</th><th>U.G.</th><th>{isRo ? 'Apă' : 'Water'}</th><th>Temp.</th><th>{isRo ? 'Aviz' : 'Notice'}</th><th>{isRo ? 'Încredere' : 'Confidence'}</th></tr></thead>
                    <tbody>{draft.rows.map((row, index) => (
                      <tr className={`${row.uncertainFields.length ? 'uncertain' : ''} ${!row.collectionCenter?.trim() ? 'empty-center' : ''}`} key={row.rowNumber}>
                        <td><span className="review-row-number">{row.rowNumber}{!row.collectionCenter?.trim() && <b title={isRo ? 'Descriere centru goală' : 'Empty center description'}>!</b>}</span></td>
                        <td><div className="review-center-cell">
                          <input value={row.collectionCenter ?? ''} onChange={(event) => updateRowText(index, 'collectionCenter', event.target.value)} />
                          {(() => {
                            const match = centerMatches.find((item) => item.rowNumber === row.rowNumber)
                            return match ? <>
                              <select value={match.selectedCode ?? ''} onChange={(event) => selectCenter(row.rowNumber, event.target.value)} aria-label={isRo ? `Centru pentru rândul ${row.rowNumber}` : `Center for row ${row.rowNumber}`}>
                                <option value="">{match.suggestions.length ? (isRo ? 'Alegeți o sugestie…' : 'Choose a suggestion…') : (isRo ? 'Nicio potrivire găsită' : 'No match found')}</option>
                                {match.suggestions.map((suggestion) => <option key={suggestion.code} value={suggestion.code}>{Math.round(suggestion.score * 100)}% · {suggestion.name} · {suggestion.code}</option>)}
                              </select>
                              <small className={match.status === 'auto_replaced' ? 'system-replaced' : match.selectedCode ? 'confirmed' : 'neutral'}>
                                {match.status === 'auto_replaced'
                                  ? (isRo ? `Înlocuit de sistem: „${match.originalName || '—'}” → „${match.selectedName}”` : `Replaced by system: “${match.originalName || '—'}” → “${match.selectedName}”`)
                                  : match.selectedCode
                                    ? (isRo ? `Selectat de utilizator: ${match.selectedName}` : `Selected by reviewer: ${match.selectedName}`)
                                    : (isRo ? 'Descrierea OCR a fost păstrată' : 'OCR description retained')}
                              </small>
                            </> : null
                          })()}
                        </div></td>
                        <td><input inputMode="decimal" value={row.liters ?? ''} onChange={(event) => updateRowNumber(index, 'liters', event.target.value)} /></td>
                        <td><input inputMode="decimal" value={row.fatPercent ?? ''} onChange={(event) => updateRowNumber(index, 'fatPercent', event.target.value)} /></td>
                        <td><input inputMode="decimal" value={row.density ?? ''} onChange={(event) => updateRowNumber(index, 'density', event.target.value)} /></td>
                        <td><input inputMode="decimal" value={row.water ?? ''} onChange={(event) => updateRowNumber(index, 'water', event.target.value)} /></td>
                        <td><input inputMode="decimal" value={row.temperature ?? ''} onChange={(event) => updateRowNumber(index, 'temperature', event.target.value)} /></td>
                        <td><input value={row.noticeNumber ?? ''} onChange={(event) => updateRowText(index, 'noticeNumber', event.target.value)} /></td>
                        <td>{Math.round(row.confidence * 100)}%</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                </div>)}
                <div className="review-save-actions">
                  <button className="review-reprocess" type="button" onClick={() => void reprocessDocument()} disabled={saving || reprocessing}>{reprocessing ? (isRo ? 'Se adaugă în coadă…' : 'Queuing…') : (isRo ? 'Refaceți OCR' : 'Redo OCR')}</button>
                  {selected.reviewStatus === 'pending' && <button className="review-save-secondary" type="button" onClick={() => void saveDocument(false)} disabled={saving}>{saving ? (isRo ? 'Se salvează…' : 'Saving…') : (isRo ? 'Salvați corecțiile' : 'Save corrections')}</button>}
                  <button className="review-complete" type="button" onClick={() => void saveDocument(selected.reviewStatus === 'pending')} disabled={saving}>{saving ? (isRo ? 'Se salvează…' : 'Saving…') : selected.reviewStatus === 'pending' ? (isRo ? 'Salvați și marcați ca verificat' : 'Save and mark as reviewed') : (isRo ? 'Salvați modificările' : 'Save changes')}</button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
