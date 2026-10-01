import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { MilkCollectionEditableDocumentSchema, MonthlySettlementEditableDocumentSchema } from '../server/ocrSchema.js'

const built = await build({ entryPoints: ['src/ocrManualRows.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { nextOcrRowNumber } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('new row numbers account for saved rows, matches and ERP history', () => {
  assert.equal(nextOcrRowNumber([], undefined), 1)
  assert.equal(nextOcrRowNumber([{ rowNumber: 1 }], [{ rowNumber: 3 }], [{ rowNumber: 5 }]), 6)
})

test('both editable OCR schemas retain manual provenance', () => {
  const daily = MilkCollectionEditableDocumentSchema.shape.rows.element.parse({
    rowNumber: 1, collectionCenter: 'Center', milkType: 'MILK-COW', liters: 100,
    fatPercent: null, density: null, water: null, temperature: null,
    noticeNumber: '123', confidence: 1, uncertainFields: [], manual: true,
  })
  const monthly = MonthlySettlementEditableDocumentSchema.shape.rows.element.parse({
    rowNumber: 1, producer: 'Producer', centerName: null, milkType: 'MILK-COW', liters: 100,
    ugPercent: null, gValue: null, confidence: 1, uncertainFields: [], manual: true,
  })
  assert.equal(daily.manual, true)
  assert.equal(monthly.manual, true)
})
