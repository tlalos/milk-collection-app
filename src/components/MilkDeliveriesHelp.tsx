import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, Check, CircleQuestionMark, MoveRight, Truck, X } from 'lucide-react'
import { OcrLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import { SaveIcon, ScaleIcon } from './MilkDeliveryIcons'
import './MilkDeliveriesHelp.css'

export function MilkDeliveriesHelp() {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState(false)
  const { isRo, language, setLanguage } = useOcrLanguage()
  const text = (en: string, ro: string) => isRo ? ro : en
  const label = text('Milk deliveries guide', 'Ghid livrări lapte')
  const titles = [text('Find a delivery', 'Găsiți o livrare'), text('Enter the truck and weights', 'Completați camionul și greutățile'), text('Save and mark departure', 'Salvați și marcați plecarea'), text('Record arrival in Greece', 'Înregistrați sosirea în Grecia')]
  const close = () => dialog.current?.close()
  const move = (next: number) => { setStep(next); content.current?.scrollTo({ top: 0 }) }
  const example = text('Example only', 'Doar exemplu')
  return <>
    <button ref={trigger} className="milk-deliveries-help-button" type="button" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setStep(0); setOpen(true); dialog.current?.showModal(); content.current?.scrollTo({ top: 0 }) }}><CircleQuestionMark size={26} aria-hidden="true" /></button>
    {createPortal(<dialog ref={dialog} className="delivery-guide" aria-labelledby="delivery-guide-title"
      onCancel={event => { event.preventDefault(); close() }} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }}>
      <header className="delivery-guide-header">
        <div><small>{text('MILK DELIVERIES', 'LIVRĂRI LAPTE')} · {step + 1} / 4</small><h2 id="delivery-guide-title">{titles[step]}</h2></div>
        <div className="delivery-guide-controls"><OcrLanguageSwitch language={language} onChange={setLanguage} /><button type="button" className="delivery-guide-icon-button" onClick={close} title={text('Close guide', 'Închideți ghidul')} aria-label={text('Close guide', 'Închideți ghidul')}><X size={20} /></button></div>
      </header>
      <div className="delivery-guide-content" ref={content}>
        <p className="delivery-guide-safety">{text('Examples only. This guide does not create, save or send deliveries.', 'Doar exemple. Acest ghid nu creează, nu salvează și nu trimite livrări.')}</p>
        {step === 0 && <>
          <p>{text('Start with Delivery date. Use Show all dates to search older deliveries, or Today to return to today. Search accepts an AVIZ, truck, milk type or destination.', 'Începeți cu Delivery date. Folosiți Show all dates pentru livrări mai vechi sau Today pentru ziua curentă. Căutați după aviz, camion, tip de lapte sau destinație.')}</p>
          <div className="delivery-guide-filter-example"><label><input type="checkbox" checked readOnly aria-label={example} /><strong>{text('Sent to Greece', 'Trimise în Grecia')}</strong></label><span>{text('Shows Awaiting Greece and Complete; hides Draft. Date, search and Status still apply.', 'Afișează Awaiting Greece și Complete; ascunde Draft. Data, căutarea și Status se aplică în continuare.')}</span></div>
          <dl className="delivery-guide-status-list">
            <div><dt><span className="delivery-status draft">Draft</span></dt><dd>{text('Not yet marked as departed. A draft can already be saved.', 'Nu este încă marcată ca plecată. Un Draft poate fi deja salvat.')}</dd></div>
            <div><dt><span className="delivery-status awaiting_greece">Awaiting Greece</span></dt><dd>{text('Marked as departed; arrival details are still to be completed.', 'Marcată ca plecată; detaliile sosirii urmează să fie completate.')}</dd></div>
            <div><dt><span className="delivery-status complete">Complete</span></dt><dd>{text('Arrival details have been entered and the delivery marked complete.', 'Detaliile sosirii au fost completate, iar livrarea a fost marcată ca finalizată.')}</dd></div>
          </dl>
          <p>{text('If Sent to Greece is checked while Status is Draft, no rows match. Choose All statuses to see all departed deliveries.', 'Dacă Sent to Greece este bifat și Status este Draft, nu există rezultate. Alegeți All statuses pentru toate livrările plecate.')}</p>
        </>}
        {step === 1 && <>
          <p>{text('Press Add delivery and fill in the date, truck, tractor where applicable, AVIZ and milk type. Choose Sales or Others before departure.', 'Apăsați Add delivery și completați data, camionul, capul tractor dacă este cazul, avizul și tipul de lapte. Alegeți Sales sau Others înainte de plecare.')}</p>
          <div className="delivery-guide-weights">
            <div><strong>Loaded kg</strong><div className="delivery-weight-entry"><input readOnly value="20000" aria-label="Example loaded kg" /><button type="button" title={example} aria-label="Example scale button"><ScaleIcon /></button></div></div>
            <div><strong>Empty kg</strong><div className="delivery-weight-entry"><input readOnly value="10000" aria-label="Example empty kg" /><button type="button" title={example} aria-label="Example empty scale button"><ScaleIcon /></button></div></div>
            <div><strong>Net kg</strong><output className="delivery-readonly-value">10,000</output></div>
          </div>
          <p>{text('Use the scale button beside each weight to read the connected scale, or type the kilograms manually. Scale readings and manual entries are labelled separately.', 'Folosiți butonul cântarului de lângă fiecare greutate pentru a citi cântarul conectat sau introduceți manual kilogramele. Citirile cântarului și introducerile manuale sunt etichetate separat.')}</p>
          <p>{text('Net kg = Loaded kg minus Empty kg. Liters are calculated from net kg using the density factor for the selected milk type. Do not enter them separately.', 'Net kg = Loaded kg minus Empty kg. Litrii sunt calculați din greutatea netă folosind factorul de densitate pentru tipul de lapte selectat. Nu se introduc separat.')}</p>
        </>}
        {step === 2 && <>
          <p>{text('Edits save automatically after a short pause when valid. Wait for Saved beneath the row actions. The disk button saves immediately; saving alone does not mark a departure.', 'Modificările valide se salvează automat după o scurtă pauză. Așteptați Saved sub acțiunile rândului. Butonul dischetă salvează imediat; simpla salvare nu marchează plecarea.')}</p>
          <div className="delivery-guide-action-example">
            <div className="delivery-row-actions"><button className="send" type="button" title={example} aria-label="Example Greece departure button"><span className="delivery-departure-icon" aria-hidden="true"><Truck /><MoveRight viewBox="0 6 24 12" /></span><span>Greece</span></button><button type="button" title={example} aria-label="Example save button"><SaveIcon /></button><span className="delivery-save-state saved">Saved</span></div>
            <p>{text('When the truck has departed, press Greece. The status becomes Awaiting Greece. This records departure in this app; it does not send an ERP invoice.', 'Când camionul a plecat, apăsați Greece. Starea devine Awaiting Greece. Aceasta înregistrează plecarea în aplicație; nu trimite o factură în ERP.')}</p>
          </div>
          <p>{text('Before departure: date, truck, AVIZ, category and positive loaded/empty weights are required. Empty kg cannot exceed Loaded kg.', 'Înainte de plecare sunt obligatorii data, camionul, avizul, categoria și greutăți pozitive la încărcat/gol. Empty kg nu poate depăși Loaded kg.')}</p>
          <dl className="delivery-guide-status-list">
            <div><dt>Not saved / Unsaved</dt><dd>{text('The row or its latest edits are not yet confirmed saved.', 'Rândul sau ultimele modificări nu sunt încă confirmate ca salvate.')}</dd></div>
            <div><dt>Needs details / Save failed</dt><dd>{text('Read the warning, correct missing details or the connection problem, then save again. Do not assume the record was saved.', 'Citiți avertizarea, corectați datele lipsă sau problema de conexiune, apoi salvați din nou. Nu presupuneți că rândul a fost salvat.')}</dd></div>
          </dl>
          <p>{text('The red trash button deletes the delivery after confirmation. Use it only for a record that should be removed.', 'Butonul roșu coș de gunoi șterge livrarea după confirmare. Folosiți-l doar pentru un rând care trebuie eliminat.')}</p>
        </>}
        {step === 3 && <>
          <div className="delivery-guide-expand-example"><button className="delivery-expand" type="button" title={example} aria-label="Example expand delivery">+</button><p>{text('Press + at the start of the row to open Arrival in Greece. These fields become available after the delivery is marked as departed.', 'Apăsați + la începutul rândului pentru a deschide Sosire în Grecia. Câmpurile devin disponibile după marcarea plecării.')}</p></div>
          <dl className="delivery-guide-arrival-example">
            <div><dt>{text('Weight from Greece', 'Greutate din Grecia')}</dt><dd>9,980 kg</dd></div>
            <div><dt>{text('Invoice number', 'Număr factură')}</dt><dd>EXAMPLE-100</dd></div>
            <div><dt>{text('Departure net weight', 'Greutate netă la plecare')}</dt><dd>10,000 kg</dd></div>
            <div><dt>{text('Difference', 'Diferență')}</dt><dd>-20 kg</dd></div>
          </dl>
          <p>{text('Enter the positive weight received in Greece and the invoice number. Add destination/comments when needed. Difference is Greece weight minus departure net kg.', 'Introduceți greutatea pozitivă recepționată în Grecia și numărul facturii. Adăugați destinația/comentarii dacă este necesar. Diferența este greutatea din Grecia minus greutatea netă la plecare.')}</p>
          <div className="delivery-guide-complete-example"><button type="button" title={example}>Mark complete</button><ArrowRight size={18} aria-hidden="true" /><span className="delivery-status complete">Complete</span></div>
          <p>{text('Press Mark complete when the arrival details are correct. The delivery remains visible under Sent to Greece. If it disappears, check your date and Status filters.', 'Apăsați Mark complete când datele sosirii sunt corecte. Livrarea rămâne vizibilă în Sent to Greece. Dacă dispare, verificați filtrele de dată și Status.')}</p>
        </>}
      </div>
      <footer className="delivery-guide-footer"><span aria-live="polite">{step + 1} / 4</span><div>
        <button type="button" className="delivery-guide-icon-button" disabled={step === 0} onClick={() => move(step - 1)} title={text('Previous step', 'Pasul anterior')} aria-label={text('Previous step', 'Pasul anterior')}><ArrowLeft size={18} /></button>
        {step < 3 ? <button type="button" className="delivery-guide-icon-button" onClick={() => move(step + 1)} title={text('Next step', 'Pasul următor')} aria-label={text('Next step', 'Pasul următor')}><ArrowRight size={18} /></button> : <button type="button" onClick={close}><Check size={18} aria-hidden="true" />{text('Done', 'Gata')}</button>}
      </div></footer>
    </dialog>, document.body)}
  </>
}
