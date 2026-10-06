import { BackButton } from './BackButton'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, Hand, KeyRound, LogIn, UserRound, X } from 'lucide-react'
import './SignInWalkthrough.css'

export interface SignInWalkthroughProps {
  form: HTMLFormElement
  isRo: boolean
  onClose: (completed?: boolean) => void
}

const selectors = ['input[autocomplete="username"]', 'input[autocomplete="current-password"]', 'button[type="submit"]']
const icons = [UserRound, KeyRound, LogIn]

export default function SignInWalkthrough({ form, isRo, onClose }: SignInWalkthroughProps) {
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const [layout, setLayout] = useState({ top: 0, left: 0, width: 0, height: 0, panelTop: 0, panelLeft: 0, viewportHeight: 0, panelMaxHeight: 600 })
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const Icon = icons[step]
  const steps = isRo ? [
    { title: 'Selectați utilizatorul', action: 'Selectați câmpul Utilizator evidențiat. Nu trebuie să introduceți date pentru acest exercițiu.' },
    { title: 'Selectați parola', action: 'Selectați câmpul Parolă evidențiat. Ghidul nu citește și nu salvează parola.' },
    { title: 'Găsiți autentificarea', text: 'Permisiunile contului determină paginile la care aveți acces.', action: 'Apăsați butonul evidențiat pentru a încheia exercițiul. Acest clic nu vă autentifică.' },
  ] : [
    { title: 'Choose the username field', action: 'Click the highlighted Username field. You do not need to enter any details for this practice.' },
    { title: 'Choose the password field', action: 'Click the highlighted Password field. The guide does not read or save your password.' },
    { title: 'Find Web sign in', text: 'Your account permissions determine which pages you can access.', action: 'Click the highlighted button to finish practicing. This practice click does not sign you in.' },
  ]

  useLayoutEffect(() => {
    const target = form.querySelector<HTMLElement>(selectors[step])
    if (!target) { onClose(); return }
    const initialScroll = { left: window.scrollX, top: window.scrollY }
    let spacer: HTMLDivElement | null = null
    setTouched(false)
    target.scrollIntoView({ block: 'center', behavior: 'instant' })
    panel.current?.focus({ preventScroll: true })
    const oldDescription = target.getAttribute('aria-describedby')
    target.setAttribute('aria-describedby', `${oldDescription ? `${oldDescription} ` : ''}${descriptionId}`)
    let frame = 0
    function measure() {
      let rect = target!.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = window.visualViewport?.height || window.innerHeight
      const offset = window.visualViewport?.offsetTop || 0
      const width = Math.min(350, vw - 24)
      const height = panel.current?.getBoundingClientRect().height || 280
      let left = Math.max(12, Math.min(rect.left, vw - width - 12))
      let top = rect.bottom + 16
      if (rect.right + width + 28 <= vw) { left = rect.right + 16; top = rect.top }
      else if (rect.left >= width + 28) { left = rect.left - width - 16; top = rect.top }
      else if (top + height > offset + vh - 12) {
        if (rect.top - height - 16 >= offset + 12) top = rect.top - height - 16
        else {
          // Short viewports need scroll room to show the control and guide together.
          if (!spacer) {
            spacer = document.createElement('div')
            spacer.style.height = `${window.innerHeight}px`
            spacer.setAttribute('aria-hidden', 'true')
            document.body.append(spacer)
          }
          window.scrollBy({ top: rect.top - offset - 24, behavior: 'instant' })
          rect = target!.getBoundingClientRect()
          top = rect.bottom + 16
        }
      }
      top = Math.max(offset + 12, Math.min(top, offset + vh - height - 12))
      setLayout({ top: Math.max(0, rect.top - 5), left: Math.max(0, rect.left - 5), width: rect.width + 10, height: rect.height + 10, panelTop: top, panelLeft: left, viewportHeight: window.innerHeight, panelMaxHeight: Math.max(120, vh - 120) })
    }
    function scheduleMeasure() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    function interacted(event: Event) {
      if (step === 2) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose(true)
      } else setTouched(true)
    }
    function focused() { if (step < 2) setTouched(true) }
    function preventSubmit(event: Event) { event.preventDefault(); event.stopImmediatePropagation() }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'Enter' && form.contains(event.target as Node)) {
        event.preventDefault()
        if (event.target === target && step === 2) onClose(true)
        return
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
      const stops = [target!, ...buttons]
      const current = stops.indexOf(document.activeElement as HTMLElement)
      const next = current < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
      event.preventDefault()
      stops[next]?.focus()
    }
    target.addEventListener('click', interacted, true)
    target.addEventListener('focus', focused)
    form.addEventListener('submit', preventSubmit, true)
    document.addEventListener('keydown', keydown, true)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(target)
    if (panel.current) observer.observe(panel.current)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      target.removeEventListener('click', interacted, true)
      target.removeEventListener('focus', focused)
      form.removeEventListener('submit', preventSubmit, true)
      document.removeEventListener('keydown', keydown, true)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      window.visualViewport?.removeEventListener('resize', scheduleMeasure)
      spacer?.remove()
      window.scrollTo({ ...initialScroll, behavior: 'instant' })
      if (oldDescription === null) target.removeAttribute('aria-describedby')
      else target.setAttribute('aria-describedby', oldDescription)
    }
  }, [form, step, onClose, descriptionId])

  const { top, left, width, height, panelTop, panelLeft, viewportHeight } = layout
  return createPortal(<div className="sign-in-walkthrough">
    <div className="sign-in-tour-shade" style={{ top: 0, left: 0, right: 0, height: top }} />
    <div className="sign-in-tour-shade" style={{ top, left: 0, width: left, height }} />
    <div className="sign-in-tour-shade" style={{ top, left: left + width, right: 0, height }} />
    <div className="sign-in-tour-shade" style={{ top: top + height, left: 0, right: 0, height: Math.max(0, viewportHeight - top - height) }} />
    <div className="sign-in-tour-ring" style={{ top, left, width, height }} aria-hidden="true"><span>{step + 1}</span></div>
    <div ref={panel} className="sign-in-tour-panel" role="dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      tabIndex={-1} style={{ top: panelTop, left: panelLeft, maxHeight: layout.panelMaxHeight }}>
      <header><span>{isRo ? 'GHID DE AUTENTIFICARE' : 'SIGN-IN GUIDE'} · {step + 1}/3</span>
        <button type="button" onClick={() => onClose()} aria-label={isRo ? 'Închide ghidul' : 'Close guide'} title={isRo ? 'Închide ghidul' : 'Close guide'}><X size={18} /></button>
      </header>
      <div className="sign-in-tour-heading"><Icon size={22} aria-hidden="true" /><h2 id={titleId}>{steps[step].title}</h2></div>
      {steps[step].text && <p>{steps[step].text}</p>}
      <div id={descriptionId} className="sign-in-tour-action"><Hand size={19} aria-hidden="true" /><p>{steps[step].action}</p></div>
      <footer>
        <BackButton type="button" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label={isRo ? 'Înapoi' : 'Back'} />
        {step < 2 ? <button type="button" className="sign-in-tour-next" aria-label={isRo ? 'Următorul' : 'Next'} title={isRo ? 'Următorul' : 'Next'} disabled={!touched} onClick={() => setStep(step + 1)}><ArrowRight size={16} aria-hidden="true" /></button>
          : <button type="button" className="sign-in-tour-next" aria-label={isRo ? 'Încheie ghidul' : 'Finish guide'} title={isRo ? 'Încheie ghidul' : 'Finish guide'} onClick={() => onClose(true)}><Check size={16} aria-hidden="true" /></button>}
      </footer>
    </div>
  </div>, document.body)
}
