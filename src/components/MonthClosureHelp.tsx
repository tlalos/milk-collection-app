import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Filter, Send, Clock, History, CalendarDays, CircleAlert, CircleCheck, CircleQuestionMark, LockKeyhole, Pencil, X, Check } from 'lucide-react'
import { useOcrLanguage } from './OcrLanguage'
import './MonthClosureHelp.css'

export function MonthClosureHelp({ canResolveInvoices = false }: { canResolveInvoices?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [step, setStep] = useState(1)
  const { isRo, language, setLanguage } = useOcrLanguage()
  const text = (en: string, ro: string) => isRo ? ro : en
  const close = () => {
    dialog.current?.close()
    trigger.current?.focus({ preventScroll: true })
  }
  const cases = [
    { id: 'needs-price', icon: Pencil, name: text('Example - Valea', 'Exemplu - Valea'), price: '-', commission: '0.00', electricity: '0.00', status: text('Needs price', 'Necesită preț'),
      title: text('Ready for pricing', 'Pregătit pentru preț'), description: text('The documents match. Enter the price, commission and electricity where applicable.', 'Documentele corespund. Completați prețul, comisionul și electricitatea, dacă este cazul.') },
    { id: 'saved', icon: CircleCheck, name: text('Example - Verde', 'Exemplu - Verde'), price: '1.50', commission: '100.00', electricity: '50.00', status: text('Saved', 'Salvat'),
      title: text('Price saved', 'Preț salvat'), description: text('Pricing is saved, but the invoice has not been sent. You can still edit it.', 'Prețurile sunt salvate, dar factura nu a fost trimisă. Le puteți modifica.') },
    { id: 'blocked', icon: CircleAlert, name: text('Example - Difference', 'Exemplu - Diferență'), price: '1.50', commission: '0.00', electricity: '0.00', status: text('Blocked', 'Blocat'), warning: text('Difference: 30 L', 'Diferență: 30 L'),
      title: text('Check the warning', 'Verificați avertizarea'), description: text('This 30 L difference exceeds the 10 L tolerance. Correct the documents in Monthly Reconciliation before sending.', 'Diferența de 30 L depășește toleranța de 10 L. Corectați documentele în Reconciliere lunară înainte de trimitere.') },
    { id: 'sent', icon: LockKeyhole, name: text('Example - Sent', 'Exemplu - Trimis'), price: '1.50', commission: '100.00', electricity: '50.00', status: text('Sent to ERP', 'Trimis în ERP'),
      title: text('Sent: pricing locked', 'Trimis: prețuri blocate'), description: text('Price, commission and electricity can no longer be edited. Sending and unconfirmed invoices are also protected.', 'Prețul, comisionul și electricitatea nu mai pot fi modificate. Facturile în curs de trimitere sau neconfirmate sunt și ele protejate.') },
  ]
  const headers = [text('Producer / center', 'Producător / centru'), text('Milk', 'Lapte'), text('Liters', 'Litri'), text('Price', 'Preț'), text('Comm.', 'Comis.'), text('Elec.', 'Electr.'), text('Status', 'Stare')]
  const invoiceCases = [
    { id: 'saved', icon: Send, name: text('Example - Ready', 'Exemplu - Pregătit'), status: '',
      title: text('Ready to send', 'Pregătit pentru trimitere'), description: text('Check the date and total. Press Send to preview, then Confirm send when the details are correct.', 'Verificați data și totalul. Apăsați Trimite pentru previzualizare, apoi confirmați trimiterea dacă detaliile sunt corecte.') },
    { id: 'blocked', icon: CircleAlert, name: text('Example - Difference', 'Exemplu - Diferență'), status: 'Difference exceeds 10 L',
      title: text('Blocked: correct the warning', 'Blocat: corectați avertizarea'), description: text('The quantities differ by more than 10 L. Correct the documents in Monthly Reconciliation before sending.', 'Cantitățile diferă cu mai mult de 10 L. Corectați documentele în Reconciliere lunară înainte de trimitere.') },
    { id: 'sending', icon: Clock, name: text('Example - Sending', 'Exemplu - În curs'), status: 'ERP: SENDING',
      title: text('Sending: please wait', 'Se trimite: așteptați'), description: text('The request is in progress. Do not send again. Pricing stays locked while the result is pending.', 'Cererea este în curs. Nu trimiteți din nou. Prețurile rămân blocate până la primirea rezultatului.') },
    { id: 'sent', icon: LockKeyhole, name: text('Example - Sent', 'Exemplu - Trimis'), status: 'ERP: SENT',
      title: text('Sent: document locked', 'Trimis: document blocat'), description: text('The invoice was sent successfully. Sending again and changing its pricing are disabled.', 'Factura a fost trimisă cu succes. Retrimiterea și modificarea prețurilor sunt dezactivate.') },
    { id: 'verification', icon: CircleAlert, name: text('Example - Unconfirmed', 'Exemplu - Neconfirmat'), status: 'ERP: UNCONFIRMED',
      title: text('Check ERP before retrying', 'Verificați ERP înainte de reîncercare'), description: text('The result is uncertain. Check whether the invoice exists in ERP before resolving its status or retrying. Pricing remains locked.', 'Rezultatul este incert. Verificați dacă factura există în ERP înainte de rezolvarea stării sau de reîncercare. Prețurile rămân blocate.') },
  ]
  const invoiceHeaders = ['Invoice date', 'Producer name', 'Producer center', 'Final result', 'ERP']
  const label = text('Month closure guide', 'Ghid închidere lunară')
  return <>
    <button ref={trigger} className="month-closure-help-button" type="button" title={label} aria-label={label} aria-haspopup="dialog" onClick={() => { setStep(1); dialog.current?.showModal() }}>
      <CircleQuestionMark size={26} aria-hidden="true" />
    </button>
    {createPortal(<dialog ref={dialog} className="month-closure-guide" aria-labelledby="closure-guide-title" onCancel={event => { event.preventDefault(); close() }}>
      <header className="closure-guide-header">
        <div><small>{text('MONTH CLOSURE GUIDE · STEP', 'GHID ÎNCHIDERE LUNARĂ · PASUL')} {step}</small><h2 id="closure-guide-title">{step === 1 ? text('Understand the pricing rows', 'Înțelegeți rândurile de prețuri') : text('ERP invoices', 'Facturi ERP')}</h2></div>
        <div className="closure-guide-controls">
          <div className="closure-guide-language" role="group" aria-label="Language">
            {(['en', 'ro'] as const).map(value => <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>)}
          </div>
          <button className="closure-guide-close" type="button" onClick={close} aria-label={text('Close guide', 'Închideți ghidul')} title={text('Close guide', 'Închideți ghidul')}><X size={19} /></button>
        </div>
      </header>
      {step === 1 ? <div className="closure-guide-content">
        <span className="closure-guide-example-label">{text('Example rows', 'Rânduri de exemplu')}</span>
        <table className="closure-guide-table">
          <thead><tr>{headers.map(header => <th key={header}>{header}</th>)}<th className="closure-guide-note-heading"><span className="closure-guide-sr-only">{text('Explanation', 'Explicație')}</span></th></tr></thead>
          <tbody>{cases.map(item => <tr key={item.id} className={`closure-guide-case ${item.id}`}>
            <td data-label={headers[0]} className="closure-guide-producer"><strong>{item.name}</strong><small>{text('Source: Journal', 'Sursă: Jurnal')}</small>{item.warning && <span className="closure-guide-warning"><CircleAlert size={14} />{item.warning}</span>}</td>
            <td data-label={headers[1]}>{text('COW', 'VACĂ')}</td><td data-label={headers[2]}>1,000</td>
            <td data-label={headers[3]}><span className="closure-guide-value">{item.price}</span></td>
            <td data-label={headers[4]}><span className="closure-guide-value">{item.commission}</span></td>
            <td data-label={headers[5]}><span className="closure-guide-value">{item.electricity}</span></td>
            <td data-label={headers[6]}><span className="closure-guide-status">{item.id === 'sent' && <LockKeyhole size={14} aria-hidden="true" />}{item.status}</span></td>
            <td className="closure-guide-note-cell"><aside className="closure-guide-note"><h3><item.icon size={20} aria-hidden="true" />{item.title}</h3><p>{item.description}</p></aside></td>
          </tr>)}</tbody>
        </table>
      </div> : <div className="closure-guide-content closure-guide-invoices">
        <div className="closure-guide-invoice-toolbar">
          <span className="closure-guide-example-label">{text('Example invoices', 'Facturi de exemplu')}</span>
          <div className="month-closure-tabs" aria-label="Example month closure views"><button type="button" onClick={() => setStep(1)}>Pricing</button><button type="button" className="active" aria-pressed="true">ERP invoices</button></div>
        </div>
        <table className="closure-guide-table closure-guide-invoice-table">
          <thead><tr>{invoiceHeaders.map(header => <th key={header}>{header}</th>)}<th><span className="closure-guide-sr-only">{text('Explanation', 'Explicație')}</span></th></tr></thead>
          <tbody>{invoiceCases.map(item => <tr key={item.id} className={`closure-guide-case ${item.id}`}>
            <td data-label={invoiceHeaders[0]}><span className={`closure-guide-invoice-date${['sending', 'sent', 'verification'].includes(item.id) ? ' locked' : ''}`}>01/09/26{['sending', 'sent', 'verification'].includes(item.id) ? <LockKeyhole size={12} aria-hidden="true" /> : <CalendarDays size={14} aria-hidden="true" />}</span></td>
            <td data-label={invoiceHeaders[1]} className="closure-guide-producer"><strong>{item.name}</strong>{item.status && <small className={item.id === 'sent' ? 'month-closure-invoice-sent' : 'month-closure-invoice-warning'}>{item.status}</small>}</td>
            <td data-label={invoiceHeaders[2]} className="closure-guide-invoice-center"><strong>VERDEA</strong><small className="month-closure-source">Source: Journal</small></td>
            <td data-label={invoiceHeaders[3]}>1,500.00</td>
            <td data-label={invoiceHeaders[4]} className="month-closure-invoice-send"><div className="month-closure-invoice-actions">
              <input type="checkbox" checked={false} readOnly disabled={item.id !== 'saved'} aria-label={`Select invoice example: ${item.name}`} />
              <button type="button" disabled={item.id !== 'saved'} title={text('Example only', 'Doar exemplu')}>Send</button>
              {['sending', 'sent', 'verification'].includes(item.id) && <button type="button" className={item.id === 'verification' && canResolveInvoices ? '' : 'month-closure-invoice-history'} title={item.id === 'verification' && canResolveInvoices ? 'Resolve ERP status' : 'History'} aria-label={item.id === 'verification' && canResolveInvoices ? 'Resolve ERP status' : 'History'}>{item.id === 'verification' && canResolveInvoices ? 'Resolve' : <History size={16} aria-hidden="true" />}</button>}
            </div></td>
            <td className="closure-guide-note-cell"><aside className="closure-guide-note"><h3><item.icon size={20} aria-hidden="true" />{item.title}</h3><p>{item.description}</p></aside></td>
          </tr>)}</tbody>
        </table>
        <p className="closure-guide-filter-tip"><Filter size={16} aria-hidden="true" />{text('ERP status: use Not sent for pending invoices, or Needs verification for uncertain results.', 'ERP status: alegeți Not sent pentru facturile netrimise sau Needs verification pentru rezultate incerte.')}</p>
      </div>}
      <footer className="closure-guide-footer"><span>{step} / 2</span><div className="closure-guide-navigation">
        {step === 2 && <button type="button" onClick={() => setStep(1)} aria-label={text('Previous step', 'Pasul anterior')} title={text('Previous step', 'Pasul anterior')}><ArrowLeft size={18} /></button>}
        {step === 1 ? <button type="button" onClick={() => setStep(2)} aria-label={text('Next step', 'Pasul următor')} title={text('Next step', 'Pasul următor')}><ArrowRight size={18} /></button> : <button type="button" onClick={close}><Check size={16} aria-hidden="true" />{text('Done', 'Gata')}</button>}
      </div></footer>
    </dialog>, document.body)}
  </>
}
