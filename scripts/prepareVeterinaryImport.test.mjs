import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { planVeterinaryHerdImport, readVeterinaryHerdRows } from './prepareVeterinaryImport.mjs'

const row = (producerName, cowCount, sourceRow = 6, taxId = '123') => ({ producerName, cowCount, sourceRow, taxId })
const producer = (producerName, producerCode = 'p001', trn = '123') => ({ producerName, producerCode, trn })

test('skips only the approved names and the specific CLAPA row', () => {
  const rows = ['MORA ELVIRA', 'PRECUP DOCHIA', 'RUS TEODOR'].map(name => row(name, null))
  rows.push(row('CLAPA LAURENTIU DORU PFA', 1, 183), row('CLAPA LAURENTIU DORU PFA', 1, 220))
  const plan = planVeterinaryHerdImport(rows, [producer('CLAPA LAURENTIU DORU PFA')], [])
  assert.equal(plan.skipped.length, 4)
  assert.equal(plan.conflicts.length, 0)
  assert.deepEqual(plan.ready[0].sourceRows, [220])
})

test('Peter matches by CNP/CUI and identical duplicates are retained once', () => {
  const plan = planVeterinaryHerdImport([row('PETER GAVRIL', 1, 104), row('PETER GAVRIL', 1, 114)], [producer('PETER GAVRIL 203')], [])
  assert.equal(plan.ready.length, 1)
  assert.equal(plan.ready[0].cowCount, 1)
  assert.equal(plan.ready[0].matchedBy, 'cnp-cui')
  assert.deepEqual(plan.ready[0].sourceRows, [104, 114])
  assert.equal(plan.merged.length, 1)
})

test('Rus Maria keeps the largest count without summing, regardless of source order', () => {
  for (const counts of [[4, 1], [1, 4]]) {
    const plan = planVeterinaryHerdImport(counts.map((count, i) => row('RUS MARIA LUDOVICA', count, 132 + i)), [producer('RUS MARIA LUDOVICA')], [])
    assert.equal(plan.ready.length, 1)
    assert.equal(plan.ready[0].cowCount, 4)
    assert.equal(plan.conflicts.length, 0)
  }
})

test('blocks ambiguous matches, tax disagreements, missing counts and unapproved differing duplicates', () => {
  const cases = [
    [[row('OTHER', 1)], [producer('OTHER'), producer('OTHER', 'p002')]],
    [[row('OTHER', 1)], [producer('OTHER', 'p001', '456')]],
    [[row('OTHER', null)], [producer('OTHER')]],
    [[row('OTHER', -1)], [producer('OTHER')]],
    [[row('OTHER', 1.2)], [producer('OTHER')]],
    [[row('OTHER', 1), row('OTHER', 4, 7)], [producer('OTHER')]],
    [[row('PETER GAVRIL', 1)], [producer('PETER GAVRIL 203'), producer('PETER GAVRIL 204', 'p002')]],
  ]
  for (const [rows, producers] of cases) assert.ok(planVeterinaryHerdImport(rows, producers, []).conflicts.length)
})

test('tracks missing contracts without inventing contract data; normalizes whitespace and accents', () => {
  const plan = planVeterinaryHerdImport([row('  TEST  NAME ', 2)], [producer('T\u00c9ST NAME')], [{ producerCode: 'p001', milkType: 'MILK-SHEEP' }])
  assert.equal(plan.ready.length, 1)
  assert.equal(plan.ready[0].hasContract, false)
  assert.equal(plan.ready[0].contractNumber, undefined)
})

test('reads only cow records before the total and rejects shifted headers', () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('formular 1')
  for (const [address, value] of Object.entries({ C5: 'nume/denumire', D5: 'CNP/CUI', E3: 'Efectiv matca vaci de lapte (capete)', C6: 'OTHER', D6: '00123', E6: 4, A8: 'Total', E8: 4, C10: 'Footer' })) sheet.getCell(address).value = value
  assert.deepEqual(readVeterinaryHerdRows(workbook), [row('OTHER', 4, 6, '00123')])
  sheet.getCell('E3').value = 'Wrong field'
  assert.throws(() => readVeterinaryHerdRows(workbook), /Unexpected header/)
})
