import { useEffect, useMemo, useState } from 'react'
import { appPath } from '../ocrPaths'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import { APP_VERSION } from '../appVersion'
import './OcrArchiveHistoryScreen.css'

interface ArchiveHistoryRecord {
  jobId: string
  documentCategory: 'daily_routes' | 'journal_monthly_settlement' | string
  documentType: string
  status: 'archived' | 'failed' | string
  sourceFile?: string | null
  originalStoredFilename?: string | null
  archivedFileName?: string | null
  folderPath?: string | null
  webUrl?: string | null
  createdAt?: string | null
  completedAt?: string | null
  reviewedAt?: string | null
  archivedAt?: string | null
  attemptedAt?: string | null
  updatedAt?: string | null
  error?: string | null
  driverName?: string | null
  truckNumber?: string | null
  route?: string | null
  headerCenterName?: string | null
  documentMonth?: number | null
  documentDate?: string | null
}

interface ArchiveHistoryPayload {
  updatedAt?: string | null
  records?: ArchiveHistoryRecord[]
  error?: string
}

type Filter = 'all' | 'daily' | 'journals' | 'failed'

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleString()
}

function formatMonth(value?: number | null) {
  if (!value) return '-'
  return new Date(2026, value - 1, 1).toLocaleString(undefined, { month: 'long' })
}

function recordTitle(record: ArchiveHistoryRecord) {
  if (record.documentCategory === 'journal_monthly_settlement') {
    return record.headerCenterName || 'Monthly settlement'
  }
  return record.truckNumber || record.route || 'Daily route'
}

function recordSubtitle(record: ArchiveHistoryRecord) {
  if (record.documentCategory === 'journal_monthly_settlement') {
    return `Month: ${formatMonth(record.documentMonth)}`
  }
  return [record.driverName, record.route].filter(Boolean).join(' - ') || 'Daily routes'
}

function recordSearchText(record: ArchiveHistoryRecord) {
  return [
    record.documentType,
    record.sourceFile,
    record.archivedFileName,
    record.folderPath,
    record.driverName,
    record.truckNumber,
    record.route,
    record.headerCenterName,
    record.documentDate,
    record.status,
    record.error,
  ].filter(Boolean).join(' ').toLowerCase()
}

async function readHistoryPayload(response: Response, url: string) {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  let payload: ArchiveHistoryPayload = {}
  if (text) {
    try {
      payload = JSON.parse(text) as ArchiveHistoryPayload
    } catch {
      const message = response.status === 401
        ? 'Your OCR session expired. Please sign in again.'
        : `The backup history endpoint did not return JSON from ${url}. Restart the local server and refresh the page.`
      throw new Error(message)
    }
  }
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new Error(`The backup history endpoint returned ${contentType} from ${url}.`)
  }
  if (!response.ok) throw new Error(payload.error || `Could not load backup history (${response.status}).`)
  return payload
}

async function fetchHistoryPayload() {
  const urls = Array.from(new Set([
    appPath('/api/ocr/archive-history'),
    '/api/ocr/archive-history',
  ]))
  let lastError: Error | null = null

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      return await readHistoryPayload(response, url)
    } catch (err) {
      lastError = err as Error
    }
  }

  throw lastError || new Error('Could not load backup history.')
}

export function OcrArchiveHistoryScreen() {
  const { language, setLanguage, isRo } = useOcrLanguage()
  const [records, setRecords] = useState<ArchiveHistoryRecord[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadHistory() {
    setLoading(true)
    setError('')
    try {
      const payload = await fetchHistoryPayload()
      setRecords(payload.records || [])
      setUpdatedAt(payload.updatedAt || null)
    } catch (err) {
      setError((err as Error).message || 'Could not load backup history.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase()
    return records.filter((record) => {
      if (filter === 'daily' && record.documentCategory !== 'daily_routes') return false
      if (filter === 'journals' && record.documentCategory !== 'journal_monthly_settlement') return false
      if (filter === 'failed' && record.status !== 'failed') return false
      return !query || recordSearchText(record).includes(query)
    })
  }, [filter, records, search])

  const stats = useMemo(() => ({
    total: records.length,
    archived: records.filter((record) => record.status === 'archived').length,
    failed: records.filter((record) => record.status === 'failed').length,
  }), [records])

  return (
    <div className="archive-history-screen">
      <header className="archive-history-header">
        <button className="archive-history-back" type="button" onClick={() => { window.location.href = appPath('/') }} aria-label={isRo ? 'Inapoi' : 'Back'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1>{isRo ? 'Istoric backup OCR' : 'OCR Backup History'} <small>v{APP_VERSION}</small></h1>
          <p>{isRo ? 'Documente arhivate in SharePoint' : 'Archived OCR documents and SharePoint backup details'}</p>
        </div>
        <div className="archive-history-actions">
          <OcrLanguageSwitch language={language} onChange={setLanguage} />
          <button type="button" onClick={() => void loadHistory()} disabled={loading}>
            {loading ? (isRo ? 'Se incarca...' : 'Loading...') : (isRo ? 'Reincarcare' : 'Refresh')}
          </button>
        </div>
      </header>

      <main className="archive-history-body">
        <section className="archive-history-summary">
          <div>
            <span>{isRo ? 'Total' : 'Total records'}</span>
            <strong>{stats.total}</strong>
          </div>
          <div>
            <span>{isRo ? 'Arhivate' : 'Archived'}</span>
            <strong>{stats.archived}</strong>
          </div>
          <div className={stats.failed ? 'has-failed' : ''}>
            <span>{isRo ? 'Esec' : 'Failed'}</span>
            <strong>{stats.failed}</strong>
          </div>
          <div>
            <span>{isRo ? 'Ultima salvare' : 'History updated'}</span>
            <strong>{formatDateTime(updatedAt)}</strong>
          </div>
        </section>

        <section className="archive-history-tools">
          <label>
            <span>{isRo ? 'Cautare' : 'Search'}</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isRo ? 'Cautati centru, sofer, camion, fisier...' : 'Search center, driver, truck, file...'}
            />
          </label>
          <div className="archive-history-filters" role="tablist">
            <button className={filter === 'all' ? 'active' : ''} type="button" onClick={() => setFilter('all')}>{isRo ? 'Toate' : 'All'}</button>
            <button className={filter === 'daily' ? 'active' : ''} type="button" onClick={() => setFilter('daily')}>{isRo ? 'Daily' : 'Daily'}</button>
            <button className={filter === 'journals' ? 'active' : ''} type="button" onClick={() => setFilter('journals')}>{isRo ? 'Jurnale' : 'Journals'}</button>
            <button className={filter === 'failed' ? 'active' : ''} type="button" onClick={() => setFilter('failed')}>{isRo ? 'Esecuri' : 'Failed'}</button>
          </div>
        </section>

        {error && <div className="archive-history-error">{error}</div>}

        {loading ? (
          <div className="archive-history-empty">{isRo ? 'Se incarca istoricul...' : 'Loading backup history...'}</div>
        ) : filteredRecords.length === 0 ? (
          <div className="archive-history-empty">{isRo ? 'Nu exista inregistrari pentru filtrul selectat.' : 'No backup history records match this view.'}</div>
        ) : (
          <section className="archive-history-list">
            {filteredRecords.map((record) => (
              <article className={`archive-history-card status-${record.status}`} key={record.jobId}>
                <div className="archive-history-card-title">
                  <div>
                    <strong>{recordTitle(record)}</strong>
                    <span>{recordSubtitle(record)}</span>
                  </div>
                  <b>{record.status}</b>
                </div>

                <dl>
                  <div>
                    <dt>{isRo ? 'Tip' : 'Type'}</dt>
                    <dd>{record.documentType || record.documentCategory}</dd>
                  </div>
                  <div>
                    <dt>{isRo ? 'Fisier original' : 'Original file'}</dt>
                    <dd>{record.sourceFile || '-'}</dd>
                  </div>
                  <div>
                    <dt>{isRo ? 'Fisier SharePoint' : 'SharePoint file'}</dt>
                    <dd>{record.archivedFileName || '-'}</dd>
                  </div>
                  <div>
                    <dt>{isRo ? 'Folder' : 'Folder'}</dt>
                    <dd>{record.folderPath || '-'}</dd>
                  </div>
                  <div>
                    <dt>{isRo ? 'Completat' : 'Completed'}</dt>
                    <dd>{formatDateTime(record.completedAt)}</dd>
                  </div>
                  <div>
                    <dt>{isRo ? 'Arhivat' : 'Archived'}</dt>
                    <dd>{formatDateTime(record.archivedAt || record.attemptedAt)}</dd>
                  </div>
                </dl>

                {record.error && <p className="archive-history-card-error">{record.error}</p>}
                <div className="archive-history-card-footer">
                  <small>ID: {record.jobId}</small>
                  {record.webUrl && (
                    <a href={record.webUrl} target="_blank" rel="noreferrer">
                      {isRo ? 'Deschide in SharePoint' : 'Open in SharePoint'}
                    </a>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
