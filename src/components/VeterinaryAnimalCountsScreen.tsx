import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Pencil, RefreshCw, Save, X } from 'lucide-react'
import { appPath } from '../ocrPaths'
import { buildVeterinaryProducerList, hasMissingVeterinaryCounts, veterinaryAnimalGroups, type VeterinaryAnimalGroup, type VeterinaryHerdCount, type VeterinaryProducerRow } from '../veterinaryExport'
import { pageBounds } from '../monthClosurePagination'
import { useOcrLanguage } from './OcrLanguage'
import { useVeterinaryData } from './useVeterinaryData'
import { usePinnedTableHeader } from './usePinnedTableHeader'
import { FloatingHorizontalScrollbar } from './FloatingHorizontalScrollbar'
import './VeterinaryAnimalCountsScreen.css'

function initialMonth() {
  const value = new URLSearchParams(window.location.search).get('month') || ''
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
const displayMonth = (month: string) => month ? `${month.slice(5)}/${month.slice(0, 4)}` : ''

export function VeterinaryAnimalCountsScreen() {
  const { isRo } = useOcrLanguage()
  const data = useVeterinaryData()
  const [month, setMonth] = useState(initialMonth)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('missing')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<VeterinaryProducerRow | null>(null)
  const [draft, setDraft] = useState<Record<VeterinaryAnimalGroup, string>>({ cow: '', buffalo: '', sheepGoat: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const editTrigger = useRef<HTMLButtonElement | null>(null)
  const table = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  usePinnedTableHeader(table, toolbar, 'animal-counts')
  const rows = useMemo(() => buildVeterinaryProducerList(data.groups, month, data.approvals, data.references, data.herdCounts), [data.groups, month, data.approvals, data.references, data.herdCounts])
  const knownCodes = useMemo(() => new Set(data.references.map(row => row.producerCode?.trim().toLowerCase())), [data.references])
  const canMatch = (row: VeterinaryProducerRow) => Boolean(row.producerCode && knownCodes.has(row.producerCode.trim().toLowerCase()))
  const missing = rows.filter(hasMissingVeterinaryCounts).length
  const filtered = rows.filter(row => {
    const matches = `${row.producer} ${row.producerCode}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    return matches && (filter === 'all' || filter === 'missing' && hasMissingVeterinaryCounts(row) || filter === 'complete' && !hasMissingVeterinaryCounts(row) || filter === 'unmatched' && !canMatch(row))
  })
  const bounds = pageBounds(filtered.length, page, pageSize)
  const labels = { cow: isRo ? 'Vaci' : 'Cows', buffalo: isRo ? 'Bivolite' : 'Buffalo', sheepGoat: isRo ? 'Oi / capre' : 'Sheep / goats' }
  const history = editing ? data.herdCounts.filter(row => row.producerCode.trim().toLowerCase() === editing.producerCode.trim().toLowerCase()).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth)) : []

  useEffect(() => {
    if (editing) {
      dialog.current?.showModal()
      dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    }
  }, [editing])

  async function save() {
    if (!editing || saving || !data.canEdit) return
    setSaveError('')
    const counts = Object.fromEntries(veterinaryAnimalGroups.map(animal => [animal.key, draft[animal.key].trim() === '' ? null : Number(draft[animal.key])])) as Record<VeterinaryAnimalGroup, number | null>
    if (Object.values(counts).some(value => value != null && (!Number.isInteger(value) || value < 0 || value > 2147483647)) || Object.values(counts).every(value => value == null)) {
      setSaveError(isRo ? 'Completati cel putin un efectiv cu un numar intreg pozitiv sau zero.' : 'Enter at least one count as a whole number of zero or more.')
      return
    }
    setSaving(true)
    try {
      const response = await fetch(appPath('/api/ocr/exports/producer-herd-counts'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ producerCode: editing.producerCode, effectiveMonth: month, expectedVersion: editing.countVersion,
          cowCount: counts.cow, buffaloCount: counts.buffalo, sheepGoatCount: counts.sheepGoat }),
      })
      const payload = await response.json() as { saved?: VeterinaryHerdCount; error?: string }
      if (!response.ok || !payload.saved) throw new Error(payload.error || 'Could not save animal counts.')
      const saved = payload.saved
      data.setHerdCounts(current => [...current.filter(row => !(row.producerCode.toLowerCase() === saved.producerCode.toLowerCase() && row.effectiveMonth === saved.effectiveMonth)), saved])
      setNotice(`${editing.producer}: ${isRo ? 'salvat' : 'saved'} (${displayMonth(month)})`)
      dialog.current?.close()
    } catch (reason) { setSaveError((reason as Error).message) }
    finally { setSaving(false) }
  }

  return <section className="apia-export herd-counts" aria-label={isRo ? 'Efective animale' : 'Animal counts'}>
    <div className="apia-filters">
      <label>{isRo ? 'Luna' : 'Month'}<input type="month" value={month} onChange={event => {
        setMonth(event.target.value); setPage(1); setNotice('')
        const url = new URL(window.location.href)
        url.searchParams.set('month', event.target.value)
        window.history.replaceState(null, '', url)
      }} /></label>
      <label className="herd-search">{isRo ? 'Producator / cod' : 'Producer / code'}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>{isRo ? 'Stare' : 'Status'}<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }}>
        <option value="missing">{isRo ? 'Efective lipsa' : 'Missing counts'}</option>
        <option value="all">{isRo ? 'Toti producatorii' : 'All producers'}</option>
        <option value="complete">{isRo ? 'Completat' : 'Complete'}</option>
        <option value="unmatched">{isRo ? 'Fara corespondent ERP' : 'No ERP match'}</option>
      </select></label>
      <button type="button" className="apia-icon-button" disabled={data.loading} title={isRo ? 'Reincarca' : 'Refresh'} aria-label={isRo ? 'Reincarca' : 'Refresh'} onClick={() => { setNotice(''); data.refresh() }}><RefreshCw size={18} /></button>
    </div>
    {data.error && <p className="apia-error" role="alert">{data.error}</p>}
    {!data.loading && !data.error && !data.canEdit && <p className="herd-readonly" role="status">{isRo ? 'Copie locala numai pentru citire. Salvarea este dezactivata.' : 'Local copy is read-only. Saving is disabled.'}</p>}
    {notice && <p className="herd-notice" role="status"><Check size={17} />{notice}</p>}
    <div className="apia-heading"><h2>{isRo ? 'Efective animale' : 'Animal counts'}</h2>{!data.loading && !data.error && <span>{rows.length} {isRo ? 'producatori' : 'producers'} · {missing} {isRo ? 'cu efective lipsa' : 'missing counts'}</span>}</div>
    <div className="apia-pagination" ref={toolbar}>
      <span>{data.loading ? (isRo ? 'Se incarca...' : 'Loading...') : `${filtered.length ? bounds.start + 1 : 0}-${bounds.end} / ${filtered.length}`}</span>
      <label>{isRo ? 'Randuri pe pagina' : 'Rows per page'}<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <button className="apia-icon-button" type="button" disabled={data.loading || bounds.page === 1} title={isRo ? 'Pagina precedenta' : 'Previous page'} aria-label={isRo ? 'Pagina precedenta' : 'Previous page'} onClick={() => setPage(bounds.page - 1)}><ChevronLeft size={18} /></button>
      <span>{bounds.page} / {bounds.pages}</span>
      <button className="apia-icon-button" type="button" disabled={data.loading || bounds.page === bounds.pages} title={isRo ? 'Pagina urmatoare' : 'Next page'} aria-label={isRo ? 'Pagina urmatoare' : 'Next page'} onClick={() => setPage(bounds.page + 1)}><ChevronRight size={18} /></button>
    </div>
    <div className="apia-table-wrap" ref={table} tabIndex={0} role="region" aria-label={isRo ? 'Efective producatori' : 'Producer animal counts'} aria-busy={data.loading}>
      <table className="apia-table herd-table"><colgroup>{[280, 120, 100, 100, 110, 115, 180, 65].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        <thead><tr><th>{isRo ? 'Producator' : 'Producer'}</th><th>{isRo ? 'Tip lapte' : 'Milk type'}</th>{veterinaryAnimalGroups.map(animal => <th key={animal.key}>{labels[animal.key]}</th>)}<th>{isRo ? 'Din luna' : 'Effective from'}</th><th>{isRo ? 'Stare' : 'Status'}</th><th><span className="herd-edit-heading">{isRo ? 'Editare' : 'Edit'}</span></th></tr></thead>
        <tbody>{!data.loading && !data.error && filtered.slice(bounds.start, bounds.end).map(row => <tr key={row.id}>
          <td><strong>{row.producer}</strong><small>{row.producerCode}</small></td>
          <td>{row.animalGroups.map(animal => labels[animal]).join(', ')}</td>
          {veterinaryAnimalGroups.map(animal => <td className="apia-quantity" key={animal.key}>{row.animalCounts[animal.key]}</td>)}
          <td>{displayMonth(row.countEffectiveMonth || '')}</td>
          <td>{!canMatch(row) ? <span className="apia-row-warning"><AlertTriangle size={14} />{isRo ? 'Fara corespondent ERP' : 'No ERP match'}</span> : hasMissingVeterinaryCounts(row) ? <span className="apia-row-warning"><AlertTriangle size={14} />{isRo ? 'Efective lipsa' : 'Missing counts'}</span> : <span className="herd-complete"><Check size={14} />{isRo ? 'Completat' : 'Complete'}</span>}</td>
          <td><button type="button" className="apia-icon-button" disabled={!canMatch(row)} title={!canMatch(row) ? (isRo ? 'Asociati mai intai producatorul in jurnal' : 'Match the producer in the journal first') : (isRo ? 'Editare efective' : 'Edit counts')} aria-label={`${isRo ? 'Editare efective' : 'Edit counts'}: ${row.producer}`} onClick={event => {
            editTrigger.current = event.currentTarget
            setSaveError('')
            setDraft({ cow: row.animalCounts.cow?.toString() ?? '', buffalo: row.animalCounts.buffalo?.toString() ?? '', sheepGoat: row.animalCounts.sheepGoat?.toString() ?? '' })
            setEditing(row)
          }}><Pencil size={17} /></button></td>
        </tr>)}
        {(data.loading || data.error || !filtered.length) && <tr><td className="apia-empty" colSpan={8}>{data.loading ? (isRo ? 'Se incarca...' : 'Loading...') : data.error ? (isRo ? 'Lista nu este disponibila.' : 'List unavailable.') : !month ? (isRo ? 'Selectati luna.' : 'Select a month.') : rows.length ? (isRo ? 'Niciun producator pentru filtrele selectate.' : 'No producers match these filters.') : (isRo ? 'Niciun producator pentru luna selectata.' : 'No producers for the selected month.')}</td></tr>}
        </tbody>
      </table>
    </div>
    <FloatingHorizontalScrollbar targetRef={table} label={isRo ? 'Derulare orizontala' : 'Horizontal scrollbar'} refreshKey={`${month}:${filter}:${bounds.page}:${data.loading}`} />
    <dialog ref={dialog} className="herd-dialog" aria-labelledby="herd-edit-title" onCancel={event => { if (saving) event.preventDefault() }} onClose={() => { setEditing(null); if (editTrigger.current?.isConnected) editTrigger.current.focus() }}>
      {editing && <form onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="herd-dialog-heading"><h2 id="herd-edit-title">{isRo ? 'Efective animale' : 'Animal counts'}</h2><button type="button" className="apia-icon-button" disabled={saving} title={isRo ? 'Inchide' : 'Close'} aria-label={isRo ? 'Inchide' : 'Close'} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
        <strong className="herd-producer-name">{editing.producer}</strong><small className="herd-producer-code">{editing.producerCode}</small>
        <p className="herd-effective">{isRo ? 'Incepand cu' : 'Effective from'} <strong>{displayMonth(month)}</strong></p>
        <div className="herd-count-inputs">{veterinaryAnimalGroups.map(animal => <label key={animal.key}>{labels[animal.key]}<input type="number" min={0} max={2147483647} step={1} value={draft[animal.key]} disabled={saving} onChange={event => setDraft(current => ({ ...current, [animal.key]: event.target.value }))} /></label>)}</div>
        {saveError && <p className="apia-error" role="alert">{saveError}</p>}
        {history.length > 0 && <details className="herd-history"><summary>{isRo ? 'Istoric' : 'History'}</summary><table><thead><tr><th>{isRo ? 'Din luna' : 'Effective from'}</th><th>{labels.cow}</th><th>{labels.buffalo}</th><th>{labels.sheepGoat}</th></tr></thead><tbody>{history.map(row => <tr key={row.effectiveMonth}><td>{displayMonth(row.effectiveMonth)}</td><td>{row.cowCount}</td><td>{row.buffaloCount}</td><td>{row.sheepGoatCount}</td></tr>)}</tbody></table></details>}
        <div className="herd-dialog-actions"><button type="button" disabled={saving} onClick={() => dialog.current?.close()}>{isRo ? 'Anuleaza' : 'Cancel'}</button><button type="submit" className="apia-export-button" disabled={saving || !data.canEdit}><Save size={17} />{saving ? (isRo ? 'Se salveaza...' : 'Saving...') : (isRo ? 'Salveaza' : 'Save')}</button></div>
      </form>}
    </dialog>
  </section>
}
