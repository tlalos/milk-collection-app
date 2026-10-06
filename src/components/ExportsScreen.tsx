import { useContext } from 'react'
import { ChevronRight, FileOutput, FileSpreadsheet, LockKeyhole, Stethoscope } from 'lucide-react'
import { appPath, routePathname } from '../ocrPaths'
import { BackButton } from './BackButton'
import { OcrNavigation, OcrNavigationContext } from './OcrNavigation'
import { useOcrLanguage } from './OcrLanguage'
import { ApiaExportScreen } from './ApiaExportScreen'
import './ExportsScreen.css'

const exportOptions = [
  { path: '/ocr/exports/apia', label: 'APIA', icon: FileSpreadsheet, permission: 'monthly_reconciliation' },
  { path: '/ocr/exports/veterinary', label: 'Veterinary', icon: Stethoscope, permission: 'ocr_documents' },
]

export function ExportsScreen() {
  const { isRo } = useOcrLanguage()
  const context = useContext(OcrNavigationContext)
  const selected = exportOptions.find(option => option.path === routePathname())
  const title = selected?.label || (isRo ? 'Exporturi' : 'Exports')
  return <div className="exports-screen app-shell">
    <header className="app-topbar exports-topbar">
      <BackButton type="button" aria-label={isRo ? 'Înapoi' : 'Back'} onClick={() => { window.location.href = appPath(selected ? '/ocr/exports' : '/ocr') }} />
      <OcrNavigation />
      <div className="app-title-block"><span>{selected ? (isRo ? 'Exporturi' : 'Exports') : (isRo ? 'Documente OCR' : 'OCR documents')}</span><h1>{title}</h1></div>
    </header>
    <main className="exports-content">
      {selected?.label === 'APIA' ? <ApiaExportScreen /> : selected ? <section className="exports-empty" aria-label={title}>
        <FileOutput size={30} aria-hidden="true" />
        <p>{isRo ? 'Niciun șablon de export configurat.' : 'No export template configured.'}</p>
      </section> : <nav aria-label={isRo ? 'Tipuri de export' : 'Export types'} className="exports-list">
        {exportOptions.map(option => {
          const locked = !context?.user.isAdmin && !context?.user.permissions?.includes(option.permission)
          return <a key={option.path} href={locked ? undefined : appPath(option.path)}
            role={locked ? 'link' : undefined} tabIndex={locked ? 0 : undefined} aria-disabled={locked || undefined}
            title={locked ? (isRo ? 'Acces restrictionat' : 'Access restricted') : undefined}>
            <option.icon size={22} aria-hidden="true" /><span>{option.label}</span>
            {locked ? <LockKeyhole size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          </a>
        })}
      </nav>}
    </main>
  </div>
}
