import { useContext } from 'react'
import { ExternalLink } from 'lucide-react'
import { OcrNavigationContext } from './OcrNavigation'
import { appPath } from '../ocrPaths'
import { numberOrNull } from './dailyReconciliationModel'
import type { CmrComparison, CmrComparisonStatus } from './cmrReconciliationModel'

export const cmrStatusLabels: Record<CmrComparisonStatus, string> = {
  only_cmr: 'Only CMR', only_scale: 'Only scale', match_available: 'Match available', needs_review: 'Needs review',
  awaiting_weight: 'Awaiting weight', linked: 'Both', difference: 'Difference', missing_info: 'Missing date or truck',
}
export function cmrQuantity(value: unknown, unit: string) {
  const numeric = numberOrNull(value)
  return numeric === null ? '-' : `${numeric.toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${unit}`
}
export function formatCmrTotals(totals: { kg: number | null; L: number | null }) {
  return (['kg', 'L'] as const).filter(unit => totals[unit] !== null).map(unit => cmrQuantity(totals[unit], unit)).join(' / ') || '-'
}

export function CmrReconciliationRows({ rows }: { rows: CmrComparison[] }) {
  const context = useContext(OcrNavigationContext)
  const canReview = Boolean(context?.user.isAdmin || context?.user.permissions?.includes('ocr_documents'))
  return <>
    {rows.length > 0 && <div className="daily-recon-other-heading" role="row"><span role="cell">Others: receptions and CMRs <strong>{rows.length}</strong></span></div>}
    {rows.map(row => <div className={`daily-recon-grid-row daily-recon-other-row ${row.status === 'only_cmr' ? 'daily-recon-cmr-only' : ''} ${row.status === 'linked' ? '' : 'needs-attention'}`} role="row" key={row.id} data-cmr-status={row.status}>
      <div className="daily-recon-identity" role="cell">
        <div className="daily-recon-identity-top">
          <strong>{row.reception?.vehicleRegistration || row.documents[0]?.vehicleRegistration || 'Truck missing'}</strong>
          <span className={`daily-recon-presence ${row.status === 'only_cmr' ? 'aviz-only' : row.status === 'linked' ? 'both' : 'unresolved'}`}>{cmrStatusLabels[row.status]}</span>
        </div>
        {row.status === 'only_cmr' && <span>{row.date.split('-').reverse().join('/')}</span>}
        {row.reception && <><span>{row.reception.receptionId}</span><span>{row.reception.milkTypeLabel || ''}{row.reception.driverName ? ` · ${row.reception.driverName}` : ''}</span></>}
        {row.reception?.comments && <span>{row.reception.comments}</span>}
        {row.status === 'match_available' && <small>{row.reception ? 'Only scale until confirmed' : 'Only CMR until confirmed'}</small>}
        {[...row.documents, ...row.suggestions].map(doc => <div className="daily-recon-cmr-document" key={doc.id}>
          <span>{doc.sourceFile || doc.id}{doc.avizNumber ? ` · Aviz ${doc.avizNumber}` : ''}</span>
          {doc.supplier && <small>{doc.supplier}</small>}
          {canReview ? <a href={appPath(`/ocr/cmr-review?id=${encodeURIComponent(doc.id)}`)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{row.status === 'linked' || row.status === 'difference' || row.status === 'awaiting_weight' ? 'Open CMR' : 'Review match'}</a>
            : <small>OCR documents access required to review</small>}
        </div>)}
        {row.status === 'only_cmr' && <small className="daily-recon-record-status">No scale reception</small>}
      </div>
      <div className="daily-recon-measure" role="cell" data-label="Scale final">
        <strong>{row.unit === 'kg' ? cmrQuantity(row.reception?.netQuantityKg, 'kg') : cmrQuantity(row.reception?.calculatedLiters, 'L')}</strong>
        {row.reception && <><span>{row.unit === 'kg' ? cmrQuantity(row.reception.calculatedLiters, 'L') : `Net ${cmrQuantity(row.reception.netQuantityKg, 'kg')}`}</span><span>Loaded {cmrQuantity(row.reception.fullTruckWeightKg, 'kg')}</span><span>Empty {cmrQuantity(row.reception.emptyTruckWeightKg, 'kg')}</span></>}
      </div>
      <div className="daily-recon-measure" role="cell" data-label="CMR">
        {row.documents.length ? row.documents.map(doc => <strong key={doc.id}>{cmrQuantity(doc.quantity, doc.quantityUnit)}</strong>) : <strong>-</strong>}
      </div>
      <div className={`daily-recon-measure ${row.status === 'difference' ? 'difference' : ''}`} role="cell" data-label="Difference"><strong>{cmrQuantity(row.difference, row.unit || '')}</strong></div>
    </div>)}
  </>
}
