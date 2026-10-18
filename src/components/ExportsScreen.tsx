import { ChevronRight, FileSpreadsheet, ListChecks, Stethoscope } from 'lucide-react'
import { appPath, routePathname } from '../ocrPaths'
import { BackButton } from './BackButton'
import { OcrNavigation } from './OcrNavigation'
import { useOcrLanguage } from './OcrLanguage'
import { ApiaExportScreen } from './ApiaExportScreen'
import { VeterinaryExportScreen } from './VeterinaryExportScreen'
import { VeterinaryAnimalCountsScreen } from './VeterinaryAnimalCountsScreen'
import { ProducerContractsScreen } from './ProducerContractsScreen'
import './ExportsScreen.css'

const exportOptions = [
  { path: '/ocr/exports/apia', label: 'APIA', icon: FileSpreadsheet },
  { path: '/ocr/exports/veterinary', label: 'Veterinary', icon: Stethoscope },
]

export function ExportsScreen() {
  const { isRo } = useOcrLanguage()
  const managingCounts = routePathname() === '/ocr/exports/veterinary/animal-counts'
  const managingContracts = routePathname() === '/ocr/exports/apia/contracts'
  const selected = exportOptions.find(option => option.path === routePathname() || managingCounts && option.label === 'Veterinary' || managingContracts && option.label === 'APIA')
  const title = managingContracts ? (isRo ? 'Contracte producatori' : 'Producer contracts') : managingCounts ? (isRo ? 'Efective animale' : 'Animal counts') : selected?.label || (isRo ? 'Exporturi' : 'Exports')
  return <div className="exports-screen app-shell">
    <header className="app-topbar exports-topbar">
      <BackButton type="button" aria-label={isRo ? 'Înapoi' : 'Back'} onClick={() => { window.location.href = appPath(managingContracts ? `/ocr/exports/apia${window.location.search}` : managingCounts ? `/ocr/exports/veterinary${window.location.search}` : selected ? '/ocr/exports' : '/ocr') }} />
      <OcrNavigation />
      <div className="app-title-block"><span>{selected ? (isRo ? 'Exporturi' : 'Exports') : (isRo ? 'Documente OCR' : 'OCR documents')}</span><h1>{title}</h1></div>
      {selected?.label === 'Veterinary' && !managingCounts && <button type="button" className="exports-header-action" onClick={() => { window.location.href = appPath(`/ocr/exports/veterinary/animal-counts${window.location.search}`) }}><ListChecks size={19} aria-hidden="true" />{isRo ? 'Efective animale' : 'Animal counts'}</button>}
      {selected?.label === 'APIA' && !managingContracts && <button type="button" className="exports-header-action" onClick={() => { window.location.href = appPath(`/ocr/exports/apia/contracts${window.location.search}`) }}><ListChecks size={19} aria-hidden="true" />{isRo ? 'Contracte' : 'Contracts'}</button>}
    </header>
    <main className="exports-content">
      {managingContracts ? <ProducerContractsScreen /> : managingCounts ? <VeterinaryAnimalCountsScreen /> : selected?.label === 'APIA' ? <ApiaExportScreen /> : selected ? <VeterinaryExportScreen /> : <nav aria-label={isRo ? 'Tipuri de export' : 'Export types'} className="exports-list">
        {exportOptions.map(option => <a key={option.path} href={appPath(option.path)}>
            <option.icon size={22} aria-hidden="true" /><span>{option.label}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </a>)}
      </nav>}
    </main>
  </div>
}
