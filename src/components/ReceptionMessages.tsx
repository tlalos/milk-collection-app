import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mail, RefreshCw, X } from 'lucide-react'
import { appPath } from '../ocrPaths'
import { OcrNavigationContext } from './OcrNavigation'
import './ReceptionMessages.css'

interface Message {
  id: string
  documentType?: 'cmr' | 'daily_aviz'
  route?: string
  kind: 'missing_reception' | 'missing_weights' | 'review_link' | 'confirm_match' | 'multiple_receptions'
  receptionDate: string
  truckNumber: string
  supplier: string
  avizNumber: string
  quantity: number | null
  unit: string
  reviewed: boolean
}
const descriptions = {
  missing_reception: 'CMR detected. No Others scale reception found for this date and truck.',
  missing_weights: 'CMR detected. A reception exists, but its weighing is incomplete.',
  review_link: 'The CMR reception link needs review. Check the existing reception before adding another.',
  confirm_match: 'A possible scale reception was found. The CMR match still needs confirmation.',
  multiple_receptions: 'More than one reception matches this document. Check the existing receptions before adding another.',
}
const avizDescriptions = {
  ...descriptions,
  missing_reception: 'Daily Aviz detected. No Collection scale reception found for this date, truck and route.',
  missing_weights: 'Daily Aviz detected. A collection reception exists, but its weighing is incomplete.',
}

export function ReceptionMessages({ revision, onViewReception }: { revision: number; onViewReception: (date: string, truck: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const user = useContext(OcrNavigationContext)?.user
  const canReview = user?.isAdmin || user?.permissions?.includes('ocr_documents')
  const canViewDailyAviz = user?.isAdmin || user?.permissions?.includes('daily_aviz')
  useEffect(() => {
    const controller = new AbortController()
    let inFlight = false
    const load = async () => {
      if (inFlight || controller.signal.aborted) return
      inFlight = true
      setLoading(true)
      try {
        const response = await fetch(appPath('/api/milk-receptions/messages'), { signal: controller.signal, cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Could not load reception messages.')
        if (!controller.signal.aborted) { setMessages(payload.messages); setError('') }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load reception messages.')
      } finally { inFlight = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    const refreshVisible = () => { if (!document.hidden) void load() }
    const timer = window.setInterval(refreshVisible, 60000)
    window.addEventListener('focus', refreshVisible)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refreshVisible) }
  }, [revision, refresh])
  return <>
    <button ref={trigger} className="reception-message-trigger" type="button" title="Reception messages"
      aria-label={`Reception messages: ${error ? 'unavailable' : loading && !messages.length ? 'loading' : `${messages.length} outstanding`}`}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { dialog.current?.showModal(); setOpen(true); setRefresh(value => value + 1) }}>
      <Mail size={22} aria-hidden="true" />
      {(error || messages.length > 0) && <span className="reception-message-count">{error ? '!' : messages.length}</span>}
    </button>
    {createPortal(<dialog ref={dialog} className="reception-messages-dialog" aria-labelledby="reception-messages-title"
      onClose={() => { setOpen(false); trigger.current?.focus() }}>
      <header><h2 id="reception-messages-title">Reception messages</h2><div>
        <button type="button" title="Refresh messages" aria-label="Refresh messages" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={18} /></button>
        <button type="button" title="Close messages" aria-label="Close messages" onClick={() => dialog.current?.close()}><X size={18} /></button>
      </div></header>
      <div className="reception-messages-body">
        <p className="reception-messages-summary">{messages.length} outstanding · Current and previous month</p>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">Checking CMRs, Daily Aviz and receptions...</p>}
        {!loading && !error && !messages.length && <p>No outstanding reception messages.</p>}
        <ul>{messages.map(message => <li key={message.id}>
          <div className="reception-message-title"><strong>{message.truckNumber}</strong><time dateTime={message.receptionDate}>{message.receptionDate.split('-').reverse().join('/')}</time></div>
          <p>{(message.documentType === 'daily_aviz' ? avizDescriptions : descriptions)[message.kind]}</p>
          {message.route && <p className="reception-message-meta">Route: {message.route}</p>}
          <p className="reception-message-meta">{[message.supplier, message.avizNumber && `Aviz ${message.avizNumber}`, message.quantity != null ? `${message.quantity.toLocaleString('en-GB')} ${message.unit}` : ''].filter(Boolean).join(' · ')}</p>
          {!message.reviewed && <small>{message.documentType === 'daily_aviz' ? 'Daily Aviz' : 'CMR'} awaiting review</small>}
          <div className="reception-message-actions">
            <button type="button" onClick={() => { onViewReception(message.receptionDate, message.truckNumber); dialog.current?.close() }}>View receptions</button>
            {message.documentType === 'daily_aviz'
              ? canViewDailyAviz && <a href={appPath(`/daily-aviz?month=${encodeURIComponent(message.receptionDate.slice(0, 7))}`)} target="_blank" rel="noreferrer">Open Daily Aviz</a>
              : canReview && <a href={appPath(`/ocr/cmr-review?id=${encodeURIComponent(message.id)}`)} target="_blank" rel="noreferrer">Review CMR</a>}
          </div>
        </li>)}</ul>
      </div>
    </dialog>, document.body)}
  </>
}
