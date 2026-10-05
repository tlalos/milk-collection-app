import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const built = await build({ entryPoints: ['src/invoiceBatch.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { runInvoiceBatch } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)
const invoice = code => ({ selection: { month: '2026-08', producerCode: code, milkType: 'MILK-COW', invoiceDate: '2026-08-31' }, snapshot: { total: 100 }, fingerprint: code })

test('batch sends one document at a time, skips blocked previews, and records ERP IDs', async () => {
  const calls = []
  let active = 0
  const results = await runInvoiceBatch([invoice('p1'), { ...invoice('p2'), error: 'Locked' }, invoice('p3')], async value => {
    assert.equal(active++, 0)
    await Promise.resolve()
    active--
    calls.push(value.selection.producerCode)
    return { erpId: value.fingerprint }
  }, () => {}, () => false)
  assert.deepEqual(calls, ['p1', 'p3'])
  assert.deepEqual(results.map(row => row.status), ['sent', 'blocked', 'sent'])
  assert.equal(results[2].erpId, 'p3')
})

test('uncertain failures stop later invoices without retrying or losing prior success', async () => {
  const calls = []
  const states = []
  const results = await runInvoiceBatch([invoice('p1'), invoice('p2'), invoice('p3')], async value => {
    calls.push(value.fingerprint)
    if (value.fingerprint === 'p2') throw new Error('Timed out')
    return { erpId: '123' }
  }, update => states.push(update), () => false)
  assert.deepEqual(calls, ['p1', 'p2'])
  assert.deepEqual(results.map(row => row.status), ['sent', 'failed', 'not_sent'])
  assert.equal(results[0].erpId, '123')
  assert.equal(results[1].error, 'Timed out')
  assert.deepEqual(states.at(-1), results)
})

test('stop finishes only the current invoice and does not start the next', async () => {
  let stopped = false
  const results = await runInvoiceBatch([invoice('p1'), invoice('p2')], async () => {
    stopped = true
    return { erpId: '123' }
  }, () => {}, () => stopped)
  assert.deepEqual(results.map(row => row.status), ['sent', 'not_sent'])
})

test('missing ERP confirmation stops the batch and missing fingerprints never send', async () => {
  let sends = 0
  const results = await runInvoiceBatch([{ ...invoice('p1'), fingerprint: undefined }, invoice('p2'), invoice('p3')], async () => {
    sends++
    return {}
  }, () => {}, () => false)
  assert.equal(sends, 1)
  assert.deepEqual(results.map(row => row.status), ['blocked', 'failed', 'not_sent'])
})
