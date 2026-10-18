import { useEffect, useState } from 'react'
import { Link2, RefreshCw, Unlink } from 'lucide-react'
import { appPath } from '../ocrPaths'

interface Reception {
  receptionId: string
  receptionDate: string
  vehicleRegistration: string
  driverName: string | null
  netQuantityKg: number | null
  calculatedLiters: number | null
  updatedAt: string
}
interface Match {
  documentVersion: string
  updatedAt: string
  link: { receptionId: string; status: string; version: string } | null
  linkedReception: Reception | null
  candidates: Reception[]
}

export function CmrReceptionMatch({ id, updatedAt, dirty, busy, onBusy, isRo }: {
  id: string; updatedAt: string; dirty: boolean; busy: boolean; onBusy: (value: boolean) => void; isRo: boolean
}) {
  const [match, setMatch] = useState<Match | null>(null)
  const [choice, setChoice] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const endpoint = appPath(`/api/ocr/cmr/${encodeURIComponent(id)}/reception-match`)
  const stale = match !== null && match.updatedAt !== updatedAt
  function accept(value: Match) {
    setMatch(value)
    setChoice(value.candidates.find(row => row.receptionId === value.link?.receptionId)?.receptionId
      || (value.candidates.length === 1 ? value.candidates[0].receptionId : ''))
  }
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setMatch(null); setError(''); setChoice('')
    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load reception matches.')
        if (!controller.signal.aborted) accept(payload)
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load reception matches.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [endpoint, updatedAt, refresh])

  useEffect(() => {
    const refreshMatches = () => { if (!busy) setRefresh(value => value + 1) }
    window.addEventListener('focus', refreshMatches)
    return () => window.removeEventListener('focus', refreshMatches)
  }, [busy])

  async function save(receptionId: string | null) {
    if (!match || dirty || stale || busy || loading) return
    if (receptionId === null && !window.confirm(isRo ? 'Eliminati legatura cu receptia?' : 'Remove the reception link?')) return
    onBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        receptionId, documentVersion: match.documentVersion, updatedAt, linkVersion: match.link?.version || null,
        ...(receptionId ? { receptionUpdatedAt: match.candidates.find(row => row.receptionId === receptionId)?.updatedAt } : {}),
      }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not save the reception link.')
      accept(payload)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the reception link.') }
    finally { onBusy(false) }
  }
  const quantity = (value: number | null, unit: string) => value == null ? '-' : `${value.toLocaleString(isRo ? 'ro-RO' : 'en-GB', { maximumFractionDigits: 3 })} ${unit}`
  const summary = (row: Reception) => `${row.receptionDate} | ${row.vehicleRegistration} | ${row.driverName || '-'} | ${quantity(row.netQuantityKg, 'kg')} | ${quantity(row.calculatedLiters, 'L')}`
  const chosen = match?.candidates.find(row => row.receptionId === choice)
  return <section className="cmr-reception-match" aria-label={isRo ? 'Receptie Alte' : 'Others reception'}>
    <div className="cmr-match-heading"><h3>{isRo ? 'Receptie Alte' : 'Others reception'}</h3>
      <div className="cmr-match-actions">
        {!loading && <button type="button" disabled={!match || !choice || dirty || stale || busy || (match.link?.status === 'CONFIRMED' && choice === match.link.receptionId)} onClick={() => void save(choice)}><Link2 size={16} />{isRo ? 'Confirma asocierea' : 'Confirm match'}</button>}
        {!loading && match?.link && <button type="button" title={isRo ? 'Elimina legatura' : 'Remove reception link'} aria-label="Remove reception link" disabled={dirty || stale || busy} onClick={() => void save(null)}><Unlink size={16} /></button>}
      <button type="button" title={isRo ? 'Reincarca receptiile' : 'Refresh reception matches'} aria-label="Refresh reception matches" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} /></button>
      </div>
    </div>
    {error && <p role="alert" className="cmr-match-warning">{error}</p>}
    {loading ? <p role="status">{isRo ? 'Se incarca...' : 'Loading receptions...'}</p> : <>
      {match?.link ? <div className="cmr-linked-reception">
        <strong className={match.link.status === 'NEEDS_REVIEW' ? 'cmr-match-warning' : ''}>{match.link.status === 'CONFIRMED'
          ? (isRo ? 'Receptie asociata' : 'Reception linked') : (isRo ? 'Legatura necesita reverificare' : 'Link needs review')}</strong>
        {match.linkedReception && <p>{summary(match.linkedReception)}</p>}
        <small>{match.link.receptionId}</small>
      </div> : match && <p>{isRo ? 'Nicio receptie asociata' : 'No reception linked'}</p>}
      {dirty && <p className="cmr-match-warning">{isRo ? 'Salvati modificarile inainte de asociere.' : 'Save changes before matching.'}</p>}
      {stale && <p role="alert" className="cmr-match-warning">{isRo ? 'Documentul s-a modificat. Reincarcati documentul.' : 'The document changed. Reload the document.'}</p>}
      {match && !dirty && !stale && (match.candidates.length ? <>
        {!match.link && <p className="cmr-match-warning" role="status">{match.candidates.length === 1
          ? (isRo ? 'Receptie detectata. Conectati acest CMR?' : 'Reception detected. Connect this CMR?')
          : (isRo ? 'Mai multe receptii detectate. Selectati receptia pentru confirmare.' : 'Multiple receptions detected. Select a reception to confirm.')}</p>}
        <label>{isRo ? 'Receptie - aceeasi data si camion' : 'Reception - same date and truck'}
          <select value={choice} onChange={event => setChoice(event.target.value)} disabled={busy}>
            <option value="">{isRo ? 'Selectati receptia' : 'Select reception'}</option>
            {match.candidates.map((row, index) => <option key={row.receptionId} value={row.receptionId}>{index + 1}. {row.vehicleRegistration} | {quantity(row.netQuantityKg, 'kg')}</option>)}
          </select>
        </label>
        {chosen && chosen.receptionId !== match.link?.receptionId && <p className="cmr-match-detail">{summary(chosen)}<br /><small>{chosen.receptionId}</small></p>}
      </> : <p>{isRo ? 'Nicio receptie Alte cu aceeasi data si camion.' : 'No Others reception with the same date and truck.'}</p>)}
    </>}
  </section>
}
