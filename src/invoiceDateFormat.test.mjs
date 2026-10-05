import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/invoiceDateFormat.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { displayInvoiceDate, parseInvoiceDate, maskInvoiceDate } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('date entry inserts separators and rejects non-numeric content', () => {
  assert.equal(maskInvoiceDate('3'), '3')
  assert.equal(maskInvoiceDate('310'), '31/0')
  assert.equal(maskInvoiceDate('31082026'), '31/08/2026')
  assert.equal(maskInvoiceDate('31/08/2026'), '31/08/2026')
  assert.equal(maskInvoiceDate('abc'), '')
  assert.equal(maskInvoiceDate('31x08y202699'), '31/08/2026')
})

test('invoice dates always display and parse day first', () => {
  assert.equal(displayInvoiceDate('2026-08-31'), '31/08/2026')
  assert.equal(parseInvoiceDate('03/09/2026'), '2026-09-03')
  assert.equal(parseInvoiceDate('31/08/2026'), '2026-08-31')
  assert.equal(parseInvoiceDate('29/02/2028'), '2028-02-29')
})

test('invalid or ambiguous formats cannot be applied', () => {
  for (const value of ['', '28/19/2026', '32/01/2026', '08/31/2026', '31/04/2026', '29/02/2026', '00/09/2026', '01/13/2026', '01/01/0000', '3/9/26', '2026-09-03']) {
    assert.equal(parseInvoiceDate(value), null, value)
  }
})
