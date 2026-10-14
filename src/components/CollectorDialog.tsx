import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { LockKeyhole, Trash2 } from 'lucide-react'
import { appPath } from '../ocrPaths'
import './CollectorDialog.css'

type Collector = { producerCode: string; producerName: string; centerName: string; locked?: boolean }
export interface CollectorDialogHandle { open(month: string): void }

export const CollectorDialog = forwardRef<CollectorDialogHandle, { onChanged(month: string, producer?: string): Promise<void> }>(function CollectorDialog({ onChanged }, ref) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [month, setMonth] = useState('')
  const [options, setOptions] = useState<Collector[]>([])
  const [saved, setSaved] = useState<Collector[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState('')
  const [removing, setRemoving] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load(value: string) {
    const response = await fetch(appPath(`/api/month-closure/collectors?month=${encodeURIComponent(value)}`))
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not load collectors.')
    setOptions(data.options)
    setSaved(data.collectors)
  }
  useImperativeHandle(ref, () => ({ open(value) {
    setMonth(value); setSearch(''); setSelected(''); setRemoving(''); setError(''); setOptions([]); setSaved([]); setBusy(true)
    dialog.current?.showModal()
    void load(value).catch(error => setError(error.message)).finally(() => setBusy(false))
  } }), [])

  async function change(producerCode: string, remove = false) {
    setBusy(true); setError('')
    try {
      const response = await fetch(appPath('/api/month-closure/collectors'), { method: remove ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, producerCode }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save collector.')
      await load(month)
      setSelected(''); setRemoving('')
      await onChanged(month, remove ? undefined : options.find(p => p.producerCode === producerCode)?.producerName)
      if (!remove) dialog.current?.close()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save collector.') }
    finally { setBusy(false) }
  }
  const available = options.filter(p => !saved.some(s => s.producerCode.toLowerCase() === p.producerCode.toLowerCase()) && `${p.producerName} ${p.producerCode} ${p.centerName}`.toLowerCase().includes(search.toLowerCase()))
  return <dialog ref={dialog} className="month-closure-date-dialog collector-dialog" aria-labelledby="collector-title" onCancel={event => { if (busy) event.preventDefault() }}>
    <form className="month-closure-bulk-editor" onSubmit={event => { event.preventDefault(); if (selected && !busy) void change(selected) }}>
      <h2 id="collector-title">Add collector</h2>
      <strong>Month: {month}</strong>
      <label>Search collector<input value={search} disabled={busy} onChange={event => { setSearch(event.target.value); setSelected('') }} /></label>
      <label>ERP collector<select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
        <option value="">{busy ? 'Loading...' : 'Choose collector'}</option>
        {available.map(p => <option key={p.producerCode} value={p.producerCode}>{p.producerName} ({p.producerCode}) - {p.centerName}</option>)}
      </select></label>
      {!busy && !available.length && <span>No matching collectors available.</span>}
      {error && <p role="alert" className="month-closure-date-error">{error}</p>}
      <div className="month-closure-bulk-actions">
        <button type="button" disabled={busy} className="month-closure-cancel-bulk" onClick={() => dialog.current?.close()}>Close</button>
        <button type="submit" disabled={busy || !selected} className="month-closure-apply-bulk">{busy ? 'Please wait...' : 'Add collector'}</button>
      </div>
      {!!saved.length && <section className="collector-saved" aria-label="Collectors added this month">
        <h3>Added this month</h3>
        {saved.map(p => <div className="collector-saved-row" key={p.producerCode}>
          <span><strong>{p.producerName}</strong><small>{p.producerCode} - {p.centerName}</small></span>
          {p.locked ? <LockKeyhole size={18} aria-label="Submitted invoice locked" /> : removing === p.producerCode ? <div className="collector-remove-confirm">
            <span>Remove from {month}?</span>
            <button type="button" disabled={busy} onClick={() => void change(p.producerCode, true)}>Remove</button>
            <button type="button" disabled={busy} onClick={() => setRemoving('')}>Cancel</button>
          </div> : <button type="button" disabled={busy} title={`Remove ${p.producerName}`} aria-label={`Remove ${p.producerName}`} onClick={() => setRemoving(p.producerCode)}><Trash2 size={18} /></button>}
        </div>)}
      </section>}
    </form>
  </dialog>
})
