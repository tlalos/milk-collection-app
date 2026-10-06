import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeErpReferenceSnapshot } from './erpReferenceStore.js'
import { matchCentersForRows, matchMonthlyProducers } from './excelService.js'
import { fetchErpReferenceSuppliers } from './erpReferenceCenters.js'

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

test('county survives snapshot normalization independently of the legacy city field', () => {
  const snapshot = normalizeErpReferenceSnapshot({ ...erpReferences, producers: [
    { ...erpReferences.producers[0], city: 'Cluj-Napoca', county: ' CLUJ ' },
    { ...erpReferences.producers[1], city: 'SALAJ' },
  ] })
  assert.equal(snapshot.producers[0].county, 'CLUJ')
  assert.equal(snapshot.producers[0].city, 'Cluj-Napoca')
  assert.equal(snapshot.producers[1].county, '')
})

test('ERP supplier mapping uses sup_district for county without a city fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([
    { sup_code: 'C1', sup_name: 'Center' },
    { sup_code: 'P1', sup_name: 'Ana', sup_district: ' CLUJ ', sup_city: 'Cluj-Napoca' },
    { sup_code: 'P2', sup_name: 'Maria', sup_district: '', sup_city: 'Zalau' },
  ]), { headers: { 'Content-Type': 'application/json' } }))
  const mapped = await fetchErpReferenceSuppliers({ serverUrl: 'http://erp.example.test/api', apiUsername: 'test' }, 'test-token')
  const snapshot = normalizeErpReferenceSnapshot(mapped)
  assert.equal(snapshot.producers[0].county, 'CLUJ')
  assert.equal(snapshot.producers[1].county, '')
  assert.equal(snapshot.producers[1].city, 'Zalau')
})

test('payment terms survive snapshot normalization without defaulting missing values', () => {
  for (const code of [3030, '3080', '0', undefined]) {
    const snapshot = normalizeErpReferenceSnapshot({ ...erpReferences, producers: [{ ...erpReferences.producers[0], paymentTerms: code }] })
    assert.equal(snapshot.producers[0].paymentTerms, code === undefined ? '' : String(code))
  }
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
