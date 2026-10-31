import { useCanOperate } from './useCanOperate'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Maximize, Minus, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, RotateCw, Save, Trash2, Upload } from 'lucide-react'
import { BackButton } from './BackButton'
import { OcrNavigation } from './OcrNavigation'
import { useOcrLanguage } from './OcrLanguage'
import { appPath } from '../ocrPaths'
import { CmrReceptionMatch } from './CmrReceptionMatch'
import './CmrReviewScreen.css'

interface CmrData {
  documentType: 'cmr'
  supplier: string
  transport: string
  driver: string
  truckNumber: string
  kilos: number | null
  date: string
  avizNumber: string
  recipient?: string
  deliveryLocation?: string
  deliveryDate?: string
  loadingLocation?: string
  loadingDate?: string
  avizDate?: string
  issueDate?: string
  receiptDate?: string
  milkType?: string
  quantity?: number | null
  quantityUnit?: '' | 'kg' | 'L'
}
interface CmrJob {
  id: string
  sourceFile: string
  mimeType: string
  fileUrl: string
  reviewStatus: string
  updatedAt: string
  data: CmrData
  status: 'queued' | 'processing' | 'completed' | 'failed'
  error?: string | null
  openai?: { model?: string; durationMs?: number | null } | null
  cmrOcr?: { warnings: string[]; uncertainFields: string[]; verifiedFields?: string[]; confidence: number; rawTranscription: string }
}
type Draft = Omit<Required<CmrData>, 'quantity'> & { quantity: string }
function listQuantity(data: CmrData, isRo: boolean) {
  const quantity = data.quantity === undefined ? data.kilos : data.quantity
  return quantity == null ? '' : `${quantity.toLocaleString(isRo ? 'ro-RO' : 'en-GB', { maximumFractionDigits: 3 })} ${data.quantityUnit ?? 'kg'}`
}
const draftOf = (data: CmrData): Draft => ({ ...data,
  driver: data.driver || '', truckNumber: data.truckNumber || '', recipient: data.recipient || '',
  deliveryLocation: data.deliveryLocation || '', deliveryDate: data.deliveryDate || '',
  loadingLocation: data.loadingLocation || '', loadingDate: data.loadingDate || '',
  avizDate: data.avizDate || '', issueDate: data.issueDate || '', receiptDate: data.receiptDate || '', milkType: data.milkType || '',
  quantity: data.quantity === undefined ? (data.kilos == null ? '' : String(data.kilos)) : (data.quantity === null ? '' : String(data.quantity)),
  quantityUnit: data.quantityUnit ?? 'kg',
})

export function CmrReviewScreen() {
  const canOperate = useCanOperate('ocr_documents')
  const { isRo } = useOcrLanguage()
  const [jobs, setJobs] = useState<CmrJob[]>([])
  const [selected, setSelected] = useState<CmrJob | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [autosaving, setAutosaving] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('pending')
  const saveLock = useRef(false)
  const [page, setPage] = useState(0)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [imageError, setImageError] = useState(false)
  const [truckOptions, setTruckOptions] = useState<{ date: string; trucks: string[]; drivers: string[]; loading: boolean; failed: boolean }>({ date: '', trucks: [], drivers: [], loading: false, failed: false })
  const documentDate = draft?.date || ''
  const suggestedTrucks = truckOptions.date === documentDate ? truckOptions.trucks : []
  const suggestedDrivers = truckOptions.date === documentDate ? truckOptions.drivers : []
  const dirty = Boolean(selected && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(selected.data)))
  const discardMessage = isRo ? 'Renuntati la modificarile nesalvate?' : 'Discard unsaved changes?'
  const recognizing = selected?.status === 'queued' || selected?.status === 'processing'
  const requiredLabels: Partial<Record<keyof Draft, string>> = {
    date: isRo ? 'Data receptiei' : 'Reception date',
    milkType: isRo ? 'Tip lapte' : 'Milk type', quantity: isRo ? 'Cantitate' : 'Quantity', quantityUnit: isRo ? 'Unitate' : 'Unit',
    receiptDate: isRo ? 'Data receptiei marfii' : 'Goods receipt date', supplier: isRo ? 'Furnizor' : 'Supplier',
    issueDate: isRo ? 'Data emiterii CMR' : 'CMR issue date', truckNumber: isRo ? 'Numar camion' : 'Truck number', avizNumber: isRo ? 'Numar aviz' : 'Aviz number',
  }
  const missingRequired = (Object.keys(requiredLabels) as (keyof Draft)[]).filter(key => {
    const value = String(draft?.[key] ?? '').trim()
    if (!value) return true
    if (key === 'quantity') { const number = Number(value.replace(',', '.')); return !Number.isFinite(number) || number < 0 || number > 999999999 }
    if (['date', 'receiptDate', 'issueDate'].includes(key)) return !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value
    return false
  })
  const viewOf = (job: CmrJob) => job.status === 'failed' ? 'failed' : job.reviewStatus === 'reviewed' ? 'reviewed' : 'pending'
  function statusText(job: CmrJob) {
    if (job.status === 'queued') return isRo ? 'In asteptare OCR' : 'Queued'
    if (job.status === 'processing') return isRo ? 'Recunoastere...' : 'Processing...'
    if (job.status === 'failed') return isRo ? 'OCR esuat' : 'OCR failed'
    return job.reviewStatus === 'reviewed' ? (isRo ? 'Verificat' : 'Reviewed') : (isRo ? 'De verificat' : 'Ready for review')
  }

  function select(job: CmrJob | null) {
    setSelected(job); setDraft(job ? draftOf(job.data) : null)
    if (job) setStatus(viewOf(job))
    setSaved(false); setError(''); setZoom(100); setRotation(0); setImageError(false)
    const url = new URL(window.location.href)
    if (job) url.searchParams.set('id', job.id)
    else url.searchParams.delete('id')
    window.history.replaceState(null, '', url)
  }

  async function load(id?: string | null, signal?: AbortSignal) {
    setLoading(true); setError('')
    try {
      const response = await fetch(appPath('/api/ocr/cmr'), { signal })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load CMR documents.')
      if (signal?.aborted) return
      const rows: CmrJob[] = payload.jobs || []
      setJobs(rows); select(rows.find(job => job.id === id) || rows[0] || null)
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not load CMR documents.')
    } finally { if (!signal?.aborted) setLoading(false) }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(new URLSearchParams(window.location.search).get('id'), controller.signal)
    return () => controller.abort()
  }, [])

  const hasActiveJobs = jobs.some(job => ['queued', 'processing'].includes(job.status))
  useEffect(() => {
    if (!hasActiveJobs) return
    const controller = new AbortController()
    let fetching = false
    const timer = window.setInterval(async () => {
      if (fetching) return
      fetching = true
      try {
        const response = await fetch(appPath('/api/ocr/cmr'), { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not refresh OCR progress.')
        if (controller.signal.aborted) return
        setJobs(payload.jobs)
        const current = payload.jobs.find((job: CmrJob) => job.id === selected?.id)
        if (current && recognizing) {
          setSelected(current); setDraft(draftOf(current.data)); setStatus(viewOf(current))
        }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not refresh OCR progress.') }
      finally { fetching = false }
    }, 2000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [hasActiveJobs, selected?.id, recognizing])

  useEffect(() => {
    if (!dirty || saving || loading || recognizing || error || editingDate) return
    const timer = window.setTimeout(() => { void save(false, true) }, 1000)
    return () => window.clearTimeout(timer)
  }, [draft, dirty, saving, loading, recognizing, error, editingDate])

  useEffect(() => {
    if (!dirty && !saving) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving])

  useEffect(() => {
    const controller = new AbortController()
    setTruckOptions({ date: documentDate, trucks: [], drivers: [], loading: Boolean(documentDate), failed: false })
    if (documentDate) void (async () => {
      try {
        const response = await fetch(appPath(`/api/ocr/cmr/truck-options?date=${encodeURIComponent(documentDate)}`), { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok || !Array.isArray(payload.trucks) || !Array.isArray(payload.drivers)) throw new Error('Could not load reception suggestions.')
        if (!controller.signal.aborted) setTruckOptions({ date: documentDate, trucks: payload.trucks, drivers: payload.drivers, loading: false, failed: false })
      } catch {
        if (!controller.signal.aborted) setTruckOptions({ date: documentDate, trucks: [], drivers: [], loading: false, failed: true })
      }
    })()
    return () => controller.abort()
  }, [documentDate, selected?.id])

  function navigate(path: string) {
    if (!saving && (!dirty || window.confirm(discardMessage))) window.location.href = appPath(path)
  }

  async function save(markReviewed = false, automatic = false) {
    if (!canOperate) return
    if (!selected || !draft || saving || saveLock.current || recognizing) return
    if (markReviewed && missingRequired.length) return
    const quantity = draft.quantity.trim() === '' ? null : Number(draft.quantity.replace(',', '.'))
    if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) { setError(isRo ? 'Introduceti o cantitate valida.' : 'Enter a valid non-negative quantity.'); return }
    if (markReviewed && selected.cmrOcr?.warnings.length && !window.confirm(isRo ? 'Ati verificat avertizarile si campurile recunoscute?' : 'Have you checked the OCR warnings and recognized fields?')) return
    saveLock.current = true
    setAutosaving(automatic)
    setSaving(true); setError(''); setSaved(false)
    try {
      const response = await fetch(appPath(`/api/ocr/cmr/${selected.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { ...draft, quantity, kilos: draft.quantityUnit === 'kg' ? quantity : null }, updatedAt: selected.updatedAt, markReviewed }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save CMR document.')
      const job: CmrJob = payload.job
      setJobs(rows => rows.map(row => row.id === job.id ? job : row))
      setSelected(job)
      // A delayed autosave must not replace edits made after its request started.
      setDraft(current => current === draft ? draftOf(job.data) : current)
      setSaved(true)
      setStatus(viewOf(job))
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save CMR document.') }
    finally { setSaving(false); setAutosaving(false); saveLock.current = false }
  }

  async function recognize() {
    if (!canOperate) return
    if (!selected || saving || saveLock.current || recognizing) return
    if (!window.confirm(isRo ? 'Rulati OCR? Campurile si corectiile vor fi inlocuite numai dupa o recunoastere reusita. Modificarile nesalvate se pierd.' : 'Run OCR? Fields and saved corrections will be replaced only after successful recognition. Unsaved changes will be discarded.')) return
    saveLock.current = true; setSaving(true); setError('')
    try {
      const response = await fetch(appPath(`/api/ocr/cmr/${selected.id}/recognize`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: selected.updatedAt }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not start CMR recognition.')
      setJobs(rows => rows.map(row => row.id === payload.job.id ? payload.job : row))
      select(payload.job)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not start CMR recognition.') }
    finally { setSaving(false); saveLock.current = false }
  }

  async function remove() {
    if (!canOperate) return
    if (!selected || saving || recognizing || !window.confirm(isRo ? `Stergeti documentul ${selected.sourceFile}?` : `Delete ${selected.sourceFile}? This also deletes its saved fields and source file.`)) return
    setSaving(true); setError('')
    try {
      const response = await fetch(appPath(`/api/ocr/cmr/${selected.id}`), { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not delete CMR document.')
      const remaining = jobs.filter(job => job.id !== selected.id)
      setJobs(remaining); select(remaining[0] || null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete CMR document.') }
    finally { setSaving(false) }
  }

  const filtered = jobs.filter(job => viewOf(job) === status
    && [job.sourceFile, job.data.supplier, job.data.transport, job.data.driver || '', job.data.truckNumber || '', job.data.date, job.data.avizNumber].some(value => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  const currentPage = Math.min(page, pages - 1)
  function field(key: keyof Draft, value: string) { setDraft(current => current ? { ...current, [key]: value } : current); setSaved(false); setError('') }
  function verification(key: keyof Draft) {
    const uncertain = selected?.reviewStatus !== 'reviewed' && selected?.cmrOcr?.uncertainFields.includes(key)
      && !selected.cmrOcr.verifiedFields?.includes(key) && draft?.[key] === draftOf(selected.data)[key]
    const missing = missingRequired.includes(key)
    return { className: uncertain || missing ? 'cmr-uncertain' : undefined, 'aria-required': Boolean(requiredLabels[key]), 'aria-invalid': Boolean(uncertain || missing), title: missing ? (isRo ? 'Camp obligatoriu pentru verificare' : 'Required before review') : uncertain ? (isRo ? 'Verificati cu documentul original' : 'Check against the source document') : undefined }
  }

  return <div className="cmr-screen">
    <header className="cmr-header">
      <BackButton onClick={() => navigate('/ocr/upload')} aria-label={isRo ? 'Inapoi' : 'Back to upload'} />
      <OcrNavigation /><div className="cmr-header-title"><h1>{isRo ? 'Verificare CMR' : 'CMR Review'}</h1><p>{isRo ? 'Documente de transport' : 'Transport documents'}</p></div>
      <button type="button" disabled={saving} onClick={() => navigate('/ocr/upload')}><Upload size={18} />{isRo ? 'Incarcare' : 'Upload'}</button>
    </header>
    {error && <div className="cmr-error" role="alert">{error}</div>}
    <main className={`cmr-layout${listCollapsed ? ' cmr-layout-collapsed' : ''}`}>
      <aside className="cmr-list" aria-label="CMR documents">
        <div className="cmr-list-toolbar">
          <button type="button" className="cmr-list-toggle" aria-controls="cmr-document-list" aria-expanded={!listCollapsed}
            title={listCollapsed ? (isRo ? 'Arata documentele' : 'Show documents') : (isRo ? 'Restrange documentele' : 'Collapse documents')}
            aria-label={listCollapsed ? (isRo ? 'Arata documentele' : 'Show documents') : (isRo ? 'Restrange documentele' : 'Collapse documents')}
            onClick={() => setListCollapsed(value => !value)}>{listCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}{!listCollapsed && <span>{isRo ? 'Restrange' : 'Collapse'}</span>}</button>
          {!listCollapsed && <button title={isRo ? 'Reincarcare' : 'Reload documents'} aria-label="Reload documents" disabled={loading || saving} onClick={() => { if (!dirty || window.confirm(discardMessage)) void load(selected?.id) }}><RefreshCw size={18} /></button>}
        </div>
        <div id="cmr-document-list" className="cmr-list-content" hidden={listCollapsed}>
        <div className="cmr-status-tabs" role="tablist" aria-label="CMR status">{(['pending', 'reviewed', 'failed'] as const).map((value, index) => <button key={value} type="button" role="tab" aria-selected={status === value} onClick={() => { setStatus(value); setPage(0) }}>{(isRo ? ['In asteptare', 'Verificate', 'Esuate'] : ['Pending', 'Reviewed', 'Failed'])[index]}</button>)}</div>
        <div className="cmr-list-heading"><h2>{isRo ? 'Documente' : 'Documents'}</h2><b>{filtered.length}</b></div>
        <label className="cmr-search"><span>{isRo ? 'Cautare document' : 'Search documents'}</span><input type="search" aria-label="Search CMR" placeholder={isRo ? 'Furnizor, aviz, camion...' : 'Supplier, Aviz, truck...'} value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></label>
        {loading ? <p role="status">{isRo ? 'Se incarca...' : 'Loading...'}</p> : !filtered.length ? <p>{isRo ? 'Nu exista documente.' : 'No documents found.'}</p> : <div className="cmr-list-items">{filtered.slice(currentPage * 25, (currentPage + 1) * 25).map(job => <button className={selected?.id === job.id ? 'selected' : ''} aria-pressed={selected?.id === job.id} disabled={saving} key={job.id} onClick={() => { if (selected?.id !== job.id && (!dirty || window.confirm(discardMessage))) select(job) }}><strong>{job.data.supplier || job.sourceFile}{job.data.avizNumber ? ` · ${job.data.avizNumber}` : ''}</strong><span>{listQuantity(job.data, isRo)}</span>{job.openai?.model && <small className="cmr-model" title={job.openai.model}>OCR: {job.openai.model}</small>}<small>{job.data.date || '-'} · {statusText(job)}</small>{job.reviewStatus !== 'reviewed' && job.status === 'completed' && Boolean(job.cmrOcr?.warnings.length || job.cmrOcr?.uncertainFields.length) && <small className="cmr-attention">{isRo ? 'Necesita verificare' : 'Needs verification'}</small>}</button>)}</div>}
        {pages > 1 && <div className="cmr-pagination"><button aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span>{currentPage + 1} / {pages}</span><button aria-label="Next page" disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></div>}
        </div>
      </aside>
      {selected && draft ? <div className="cmr-workspace">
        <section className="cmr-source" aria-label="Source document">
          <div className="cmr-preview-toolbar">
          <div className="cmr-source-heading"><h2>{selected.sourceFile}</h2><a href={selected.fileUrl} target="_blank" rel="noopener noreferrer" title="Open original document" aria-label="Open original document"><ExternalLink size={18} /></a></div>
          {selected.mimeType !== 'application/pdf' && <div className="cmr-image-tools"><button aria-label="Zoom out" title="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(value => value - 25)}><Minus size={18} /></button><span>{zoom}%</span><button aria-label="Zoom in" title="Zoom in" disabled={zoom >= 250} onClick={() => setZoom(value => value + 25)}><Plus size={18} /></button><button aria-label="Fit image" title="Fit image" onClick={() => setZoom(100)}><Maximize size={18} /></button><button aria-label="Rotate image" title="Rotate image" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={18} /></button></div>}
          </div>
          <div className="cmr-image-viewport">
            {selected.mimeType === 'application/pdf' ? <iframe key={selected.id} src={selected.fileUrl} title="CMR source PDF" /> : imageError ? <p role="alert">{isRo ? 'Imaginea nu poate fi incarcata.' : 'Could not load the source image.'}</p> : <div className="cmr-image-stage" style={{ width: `${zoom}%` }}><img key={selected.id} src={selected.fileUrl} alt={selected.sourceFile} onError={() => setImageError(true)} style={{ transform: `rotate(${rotation}deg)` }} /></div>}
          </div>
        </section>
        <form className="cmr-fields" onSubmit={event => { event.preventDefault(); void save() }}>
          <div className="cmr-fields-heading"><div><h2>{isRo ? 'Date recunoscute' : 'Recognised data'}</h2><small>CMR</small>{selected.openai?.durationMs != null && <b className="cmr-ocr-time">{isRo ? 'Durata OCR' : 'OCR time'}: {Math.round(selected.openai.durationMs / 1000)}s</b>}</div>
            <div className="cmr-heading-actions">{canOperate && <span className={`cmr-autosave${error ? ' has-error' : ''}`} role="status">{saving ? (isRo ? 'Se salveaza...' : 'Saving...') : error ? (isRo ? 'Verificati eroarea' : 'Check error') : dirty ? (isRo ? 'Nesalvat' : 'Unsaved changes') : saved ? (isRo ? 'Salvat automat' : 'Autosaved') : (isRo ? 'Salvare automata activa' : 'Autosave on')}</span>}
              <button type="submit" disabled={!canOperate || saving || loading || recognizing}><Save size={16} />{isRo ? 'Salveaza' : 'Save changes'}</button></div>
          </div>
          <div className="cmr-fields-content">
          <div className="cmr-ocr-status" role="status"><strong className={`cmr-status-badge status-${selected.status} ${selected.reviewStatus}`}>{statusText(selected)}</strong>
            {selected.openai?.model && <small className="cmr-model" title={selected.openai.model}>OCR: {selected.openai.model}</small>}
            {selected.cmrOcr && <small>{isRo ? 'Incredere OCR estimata' : 'Estimated OCR confidence'}: {Math.round(selected.cmrOcr.confidence * 100)}%</small>}
          </div>
          {selected.status === 'failed' && <p className="cmr-error" role="alert">{selected.error || (isRo ? 'Recunoasterea a esuat.' : 'Recognition failed.')}</p>}
          {Boolean(selected.cmrOcr?.warnings.length) && <details className="cmr-warnings"><summary>{isRo ? 'De verificat' : 'Items to verify'} ({selected.cmrOcr!.warnings.length})</summary><ul>{selected.cmrOcr!.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          {selected.cmrOcr?.rawTranscription && <details className="cmr-transcription"><summary>{isRo ? 'Transcriere OCR' : 'OCR transcription'}</summary><p>{selected.cmrOcr.rawTranscription}</p></details>}
          <fieldset disabled={(saving && !autosaving) || loading || recognizing}
            onFocus={event => { if (event.target instanceof HTMLInputElement && event.target.type === 'date') setEditingDate(true) }}
            onBlur={event => { if (event.target instanceof HTMLInputElement && event.target.type === 'date') setEditingDate(false) }}>
            <label className="cmr-wide">{isRo ? 'Data receptiei' : 'Reception date'}<input disabled={!canOperate} {...verification('date')} type="date" value={draft.date} onChange={e => field('date', e.target.value)} /></label>
            <label>{isRo ? 'Furnizor (1)' : 'Supplier (1)'}<input disabled={!canOperate} {...verification('supplier')} maxLength={300} value={draft.supplier} onChange={e => field('supplier', e.target.value)} /></label>
            <label>{isRo ? 'Destinatar (2)' : 'Recipient (2)'}<input disabled={!canOperate} {...verification('recipient')} maxLength={300} value={draft.recipient} onChange={e => field('recipient', e.target.value)} /></label>
            <h3 className="cmr-field-section">{isRo ? 'Livrare prevazuta (3)' : 'Planned delivery (3)'}</h3>
            <label>{isRo ? 'Locul livrarii' : 'Delivery location'}<input disabled={!canOperate} {...verification('deliveryLocation')} maxLength={300} value={draft.deliveryLocation} onChange={e => field('deliveryLocation', e.target.value)} /></label>
            <label>{isRo ? 'Data livrarii prevazute' : 'Planned delivery date'}<input disabled={!canOperate} {...verification('deliveryDate')} type="date" value={draft.deliveryDate} onChange={e => field('deliveryDate', e.target.value)} /></label>
            <h3 className="cmr-field-section">{isRo ? 'Incarcare (4)' : 'Loading (4)'}</h3>
            <label>{isRo ? 'Locul incarcarii' : 'Loading location'}<input disabled={!canOperate} {...verification('loadingLocation')} maxLength={300} value={draft.loadingLocation} onChange={e => field('loadingLocation', e.target.value)} /></label>
            <label>{isRo ? 'Data incarcarii' : 'Loading date'}<input disabled={!canOperate} {...verification('loadingDate')} type="date" value={draft.loadingDate} onChange={e => field('loadingDate', e.target.value)} /></label>
            <h3 className="cmr-field-section">Aviz (5)</h3>
            <label>{isRo ? 'Numar aviz' : 'Aviz number'}<input disabled={!canOperate} {...verification('avizNumber')} maxLength={300} value={draft.avizNumber} onChange={e => field('avizNumber', e.target.value)} /></label>
            <label>{isRo ? 'Data avizului' : 'Aviz date'}<input disabled={!canOperate} {...verification('avizDate')} type="date" value={draft.avizDate} onChange={e => field('avizDate', e.target.value)} /></label>
            <h3 className="cmr-field-section">{isRo ? 'Transportator (17)' : 'Carrier (17)'}</h3>
            <label className="cmr-wide">{isRo ? 'Transport' : 'Transport'}<input disabled={!canOperate} {...verification('transport')} maxLength={300} value={draft.transport} onChange={e => field('transport', e.target.value)} /></label>
            <div className="cmr-input-group">
            <label>{isRo ? 'Sofer' : 'Driver'}<input disabled={!canOperate} {...verification('driver')} list="cmr-driver-options" aria-describedby="cmr-driver-status" autoComplete="off" maxLength={300} value={draft.driver} onChange={e => field('driver', e.target.value)} /></label>
            <datalist id="cmr-driver-options">{suggestedDrivers.map(driver => <option key={driver} value={driver} />)}</datalist>
            <small id="cmr-driver-status" className="cmr-truck-status" role="status">{!documentDate
              ? (isRo ? 'Data receptiei nu este selectata.' : 'No reception date selected.')
              : truckOptions.date !== documentDate || truckOptions.loading ? (isRo ? 'Se incarca soferii...' : 'Loading drivers...')
              : truckOptions.failed ? (isRo ? 'Soferii nu au putut fi incarcati.' : 'Driver suggestions could not be loaded.')
              : suggestedDrivers.length ? (isRo ? `${suggestedDrivers.length} soferi din receptii Alte pentru aceasta data.` : `${suggestedDrivers.length} drivers from Other receptions on this date.`)
              : (isRo ? 'Niciun sofer din receptii Alte pentru aceasta data.' : 'No drivers from Other receptions on this date.')}</small>
            </div>
            <div className="cmr-input-group">
            <label>{isRo ? 'Numar camion' : 'Truck number'}<input disabled={!canOperate} {...verification('truckNumber')} list="cmr-truck-options" aria-describedby="cmr-truck-status" autoComplete="off" maxLength={300} value={draft.truckNumber} onChange={e => field('truckNumber', e.target.value)} /></label>
            <datalist id="cmr-truck-options">{suggestedTrucks.map(truck => <option key={truck} value={truck} />)}</datalist>
            <small id="cmr-truck-status" className="cmr-truck-status" role="status">{!documentDate
              ? (isRo ? 'Data receptiei nu este selectata.' : 'No reception date selected.')
              : truckOptions.date !== documentDate || truckOptions.loading ? (isRo ? 'Se incarca camioanele...' : 'Loading trucks...')
              : truckOptions.failed ? (isRo ? 'Camioanele nu au putut fi incarcate.' : 'Truck suggestions could not be loaded.')
              : suggestedTrucks.length ? (isRo ? `${suggestedTrucks.length} camioane din receptii Alte pentru aceasta data.` : `${suggestedTrucks.length} trucks from Other receptions on this date.`)
              : (isRo ? 'Niciun camion din receptii Alte pentru aceasta data.' : 'No trucks from Other receptions on this date.')}</small>
            </div>
            <h3 className="cmr-field-section">{isRo ? 'Marfa si cantitate' : 'Goods and quantity'}</h3>
            <div className="cmr-quantity-fields">
            <label>{isRo ? 'Tip lapte' : 'Milk type'}<select disabled={!canOperate} {...verification('milkType')} value={draft.milkType} onChange={e => field('milkType', e.target.value)}>
              <option value="">{isRo ? 'Nespecificat' : 'Not specified'}</option>
              <option value="MILK-COW">{isRo ? 'Vaca' : 'Cow'}</option><option value="MILK-SHEEP">{isRo ? 'Oaie' : 'Sheep'}</option>
              <option value="MILK-GOAT">{isRo ? 'Capra' : 'Goat'}</option><option value="MILK-BUFF">{isRo ? 'Bivolita' : 'Buffalo'}</option>
            </select></label>
              <label>{isRo ? 'Cantitate document' : 'Document quantity'}<input disabled={!canOperate} {...verification('quantity')} inputMode="decimal" value={draft.quantity} onChange={e => field('quantity', e.target.value)} /></label>
              <label>{isRo ? 'Unitate' : 'Unit'}<select disabled={!canOperate} {...verification('quantityUnit')} value={draft.quantityUnit} onChange={e => field('quantityUnit', e.target.value)}><option value="">{isRo ? 'Alegeti' : 'Select'}</option><option value="kg">kg</option><option value="L">{isRo ? 'Litri' : 'Liters'}</option></select></label>
            </div>
            <h3 className="cmr-field-section">{isRo ? 'Emiterea si receptia CMR' : 'CMR issue and receipt'}</h3>
            <label>{isRo ? 'Data emiterii CMR (22)' : 'CMR issue date (22)'}<input disabled={!canOperate} {...verification('issueDate')} type="date" value={draft.issueDate} onChange={e => field('issueDate', e.target.value)} /></label>
            <label>{isRo ? 'Data receptiei marfii (25)' : 'Goods receipt date (25)'}<input disabled={!canOperate} {...verification('receiptDate')} type="date" value={draft.receiptDate} onChange={e => field('receiptDate', e.target.value)} /></label>
            <CmrReceptionMatch key={selected.id} id={selected.id} updatedAt={selected.updatedAt} dirty={dirty} busy={saving || recognizing} onBusy={setSaving} isRo={isRo} />
          </fieldset>
          </div>
          <div className="cmr-save">
            {selected.reviewStatus !== 'reviewed' && missingRequired.length > 0 && <small className="cmr-required-summary" role="status">{isRo ? 'Campuri obligatorii' : 'Required fields'}: {missingRequired.map(key => requiredLabels[key]).join(', ')}</small>}
            <button type="button" disabled={!canOperate || (saving || loading || recognizing)} onClick={() => void recognize()}><RefreshCw size={18} />{selected.openai || selected.cmrOcr ? (isRo ? 'Reface OCR' : 'Redo OCR') : (isRo ? 'Ruleaza OCR' : 'Run OCR')}</button>
            {selected.reviewStatus !== 'reviewed' && <>
              <button className="cmr-primary-action" type="button" disabled={!canOperate || (saving || loading || recognizing || selected.status !== 'completed' || missingRequired.length > 0)} onClick={() => void save(true)}>{isRo ? 'Marcheaza verificat' : 'Mark as reviewed'}</button>
            </>}
            <button type="button" className="cmr-delete" title={isRo ? 'Sterge document' : 'Delete document'} aria-label="Delete CMR document" disabled={!canOperate || (saving || recognizing)} onClick={() => void remove()}><Trash2 size={18} /></button>
          </div>
        </form>
      </div> : !loading && <div className="cmr-empty">{isRo ? 'Niciun document selectat' : 'No document selected'}</div>}
    </main>
  </div>
}
