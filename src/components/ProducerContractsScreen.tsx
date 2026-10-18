import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Save, X } from 'lucide-react'
import { appPath } from '../ocrPaths'
import { type ApiaProducerContract } from '../apiaExport'
import { loadOcrReferenceSuppliers, type OcrReferenceProducer } from '../store/ocrReferenceSuppliersStore'
import { pageBounds } from '../monthClosurePagination'
import { useOcrLanguage } from './OcrLanguage'
import { usePinnedTableHeader } from './usePinnedTableHeader'
import { FloatingHorizontalScrollbar } from './FloatingHorizontalScrollbar'
import './ProducerContractsScreen.css'

interface Contract extends ApiaProducerContract { contractId: number | string; version: string }
interface ContractRow { id: string; producerCode: string; producerName: string; contract: Contract | null }
interface Draft { producerCode: string; milkType: string; contractNumber: string; contractStartDate: string; contractEndDate: string; contractedKg: string }
const milkTypes = ['MILK-COW', 'MILK-SHEEP', 'MILK-GOAT', 'MILK-BUFF']
const displayDate = (value: string) => value ? value.split('-').reverse().join('/') : '-'

export function ProducerContractsScreen() {
  const { isRo } = useOcrLanguage()
  const [contracts, setContracts] = useState<Contract[]>([])
  const [producers, setProducers] = useState<OcrReferenceProducer[]>([])
  const [milkType, setMilkType] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('milkType') || ''
    return milkTypes.includes(value) ? value : 'MILK-COW'
  })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [producerSearch, setProducerSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const table = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  usePinnedTableHeader(table, toolbar, 'producer-contracts')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    void (async () => {
      try {
        const response = await fetch(appPath('/api/ocr/exports/producer-contracts'), { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok || !Array.isArray(payload.contracts)) throw new Error(payload.error || 'Could not load contracts.')
        const references = await loadOcrReferenceSuppliers()
        if (controller.signal.aborted) return
        setContracts(payload.contracts); setCanEdit(payload.canEdit === true)
        const unique = new Map(references.producers.map(producer => [producer.producerCode.toLowerCase(), producer]))
        setProducers([...unique.values()].sort((a, b) => a.producerName.localeCompare(b.producerName)))
      } catch (reason) { if (!controller.signal.aborted) setError((reason as Error).message) }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [revision])

  useEffect(() => { if (draft) dialog.current?.showModal() }, [Boolean(draft)])
  const names = useMemo(() => new Map(producers.map(producer => [producer.producerCode.toLowerCase(), producer.producerName])), [producers])
  const rows = useMemo(() => {
    const selected = contracts.filter(contract => contract.milkType === milkType)
    const existingCodes = new Set(selected.map(contract => contract.producerCode.toLowerCase()))
    const result: ContractRow[] = selected.map(contract => ({ id: String(contract.contractId), producerCode: contract.producerCode,
      producerName: names.get(contract.producerCode.toLowerCase()) || contract.producerCode, contract }))
    for (const producer of producers) if (!existingCodes.has(producer.producerCode.toLowerCase())) result.push({ id: `missing-${producer.producerCode}`, producerCode: producer.producerCode, producerName: producer.producerName, contract: null })
    return result.sort((a, b) => a.producerName.localeCompare(b.producerName) || (b.contract?.contractStartDate || '').localeCompare(a.contract?.contractStartDate || ''))
  }, [contracts, milkType, names, producers])
  const filtered = rows.filter(row => `${row.producerName} ${row.producerCode} ${row.contract?.contractNumber || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (filter === 'all' || filter === 'missing' && !row.contract || filter === 'existing' && row.contract))
  const bounds = pageBounds(filtered.length, page, pageSize)
  const producerOptions = producers.filter(producer => producer.producerCode.toLowerCase() === draft?.producerCode.toLowerCase()
    || `${producer.producerName} ${producer.producerCode}`.toLocaleLowerCase().includes(producerSearch.trim().toLocaleLowerCase()))

  function open(contract: Contract | null, producerCode = '') {
    trigger.current = document.activeElement as HTMLElement
    setEditing(contract); setProducerSearch(''); setSaveError('')
    setDraft({ producerCode: contract?.producerCode || producerCode, milkType: contract?.milkType || milkType,
      contractNumber: contract?.contractNumber || '', contractStartDate: contract?.contractStartDate || '',
      contractEndDate: contract?.contractEndDate || '', contractedKg: contract?.contractedKg.toString() || '' })
  }

  async function save() {
    if (!draft || saving || !canEdit) return
    const kg = Number(draft.contractedKg.replace(',', '.'))
    if (!draft.producerCode || !draft.contractNumber.trim() || !draft.contractStartDate || !draft.contractEndDate
      || draft.contractEndDate < draft.contractStartDate || !Number.isFinite(kg) || kg <= 0) {
      setSaveError(isRo ? 'Completati toate campurile. Verificati datele si cantitatea.' : 'Complete all fields and check the dates and quantity.'); return
    }
    setSaving(true); setSaveError('')
    try {
      const response = await fetch(appPath('/api/ocr/exports/producer-contracts'), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, contractedKg: kg, contractId: editing?.contractId ?? null, expectedVersion: editing?.version ?? null }) })
      const payload = await response.json()
      if (!response.ok || !payload.saved) throw new Error(payload.error || 'Could not save contract.')
      const saved: Contract = payload.saved
      setContracts(current => [...current.filter(contract => String(contract.contractId) !== String(saved.contractId)), saved])
      setNotice(`${names.get(saved.producerCode.toLowerCase()) || saved.producerCode}: ${isRo ? 'contract salvat' : 'contract saved'}`)
      dialog.current?.close()
    } catch (reason) { setSaveError((reason as Error).message) }
    finally { setSaving(false) }
  }

  function update(key: keyof Draft, value: string) { setDraft(current => current ? { ...current, [key]: value } : current) }
  return <section className="apia-export producer-contracts" aria-label="Producer contracts">
    <div className="apia-filters">
      <label className="contract-search">{isRo ? 'Producator / cod / contract' : 'Producer / code / contract'}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>
      <label>{isRo ? 'Tip lapte' : 'Milk type'}<select value={milkType} onChange={event => {
        setMilkType(event.target.value); setPage(1)
        const url = new URL(window.location.href); url.searchParams.set('milkType', event.target.value); window.history.replaceState(null, '', url)
      }}>{milkTypes.map(type => <option key={type}>{type}</option>)}</select></label>
      <label>{isRo ? 'Stare' : 'Status'}<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }}><option value="all">{isRo ? 'Toti producatorii' : 'All producers'}</option><option value="missing">{isRo ? 'Fara contract' : 'Without any contract'}</option><option value="existing">{isRo ? 'Cu contract' : 'With contracts'}</option></select></label>
      <button type="button" className="apia-icon-button" aria-label="Refresh contracts" title={isRo ? 'Reincarca' : 'Refresh'} disabled={loading || saving} onClick={() => { setRevision(value => value + 1); setNotice('') }}><RefreshCw size={18} /></button>
      <button type="button" className="apia-export-button" disabled={loading || !!error || !canEdit} onClick={() => open(null)}><Plus size={18} />{isRo ? 'Adauga contract' : 'Add contract'}</button>
    </div>
    {error && <p className="apia-error" role="alert">{error}</p>}
    {!loading && !error && !canEdit && <p role="status">{isRo ? 'Salvarea este dezactivata in copia numai pentru citire.' : 'Saving is disabled in this read-only copy.'}</p>}
    {notice && <p className="contract-notice" role="status"><Check size={17} />{notice}</p>}
    <div className="apia-heading"><h2>{isRo ? 'Contracte' : 'Contracts'}</h2><span>{isRo ? 'Toate perioadele' : 'All contract periods'}</span></div>
    <div className="apia-pagination" ref={toolbar}><span>{loading ? 'Loading...' : `${filtered.length ? bounds.start + 1 : 0}-${bounds.end} / ${filtered.length}`}</span>
      <label>{isRo ? 'Randuri pe pagina' : 'Rows per page'}<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label>
      <button type="button" className="apia-icon-button" aria-label="Previous page" disabled={loading || bounds.page === 1} onClick={() => setPage(bounds.page - 1)}><ChevronLeft size={18} /></button><span>{bounds.page} / {bounds.pages}</span><button type="button" className="apia-icon-button" aria-label="Next page" disabled={loading || bounds.page === bounds.pages} onClick={() => setPage(bounds.page + 1)}><ChevronRight size={18} /></button>
    </div>
    <div className="apia-table-wrap" ref={table} role="region" aria-label="Contracts table" tabIndex={0}>
      <table className="apia-table contracts-table"><colgroup>{[270, 140, 175, 175, 200, 65].map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        <thead><tr><th>{isRo ? 'Producator / cod' : 'Producer / code'}</th><th>Numar contract</th><th>Data incheierii contractului<br />zz/ll/aaaa</th><th>Data incetarii contractului<br />zz/ll/aaaa</th><th>Cantitate de lapte contractata<br />(total - kg)</th><th>{isRo ? 'Editare' : 'Edit'}</th></tr></thead>
        <tbody>{!loading && !error && filtered.slice(bounds.start, bounds.end).map(row => <tr key={row.id}>
          <td><strong>{row.producerName}</strong><small>{row.producerCode}</small></td><td>{row.contract?.contractNumber || '-'}</td>
          <td>{displayDate(row.contract?.contractStartDate || '')}</td><td>{displayDate(row.contract?.contractEndDate || '')}</td>
          <td className="apia-quantity">{row.contract ? new Intl.NumberFormat(isRo ? 'ro-RO' : 'en-GB', { maximumFractionDigits: 3 }).format(row.contract.contractedKg) : '-'}</td>
          <td><button type="button" className="apia-icon-button" disabled={!canEdit} title={isRo ? 'Editare contract' : 'Edit contract'} aria-label={`Edit contract: ${row.producerName}`} onClick={() => open(row.contract, row.producerCode)}>{row.contract ? <Pencil size={17} /> : <Plus size={17} />}</button></td>
        </tr>)}{(loading || error || !filtered.length) && <tr><td colSpan={6} className="apia-empty">{loading ? (isRo ? 'Se incarca...' : 'Loading...') : error ? (isRo ? 'Lista indisponibila' : 'List unavailable') : (isRo ? 'Niciun rezultat' : 'No matching producers or contracts')}</td></tr>}</tbody>
      </table>
    </div>
    <FloatingHorizontalScrollbar targetRef={table} label="Contracts horizontal scrollbar" refreshKey={`${milkType}:${bounds.page}:${loading}`} />
    <dialog ref={dialog} className="contract-dialog" aria-labelledby="contract-edit-title" onCancel={event => { if (saving) event.preventDefault() }} onClose={() => { setDraft(null); setEditing(null); if (trigger.current?.isConnected) trigger.current.focus() }}>
      {draft && <form onSubmit={event => { event.preventDefault(); void save() }}>
        <div className="contract-dialog-heading"><h2 id="contract-edit-title">{editing ? (isRo ? 'Editare contract' : 'Edit contract') : (isRo ? 'Adauga contract' : 'Add contract')}</h2><button type="button" aria-label="Close" disabled={saving} onClick={() => dialog.current?.close()}><X size={19} /></button></div>
        {editing ? <p><strong>{names.get(draft.producerCode.toLowerCase()) || draft.producerCode}</strong><br />{draft.producerCode} · {draft.milkType}</p> : <div className="contract-identity">
          <label>{isRo ? 'Cauta producator' : 'Find producer'}<input type="search" value={producerSearch} disabled={saving} onChange={event => setProducerSearch(event.target.value)} /></label>
          <label>{isRo ? 'Producator' : 'Producer'}<select required value={draft.producerCode} disabled={saving} onChange={event => update('producerCode', event.target.value)}><option value="">{isRo ? 'Selectati producatorul' : 'Select producer'}</option>{producerOptions.map(producer => <option key={producer.producerCode} value={producer.producerCode}>{producer.producerName} ({producer.producerCode})</option>)}</select></label>
          <label>{isRo ? 'Tip lapte' : 'Milk type'}<select value={draft.milkType} disabled={saving} onChange={event => update('milkType', event.target.value)}>{milkTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        </div>}
        <div className="contract-edit-fields">
          <label>Numar contract<input required maxLength={100} value={draft.contractNumber} disabled={saving} onChange={event => update('contractNumber', event.target.value)} /></label>
          <label>Data incheierii contractului<input required type="date" value={draft.contractStartDate} disabled={saving} onChange={event => update('contractStartDate', event.target.value)} /></label>
          <label>Data incetarii contractului<input required type="date" min={draft.contractStartDate || undefined} value={draft.contractEndDate} disabled={saving} onChange={event => update('contractEndDate', event.target.value)} /></label>
          <label>Cantitate de lapte contractata (total - kg)<input required inputMode="decimal" value={draft.contractedKg} disabled={saving} onChange={event => update('contractedKg', event.target.value)} /></label>
        </div>
        {saveError && <p className="apia-error" role="alert">{saveError}</p>}
        <div className="contract-dialog-actions"><button type="button" disabled={saving} onClick={() => dialog.current?.close()}>{isRo ? 'Anuleaza' : 'Cancel'}</button><button type="submit" className="apia-export-button" disabled={saving || !canEdit}><Save size={17} />{saving ? (isRo ? 'Se salveaza...' : 'Saving...') : (isRo ? 'Salveaza' : 'Save')}</button></div>
      </form>}
    </dialog>
  </section>
}
