import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react'
import { createApiaExcelDownload } from '../apiaExcelExport'
import { appPath } from '../ocrPaths'
import { apiaColumns, buildApiaProducerList, type ApiaAvizApproval, type ApiaJournalGroup, type ApiaProducerReference, type ApiaReceptionFactor } from '../apiaExport'
import { loadOcrReferenceSuppliers } from '../store/ocrReferenceSuppliersStore'
import { pageBounds } from '../monthClosurePagination'
import { useOcrLanguage } from './OcrLanguage'
import { usePinnedTableHeader } from './usePinnedTableHeader'
import { FloatingHorizontalScrollbar } from './FloatingHorizontalScrollbar'

function initialMonth() {
  const value = new URLSearchParams(window.location.search).get('month') || ''
  if (/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) return value
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function ApiaExportScreen() {
  const { isRo } = useOcrLanguage()
  const [month, setMonth] = useState(initialMonth)
  const [milkType, setMilkType] = useState(() => new URLSearchParams(window.location.search).get('milkType') ?? 'MILK-COW')
  const [groups, setGroups] = useState<ApiaJournalGroup[]>([])
  const [approvals, setApprovals] = useState<ApiaAvizApproval[]>([])
  const [references, setReferences] = useState<ApiaProducerReference[]>([])
  const [factors, setFactors] = useState<ApiaReceptionFactor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const tableRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  usePinnedTableHeader(tableRef, toolbarRef)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(appPath('/api/ocr/monthly-reconciliation/rows'), { signal: controller.signal })
      .then(async response => {
        const payload = await response.json() as { rows?: ApiaJournalGroup[]; avizApprovals?: ApiaAvizApproval[]; error?: string }
        if (!response.ok) throw new Error(payload.error || 'Could not load journals.')
        if (!Array.isArray(payload.rows)) throw new Error('Invalid journal response.')
        if (controller.signal.aborted) return
        const suppliers = await loadOcrReferenceSuppliers()
        const factorResponse = await fetch(appPath('/api/ocr/exports/reception-factors'), { signal: controller.signal, cache: 'no-store' })
        const factorPayload = await factorResponse.json() as { factors?: ApiaReceptionFactor[]; error?: string }
        if (!factorResponse.ok || !Array.isArray(factorPayload.factors)) throw new Error(factorPayload.error || 'Could not load reception factors.')
        if (!controller.signal.aborted) {
          setGroups(payload.rows)
          setApprovals(payload.avizApprovals || [])
          setReferences(suppliers.producers)
          setFactors(factorPayload.factors)
        }
      })
      .catch((loadError: Error) => {
        if (!controller.signal.aborted) { setGroups([]); setApprovals([]); setReferences([]); setFactors([]); setError(loadError.message) }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])

  const milkTypes = useMemo(() => [...new Set(['MILK-COW', milkType, ...groups.map(group => group.milkType || ''), ...approvals.filter(approval => approval.status === 'APPROVED').map(approval => approval.milkType)])].filter(Boolean).sort(), [groups, approvals, milkType])
  const rows = useMemo(() => buildApiaProducerList(groups, month, milkType, approvals, references, factors), [groups, month, milkType, approvals, references, factors])
  const bounds = pageBounds(rows.length, page, pageSize)
  const visibleRows = rows.slice(bounds.start, bounds.end)
  const warningCount = rows.filter(row => row.warning || row.missingReceptionFactor).length

  function changeMonth(value: string) {
    setExportError('')
    setMonth(value)
    setPage(1)
    const url = new URL(window.location.href)
    if (value) url.searchParams.set('month', value)
    else url.searchParams.delete('month')
    window.history.replaceState(null, '', url)
  }

  function changeMilkType(value: string) {
    setExportError('')
    setMilkType(value)
    setPage(1)
    const url = new URL(window.location.href)
    url.searchParams.set('milkType', value)
    window.history.replaceState(null, '', url)
  }

  async function exportExcel() {
    if (loading || error || exporting || !rows.length) return
    setExporting(true)
    setExportError('')
    try {
      const download = await createApiaExcelDownload(month, milkType, rows)
      const url = URL.createObjectURL(new Blob([new Uint8Array(download.data)], { type: download.mimeType }))
      const link = document.createElement('a')
      link.href = url
      link.download = download.filename
      document.body.appendChild(link)
      try { link.click() } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      setExportError(isRo ? 'Exportul Excel nu a reusit. Incercati din nou.' : 'Excel export failed. Please try again.')
    } finally { setExporting(false) }
  }

  return <section className="apia-export" aria-label="APIA">
    <div className="apia-filters">
      <label htmlFor="apia-month">{isRo ? 'Luna' : 'Month'}
        <input id="apia-month" type="month" value={month} onChange={event => changeMonth(event.target.value)} />
      </label>
      <label htmlFor="apia-milk-type">{isRo ? 'Tip lapte' : 'Milk type'}
        <select id="apia-milk-type" value={milkType} onChange={event => changeMilkType(event.target.value)}>
          <option value="">{isRo ? 'Toate tipurile de lapte' : 'All milk types'}</option>
          {milkTypes.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      <button type="button" className="apia-icon-button" title={isRo ? 'Reincarca' : 'Refresh'} aria-label={isRo ? 'Reincarca' : 'Refresh'} disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={18} /></button>
      <button type="button" className="apia-export-button" disabled={loading || Boolean(error) || exporting || !rows.length} onClick={() => void exportExcel()}>
        <Download size={18} aria-hidden="true" />{exporting ? (isRo ? 'Se exporta...' : 'Exporting...') : 'Export Excel'}
      </button>
    </div>
    {error && <p role="alert" className="apia-error">{error}</p>}
    {exportError && <p role="alert" className="apia-error">{exportError}</p>}
    <div className="apia-heading"><h2>{isRo ? 'Lista APIA' : 'APIA list'}</h2>
      {!loading && !error && <span>{rows.length} {isRo ? 'randuri' : 'rows'}{warningCount > 0 ? ` · ${warningCount} ${isRo ? 'de verificat' : 'need review'}` : ''}</span>}
    </div>
    <div className="apia-pagination" ref={toolbarRef}>
      <span role="status">{loading ? (isRo ? 'Se incarca...' : 'Loading...') : error ? '-' : `${rows.length ? bounds.start + 1 : 0}-${bounds.end} / ${rows.length}`}</span>
      <label>{isRo ? 'Randuri pe pagina' : 'Rows per page'} <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <button type="button" className="apia-icon-button" aria-label={isRo ? 'Pagina precedenta' : 'Previous page'} title={isRo ? 'Pagina precedenta' : 'Previous page'} disabled={loading || Boolean(error) || bounds.page === 1} onClick={() => setPage(bounds.page - 1)}><ChevronLeft size={18} /></button>
      <span>{bounds.page} / {bounds.pages}</span>
      <button type="button" className="apia-icon-button" aria-label={isRo ? 'Pagina urmatoare' : 'Next page'} title={isRo ? 'Pagina urmatoare' : 'Next page'} disabled={loading || Boolean(error) || bounds.page === bounds.pages} onClick={() => setPage(bounds.page + 1)}><ChevronRight size={18} /></button>
    </div>
    <div className="apia-table-wrap" ref={tableRef} role="region" aria-label={isRo ? 'Producatori APIA' : 'APIA producers'} tabIndex={0} aria-busy={loading}>
      <table className="apia-table" style={{ minWidth: apiaColumns.reduce((total, column) => total + column.width, 0) }}>
        <colgroup>{apiaColumns.map(column => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
        <thead><tr>{apiaColumns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{!loading && !error && visibleRows.map(row => <tr key={row.id}>
          <td><strong>{row.producer || (isRo ? 'Producator neidentificat' : 'Unidentified producer')}</strong>
            {row.producerCode && <small>{row.producerCode}</small>}
            {row.source === 'aviz' && <small>{isRo ? 'Sursa: Aviz aprobat' : 'Source: Approved aviz'}</small>}
            {row.warning && <span className="apia-row-warning"><AlertTriangle size={14} aria-hidden="true" />{isRo ? (row.warning === 'No ERP match' ? 'Fara corespondent ERP' : row.warning === 'Wrong center' ? 'Centru incorect' : row.warning) : row.warning}</span>}
          </td>
          {apiaColumns.slice(1).map(column => {
            if (column.key === 'purchasedKg') return <td key={column.key} className="apia-quantity">
              {row.purchasedKg == null ? <span className="apia-row-warning">{isRo ? 'Lipseste factorul de receptie' : 'Missing reception factor'}</span> : new Intl.NumberFormat(isRo ? 'ro-RO' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.purchasedKg)}
            </td>
            const connected = column.key === 'taxId' || column.key === 'exploitationCode' || column.key === 'county'
            const value = connected ? row[column.key] : null
            return <td key={column.key} className={value ? (column.key === 'county' ? undefined : 'apia-identifier') : 'apia-unmapped'}
              title={value ? undefined : connected ? (isRo ? 'Lipseste din datele ERP' : 'Missing from ERP data') : (isRo ? 'Camp neconectat inca' : 'Field not connected yet')}>
              {value || <span aria-label={isRo ? 'Indisponibil' : 'Not available'}>-</span>}
            </td>
          })}
        </tr>)}
        {(loading || error || !visibleRows.length) && <tr><td colSpan={apiaColumns.length} className="apia-empty"><span>{loading ? (isRo ? 'Se incarca...' : 'Loading...') : error ? (isRo ? 'Lista nu este disponibila.' : 'List unavailable.') : !month ? (isRo ? 'Selectati luna.' : 'Select a month.') : (isRo ? 'Nicio livrare in jurnale sau avize aprobate pentru filtrele selectate.' : 'No journal or approved aviz deliveries for the selected filters.')}</span></td></tr>}
        </tbody>
      </table>
    </div>
    <FloatingHorizontalScrollbar targetRef={tableRef} label={isRo ? 'Derulare orizontala APIA' : 'APIA horizontal scrollbar'} refreshKey={`${month}:${milkType}:${bounds.page}:${pageSize}:${loading}`} />
  </section>
}
