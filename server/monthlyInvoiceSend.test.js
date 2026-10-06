import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInvoicePreview, executeInvoiceSend, connectInvoiceErp } from './monthlyInvoiceSend.js'
const row = { month: '2026-08', producerCode: 'p1', producer: 'Example', milkType: 'MILK-COW', source: 'journal', readyForPricing: true, reconciliationDifferenceLiters: 5, reconciliationStatus: 'ok', liters: 963, price: 1, commission: 737, electricity: 0 }
const supplier = { sup_code: 'p1', sup_id: 1234, sup_bool01: 1, sup_bool02: 0, sup_payment: 3030 }
const preview = () => buildInvoicePreview(row, supplier, '2026-08-31', 'zg1', { par_from_branch: 1, par_to_branch: 2 })

test('invoice payload follows agreed price, series, payment and internal number rules', () => {
  const p = preview()
  assert.equal(p.payload.length, 1)
  assert.equal(p.payload[0].price, 1.765317)
  assert.equal(p.payload[0].paymentid, '3030')
  assert.equal(p.payload[0].salespickingseries, 5106)
  assert.equal(p.payload[0].internalnum, '608311234')
  assert.equal(p.payload[0].fromstore, '110')
  assert.equal(p.payload[0].tostore, '0')
  assert.equal(p.snapshot.total, 1836)
  const regular = buildInvoicePreview(row, { ...supplier, sup_bool01: 0, sup_bool02: 1, sup_payment: 3080, sup_vatstatus_name: 'Regular' }, '2026-08-31', 'zg1')
  assert.equal(regular.payload[0].vatid, '11')
  assert.equal(regular.payload[0].paymentid, '3080')
  assert.equal(regular.snapshot.series, 5105)
})

test('invalid or blocked source data cannot be sent', () => {
  for (const change of [{ price: null }, { duplicateProducer: true }, { readyForPricing: false }, { reconciliationDifferenceLiters: -10.001 }, { reconciliationDifferenceLiters: 10.001 }, { producerWarning: 'Mismatch' }, { liters: 0 }]) {
    assert.throws(() => buildInvoicePreview({ ...row, ...change }, supplier, '2026-08-31', 'zg1'))
  }
  assert.throws(() => buildInvoicePreview(row, { ...supplier, sup_payment: null }, '2026-08-31', 'zg1'))
})

test('invoice preview accepts differences up to ten liters in either direction', () => {
  for (const difference of [-10, -6, 0, 6, 10]) {
    assert.doesNotThrow(() => buildInvoicePreview({ ...row, reconciliationDifferenceLiters: difference }, supplier, '2026-08-31', 'zg1'))
  }
})

test('send persists claim before ERP and records success once', async () => {
  const events = []
  const result = await executeInvoiceSend(preview(), async () => { events.push('claim'); return { attemptId: 'a' } }, async value => { events.push('finish'); assert.equal(value.erpId, '42') }, async () => { events.push('send'); return { status: true, newid: '42' } })
  assert.deepEqual(events, ['claim', 'send', 'finish'])
  assert.equal(result.erpId, '42')
})

test('failed claims never send; uncertain responses are never retried', async () => {
  let sends = 0
  await assert.rejects(executeInvoiceSend(preview(), async () => { throw new Error('locked') }, async () => {}, async () => { sends++ }), /locked/)
  assert.equal(sends, 0)
  let recorded
  await assert.rejects(executeInvoiceSend(preview(), async () => ({ attemptId: 'a' }), async value => { recorded = value }, async () => { sends++; throw new Error('timeout') }), /verification/)
  assert.equal(sends, 1)
  assert.match(recorded.error, /timeout/)
})

test('success persistence failure does not resend or overwrite ERP success', async () => {
  let sends = 0
  let finishes = 0
  await assert.rejects(executeInvoiceSend(preview(), async () => ({ attemptId: 'a' }), async () => { finishes++; throw new Error('SQL unavailable') }, async () => { sends++; return { status: true, newid: '42' } }), /SQL/)
  assert.equal(sends, 1)
  assert.equal(finishes, 1)
})

test('ERP HTTP error details are retained in the locked attempt', async () => {
  let saved
  const failure = new Error('ERP request failed (400). Invalid field')
  failure.erpResponse = { httpStatus: 400, body: '{"Message":"Invalid field"}' }
  await assert.rejects(executeInvoiceSend(preview(), async () => ({ attemptId: 'a' }), async value => { saved = value }, async () => { throw failure }), /Invalid field/)
  assert.deepEqual(saved.response, failure.erpResponse)
  assert.match(saved.error, /400/)
})

test('unapproved ERP destinations make no network requests', async () => {
  await assert.rejects(connectInvoiceErp({ serverUrl: 'http://unapproved.invalid' }, async () => { throw new Error('Must not fetch') }, { get: async () => ({ serverUrl: 'https://erp.example/api' }) }), /destination/)
})

test('server-only internal route handles invoice lookups and explicit sending without changing the shared URL', async () => {
  const configured = 'https://erp.example/api'
  const calls = []
  const connection = { serverUrl: configured, apiUsername: 'test', apiPassword: 'test-only', defaultFiscalYear: '2026' }
  const store = { get: async () => ({ serverUrl: configured }) }
  const client = await connectInvoiceErp(connection, async (url, options) => {
    calls.push({ url, options })
    const data = url.includes('Accounts/Login') ? { access_token: 'test-token' }
      : url.includes('ERP_RomSuppliersList') ? [supplier]
      : url.includes('ERP_RomZgParam') ? [{ par_from_branch: 1 }] : { status: true, newid: 'test-id' }
    return { ok: true, json: async () => data }
  }, store, 'http://127.0.0.1:8102/wmsapi/api/')
  assert.equal(calls.length, 3, 'connecting does not send an invoice')
  assert.ok(calls.every(call => call.url.startsWith('http://127.0.0.1:8102/wmsapi/api/')))
  assert.ok(calls.every(call => call.options.redirect === 'error'))
  assert.equal(JSON.parse(calls[0].options.body).Username, 'test')
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token')
  assert.equal((await store.get()).serverUrl, configured)
  assert.equal(connection.serverUrl, configured)
  const result = await client.send(preview().payload)
  assert.equal(result.newid, 'test-id')
  assert.equal(calls.length, 4)
  assert.ok(calls[3].url.endsWith('/WMS/ERP_SaveRomZGParalavesSuppliesOrder'))
  assert.deepEqual(JSON.parse(calls[3].options.body), preview().payload)
})

test('internal route never bypasses the approved browser destination or URL validation', async () => {
  const store = { get: async () => ({ serverUrl: 'https://erp.example/api' }) }
  let requests = 0
  const fetchImpl = async () => { requests++; throw new Error('Unexpected request') }
  const connection = { serverUrl: 'https://erp.example/api', apiUsername: 'test', apiPassword: 'test-only' }
  await assert.rejects(connectInvoiceErp({ ...connection, serverUrl: 'http://other.invalid' }, fetchImpl, store, 'http://127.0.0.1:8102/wmsapi/api'), /destination changed/)
  for (const url of ['file:///etc/passwd', 'http://user:password@localhost/api', 'http://localhost/api?redirect=other', 'not a URL']) {
    await assert.rejects(connectInvoiceErp(connection, fetchImpl, store, url))
  }
  assert.equal(requests, 0)
})

test('without a server override the shared URL remains in use; client override fields are ignored', async () => {
  const configured = 'https://erp.example/api'
  const calls = []
  await assert.rejects(connectInvoiceErp({ serverUrl: configured, apiUsername: 'test', apiPassword: 'test-only', internalUrl: 'http://other.invalid' }, async url => {
    calls.push(url)
    throw new Error('Test connection failure')
  }, { get: async () => ({ serverUrl: configured }) }, ''), /Test connection failure/)
  assert.deepEqual(calls, [`${configured}/Accounts/Login`], 'no retry or fallback to a second destination')
})

test('branch lookup and invoice payload use the same ZG user, not login username', async () => {
  const previous = process.env.MONTHLY_INVOICE_ERP_URL
  process.env.MONTHLY_INVOICE_ERP_URL = 'https://erp.example/api'
  const paths = []
  try {
    const client = await connectInvoiceErp({ serverUrl: 'https://erp.example/api', apiUsername: 'login-user', apiPassword: 'test-only' }, async url => {
      paths.push(url)
      const data = url.includes('Accounts/Login') ? { access_token: 'test-token' }
        : url.includes('ERP_RomSuppliersList') ? [supplier]
        : url.endsWith('username=zg1') ? [{ par_from_branch: 1 }] : []
      return { ok: true, json: async () => JSON.stringify(data) }
    }, { get: async () => ({ serverUrl: 'https://erp.example/api' }) })
    assert.equal(client.params.par_from_branch, 1)
    assert.equal(client.username, 'zg1')
    const invoice = buildInvoicePreview(row, supplier, '2026-08-31', client.username, client.params)
    assert.equal(invoice.payload[0].username, 'zg1')
    assert.ok(paths.some(path => path.includes('ERP_RomSuppliersList?mode=ALL&username=login-user')))
    assert.ok(paths.some(path => path.endsWith('ERP_RomZgParam?username=zg1')))
    assert.ok(paths.every(path => !path.includes('ERP_Save')))
  } finally {
    if (previous === undefined) delete process.env.MONTHLY_INVOICE_ERP_URL
    else process.env.MONTHLY_INVOICE_ERP_URL = previous
  }
})
