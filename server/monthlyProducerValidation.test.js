import test from 'node:test'
import assert from 'node:assert/strict'
import { matchingMonthlyProducer, reconcileMonthlyProducerMatches, monthlyProducerWarning, monthlyPricingProducerWarning, matchingMonthlyHeader, reconcileMonthlyHeader } from './monthlyProducerValidation.js'

test('edited headers cannot keep stale center identity; exact ERP names save together', () => {
 const old = {selectedCode:'c22', selectedName:'BATIN 2',originalName:'Batin',status:'auto_replaced',suggestions:[]}
 const name = 'BATIN - MUNTII VLADESEI COOP. AGRICOLA'
 assert.equal(matchingMonthlyHeader(name,old).selectedCode,null)
 assert.equal(matchingMonthlyHeader(' batin 2 ',old),old)
 const result = reconcileMonthlyHeader(name,old,[{code:'c89',name}])
 assert.equal(result.selectedCode,'c89')
 assert.equal(result.selectedName,name)
 assert.equal(result.originalName,'Batin')
 assert.equal(reconcileMonthlyHeader('Unknown',old,[{code:'c89',name}]).selectedCode,null)
 assert.equal(reconcileMonthlyHeader(name,old,[{code:'c89',name},{code:'c90',name}]).selectedCode,null)
 assert.equal(old.selectedCode,'c22')
})

test('pricing requires an explicit P code and the correct ERP center', () => {
 const refs = {centers:[{code:'c1',name:'AGRIES'}], producers:[{producerCode:'p1',producerName:'PERSON',centerCode:'c1'}]}
 const row = {producer:'PERSON',producerCode:'p1',centerName:'AGRIES'}
 assert.equal(monthlyPricingProducerWarning(row, refs), null)
 assert.equal(monthlyPricingProducerWarning({...row,producerCode:null}, refs), 'No ERP match')
 assert.equal(monthlyPricingProducerWarning({...row,producerCode:'c1'}, refs), 'No ERP match')
 assert.equal(monthlyPricingProducerWarning({...row,centerName:'OTHER'}, refs), 'Wrong center')
 assert.equal(monthlyPricingProducerWarning({...row,producer:'UNKNOWN'}, refs), 'No ERP match')
 assert.equal(monthlyPricingProducerWarning(row, null), 'ERP list unavailable')
})

test('journal warnings distinguish unmatched names from wrong centers', () => {
  const refs = {centers:[{code:'c1', name:'AGRIES 1'}, {code:'c2', name:'OTHER'}],
    producers:[{producerCode:'p1', producerName:'RUS MARIA LUDOVICA', centerCode:'c1', centerName:'AGRIES 1'}]}
  const row = {producer:'RUS MARIA LUDOVICA', producerCode:'p1', centerName:'AGRIES 1'}
  assert.equal(monthlyProducerWarning(row, refs), null)
  assert.equal(monthlyProducerWarning({...row, centerName:'OTHER'}, refs), 'Wrong center')
  assert.equal(monthlyProducerWarning({...row, producer:'RUS MARIA'}, refs), 'No ERP match')
  assert.equal(monthlyProducerWarning({...row, producerCode:null, producer:'RUS MARIA'}, refs), 'No ERP match')
  assert.equal(monthlyProducerWarning({...row, producerCode:null}, refs), null)
  assert.equal(monthlyProducerWarning({...row, producerCode:'unknown'}, refs), 'No ERP match')
  assert.equal(monthlyProducerWarning(row, null), 'ERP list unavailable')
})

const match = { rowNumber: 20, selectedCode: 'p0000341', selectedName: 'RUS MARIA LUDOVICA', originalName: 'OCR original', status: 'confirmed', suggestions: [] }
test('producer rename clears stale identity without changing OCR evidence', () => {
  const result = matchingMonthlyProducer({ producer: 'RUS MARIA' }, match)
  assert.equal(result.selectedCode, null)
  assert.equal(result.selectedName, null)
  assert.equal(result.status, 'unmatched')
  assert.equal(result.originalName, match.originalName)
  assert.deepEqual(result.suggestions, match.suggestions)
  assert.equal(match.selectedCode, 'p0000341')
})
test('unchanged names and explicit valid selections retain identity', () => {
  assert.equal(matchingMonthlyProducer({ producer: ' rus maria  ludovica ' }, match), match)
  const replacement = { ...match, selectedCode: 'p2', selectedName: 'OTHER PERSON' }
  assert.equal(matchingMonthlyProducer({ producer: 'OTHER PERSON' }, replacement), replacement)
})
test('save reconciliation clears stale matches and removes deleted rows', () => {
  const rows = [{ rowNumber: 20, producer: 'RUS MARIA' }]
  const result = reconcileMonthlyProducerMatches(rows, [match, { ...match, rowNumber: 21 }])
  assert.equal(result.length, 1)
  assert.equal(result[0].selectedCode, null)
  assert.deepEqual(reconcileMonthlyProducerMatches(rows, []), [])
})
