import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { readElgoContracts } from './importProducerContracts.mjs'

function fixture() {
  const w = new ExcelJS.Workbook()
  const s = w.addWorksheet('elgo')
  for (const [cell, value] of Object.entries({ F1: 'Numar contract', G1: 'Data incheierii contractului\nzz/ll/aaaa', H1: 'Data incetarii contractului\nzz/ll/aaaa', I1: 'Cantitate de lapte contractata(total - kg)', V1: 'Producer_Code (helper)' })) s.getCell(cell).value = value
  s.getCell('F2').value = { formula: 'SEQUENCE(1)', result: 1 }
  s.getCell('G2').value = new Date('2026-06-01T00:00:00Z')
  s.getCell('H2').value = new Date('2027-06-01T00:00:00Z')
  s.getCell('I2').value = { formula: '100*12.8', result: 9900 }
  s.getCell('V2').value = { formula: '"p0000001"', result: 'p0000001' }
  s.getCell('X500').value = 'Unrelated note'
  return w
}

test('imports only approved cached values from F-I and column V, never recalculates formulas', () => {
  const rows = readElgoContracts(fixture())
  assert.deepEqual(rows, [{ producerCode: 'p0000001', milkType: 'MILK-COW', contractNumber: '1', contractStartDate: '2026-06-01', contractEndDate: '2027-06-01', contractedKg: 9900, sourceRow: 2 }])
})

test('missing formula caches, shifted headers, missing codes and ambiguous dates stop the import', () => {
  for (const [cell, value] of [['I2', { formula: '1+2' }], ['F1', 'Wrong header'], ['V2', null], ['G2', '01/06/26']]) {
    const w = fixture()
    w.getWorksheet('elgo').getCell(cell).value = value
    assert.throws(() => readElgoContracts(w))
  }
})

test('text contract numbers preserve leading zeros', () => {
  const w = fixture()
  w.getWorksheet('elgo').getCell('F2').value = '0001/26'
  assert.equal(readElgoContracts(w)[0].contractNumber, '0001/26')
})
