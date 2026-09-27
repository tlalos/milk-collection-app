import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeErpReferenceSnapshot } from './erpReferenceStore.js'
import { matchCentersForRows, matchMonthlyProducers } from './excelService.js'

const erpReferences = {
  centers: [
    { code: 'C100', name: 'AGRIES 1' },
    { code: 'C101', name: 'VALEA CALDA' },
    { code: 'P999', name: 'Not a center' },
    { code: 'c100', name: 'Duplicate center' },
  ],
  producers: [
    { producerCode: 'P200', producerName: 'BIZO VALER', centerCode: 'C100', centerName: 'AGRIES 1', iban: 'RO123' },
    { producerCode: 'P201', producerName: 'BIZO VALER', centerCode: 'C101', centerName: 'VALEA CALDA' },
    { producerCode: 'C999', producerName: 'Not a producer' },
  ],
}

test('saved ERP references contain only distinct C* centers and P* producers', () => {
  const snapshot = normalizeErpReferenceSnapshot(erpReferences)
  assert.deepEqual(snapshot.centers, [
    { code: 'C100', name: 'AGRIES 1' },
    { code: 'C101', name: 'VALEA CALDA' },
  ])
  assert.equal(snapshot.producers.length, 2)
  assert.equal(snapshot.producers[0].producerCode, 'P200')
  assert.equal(snapshot.producers[0].iban, 'RO123')
})

test('an empty ERP response cannot replace the saved list', () => {
  assert.throws(() => normalizeErpReferenceSnapshot({ centers: [], producers: [] }), /not changed/u)
  assert.throws(() => normalizeErpReferenceSnapshot({ centers: erpReferences.centers, producers: [] }), /not changed/u)
})

test('daily and monthly OCR matches use ERP C* and P* references', async () => {
  const snapshot = normalizeErpReferenceSnapshot(erpReferences)
  const [daily] = await matchCentersForRows([{ rowNumber: 1, collectionCenter: 'AGRIES 1' }], { centers: snapshot.centers })
  assert.equal(daily.selectedCode, 'C100')

  const monthly = await matchMonthlyProducers({
    headerCenterName: 'AGRIES 1',
    rows: [{ rowNumber: 1, producer: 'BIZO VALER' }],
  }, snapshot)
  assert.equal(monthly.header.selectedCode, 'C100')
  assert.equal(monthly.rows[0].selectedCode, 'P200')
})
