import { useEffect, useMemo, useState } from 'react'
import { APP_VERSION } from '../appVersion'
import { appPath } from '../ocrPaths'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import './OcrComparisonScreen.css'
import './OcrComparisonEnhancements.css'

interface Provider { id: string; label: string; models: string[]; configured: boolean; supportsDocuments: boolean; compatibilityNote: string | null }
interface Settings { providers: Provider[] }
interface ComparisonResult { provider: string; providerLabel: string; model: string; durationMs: number; accounting?: { cost?: { estimatedUsd?: number } | null }; data: Record<string, unknown> }
interface SideState { provider: string; model: string; result: ComparisonResult | null; error: string; running: boolean; startedAt: number | null }

const emptySide: SideState = { provider: '', model: '', result: null, error: '', running: false, startedAt: null }

function formatElapsed(milliseconds: number) {
  const totalTenths = Math.max(0, Math.floor(milliseconds / 100))
  const minutes = Math.floor(totalTenths / 600)
  const seconds = ((totalTenths % 600) / 10).toFixed(1).padStart(4, '0')
  return minutes ? `${minutes}:${seconds}` : `${seconds}s`
}

function OcrRunTimer({ side, isRo }: { side: SideState; isRo: boolean }) {
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    if (!side.running) return
    setClock(Date.now())
    const timer = window.setInterval(() => setClock(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [side.running, side.startedAt])
  const elapsed = side.running && side.startedAt ? clock - side.startedAt : side.result?.durationMs
  return <div className={`compare-ocr-timer ${side.running ? 'running' : ''}`} aria-live="polite"><span>{isRo ? 'Timp OCR' : 'OCR time'}</span><strong>{elapsed === undefined ? '—' : formatElapsed(elapsed)}</strong><em>{side.running ? (isRo ? 'În desfășurare' : 'Running') : side.result ? (isRo ? 'Finalizat' : 'Completed') : (isRo ? 'Nu a fost rulat' : 'Not run')}</em></div>
}

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not detected'
  return String(value)
}

function formattedDate(value: unknown) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/u)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : valueText(value)
}

function ResultPanel({ side, isRo }: { side: SideState; isRo: boolean }) {
  if (side.running) return <div className="compare-result-empty"><span className="compare-spinner" />{isRo ? 'Modelul procesează documentul…' : 'Model is processing the document…'}</div>
  if (side.error) return <div className="compare-error"><strong>{isRo ? 'OCR eșuat' : 'OCR failed'}</strong><span>{side.error}</span></div>
  if (!side.result) return <div className="compare-result-empty">{isRo ? 'Selectați un model și rulați OCR.' : 'Select a model and run OCR.'}</div>
  const data = side.result.data as Record<string, any>
  const rows = Array.isArray(data.rows) ? data.rows : []
  const rowTotal = rows.reduce((sum: number, row: Record<string, unknown>) => sum + (typeof row.liters === 'number' ? row.liters : 0), 0)
  const documentTotal = typeof data.totalLiters === 'number' ? data.totalLiters : null
  const difference = documentTotal === null ? null : rowTotal - documentTotal
  const monthly = data.documentType === 'journal_monthly_settlement'
  const cost = side.result.accounting?.cost?.estimatedUsd
  return <div className="compare-result">
    <div className="compare-metrics"><span>{side.result.providerLabel}</span><span>{side.result.model}</span><span>{(side.result.durationMs / 1000).toFixed(1)}s</span><span>{cost == null ? (isRo ? 'Cost necunoscut' : 'Cost unavailable') : `€${(cost * Number(import.meta.env.VITE_USD_TO_EUR_RATE || .92)).toFixed(4)}`}</span></div>
    <div className="compare-fields">
      {monthly ? <>
        <label>{isRo ? 'Aspect' : 'Layout'}<b>{valueText(data.layoutType)}</b></label>
        <label>{isRo ? 'Data' : 'Date'}<b>{formattedDate(data.date)}</b></label>
        <label>{isRo ? 'Tip lapte' : 'Milk type'}<b>{valueText(data.milkType)}</b></label>
        <label>{isRo ? 'Centru antet' : 'Header center'}<b>{valueText(data.headerCenterName)}</b></label>
      </> : <>
        <label>{isRo ? 'Companie' : 'Company'}<b>{valueText(data.companyName)}</b></label>
        <label>{isRo ? 'Data' : 'Date'}<b>{formattedDate(data.date)}</b></label>
        <label>{isRo ? 'Șofer' : 'Driver'}<b>{valueText(data.driverName)}</b></label>
        <label>{isRo ? 'Vehicul' : 'Vehicle'}<b>{valueText(data.vehicleRegistration)}</b></label>
        <label>{isRo ? 'Rută' : 'Route'}<b>{valueText(data.route)}</b></label>
      </>}
    </div>
    <div className={`compare-totals ${difference === null ? '' : Math.abs(difference) < .01 ? 'match' : 'mismatch'}`}>
      <span>{isRo ? 'Total rânduri' : 'Rows total'} <b>{rowTotal.toLocaleString()} L</b></span>
      <span>{isRo ? 'Total document' : 'Document total'} <b>{documentTotal?.toLocaleString() ?? (isRo ? 'Nedetectat' : 'Not detected')}</b></span>
      {difference !== null && <strong>{Math.abs(difference) < .01 ? (isRo ? '✓ Corespund' : '✓ Match') : `${isRo ? 'Diferență' : 'Difference'} ${difference > 0 ? '+' : ''}${difference.toLocaleString()} L`}</strong>}
    </div>
    {Array.isArray(data.warnings) && data.warnings.length > 0 && <details className="compare-warnings" open><summary>{isRo ? 'De verificat' : 'Items to verify'} ({data.warnings.length})</summary><ul>{data.warnings.map((warning: string, index: number) => <li key={index}>{warning}</li>)}</ul></details>}
    <div className="compare-table"><table><thead><tr><th>#</th><th>{monthly ? (data.layoutType === 'detailed' ? (isRo ? 'Producător' : 'Producer') : (isRo ? 'Centru' : 'Center')) : (isRo ? 'Centru' : 'Center')}</th><th>{isRo ? 'Litri' : 'Liters'}</th>{monthly ? <><th>U.G. %</th><th>G</th></> : <><th>{isRo ? 'Grăsime %' : 'Fat %'}</th><th>U.G.</th><th>{isRo ? 'Apă' : 'Water'}</th><th>{isRo ? 'Temp.' : 'Temp.'}</th><th>Aviz</th></>}</tr></thead><tbody>{rows.map((row: Record<string, any>, index: number) => <tr key={`${row.rowNumber}-${index}`}><td>{row.rowNumber}<small>{Math.round(Number(row.confidence || 0) * 100)}%</small></td><td>{valueText(monthly ? (data.layoutType === 'detailed' ? row.producer : row.centerName) : row.collectionCenter)}</td><td>{valueText(row.liters)}</td>{monthly ? <><td>{valueText(row.ugPercent)}</td><td>{valueText(row.gValue)}</td></> : <><td>{valueText(row.fatPercent)}</td><td>{valueText(row.density)}</td><td>{valueText(row.water)}</td><td>{valueText(row.temperature)}</td><td>{valueText(row.noticeNumber)}</td></>}</tr>)}</tbody></table></div>
    <details className="compare-transcription"><summary>{isRo ? 'Transcriere brută' : 'Raw transcription'}</summary><pre>{String(data.rawTranscription || '')}</pre></details>
  </div>
}

export function OcrComparisonScreen() {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [category, setCategory] = useState('')
  const [left, setLeft] = useState<SideState>(emptySide)
  const [right, setRight] = useState<SideState>(emptySide)
  const [zoom, setZoom] = useState(100)
  const providers = useMemo(() => settings?.providers.filter((provider) => provider.configured) || [], [settings])

  useEffect(() => { void fetch(appPath('/api/ocr/settings')).then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not load models.'); setSettings(payload.settings) }).catch(error => setLeft(current => ({ ...current, error: error.message }))) }, [])
  useEffect(() => { if (!file) return setPreviewUrl(''); const url = URL.createObjectURL(file); setPreviewUrl(url); return () => URL.revokeObjectURL(url) }, [file])
  useEffect(() => {
    if (!providers.length || left.provider) return
    const first = providers.find(provider => provider.id === 'openai') || providers[0]
    const second = providers.find(provider => provider.id === 'kimi') || providers.find(provider => provider.id !== first.id) || first
    setLeft({ ...emptySide, provider: first.id, model: first.models[0] })
    setRight({ ...emptySide, provider: second.id, model: second.models[0] })
  }, [providers, left.provider])

  function selectProvider(which: 'left'|'right', providerId: string) {
    const provider = providers.find(item => item.id === providerId)
    const update = { ...emptySide, provider: providerId, model: provider?.models[0] || '' }
    which === 'left' ? setLeft(update) : setRight(update)
  }

  async function run(which: 'left'|'right') {
    const side = which === 'left' ? left : right
    const setter = which === 'left' ? setLeft : setRight
    if (!file || !category || !side.provider || !side.model || side.running) return
    setter(current => ({ ...current, running: true, startedAt: Date.now(), result: null, error: '' }))
    try {
      const form = new FormData(); form.append('document', file); form.append('documentCategory', category); form.append('provider', side.provider); form.append('model', side.model)
      const response = await fetch(appPath('/api/ocr/compare'), { method: 'POST', body: form })
      const payload = await response.json() as { result?: ComparisonResult; error?: string }
      if (!response.ok || !payload.result) throw new Error(payload.error || 'Comparison OCR failed.')
      setter(current => ({ ...current, running: false, startedAt: null, result: payload.result!, error: '' }))
    } catch (error) { setter(current => ({ ...current, running: false, startedAt: null, result: null, error: (error as Error).message })) }
  }

  function ModelControls({ which, side }: { which: 'left'|'right'; side: SideState }) {
    const provider = providers.find(item => item.id === side.provider)
    const setter = which === 'left' ? setLeft : setRight
    return <><div className="compare-model-controls"><select aria-label={`${which} provider`} value={side.provider} onChange={event => selectProvider(which, event.target.value)}>{providers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select aria-label={`${which} model`} value={side.model} onChange={event => setter(current => ({ ...current, model: event.target.value, result: null, error: '' }))}>{provider?.models.map(model => <option key={model} value={model}>{model}</option>)}</select><button type="button" disabled={!file || !category || side.running} onClick={() => void run(which)}>{side.running ? (isRo ? 'Se execută…' : 'Running…') : (isRo ? 'Rulează modelul' : 'Run model')}</button></div><OcrRunTimer side={side} isRo={isRo}/></>
  }

  return <div className="ocr-compare-screen"><header><div><h1>{isRo ? 'Comparare modele OCR' : 'OCR Model Comparison'} <small>v{APP_VERSION}</small></h1><p>{isRo ? 'Rulați același document cu două modele și comparați rezultatele' : 'Run the same document through two models and compare their results'}</p></div><nav><button onClick={() => { window.location.href = appPath('/ocr/review') }}>{isRo ? 'Rute zilnice' : 'Daily Routes'}</button><button onClick={() => { window.location.href = appPath('/ocr/monthly-review') }}>{isRo ? 'Decont lunar' : 'Monthly Review'}</button><button onClick={() => { window.location.href = appPath('/ocr/settings?from=review') }}>{isRo ? 'Setări' : 'Settings'}</button><OcrLanguageSwitch language={language} onChange={setLanguage}/></nav></header>
    <section className="compare-setup"><label>{isRo ? 'Tip document' : 'Document type'}<select value={category} onChange={event => { setCategory(event.target.value); setLeft(current => ({ ...current, result: null, error: '' })); setRight(current => ({ ...current, result: null, error: '' })) }}><option value="">{isRo ? 'Selectați…' : 'Select…'}</option><option value="daily_routes">Daily Routes</option><option value="journal_monthly_settlement">Journal Monthly Settlement</option></select></label><label className="compare-file">{file ? file.name : (isRo ? 'Selectați imagine sau PDF' : 'Choose image or PDF')}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setFile(event.target.files?.[0] || null)}/></label><button className="compare-run-both" type="button" disabled={!file || !category || (left.running && right.running)} onClick={() => { if (!left.running) void run('left'); if (!right.running) void run('right') }}>{left.running || right.running ? (isRo ? 'Rulează modelul disponibil' : 'Run available model') : (isRo ? 'Rulează ambele modele' : 'Run both models')}</button></section>
    <main className="compare-workspace"><article className="compare-side"><h2>{isRo ? 'Model stânga' : 'Left model'}</h2><ModelControls which="left" side={left}/><ResultPanel side={left} isRo={isRo}/></article><article className="compare-preview"><div className="compare-preview-header"><h2>{isRo ? 'Document sursă' : 'Source document'}</h2><div className="compare-zoom-controls"><button type="button" disabled={!previewUrl || zoom <= 50} onClick={() => setZoom(value => Math.max(50, value - 25))}>−</button><span>{zoom}%</span><button type="button" disabled={!previewUrl || zoom >= 250} onClick={() => setZoom(value => Math.min(250, value + 25))}>+</button><button type="button" disabled={!previewUrl} onClick={() => setZoom(100)}>Fit</button></div></div>{!previewUrl ? <div>{isRo ? 'Selectați un document.' : 'Select a document.'}</div> : file?.type === 'application/pdf' ? <iframe key={`${previewUrl}-${zoom}`} src={`${previewUrl}#zoom=${zoom}`}/> : <div className="compare-image-scroll"><img src={previewUrl} alt={file?.name || 'Document'} style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none' }}/></div>}</article><article className="compare-side"><h2>{isRo ? 'Model dreapta' : 'Right model'}</h2><ModelControls which="right" side={right}/><ResultPanel side={right} isRo={isRo}/></article></main>
  </div>
}
