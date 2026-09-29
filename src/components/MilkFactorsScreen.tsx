import { useEffect, useState } from 'react'
import { appPath } from '../ocrPaths'
import './MilkFactorsScreen.css'

type Workflow = 'RECEPTION' | 'DELIVERIES'
interface MilkFactor {
  code: string
  label: string
  densityFactor: number
  updatedAt?: string | null
  updatedBy?: string
}
type Settings = Record<Workflow, MilkFactor[]>
type Draft = Record<Workflow, Record<string, string>>

function toDraft(settings: Settings): Draft {
  return {
    RECEPTION: Object.fromEntries(settings.RECEPTION.map((item) => [item.code, String(item.densityFactor)])),
    DELIVERIES: Object.fromEntries(settings.DELIVERIES.map((item) => [item.code, String(item.densityFactor)])),
  }
}

function backPath() {
  return new URLSearchParams(window.location.search).get('from') === 'deliveries' ? '/milk-deliveries' : '/milk-reception'
}

export function MilkFactorsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'saved' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    void loadSettings()
  }, [])

  async function loadSettings() {
    setStatus('loading')
    setError('')
    try {
      const response = await fetch(appPath('/api/milk-factors'), { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not load density factors.')
      setSettings(payload.settings)
      setDraft(toDraft(payload.settings))
      setCanEdit(Boolean(payload.canEdit))
      setStatus('idle')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load density factors.')
      setStatus('error')
    }
  }

  const changed = Boolean(settings && draft && (['RECEPTION', 'DELIVERIES'] as const).some((workflow) =>
    settings[workflow].some((item) => draft[workflow][item.code] !== String(item.densityFactor))))

  async function saveSettings() {
    if (!settings || !draft || !canEdit) return
    const next = Object.fromEntries((['RECEPTION', 'DELIVERIES'] as const).map((workflow) => [workflow,
      settings[workflow].map((item) => ({ code: item.code, densityFactor: Number(draft[workflow][item.code]) })),
    ])) as Settings
    for (const workflow of ['RECEPTION', 'DELIVERIES'] as const) {
      for (const item of next[workflow]) {
        if (!Number.isFinite(item.densityFactor) || item.densityFactor < 0.9 || item.densityFactor > 1.2 || Math.round(item.densityFactor * 1e6) / 1e6 !== item.densityFactor || !draft[workflow][item.code].trim()) {
          setError(`${item.label} in ${workflow === 'RECEPTION' ? 'Reception' : 'Deliveries'} needs a factor from 0.9 to 1.2 with up to 6 decimals.`)
          setStatus('error')
          return
        }
      }
    }
    setStatus('saving')
    setError('')
    try {
      const response = await fetch(appPath('/api/milk-factors'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: next }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Could not save density factors.')
      setSettings(payload.settings)
      setDraft(toDraft(payload.settings))
      setStatus('saved')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save density factors.')
      setStatus('error')
    }
  }

  return (
    <div className="app-shell milk-factors-screen">
      <header className="app-topbar milk-factors-topbar">
        <button className="back-button" type="button" onClick={() => { window.location.href = appPath(backPath()) }}>Back</button>
        <div className="app-title-block"><p>Factory workflow</p><h1>Milk Factors</h1></div>
      </header>
      <main className="milk-factors-content">
        {error && <p className="milk-factors-error" role="alert">{error}</p>}
        {status === 'loading' && <p>Loading factors...</p>}
        {settings && draft && (['RECEPTION', 'DELIVERIES'] as const).map((workflow) => (
          <section className="milk-factors-section" key={workflow}>
            <h2>{workflow === 'RECEPTION' ? 'Milk Reception' : 'Milk Deliveries'}</h2>
            <div className="milk-factors-table-wrap">
              <table className="milk-factors-table">
                <thead><tr><th>Milk type</th><th>Factor (kg/L)</th><th>Liters from 1,000 kg</th></tr></thead>
                <tbody>{settings[workflow].map((item) => {
                  const factor = Number(draft[workflow][item.code])
                  return <tr key={item.code}>
                    <th scope="row">{item.label}</th>
                    <td><input aria-label={`${workflow === 'RECEPTION' ? 'Reception' : 'Deliveries'} ${item.label} factor`} type="number" min="0.9" max="1.2" step="0.000001" value={draft[workflow][item.code]} disabled={!canEdit || status === 'saving'} onChange={(event) => {
                      setDraft({ ...draft, [workflow]: { ...draft[workflow], [item.code]: event.target.value } })
                      setStatus('idle')
                      setError('')
                    }} /></td>
                    <td>{Number.isFinite(factor) && factor > 0 ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(1000 / factor) : '-'}</td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          </section>
        ))}
        {settings && <div className="milk-factors-footer">
          <p>Saved rows retain the factor used when they were recorded. New rows use these values.</p>
          {canEdit && <div className="milk-factors-save"><span role="status">{status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : changed ? 'Unsaved changes' : ''}</span><button type="button" disabled={!changed || status === 'saving'} onClick={() => void saveSettings()}>Save factors</button></div>}
        </div>}
      </main>
    </div>
  )
}
