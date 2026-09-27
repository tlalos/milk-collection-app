export function ocrFileJobId(route) {
  return /^\/jobs\/([^/]+)\/file$/u.exec(route)?.[1] || null
}

export function ocrPermissionsForRoute(route, documentCategory = '') {
  if (route === '/settings') return ['ocr_settings']
  if (route === '/reference-suppliers') return ['ocr_documents', 'month_closure']
  if (route === '/daily-aviz/rows') return ['daily_aviz']
  if (route === '/monthly-reconciliation/rows' || route === '/monthly-reconciliation/aviz-center' || route === '/issues') {
    return ['monthly_reconciliation']
  }
  if (ocrFileJobId(route)) {
    if (documentCategory === 'daily_routes') {
      return ['ocr_documents', 'daily_aviz', 'daily_reconciliation', 'monthly_reconciliation']
    }
    if (documentCategory === 'journal_monthly_settlement') {
      return ['ocr_documents', 'monthly_reconciliation']
    }
  }
  return ['ocr_documents']
}
