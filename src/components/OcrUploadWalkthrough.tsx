import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, ChevronUp, ClipboardCheck, Files, FolderOpen, Hand, X } from 'lucide-react'
import { BackButton } from './BackButton'
import { PageLanguageSwitch } from './OcrLanguage'
import './SignInWalkthrough.css'
import './OcrUploadWalkthrough.css'

export interface OcrUploadWalkthroughProps {
  screen: HTMLDivElement
  isRo: boolean
  onClose: () => void
}

const selectors = [['.ocr-document-type select'], ['.ocr-action-button.secondary', '.ocr-action-button.primary'], ['.ocr-review-links button:first-child', '.ocr-review-links button:last-child']]
const icons = [Files, FolderOpen, ClipboardCheck]

export default function OcrUploadWalkthrough({ screen, isRo, onClose }: OcrUploadWalkthroughProps) {
  const [step, setStep] = useState(0)
  const [choice, setChoice] = useState(0)
  const [touched, setTouched] = useState(false)
  const [layout, setLayout] = useState({ highlights: [] as { top: number; left: number; width: number; height: number }[], panelTop: 0, panelLeft: 0, viewportHeight: 0, panelMaxHeight: 600 })
  const panel = useRef<HTMLDivElement>(null)
  const practice = useRef<HTMLButtonElement>(null)
  const typeOptions = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const Icon = icons[step]
  const steps = isRo ? [
    { title: 'Alegeți tipul documentului', action: 'Alegeți Rute zilnice sau Jurnal decont lunar, în funcție de document. Apăsați una dintre opțiuni pentru a exersa.' },
    { title: 'Alegeți documente sau fotografiați', action: 'Selectați imagini sau PDF-uri de pe dispozitiv ori fotografiați documentul cu telefonul. Apăsați unul dintre butoanele evidențiate pentru a exersa.' },
    { title: 'Deschideți meniurile de verificare', action: 'Pentru a accesa OCR pentru rute zilnice sau jurnalul lunar, folosiți aceste butoane. Apăsați unul dintre butoanele evidențiate pentru a exersa.' },
  ] : [
    { title: 'Choose the document type', action: 'Choose Daily Routes or Journal Monthly Settlement to match your document. Click either option to practice.' },
    { title: 'Choose documents or take a photo', action: 'Choose images or PDFs from your device, or take a picture of the document with your phone. Click either highlighted button to practice.' },
    { title: 'Open the review menus', action: 'To access Daily OCR or the Monthly Journal, use these buttons. Click either highlighted button to practice.' },
  ]

  function goToStep(next: number) {
    setTouched(false)
    setChoice(0)
    setStep(next)
  }

  useEffect(() => {
    if (selectors[step].length < 2) return
    const timer = window.setInterval(() => setChoice(current => 1 - current), 2000)
    return () => window.clearInterval(timer)
  }, [step])

  useLayoutEffect(() => {
    // Practice targets live in the portal; the real application stays untouched and inert.
    const root = document.getElementById('root')
    const initialScroll = { left: window.scrollX, top: window.scrollY }
    const wasInert = root?.inert ?? false
    if (root) root.inert = true
    screen.classList.add('ocr-guide-active')
    return () => {
      if (root) root.inert = wasInert
      screen.classList.remove('ocr-guide-active')
      window.scrollTo({ ...initialScroll, behavior: 'instant' })
    }
  }, [screen])

  useLayoutEffect(() => {
    const area = step === 1 ? '.ocr-actions' : step === 2 ? '.ocr-review-links' : selectors[step][0]
    screen.querySelector(area)?.scrollIntoView({ block: 'center', behavior: 'instant' })
    panel.current?.focus({ preventScroll: true })
  }, [screen, step])

  useLayoutEffect(() => {
    const targets = selectors[step].map(selector => screen.querySelector<HTMLElement>(selector))
    const anchor = step === 0 ? targets[0] : screen.querySelector<HTMLElement>(step === 1 ? '.ocr-actions' : '.ocr-review-links')
    if (!anchor || targets.some(target => !target)) { onClose(); return }
    let spacer: HTMLDivElement | null = null
    let frame = 0
    function targetRect(target: HTMLElement) {
      const rect = target.getBoundingClientRect()
      const extra = step === 0 ? 96 : 0
      return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom + extra, width: rect.width, height: rect.height + extra }
    }
    function measure() {
      // Position the text once around the whole pair; only its highlight alternates.
      let rect = targetRect(anchor!)
      const vw = document.documentElement.clientWidth
      const vh = window.visualViewport?.height || window.innerHeight
      const offset = window.visualViewport?.offsetTop || 0
      const width = Math.min(350, vw - 24)
      let maxHeight = vh - 24
      let left = Math.max(12, Math.min(rect.left, vw - width - 12))
      let top = rect.bottom + 16
      const height = panel.current?.getBoundingClientRect().height || 300
      if (rect.right + width + 28 <= vw) { left = rect.right + 16; top = rect.top }
      else if (rect.left >= width + 28) { left = rect.left - width - 16; top = rect.top }
      else if (spacer || top + height > offset + vh - 12) {
        if (!spacer && rect.top - height - 16 >= offset + 12) top = rect.top - height - 16
        else {
          if (!spacer) {
            spacer = document.createElement('div')
            spacer.style.height = `${window.innerHeight}px`
            spacer.setAttribute('aria-hidden', 'true')
            screen.append(spacer)
          }
          window.scrollBy({ top: rect.top - offset - 24, behavior: 'instant' })
          rect = targetRect(anchor!)
          top = rect.bottom + 16
          maxHeight = Math.max(100, offset + vh - top - 12)
        }
      }
      top = Math.max(offset + 12, Math.min(top, offset + vh - Math.min(height, maxHeight) - 12))
      const highlights = targets.map(target => {
        const bounds = targetRect(target!)
        return { top: bounds.top - 5, left: bounds.left - 5, width: bounds.width + 10, height: bounds.height + 10 }
      })
      setLayout({ highlights,
        panelTop: top, panelLeft: left, viewportHeight: window.innerHeight, panelMaxHeight: maxHeight })
    }
    function scheduleMeasure() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
      const targets = step === 0 ? Array.from(typeOptions.current?.querySelectorAll<HTMLButtonElement>('button') || []) : [practice.current!]
      const stops = [...targets, ...buttons]
      const current = stops.indexOf(document.activeElement as HTMLButtonElement)
      const next = current < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
      event.preventDefault()
      stops[next]?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(anchor)
    // Header wrapping can move targets without changing their own dimensions.
    const header = screen.querySelector('.ocr-header')
    if (header) observer.observe(header)
    targets.forEach(target => observer.observe(target!))
    if (panel.current) observer.observe(panel.current)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('keydown', keydown, true)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      window.visualViewport?.removeEventListener('resize', scheduleMeasure)
      spacer?.remove()
    }
  }, [screen, step, onClose])

  const { panelTop, panelLeft, viewportHeight } = layout
  const { top, left, width, height } = layout.highlights[choice] ?? { top: 0, left: 0, width: 0, height: 0 }
  return createPortal(<div className="sign-in-walkthrough ocr-upload-walkthrough" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <div className="sign-in-tour-shade" style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
    <div className="sign-in-tour-shade" style={{ top, left: 0, width: Math.max(0, left), height }} />
    <div className="sign-in-tour-shade" style={{ top, left: left + width, right: 0, height }} />
    <div className="sign-in-tour-shade" style={{ top: top + height, left: 0, right: 0, height: Math.max(0, viewportHeight - top - height) }} />
    {step === 0 ? <div ref={typeOptions} className="ocr-tour-type" style={{ top: top + 5, left: left + 5, width: width - 10 }}>
      <div className="ocr-tour-type-label" style={{ height: height - 106 }}>{isRo ? 'Selectați tipul documentului…' : 'Select document type…'}<ChevronUp size={16} aria-hidden="true" /></div>
      <div className="ocr-tour-type-options" role="group" aria-label={isRo ? 'Tip document (exercițiu)' : 'Document type (practice)'}>
        <button type="button" onClick={() => setTouched(true)}>{isRo ? 'RUTE ZILNICE' : 'DAILY ROUTES'}</button>
        <button type="button" onClick={() => setTouched(true)}>{isRo ? 'JURNAL DECONT LUNAR' : 'JOURNAL MONTHLY SETTLEMENT'}</button>
      </div>
    </div> : <button ref={practice} type="button" className="ocr-tour-practice" style={{ top, left, width, height }}
      aria-label={`${isRo ? 'Exersați' : 'Practice'}: ${steps[step].title}`} aria-describedby={descriptionId} onClick={() => setTouched(true)} />}
    <div className="sign-in-tour-ring" style={{ top, left, width, height }} aria-hidden="true"><span>{touched ? <Check size={16} /> : step + 1}</span></div>
    <div ref={panel} className="sign-in-tour-panel" tabIndex={-1} style={{ top: panelTop, left: panelLeft, maxHeight: layout.panelMaxHeight }}>
      <header><span>{isRo ? 'GHID OCR' : 'OCR GUIDE'} · {step + 1}/{steps.length}</span>
        <div className="ocr-tour-header-actions">
          <PageLanguageSwitch />
          <button type="button" onClick={onClose} aria-label={isRo ? 'Închide ghidul' : 'Close guide'} title={isRo ? 'Închide ghidul' : 'Close guide'}><X size={18} /></button>
        </div>
      </header>
      <div className="sign-in-tour-heading"><Icon size={22} aria-hidden="true" /><h2 id={titleId}>{steps[step].title}</h2></div>
      <div id={descriptionId} className="sign-in-tour-action"><Hand size={19} aria-hidden="true" /><p>{steps[step].action}</p></div>
      <p className="ocr-tour-practice-note">{isRo ? 'Exercițiu: nu se modifică și nu se trimit documente.' : 'Practice only: no documents are changed or sent.'}</p>
      <footer>
        <BackButton type="button" disabled={step === 0} onClick={() => goToStep(step - 1)} aria-label={isRo ? 'Înapoi' : 'Back'} />
        <button type="button" className="sign-in-tour-next" aria-label={step < steps.length - 1 ? (isRo ? 'Următorul' : 'Next') : (isRo ? 'Încheie ghidul' : 'Finish guide')} title={step < steps.length - 1 ? (isRo ? 'Următorul' : 'Next') : (isRo ? 'Încheie ghidul' : 'Finish guide')} disabled={!touched} onClick={() => step < steps.length - 1 ? goToStep(step + 1) : onClose()}>
          {step < steps.length - 1 ? <ArrowRight size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
        </button>
      </footer>
    </div>
  </div>, document.body)
}
