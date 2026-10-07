import { createContext, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, CalendarCheck, ClipboardCheck, FileOutput, FileScan, House, Landmark, LockKeyhole, Menu, Scale, Settings, Truck, X } from 'lucide-react'
import { appPath, routePathname } from '../ocrPaths'
import './OcrNavigation.css'

const pages = [
  { path: '/ocr/upload', label: 'OCR documents', permission: 'ocr_documents', icon: FileScan, children: ['/ocr/review', '/ocr/monthly-review', '/ocr/compare'] },
  { path: '/ocr/settings', label: 'OCR settings', permission: 'ocr_settings', icon: Settings },
  { path: '/ocr/archive-history', label: 'Backup history', permission: 'backup_history', icon: Archive },
  { path: '/milk-reception', label: 'Milk Reception', permission: 'milk_reception', icon: Scale },
  { path: '/milk-deliveries', label: 'Milk Deliveries', permission: 'milk_reception', icon: Truck, children: ['/milk-factors'] },
  { path: '/daily-aviz', label: 'Daily Aviz', permission: 'daily_aviz', icon: ClipboardCheck },
  { path: '/daily-reconciliation', label: 'Daily Reconciliation', permission: 'daily_reconciliation', icon: CalendarCheck },
  { path: '/monthly-reconciliation', label: 'Monthly Reconciliation', permission: 'monthly_reconciliation', icon: CalendarCheck },
  { path: '/month-closure', label: 'Month Closure & Payments', permission: 'month_closure', icon: Landmark, children: ['/bank-note'] },
  { path: '/ocr/exports', label: 'Exports', permission: 'exports', icon: FileOutput, children: ['/ocr/exports/apia', '/ocr/exports/veterinary', '/ocr/exports/veterinary/animal-counts'] },
]

export function hasOcrNavigation() {
  const path = routePathname()
  return pages.some(page => page.path === path || page.children?.includes(path))
}

interface Props {
  user: { isAdmin?: boolean; permissions?: string[] }
  isRo: boolean
}

export const OcrNavigationContext = createContext<Props | null>(null)

export function OcrNavigation() {
  const context = useContext(OcrNavigationContext)
  return context ? <OcrNavigationMenu {...context} /> : null
}

function OcrNavigationMenu({ user, isRo }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const path = routePathname()
  const close = () => dialog.current?.close()

  return <>
    <button ref={trigger} type="button" className="ocr-navigation-trigger"
      title={isRo ? 'Meniu pagini' : 'Page menu'} aria-label={isRo ? 'Meniu pagini' : 'Page menu'}
      aria-haspopup="dialog" aria-expanded={open} aria-controls="ocr-navigation"
      onClick={() => { dialog.current?.showModal(); setOpen(true) }}>
      <Menu size={21} aria-hidden="true" />
    </button>
    {createPortal(<dialog ref={dialog} id="ocr-navigation" className="ocr-navigation-drawer"
      aria-labelledby="ocr-navigation-title"
      onClose={() => { setOpen(false); trigger.current?.focus() }}
      onKeyDown={event => {
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], a[aria-disabled="true"]')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
      }}>
      <div className="ocr-navigation-heading">
        <h2 id="ocr-navigation-title">{isRo ? 'Meniu OCR' : 'OCR menu'}</h2>
        <button type="button" onClick={close} aria-label={isRo ? 'Închideți meniul' : 'Close menu'} title={isRo ? 'Închideți meniul' : 'Close menu'}><X size={20} aria-hidden="true" /></button>
      </div>
      <nav aria-label={isRo ? 'Pagini OCR' : 'OCR pages'}>
        <a href={appPath('/ocr')} className="ocr-navigation-home"><House size={19} aria-hidden="true" /><span>Main menu</span></a>
        {pages.map(page => {
          const locked = !user.isAdmin && !user.permissions?.includes(page.permission)
          const active = page.path === path || page.children?.includes(path)
          const lockLabel = isRo ? 'Acces restricționat' : 'Access restricted'
          return <a key={page.path} href={locked ? undefined : appPath(page.path)} className={locked ? 'locked' : active ? 'active' : undefined}
            role={locked ? 'link' : undefined} tabIndex={locked ? 0 : undefined} aria-disabled={locked || undefined}
            title={locked ? lockLabel : undefined} aria-label={locked ? `${page.label}: ${lockLabel}` : undefined}
            aria-current={page.path === path ? 'page' : active ? 'location' : undefined}>
            <page.icon size={19} aria-hidden="true" /><span>{page.label}</span>
            {locked && <LockKeyhole className="ocr-navigation-lock" size={16} aria-hidden="true" />}
          </a>
        })}
      </nav>
    </dialog>, document.body)}
  </>
}
