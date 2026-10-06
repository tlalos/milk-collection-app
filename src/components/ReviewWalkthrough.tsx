import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, ClipboardCheck, FileSearch, Hand, ListChecks, Pencil, Route, ScanText, X, type LucideIcon } from 'lucide-react'
import { BackButton } from './BackButton'
import { PageLanguageSwitch, useOcrLanguage } from './OcrLanguage'
import './SignInWalkthrough.css'
import './OcrUploadWalkthrough.css'
import './ReviewWalkthrough.css'

export interface WalkthroughStep { title: string; text: string; selector: string; prepare?: () => void; practice?: () => void; content?: ReactNode; unavailable?: string; hideSafetyNote?: boolean; interactiveTarget?: boolean; keepPageVisible?: boolean; compact?: boolean; panelBelowTarget?: boolean; targetClassName?: string; relatedSelector?: string; icon?: LucideIcon; sideNote?: { title: string; text: string; icon?: LucideIcon; selector?: string } }
export interface ReviewWalkthroughProps { screen: HTMLElement; kind: 'daily' | 'monthly'; onClose: () => void; customSteps?: WalkthroughStep[]; guideTitle?: string }
const icons = [ScanText, FileSearch, ClipboardCheck, Route, ListChecks, Check]
const dailyTargets = ['.review-queue-tabs', '.review-job-item.status-completed .review-job-open:not(:disabled)', '.review-data-tabs button:first-child', '.review-reception-routes-heading', '.review-center-cell', '.review-complete']

export default function ReviewWalkthrough({ screen, kind, onClose, customSteps, guideTitle }: ReviewWalkthroughProps) {
  const { isRo } = useOcrLanguage()
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const [layout, setLayout] = useState({ top: 0, left: 0, width: 0, height: 0, panelTop: 12, panelLeft: 12, panelMaxHeight: 500, found: false })
  const panel = useRef<HTMLDivElement>(null)
  const companion = useRef<HTMLElement>(null)
  const practice = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const steps = customSteps || (isRo ? [
    { title: 'După încărcare', text: 'După încărcarea documentelor sau fotografiilor, OCR pornește automat. La final, documentul apare în În așteptare pentru verificare sau în Eșuate dacă procesarea nu a reușit.' },
    { title: 'Alegeți un document', text: kind === 'daily' ? 'Alegeți o imagine din lista În așteptare, cu OCR finalizat. Apăsați documentul evidențiat pentru a-l deschide.' : 'Deschideți În așteptare și alegeți jurnalul lunar pe care doriți să îl verificați. Comparați datele extrase cu imaginea înainte de a marca documentul ca verificat.' },
    { title: 'Detaliile documentului', text: 'Panoul deschis conține informațiile principale despre rută: companie, dată, șofer, vehicul, rută și total litri. Verificați-le comparând cu documentul.' },
    { title: 'Rute din recepție', text: 'Apăsați + la Rute recepție pentru a vedea rutele disponibile din datele cântarului, pentru data documentului. Comparați ruta și camionul cu datele extrase.' },
    { title: 'Verificați centrele', text: 'Alegeți centrul ERP corect și completați fiecare rând. Numele centrului, tipul de lapte, litrii și numărul avizului sunt obligatorii. Comparați valorile cu imaginea.' },
    { title: 'Marcați ca verificat', text: 'Când toate datele sunt corecte, apăsați Marcați ca verificat. În acest ghid, clicul este doar un exercițiu: nu salvează, nu marchează documentul și nu trimite în ERP.' },
  ] : [
    { title: 'After uploading', text: 'After uploading your document or photo, OCR starts automatically. When it finishes, you will find the document under Pending for review, or Failed if processing could not finish.' },
    { title: 'Choose a document', text: kind === 'daily' ? 'Choose a picture from the Pending list whose OCR is complete. Click the highlighted document to open it for review.' : 'Open Pending and choose the monthly journal you want to review. Compare the extracted data with the picture before marking the document reviewed.' },
    { title: 'Document details', text: 'The open side panel contains the main route information: company, date, driver, vehicle, route and total liters. Check these against the document.' },
    { title: 'Reception routes', text: 'Press + in Reception routes to see the available routes from the scale data for the document date. Compare the route and truck with the extracted details.' },
    { title: 'Check the centers', text: 'Choose the correct ERP center and complete every row. Center name, milk type, liters and aviz number are mandatory. Compare the values with the picture.' },
    { title: 'Mark as reviewed', text: 'When all the details are correct, press Mark as reviewed. In this guide, the click is practice only: it does not save, mark the document reviewed, or send to ERP.' },
  ])
  const count = customSteps?.length || (kind === 'daily' ? 6 : 2)
  const customStep = customSteps?.[step]
  const compact = customStep?.compact === true
  const panelBelowTarget = customStep?.panelBelowTarget === true
  const targetClassName = customStep?.targetClassName
  const hasSideNote = Boolean(customStep?.sideNote)
  const secondarySelector = customStep?.relatedSelector || customStep?.sideNote?.selector
  const selector = customStep?.selector || (kind === 'daily' ? dailyTargets[step] : step === 0 ? '.monthly-tabs' : '.monthly-tabs button:first-child')
  const Icon = customStep?.icon || (hasSideNote ? FileSearch : icons[step] || ListChecks)
  const SideIcon = customStep?.sideNote?.icon || Pencil
  const prepare = useRef(customStep?.prepare)
  prepare.current = customStep?.prepare
  const interactiveSelector = customStep?.interactiveTarget ? selector : undefined

  useLayoutEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    const wasInert = root.inert
    const saved: { element: HTMLElement; inert: boolean }[] = []
    const target = interactiveSelector ? screen.querySelector<HTMLElement>(interactiveSelector) : null
    if (target) {
      // Only the highlighted field remains interactive; all other page controls stay inert.
      root.inert = false
      let branch: HTMLElement = target
      while (branch !== root && branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling !== branch && sibling instanceof HTMLElement) {
            saved.push({ element: sibling, inert: sibling.inert })
            sibling.inert = true
          }
        }
        branch = branch.parentElement
      }
    } else root.inert = true
    return () => {
      saved.forEach(({ element, inert }) => { element.inert = inert })
      root.inert = wasInert
    }
  }, [screen, interactiveSelector])

  useLayoutEffect(() => {
    const scroll = { left: window.scrollX, top: window.scrollY }
    const scrolling = Array.from(screen.querySelectorAll<HTMLElement>('*')).filter(el => el.scrollTop || el.scrollLeft).map(el => ({ el, top: el.scrollTop, left: el.scrollLeft }))
    const details = screen.querySelector<HTMLDetailsElement>('.review-reception-routes')
    const wasOpen = details?.open
    screen.classList.add('review-guide-active')
    return () => {
      screen.classList.remove('review-guide-active')
      if (details?.isConnected && wasOpen != null) details.open = wasOpen
      scrolling.forEach(({ el, top, left }) => el.scrollTo({ top, left, behavior: 'instant' }))
      window.scrollTo({ ...scroll, behavior: 'instant' })
    }
  }, [screen])

  useLayoutEffect(() => {
    setTouched(false)
    panel.current?.focus({ preventScroll: true })
    // Only switch display tabs; never dispatch change, save, review or ERP actions.
    if (customSteps) prepare.current?.()
    else if (kind === 'daily' && step >= 2) screen.querySelector<HTMLButtonElement>(`.review-data-tabs button:nth-child(${step >= 4 ? 2 : 1})`)?.click()
    let target: HTMLElement | null = null
    let secondaryTarget: HTMLElement | null = null
    const targetClasses = targetClassName?.split(/\s+/).filter(Boolean) || []
    let frame = 0
    const resize = new ResizeObserver(schedule)
    function targetBounds() {
      const first = target!.getBoundingClientRect()
      if (!secondaryTarget) return first
      const second = secondaryTarget.getBoundingClientRect()
      const left = Math.min(first.left, second.left)
      const top = Math.min(first.top, second.top)
      return new DOMRect(left, top, Math.max(first.right, second.right) - left, Math.max(first.bottom, second.bottom) - top)
    }
    function measure() {
      const next = screen.querySelector<HTMLElement>(selector)
      if (next !== target) {
        if (target) { resize.unobserve(target); target.classList.remove(...targetClasses) }
        target = next
        if (target) { target.classList.add(...targetClasses); resize.observe(target); target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }) }
      }
      const vw = document.documentElement.clientWidth
      const vh = window.visualViewport?.height || window.innerHeight
      const nextSecondary = secondarySelector ? screen.querySelector<HTMLElement>(secondarySelector) : null
      if (nextSecondary !== secondaryTarget) {
        if (secondaryTarget) { resize.unobserve(secondaryTarget); secondaryTarget.classList.remove('review-guide-secondary-target') }
        secondaryTarget = nextSecondary
        if (secondaryTarget) {
          secondaryTarget.classList.add('review-guide-secondary-target')
          resize.observe(secondaryTarget)
          if (target) { const bounds = targetBounds(); window.scrollBy({ top: bounds.top + bounds.height / 2 - vh / 2, behavior: 'instant' }) }
        }
      }
      const panelWidth = Math.min(hasSideNote && vw >= 760 ? 716 : compact ? 260 : 350, vw - 24)
      const panelHeight = Math.max(panel.current?.getBoundingClientRect().height || 300, companion.current?.getBoundingClientRect().height || 0)
      if (!target) {
        setLayout({ top: 0, left: 0, width: 0, height: 0, panelLeft: (vw - panelWidth) / 2, panelTop: Math.max(12, (vh - panelHeight) / 2), panelMaxHeight: vh - 24, found: false })
        return
      }
      let r = targetBounds()
      const fullPanelHeight = Math.max(panelHeight, (panel.current?.scrollHeight || 0) + 2)
      if (targetClassName && r.height + fullPanelHeight + 48 <= vh && r.top - 24 < fullPanelHeight && vh - r.bottom - 24 < fullPanelHeight) {
        // Leave room above the example for the full instruction on narrow screens.
        window.scrollBy({ top: r.top - fullPanelHeight - 24, behavior: 'instant' })
        r = targetBounds()
      }
      const top = Math.max(6, r.top - 5)
      const left = Math.max(6, r.left - 5)
      const width = Math.min(vw - left - 6, r.width + 10)
      const height = Math.min(vh - top - 6, r.height + 10)
      let panelLeft = Math.max(12, Math.min(left, vw - panelWidth - 12))
      let panelTop: number
      let panelMaxHeight = vh - 24
      if (panelBelowTarget) {
        const below = vh - (top + height) - 24
        const above = top - 24
        if (left + width + panelWidth + 28 < vw) panelLeft = left + width + 16
        // Keep the entire row visible, including totals to the right of the highlighted cell.
        if (below >= 180 || below >= above) { panelMaxHeight = Math.max(80, below); panelTop = top + height + 12 }
        else { panelMaxHeight = Math.max(80, above); panelTop = top - 12 - Math.min(panelHeight, panelMaxHeight) }
      }
      else if (left + width + panelWidth + 28 < vw) { panelLeft = left + width + 16; panelTop = Math.min(top, vh - panelHeight - 12) }
      else if (left >= panelWidth + 28) { panelLeft = left - panelWidth - 16; panelTop = Math.min(top, vh - panelHeight - 12) }
      else {
        const above = top - 24
        const below = vh - (top + height) - 24
        if (above > below) { panelMaxHeight = Math.max(80, above); panelTop = top - 12 - Math.min(panelHeight, panelMaxHeight) }
        else { panelMaxHeight = Math.max(80, below); panelTop = top + height + 12 }
      }
      setLayout({ top, left, width, height, panelTop: Math.max(12, panelTop), panelLeft, panelMaxHeight, found: true })
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])
      const liveTarget = interactiveSelector ? screen.querySelector<HTMLElement>(interactiveSelector) : null
      const stops = liveTarget ? [liveTarget, ...buttons] : practice.current ? [practice.current, ...buttons] : buttons
      const current = stops.indexOf(document.activeElement as HTMLElement)
      event.preventDefault()
      stops[(current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus({ preventScroll: true })
    }
    const mutation = new MutationObserver(schedule)
    mutation.observe(screen, { childList: true, subtree: true })
    if (panel.current) resize.observe(panel.current)
    if (companion.current) resize.observe(companion.current)
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    measure()
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); target?.classList.remove(...targetClasses); secondaryTarget?.classList.remove('review-guide-secondary-target'); document.removeEventListener('keydown', keydown, true); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [screen, kind, step, selector, onClose, interactiveSelector, compact, panelBelowTarget, targetClassName, hasSideNote, secondarySelector])

  function interact() {
    if (customStep) {
      customStep.practice?.()
      setTouched(true)
    } else if (kind === 'daily' && step === 1) {
      screen.querySelector<HTMLButtonElement>(selector)?.click()
      setStep(2)
    } else {
      if (kind === 'daily' && step === 3) {
        const details = screen.querySelector<HTMLDetailsElement>('.review-reception-routes')
        if (details) details.open = true
      }
      setTouched(true)
    }
  }
  const { top, left, width, height } = layout
  const canContinue = customStep ? (!layout.found || !customStep.practice || touched) : step === 0 || kind === 'monthly' || (layout.found && touched)
  return createPortal(<div className={`review-walkthrough sign-in-walkthrough${interactiveSelector ? ' has-live-target' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="sign-in-tour-shade" style={{ inset: 0, background: customStep?.keepPageVisible ? 'transparent' : undefined, clipPath: layout.found ? `polygon(0 0,100% 0,100% 100%,0 100%,0 ${top}px,${left}px ${top}px,${left}px ${top + height}px,${left + width}px ${top + height}px,${left + width}px ${top}px,0 ${top}px)` : undefined }} />
    {layout.found && <>
      {!interactiveSelector && <button ref={practice} type="button" className="ocr-tour-practice" style={{ top, left, width, height }} onClick={interact} aria-label={`${isRo ? 'Exersați' : 'Practice'}: ${steps[step].title}`} aria-describedby={descriptionId} />}
      <div className="sign-in-tour-ring" style={{ top, left, width, height }} aria-hidden="true"><span>{touched ? <Check size={16} /> : step + 1}</span></div>
    </>}
    <div ref={panel} className={`sign-in-tour-panel${compact ? ' review-guide-compact' : ''}${hasSideNote ? ' review-guide-paired' : ''}`} tabIndex={-1} style={{ top: layout.panelTop, left: layout.panelLeft, maxHeight: layout.panelMaxHeight }}>
      <header><span>{!compact && `${guideTitle || (isRo ? 'GHID DE VERIFICARE' : 'REVIEW GUIDE')} · `}{step + 1}/{count}</span><div className="ocr-tour-header-actions"><PageLanguageSwitch /><button type="button" aria-label={isRo ? 'Închide ghidul' : 'Close guide'} title={isRo ? 'Închide ghidul' : 'Close guide'} onClick={onClose}><X size={18} /></button></div></header>
      {compact ? <p className="review-guide-compact-text" id={titleId}><span id={descriptionId}>{steps[step].text}</span></p> : <>
        <div className="sign-in-tour-heading"><Icon size={22} aria-hidden="true" /><h2 id={titleId}>{steps[step].title}</h2></div>
        <div className="sign-in-tour-action" id={descriptionId}><Hand size={19} aria-hidden="true" /><p>{steps[step].text}</p></div>
      </>}
      {customStep?.content}
      {customStep?.sideNote && <section className="review-guide-inline-note">
        <div className="sign-in-tour-heading"><SideIcon size={22} aria-hidden="true" /><h2>{customStep.sideNote.title}</h2></div>
        <p>{customStep.sideNote.text}</p>
      </section>}
      {customStep && !layout.found && <p role="status">{customStep.unavailable || (isRo ? 'Acest exemplu nu este disponibil pentru filtrele curente. Puteți continua ghidul.' : 'This example is not available with the current filters. You can continue the guide.')}</p>}
      {!customSteps && kind === 'daily' && step > 0 && !layout.found && <p role="status">{step === 1 ? (isRo ? 'Nu există un document disponibil cu OCR finalizat în lista În așteptare. Reveniți după procesare.' : 'No OCR-complete document is available in Pending. Return after processing finishes.') : (isRo ? 'Se așteaptă datele documentului. Dacă nu apar, închideți ghidul și verificați documentul.' : 'Waiting for document details. If they do not appear, close the guide and check the document.')}</p>}
      {!customStep?.hideSafetyNote && <p className="review-guide-note">{isRo ? 'Ghidul nu modifică și nu trimite documente.' : 'The guide does not edit or send documents.'}</p>}
      <footer><BackButton type="button" disabled={step === 0} aria-label={isRo ? 'Înapoi' : 'Back'} onClick={() => setStep(step - 1)} /><button className="sign-in-tour-next" type="button" aria-label={step === count - 1 ? (isRo ? 'Încheie ghidul' : 'Finish guide') : (isRo ? 'Următorul' : 'Next')} title={step === count - 1 ? (isRo ? 'Încheie ghidul' : 'Finish guide') : (isRo ? 'Următorul' : 'Next')} disabled={!canContinue} onClick={() => step === count - 1 ? onClose() : setStep(step + 1)}>{step === count - 1 ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</button></footer>
    </div>
    {customStep?.sideNote && <aside ref={companion} className="sign-in-tour-panel review-guide-companion" style={{ top: layout.panelTop, left: layout.panelLeft + 366, maxHeight: layout.panelMaxHeight }} aria-label={customStep.sideNote.title}>
      <div className="sign-in-tour-heading"><SideIcon size={22} aria-hidden="true" /><h2>{customStep.sideNote.title}</h2></div>
      <p>{customStep.sideNote.text}</p>
    </aside>}
  </div>, document.body)
}
