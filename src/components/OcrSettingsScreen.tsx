import { useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import './OcrSettingsScreen.css'

interface Provider { id: string; label: string; models: string[]; configured: boolean; supportsDocuments: boolean; compatibilityNote: string | null; local?: boolean }
interface Settings { provider: string; model: string; updatedAt: string | null; providers: Provider[] }

export function OcrSettingsScreen() {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const selectedProvider = useMemo(() => settings?.providers.find((item) => item.id === provider), [provider, settings])
  const from = new URLSearchParams(window.location.search).get('from') === 'upload' ? 'upload' : 'review'

  useEffect(() => {
    void fetch(appPath('/api/ocr/settings')).then(async (response) => {
      const payload = await response.json() as { settings?: Settings; error?: string }
      if (!response.ok || !payload.settings) throw new Error(payload.error || 'Could not load OCR settings.')
      setSettings(payload.settings); setProvider(payload.settings.provider); setModel(payload.settings.model)
    }).catch((reason) => setError((reason as Error).message))
  }, [])

  function chooseProvider(value: string) {
    setProvider(value)
    const next = settings?.providers.find((item) => item.id === value)
    setModel(next?.models[0] || '')
    setMessage('')
  }

  async function save() {
    if (!model || saving) return
    setSaving(true); setError(''); setMessage('')
    try {
      const response = await fetch(appPath('/api/ocr/settings'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }) })
      const payload = await response.json() as { settings?: Settings; error?: string }
      if (!response.ok || !payload.settings) throw new Error(payload.error || 'Could not save OCR settings.')
      setSettings(payload.settings)
      setMessage(isRo ? 'Modelul OCR a fost salvat pe server. Documentele noi vor folosi această setare.' : 'OCR model saved on the server. New documents will use this setting.')
    } catch (reason) { setError((reason as Error).message) } finally { setSaving(false) }
  }

  return <div className="ocr-settings-screen">
    <header><button type="button" onClick={() => { window.location.href = appPath(`/ocr/${from}`) }}>←</button><div><h1>{isRo ? 'Setări OCR' : 'OCR Settings'}</h1><p>{isRo ? 'Alegeți furnizorul și modelul pentru documentele noi' : 'Choose the provider and model for new documents'}</p></div><OcrLanguageSwitch language={language} onChange={setLanguage} /></header>
    <main><section>
      <h2>{isRo ? 'Model de extragere' : 'Extraction model'}</h2>
      <p>{isRo ? 'Cheile API și adresa serviciului local rămân în variabilele de mediu ale serverului și nu sunt salvate în browser.' : 'API keys and the local service address remain in server environment variables and are never stored in the browser.'}</p>
      <div className="ocr-provider-grid">{settings?.providers.map((item) => <button className={provider === item.id ? 'active' : ''} type="button" onClick={() => chooseProvider(item.id)} key={item.id}><strong>{item.label}</strong><span className={item.configured ? 'ready' : 'missing'}>{item.configured ? (item.local ? (isRo ? 'Local · fără cost API' : 'Local · no API cost') : (isRo ? 'Configurat' : 'Configured')) : (item.local ? (isRo ? 'Lipsește URL-ul local' : 'Local URL missing') : (isRo ? 'Lipsește cheia API' : 'API key missing'))}</span></button>)}</div>
      <label>{isRo ? 'Model' : 'Model'}<select value={model} onChange={(event) => setModel(event.target.value)}>{selectedProvider?.models.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      {selectedProvider && !selectedProvider.supportsDocuments && <div className="ocr-settings-warning">{selectedProvider.id === 'deepseek' ? selectedProvider.compatibilityNote : (isRo ? 'Această integrare acceptă imagini, dar nu PDF-uri. Pentru PDF utilizați OpenAI.' : 'This integration supports images but not PDFs. Use OpenAI for PDF documents.')}</div>}
      {selectedProvider?.local && <div className="ocr-settings-warning">{isRo ? 'Mod experimental: rulează PaddleOCR pe server, fără cheie sau cost API. Rezultatele trebuie verificate. Puteți reveni oricând la OpenAI din această pagină.' : 'Experimental mode: runs PaddleOCR on the server with no API key or API cost. Results must be reviewed. You can switch back to OpenAI here at any time.'}</div>}
      {error && <p className="error">{error}</p>}{message && <p className="success">{message}</p>}
      <button className="save" type="button" onClick={() => void save()} disabled={saving || !selectedProvider?.configured}>{saving ? (isRo ? 'Se salvează…' : 'Saving…') : (isRo ? 'Salvați modelul OCR' : 'Save OCR model')}</button>
    </section></main>
  </div>
}
