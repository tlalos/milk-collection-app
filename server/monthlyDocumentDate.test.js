import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMonthlyDocumentDate } from './monthlyDocumentDate.js'
import { MonthlySettlementEditableDocumentSchema, MonthlySettlementDocumentSchema } from './ocrSchema.js'
import { normalizeMonthlyData } from './ocrService.js'

const document = {
  documentType: 'journal_monthly_settlement', layoutType: 'detailed',
  date: '31/08/26', documentMonth: null, milkType: 'MILK-COW',
  headerCenterName: 'GILGAU', totalLiters: 783, rows: [], warnings: [], rawTranscription: '',
}

test('ISO and both displayed year formats resolve to the same calendar date', () => {
  for (const value of ['2026-08-31', '31/08/2026', '31/08/26', ' 31/08/26 ']) {
    assert.equal(normalizeMonthlyDocumentDate(value), '2026-08-31')
  }
  assert.equal(normalizeMonthlyDocumentDate('09/10/26'), '2026-10-09')
  assert.equal(normalizeMonthlyDocumentDate('01/01/00'), '2000-01-01')
  assert.equal(normalizeMonthlyDocumentDate('31/12/99'), '2099-12-31')
})

test('calendar validation rejects impossible dates without rolling into another month', () => {
  for (const value of ['31/04/26', '29/02/2026', '2026-02-29', '00/08/26', '31/00/26', '31/13/26', '2026-08-00']) {
    assert.equal(normalizeMonthlyDocumentDate(value), null, value)
  }
  assert.equal(normalizeMonthlyDocumentDate('29/02/24'), '2024-02-29')
  assert.equal(normalizeMonthlyDocumentDate('29/02/2000'), '2000-02-29')
  assert.equal(normalizeMonthlyDocumentDate('29/02/2100'), null)
})

test('missing, incomplete and unsupported dates are not guessed', () => {
  for (const value of [null, undefined, '', ' ', '31/08/2', '31/08/202', 'August 2026', '08/31/26', '2026-08']) {
    assert.equal(normalizeMonthlyDocumentDate(value), null)
  }
})

test('editable schema canonicalizes short dates and rejects invalid or cleared dates', () => {
  assert.equal(MonthlySettlementEditableDocumentSchema.parse(document).date, '2026-08-31')
  for (const date of [null, '', '31/08/2', '31/04/26']) {
    const result = MonthlySettlementEditableDocumentSchema.safeParse({ ...document, date })
    assert.equal(result.success, false)
    assert.deepEqual(result.error.issues[0].path, ['date'])
    assert.match(result.error.issues[0].message, /valid document date/)
  }
})

test('OCR schema stays nullable and normalization accepts a valid short year', () => {
  assert.equal(MonthlySettlementDocumentSchema.safeParse({ ...document, date: null }).success, true)
  const result = normalizeMonthlyData(document)
  assert.equal(result.date, '2026-08-31')
  assert.equal(result.totalLiters, 783)
  assert.equal(result.headerCenterName, 'GILGAU')
})

test('normalization does not replace an invalid existing date with a guessed date', () => {
  assert.equal(normalizeMonthlyData({ ...document, date: '31/04/26' }).date, '31/04/26')
  const daily = { ...document, documentType: 'daily_driver_statement' }
  assert.equal(normalizeMonthlyData(daily), daily)
})
