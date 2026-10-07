import { Fragment, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, RefreshCw } from 'lucide-react'
import { createVeterinaryExcelDownload } from '../veterinaryExcelExport'
import { buildVeterinaryProducerList, veterinaryAnimalGroups, type VeterinaryProducerRow } from '../veterinaryExport'
import { useVeterinaryData } from './useVeterinaryData'
import { pageBounds } from '../monthClosurePagination'
import { useOcrLanguage } from './OcrLanguage'
import { usePinnedTableHeader } from './usePinnedTableHeader'
import { FloatingHorizontalScrollbar } from './FloatingHorizontalScrollbar'
import './VeterinaryExportScreen.css'

function initialMonth() {
  const month = new URLSearchParams(window.location.search).get('month') || ''
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function VeterinaryExportScreen() {
  const { isRo } = useOcrLanguage()
  const [month, setMonth] = useState(initialMonth)
  const [form, setForm] = useState<1 | 2>(() => new URLSearchParams(window.location.search).get('form') === '2' ? 2 : 1)
  const { groups, approvals, references, herdCounts, loading, error, refresh } = useVeterinaryData()
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const tableRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  usePinnedTableHeader(tableRef, toolbarRef, String(form))

  const rows = useMemo(() => buildVeterinaryProducerList(groups, month, approvals, references, herdCounts), [groups, month, approvals, references, herdCounts])
  const bounds = pageBounds(rows.length, page, pageSize)
  const visibleRows = rows.slice(bounds.start, bounds.end)
  const columns = form === 1 ? 11 : 7
  const formatLiters = new Intl.NumberFormat(isRo ? 'ro-RO' : 'en-US', { maximumFractionDigits: 3 })

  function updateUrl(key: string, value: string) {
    setExportError('')
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.history.replaceState(null, '', url)
  }

  function changeForm(value: 1 | 2) {
    setForm(value)
    setPage(1)
    updateUrl('form', String(value))
    if (tableRef.current) tableRef.current.scrollLeft = 0
  }

  async function exportExcel() {
    if (loading || error || exporting || !rows.length) return
    setExporting(true)
    setExportError('')
    try {
      const download = await createVeterinaryExcelDownload(month, form, rows)
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

  function producerCell(row: VeterinaryProducerRow) {
    return <><strong>{row.producer || (isRo ? 'Producator neidentificat' : 'Unidentified producer')}</strong>
      {row.producerCode && <small>{row.producerCode}</small>}
      {row.source === 'aviz' && <small>{isRo ? 'Sursa: Aviz aprobat' : 'Source: Approved aviz'}</small>}
      {row.warning && <span className="apia-row-warning"><AlertTriangle size={14} aria-hidden="true" />{isRo ? (row.warning === 'No ERP match' ? 'Fara corespondent ERP' : row.warning === 'Wrong center' ? 'Centru incorect' : row.warning) : row.warning}</span>}
      {row.hasUnclassifiedMilk && <span className="apia-row-warning"><AlertTriangle size={14} aria-hidden="true" />{isRo ? 'Tip de lapte neidentificat' : 'Unidentified milk type'}</span>}
    </>
  }

  return <section className="apia-export veterinary-export" aria-label="Veterinary">
    <div className="apia-filters veterinary-filters">
      <label htmlFor="veterinary-month">{isRo ? 'Luna' : 'Month'}
        <input id="veterinary-month" type="month" value={month} onChange={event => { setMonth(event.target.value); setPage(1); updateUrl('month', event.target.value) }} />
      </label>
      <button type="button" className="apia-icon-button" title={isRo ? 'Reincarca' : 'Refresh'} aria-label={isRo ? 'Reincarca' : 'Refresh'} disabled={loading} onClick={refresh}><RefreshCw size={18} aria-hidden="true" /></button>
      <div className="veterinary-tabs" role="tablist" aria-label={isRo ? 'Formulare' : 'Forms'} ref={tabsRef}>
        {([1, 2] as const).map(value => <button key={value} id={`veterinary-tab-${value}`} type="button" role="tab" aria-selected={form === value} aria-controls="veterinary-panel" tabIndex={form === value ? 0 : -1}
          onClick={() => changeForm(value)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 1 : event.key === 'End' ? 2 : form === 1 ? 2 : 1
            changeForm(next)
            tabsRef.current?.querySelector<HTMLButtonElement>(`#veterinary-tab-${next}`)?.focus()
          }}>Formular {value}</button>)}
      </div>
      <button type="button" className="apia-export-button" disabled={loading || Boolean(error) || exporting || !rows.length} onClick={() => void exportExcel()}>
        <Download size={18} aria-hidden="true" />{exporting ? (isRo ? 'Se exporta...' : 'Exporting...') : 'Export Excel'}
      </button>
    </div>
    {error && <p role="alert" className="apia-error">{error}</p>}
    {exportError && <p role="alert" className="apia-error">{exportError}</p>}
    <div id="veterinary-panel" role="tabpanel" aria-labelledby={`veterinary-tab-${form}`}>
      <div className="apia-heading"><h2>Formular {form}</h2>{!loading && !error && <span>{rows.length} {isRo ? 'producatori' : 'producers'}</span>}</div>
      <div className="apia-pagination" ref={toolbarRef}>
        <span role="status">{loading ? (isRo ? 'Se incarca...' : 'Loading...') : error ? '-' : `${rows.length ? bounds.start + 1 : 0}-${bounds.end} / ${rows.length}`}</span>
        <label>{isRo ? 'Randuri pe pagina' : 'Rows per page'} <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>{[25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <button type="button" className="apia-icon-button" aria-label={isRo ? 'Pagina precedenta' : 'Previous page'} title={isRo ? 'Pagina precedenta' : 'Previous page'} disabled={loading || Boolean(error) || bounds.page === 1} onClick={() => setPage(bounds.page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <span>{bounds.page} / {bounds.pages}</span>
        <button type="button" className="apia-icon-button" aria-label={isRo ? 'Pagina urmatoare' : 'Next page'} title={isRo ? 'Pagina urmatoare' : 'Next page'} disabled={loading || Boolean(error) || bounds.page === bounds.pages} onClick={() => setPage(bounds.page + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>
      <div className="apia-table-wrap" ref={tableRef} role="region" aria-label={`Formular ${form}`} tabIndex={0} aria-busy={loading}>
        <table className={`apia-table veterinary-table veterinary-form-${form}`} key={form}>
          <colgroup><col style={{ width: 54 }} /><col style={{ width: 130 }} />
            {form === 1 ? veterinaryAnimalGroups.map(animal => <Fragment key={animal.key}><col style={{ width: 230 }} /><col style={{ width: 140 }} /><col style={{ width: 110 }} /></Fragment>) : <><col style={{ width: 300 }} /><col style={{ width: 145 }} /><col style={{ width: 145 }} /><col style={{ width: 145 }} /><col style={{ width: 145 }} /></>}
          </colgroup>
          {form === 1 ? <thead><tr>
            <th rowSpan={2} scope="col">Nr. crt.</th><th rowSpan={2} scope="col">Judet</th>
            {veterinaryAnimalGroups.map(animal => <Fragment key={animal.key}><th colSpan={2} scope="colgroup">{animal.label}</th><th rowSpan={2} scope="col">{animal.countLabel}</th></Fragment>)}
          </tr><tr>{veterinaryAnimalGroups.map(animal => <Fragment key={animal.key}><th scope="col">Nume / denumire</th><th scope="col">CNP/CUI</th></Fragment>)}</tr></thead> : <thead><tr>
            <th scope="col">Nr. crt.</th><th scope="col">Judet</th><th scope="col">Exploatatii<br />Nume / denumire</th><th scope="col">CNP/CUI</th>
            <th scope="col">Productii de lapte de vaca - total (litri)</th><th scope="col">Productii de lapte de bivolite - total (litri)</th><th scope="col">Productii de lapte de oi/capre - total (litri)</th>
          </tr></thead>}
          <tbody>{!loading && !error && visibleRows.map((row, index) => <tr key={row.id}>
            <td className="veterinary-index">{bounds.start + index + 1}</td><td>{row.county || '-'}</td>
            {form === 1 ? row.animalGroups.length ? veterinaryAnimalGroups.map(animal => <Fragment key={animal.key}>
              <td>{row.animalGroups.includes(animal.key) ? producerCell(row) : null}</td>
              <td className="apia-identifier">{row.animalGroups.includes(animal.key) ? row.taxId || '-' : null}</td>
              <td className={row.animalGroups.includes(animal.key) && row.animalCounts[animal.key] != null ? 'apia-quantity' : 'veterinary-unfilled'}>
                {row.animalGroups.includes(animal.key) ? row.animalCounts[animal.key] : null}
              </td>
            </Fragment>) : <td colSpan={9}>{producerCell(row)}</td> : <>
              <td>{producerCell(row)}</td><td className="apia-identifier">{row.taxId || '-'}</td>
              {veterinaryAnimalGroups.map(animal => <td key={animal.key} className="apia-quantity">
                {row.animalGroups.length && Number.isFinite(row.liters[animal.key]) && row.liters[animal.key] > 0 ? formatLiters.format(row.liters[animal.key]) : null}
              </td>)}
            </>}
          </tr>)}
          {(loading || error || !visibleRows.length) && <tr><td colSpan={columns} className="apia-empty"><span>{loading ? (isRo ? 'Se incarca...' : 'Loading...') : error ? (isRo ? 'Lista nu este disponibila.' : 'List unavailable.') : !month ? (isRo ? 'Selectati luna.' : 'Select a month.') : (isRo ? 'Niciun producator pentru luna selectata.' : 'No producers for the selected month.')}</span></td></tr>}
          </tbody>
        </table>
      </div>
      <FloatingHorizontalScrollbar targetRef={tableRef} label={isRo ? 'Derulare orizontala formular' : 'Form horizontal scrollbar'} refreshKey={`${form}:${month}:${bounds.page}:${pageSize}:${loading}`} />
    </div>
  </section>
}
