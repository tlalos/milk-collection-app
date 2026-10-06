export function monthlyReconciliationGuideData(month: string) {
  const avizRows = [1, 2].map(number => ({
    id: `demo-aviz-${number}`, jobId: `demo-route-${number}`, sourceFile: 'Example aviz', fileUrl: '',
    documentDate: `${month}-${number === 1 ? '05' : '15'}`, route: 'R01', driverName: 'Example driver',
    vehicleRegistration: 'DEMO-01', rowNumber: number, noticeNumber: `DEMO-00${number}`, liters: 600,
  }))
  const monthlyRows = [1, 2].map(number => ({
    id: `demo-journal-${number}`, jobId: 'demo-journal', sourceFile: 'Example journal', fileUrl: '',
    documentDate: `${month}-28`, rowNumber: number, producer: `Example producer ${number}`,
    centerName: 'Example - Valea', milkType: 'MILK-COW', liters: number === 1 ? 600 : 605,
    confidence: 1, producerWarning: number === 2 ? 'No ERP match' : null,
  }))
  const base = { month, milkType: 'MILK-COW', avizLiters: 1200, monthlyLiters: 1205,
    differenceLiters: 5, differencePercent: 5 / 12, avizLineCount: 2, monthlyRowCount: 2, avizRows, monthlyRows }
  const single = { ...base, monthlyLiters: 0, differenceLiters: -1200, differencePercent: -100,
    monthlyRowCount: 0, monthlyRows: [], avizPricing: { centerCode: 'demo-single', producerName: 'Example sole producer',
      producerCode: 'demo-p1', approvedLiters: 1200, sourceFingerprint: 'demo-only',
      linkedProducers: [{ producerCode: 'demo-p1', producerName: 'Example sole producer' }] } }
  return {
    rows: [
      { ...base, id: 'demo-warning', center: 'Example - Valea', status: 'ok' as const },
      { ...base, id: 'demo-ok', center: 'Example - Verde', status: 'ok' as const,
        monthlyRows: monthlyRows.map(row => ({ ...row, producerWarning: null })) },
      { ...single, id: 'demo-single', center: 'Example - One producer', status: 'missing_monthly' as const },
      { ...base, id: 'demo-difference', center: 'Example - Difference', status: 'difference' as const,
        monthlyLiters: 1230, differenceLiters: 30, differencePercent: 2.5,
        monthlyRows: monthlyRows.map((row, i) => ({ ...row, liters: i === 0 ? 600 : 630, producerWarning: null })) },
      { ...single, id: 'demo-approved', center: 'Example - Approved', status: 'missing_monthly' as const,
        avizPricing: { ...single.avizPricing, centerCode: 'demo-approved' } },
      { ...base, id: 'demo-journal-only', center: 'Example - No aviz', status: 'missing_aviz' as const,
        avizLiters: 0, avizLineCount: 0, avizRows: [], monthlyLiters: 600, monthlyRowCount: 1,
        differenceLiters: 600, differencePercent: null,
        monthlyRows: [{ ...monthlyRows[0], id: 'demo-unmatched-journal', centerName: 'Example - No aviz', producerWarning: null }] },
    ],
    approvals: [{ approvalId: 'demo-approval', monthKey: month, centerCode: 'demo-approved',
      centerName: 'Example - Approved', producerName: 'Example sole producer', producerCode: 'demo-p1',
      milkType: 'MILK-COW', approvedLiters: 1200, status: 'APPROVED' }],
    centers: [{ name: 'Example - Valea', code: 'demo-valea' }, { name: 'Example - Correct center', code: 'demo-correct' }],
  }
}
