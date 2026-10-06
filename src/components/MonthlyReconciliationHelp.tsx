import { useCallback, useRef, useState, type ComponentType } from 'react'
import { Calculator, CircleAlert, CircleCheck, CircleQuestionMark, FileQuestion, LoaderCircle, Plus, UsersRound } from 'lucide-react'
import { useOcrLanguage } from './OcrLanguage'
import type { ReviewWalkthroughProps, WalkthroughStep } from './ReviewWalkthrough'
import './MonthlyReconciliationHelp.css'

interface Props { onStart: () => () => void; disabled: boolean }

export function MonthlyReconciliationHelp({ onStart, disabled }: Props) {
  const { isRo } = useOcrLanguage()
  const trigger = useRef<HTMLButtonElement>(null)
  const restore = useRef<(() => void) | null>(null)
  const [Guide, setGuide] = useState<ComponentType<ReviewWalkthroughProps> | null>(null)
  const [screen, setScreen] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const close = useCallback(() => {
    restore.current?.()
    restore.current = null
    setScreen(null)
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }, [])
  async function start() {
    setLoading(true)
    setFailed(false)
    try {
      const module = await import('./ReviewWalkthrough')
      const parent = trigger.current?.closest<HTMLElement>('.monthly-recon-screen')
      if (!parent) return
      restore.current = onStart()
      setGuide(() => module.default)
      setScreen(parent)
    } catch { setFailed(true) }
    finally { setLoading(false) }
  }
  const click = (selector: string) => screen?.querySelector<HTMLButtonElement>(selector)?.click()
  const expand = () => {
    click('.monthly-recon-modal:not(.monthly-aviz-dialog) .monthly-recon-modal-actions button:first-child')
    if (!screen?.querySelector('.monthly-recon-detail-grid')) click('.monthly-recon-expand')
  }
  const showJournals = () => click('.monthly-recon-journals-toggle[aria-expanded="false"]')
  const showApprovals = () => click('.monthly-recon-approvals-toggle[aria-expanded="false"]')
  const closeCorrection = () => click('.monthly-recon-modal:not(.monthly-aviz-dialog) .monthly-recon-modal-actions button:first-child')
  const showCases = () => {
    closeCorrection()
    if (screen?.querySelector('.monthly-recon-detail-grid')) click('.monthly-recon-expand[aria-label="Collapse details"]')
    click('.monthly-recon-journals-toggle[aria-expanded="true"]')
    click('[data-guide-row="demo-single"] .monthly-recon-producer-count button[aria-expanded="true"]')
    screen?.querySelector('.monthly-recon-table-wrap')?.scrollTo({ left: 0, behavior: 'instant' })
  }
  const showSingleProducer = () => {
    closeCorrection()
    click('.monthly-aviz-dialog-actions button:first-child')
    click('.monthly-recon-journals-toggle[aria-expanded="true"]')
    if (screen?.querySelector('.monthly-recon-detail-grid')) click('.monthly-recon-expand[aria-label="Collapse details"]')
    click('[data-guide-row="demo-single"] .monthly-recon-producer-count button[aria-expanded="false"]')
    screen?.querySelector('.monthly-recon-table-wrap')?.scrollTo({ left: 0, behavior: 'instant' })
  }
  const text = (en: string, ro: string) => isRo ? ro : en
  const steps: WalkthroughStep[] = [
    { title: text('Choose the month', 'Alegeți luna'), selector: '.monthly-recon-toolbar input[type="month"]', hideSafetyNote: true, interactiveTarget: true,
      text: text('Choose the month to compare daily aviz liters with monthly journal liters.', 'Alegeți luna pentru a compara litrii din avizele zilnice cu litrii din jurnalele lunare.') },
    { title: text('Green: totals match', 'Verde: totalurile corespund'), selector: '[data-guide-row="demo-ok"]', prepare: showCases, keepPageVisible: true, panelBelowTarget: true, targetClassName: 'monthly-recon-guide-case', icon: CircleCheck,
      text: text('Aviz matches journals', 'Avizele corespund jurnalelor'),
      sideNote: { title: text('Green with a warning', 'Verde cu avertizare'), selector: '[data-guide-row="demo-warning"]', icon: CircleAlert,
        text: text('The totals are within tolerance, but Check details to correct warnings.', 'Totalurile sunt în toleranță, dar verificați detaliile (Check details) pentru a corecta avertizările.') } },
    { title: text('White: no journal', 'Alb: fără jurnal'), selector: '[data-guide-row="demo-single"]', prepare: showCases, keepPageVisible: true, panelBelowTarget: true, targetClassName: 'monthly-recon-guide-case', icon: FileQuestion,
      text: text('The monthly journal has not been received yet.', 'Jurnalul lunar nu a fost încă primit.'),
      sideNote: { title: text('Orange: check the difference', 'Portocaliu: verificați diferența'), selector: '[data-guide-row="demo-difference"]', icon: CircleAlert,
        text: text('The 30-liter difference exceeds the 10-liter tolerance. Expand the row to check the quantities.', 'Diferența de 30 de litri depășește toleranța de 10 litri. Deschideți rândul pentru a verifica valorile.') } },
    { title: text('Aviz and journals', 'Avize și jurnale'), selector: '.monthly-recon-detail-grid', prepare: expand, keepPageVisible: true, panelBelowTarget: true, targetClassName: 'monthly-recon-guide-details',
      text: text('Aviz on the left, journals on the right. Errors are marked: see the highlighted warning.', 'Avizele sunt în stânga, jurnalele în dreapta. Erorile sunt marcate: vedeți avertizarea evidențiată.') },
    { title: text('Open source picture', 'Deschideți imaginea sursă'), selector: '.monthly-recon-detail-grid', prepare: expand, keepPageVisible: true, panelBelowTarget: true, targetClassName: 'monthly-recon-guide-details monthly-recon-guide-actions',
      text: text('Both Open buttons show the source picture: aviz on the left, journal on the right.', 'Ambele butoane Open afișează imaginea sursă: avizul în stânga, jurnalul în dreapta.'),
      sideNote: { title: text('Change aviz center', 'Schimbați centrul avizului'), text: text('Press the pencil icon to open a window where you can change the center for this aviz row only.', 'Apăsați pictograma creion pentru a deschide o fereastră în care puteți schimba centrul doar pentru acest rând de aviz.') } },
    { title: text('Move all aviz rows', 'Schimbați centrul pentru toate avizele'), selector: '.monthly-recon-detail-heading button', prepare: () => { closeCorrection(); expand() },
      text: text('Press Change aviz center to change the entire aviz list to another center.', 'Apăsați Change aviz center pentru a muta întreaga listă de avize la alt centru.') },
    { title: text('Open the received journals', 'Deschideți jurnalele primite'), selector: '.monthly-recon-journal-centers', prepare: showJournals, keepPageVisible: true, panelBelowTarget: true,
      text: text('Press Journals beside Monthly journals Vs Aviz to see the journal centers received for the selected month, including those without a matching aviz.', 'Apăsați Journals lângă Monthly journals Vs Aviz pentru a vedea centrele cu jurnale primite în luna selectată, inclusiv cele fără aviz corespondent.') },
    { title: text('Check the linked producer', 'Verificați producătorul asociat'), selector: '[data-guide-row="demo-single"]', prepare: showSingleProducer, keepPageVisible: true, panelBelowTarget: true, targetClassName: 'monthly-recon-guide-pricing', icon: UsersRound,
      text: text('Expand the producer count to see who belongs to this center in ERP.', 'Deschideți lista pentru a vedea producătorul asociat acestui centru în ERP.'),
      sideNote: { title: text('Use aviz for pricing', 'Folosiți avizele pentru calculul prețului'), icon: Calculator,
        text: text('With no journal and one eligible ERP producer, an authorized user can use aviz liters for pricing.', 'Fără jurnal și cu un singur producător ERP eligibil, un utilizator autorizat poate folosi litrii din avize la calculul prețului.') } },
    { title: text('Aviz pricing approvals', 'Aprobări pentru calculul prețului din avize'), selector: '.monthly-aviz-approvals', relatedSelector: '.monthly-recon-approvals-toggle', keepPageVisible: true, panelBelowTarget: true, icon: Plus,
      prepare: () => { click('.monthly-aviz-dialog-actions button:first-child'); showApprovals() },
      text: text('Press + beside Aviz pricing approvals to display the approved entries shown here.', 'Apăsați + lângă Aviz pricing approvals pentru a afișa lista aprobărilor, ca în exemplul de aici.') },
  ]
  const label = text('Monthly reconciliation guide', 'Ghid reconciliere lunară')
  return <>
    <button ref={trigger} className="monthly-recon-header-button monthly-recon-help-button" type="button" onClick={start} disabled={disabled || loading}
      title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={Boolean(screen)} aria-busy={loading}>
      {loading ? <LoaderCircle size={22} aria-hidden="true" /> : <CircleQuestionMark size={28} aria-hidden="true" />}
    </button>
    {failed && <span role="alert">{text('Could not load the guide. Try again.', 'Ghidul nu s-a încărcat. Încercați din nou.')}</span>}
    {screen && Guide && <Guide screen={screen} kind="monthly" customSteps={steps.map(step => ({ ...step, hideSafetyNote: true }))} guideTitle={text('MONTHLY GUIDE', 'GHID LUNAR')} onClose={close} />}
  </>
}
