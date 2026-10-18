import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import express from 'express'
import { zodTextFormat } from 'openai/helpers/zod'
import { CmrOcrSchema, CMR_PROMPT, cmrTextFields, cmrDateFields, normalizeCmrExtraction } from './cmrOcr.js'
import { CmrDataSchema, emptyCmrData, registerCmrRoutes } from './cmrDocument.js'
import { hydrateCmrJob } from './cmrSqlStore.js'

const raw = () => ({ documentType: 'cmr', ...Object.fromEntries([...cmrTextFields, ...cmrDateFields].map(field => [field, null])),
  supplier: 'MIRON', truckNumber: 'MS 33 MRN', avizNumber: '00168', quantity: 4900, quantityUnit: 'L', milkType: 'MILK-COW',
  uncertainFields: [], warnings: [], confidence: 0.85, rawTranscription: 'Aviz 00168; 4900 litri' })

test('CMR structured schema anchors all boxes and excludes the independent matching date', () => {
  assert.equal(zodTextFormat(CmrOcrSchema, 'cmr_document').strict, true)
  for (const box of [1, 2, 3, 4, 5, 17, 22, 25]) assert.match(CMR_PROMPT, new RegExp(`Box ${box}\\b`))
  assert.match(CMR_PROMPT, /Reception date is entered by the user/)
  for (const hint of ['Upper left: Box 1', 'Boxes 3, 4 and 5 follow vertically', 'Upper right below the CMR title: Box 17', 'Lower left above the signatures: Box 22', 'Lower right near the recipient signature/stamp: Box 25']) assert.ok(CMR_PROMPT.includes(hint))
  assert.match(CMR_PROMPT, /positions together with printed box numbers and labels/)
  assert.match(CMR_PROMPT, /not fixed pixel coordinates/)
})

test('CMR dates, quantity/unit and names are not guessed or replaced', () => {
  const result = normalizeCmrExtraction({ ...raw(), loadingDate: '2026-09-23', deliveryDate: '2026-09-24', issueDate: '2026-09-23' })
  assert.equal(result.data.date, '')
  assert.equal(result.data.receiptDate, '')
  assert.equal(result.data.quantity, 4900)
  assert.equal(result.data.quantityUnit, 'L')
  assert.equal(result.data.kilos, null)
  assert.equal(result.data.avizNumber, '00168')
  assert.equal(result.cmrOcr.uncertainFields.includes('date'), false)
  assert.deepEqual(CmrDataSchema.parse(result.data), result.data)
  const receipt = normalizeCmrExtraction({ ...raw(), receiptDate: '2026-09-25', quantity: 0, quantityUnit: 'kg' })
  assert.equal(receipt.data.date, '')
  assert.equal(receipt.data.receiptDate, '2026-09-25')
  assert.equal(normalizeCmrExtraction({ ...raw(), receiptDate: '2026-09-25' }, '2026-09-23').data.date, '2026-09-23')
  assert.equal(receipt.data.kilos, 0)
  const unclear = normalizeCmrExtraction({ ...raw(), receiptDate: '2026-02-30', quantityUnit: null })
  assert.equal(unclear.data.date, '')
  assert.equal(unclear.data.quantityUnit, '')
  assert.equal(unclear.data.quantity, 4900)
  assert.ok(unclear.cmrOcr.uncertainFields.includes('quantityUnit'))
  assert.equal(CmrDataSchema.parse(unclear.data).quantityUnit, '')
  for (const quantity of [null, -1, 1000000000]) assert.equal(normalizeCmrExtraction({ ...raw(), quantity }).data.quantity, null)
})

test('CMR SQL hydration preserves OCR metadata alongside authoritative structured fields', () => {
  const { data, cmrOcr } = normalizeCmrExtraction({ ...raw(), quantityUnit: null })
  const job = hydrateCmrJob({ ...data, documentDate: null, jobId: 'test', jobJson: JSON.stringify({ id: 'test', documentCategory: 'cmr', data: null, cmrOcr, ocrOriginalData: raw() }) })
  assert.deepEqual(job.cmrOcr, cmrOcr)
  assert.equal(job.data.quantityUnit, '')
  assert.deepEqual(job.ocrOriginalData, raw())
})

test('CMR queue saves recognition separately, skips ERP, and keeps saved data on failure', async () => {
  const source = (await readFile(new URL('ocrQueue.js', import.meta.url), 'utf8')).replace(/^import .*\r?\n/gmu, '').replace(/^export /gmu, '')
  for (const fail of [false, true]) {
    let job = { id: 'cmr', documentCategory: 'cmr', status: 'queued', reviewStatus: 'pending', data: { ...emptyCmrData(), supplier: 'Saved correction', date: '2026-09-22' }, updatedAt: 'v1', mimeType: 'image/jpeg', sourceFile: 'cmr.jpg' }
    const original = structuredClone(job.data)
    let writes = 0
    const context = vm.createContext({
      Error,
      getJob: async () => job,
      updateJob: async (_id, patch, options) => {
        if (options?.expectedUpdatedAt) assert.equal(options.expectedUpdatedAt, job.updatedAt)
        job = { ...job, ...patch, updatedAt: `v${++writes + 1}` }; return job
      },
      getOcrSettings: async () => ({ provider: 'openai', model: 'test-model' }),
      readFile: async () => Buffer.from('fixture'), getStoredFilePath: () => 'fixture',
      extractMilkCollectionDocument: async (_file, category, settings) => {
        assert.equal(category, 'cmr'); assert.equal(settings.model, 'test-model')
        if (fail) throw new Error('Recognition unavailable')
        return { data: raw(), openai: { model: 'test-model' } }
      },
      normalizeCmrExtraction,
      clearReferenceCaches: () => { throw new Error('CMR must not use reference matching') },
    })
    vm.runInContext(source, context)
    vm.runInContext('pendingIds.push("cmr")', context)
    await context.processNext()
    assert.equal(job.status, fail ? 'failed' : 'completed')
    assert.equal(job.reviewStatus, 'pending')
    assert.equal(job.data.date, '2026-09-22')
    if (fail) { assert.deepEqual(job.data, original); assert.equal(job.error, 'Recognition unavailable') }
    else { assert.equal(job.data.quantityUnit, 'L'); assert.deepEqual(job.ocrOriginalData, raw()); assert.ok(job.cmrOcr.warnings.length) }
  }
})

test('CMR recognizes explicitly, requires current version, protects processing, and reviews separately', async () => {
  let job = { id: 'cmr', documentCategory: 'cmr', status: 'completed', reviewStatus: 'reviewed', updatedAt: 'v1', data: emptyCmrData() }
  let queued = 0, configured = true, version = 1
  const app = express(); app.use(express.json())
  registerCmrRoutes(app, {
    getJob: async () => job, toPublicJob: value => value,
    updateJob: async (_id, patch, options) => { assert.equal(options.expectedUpdatedAt, job.updatedAt); job = { ...job, ...patch, updatedAt: `v${++version}` }; return job },
    getOcrSettings: async () => ({ provider: 'openai' }), OCR_PROVIDERS: { openai: {} }, isOcrProviderConfigured: () => configured,
    enqueueOcrJob: () => queued++, auditAction: async () => {},
  })
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  const send = (suffix, method, body) => fetch(`http://127.0.0.1:${server.address().port}/api/ocr/cmr/cmr${suffix}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await send('/recognize', 'POST', { updatedAt: 'old' })).status, 409)
    configured = false
    assert.equal((await send('/recognize', 'POST', { updatedAt: 'v1' })).status, 503)
    configured = true
    assert.equal((await send('/recognize', 'POST', { updatedAt: 'v1' })).status, 202)
    assert.equal(queued, 1); assert.equal(job.reviewStatus, 'pending'); assert.deepEqual(job.data, emptyCmrData())
    assert.equal((await send('/recognize', 'POST', { updatedAt: job.updatedAt })).status, 409)
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data: emptyCmrData() })).status, 409)
    assert.equal((await send('', 'DELETE', {})).status, 409)
    job.status = 'completed'
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data: job.data, markReviewed: true })).status, 400)
    const data = normalizeCmrExtraction({ ...raw(), receiptDate: '2026-09-25', issueDate: '2026-09-23' }, '2026-09-24').data
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data })).status, 200)
    assert.equal(job.reviewStatus, 'pending')
    for (const field of ['date', 'milkType', 'quantity', 'quantityUnit', 'receiptDate', 'supplier', 'issueDate', 'truckNumber', 'avizNumber']) {
      const incomplete = { ...data, [field]: field === 'quantity' ? null : '' }
      const response = await send('', 'PATCH', { updatedAt: job.updatedAt, data: incomplete, markReviewed: true })
      assert.equal(response.status, 400, field)
      assert.ok((await response.json()).missingFields.includes(field))
      assert.equal(job.reviewStatus, 'pending')
    }
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data: { ...data, supplier: '  ' }, markReviewed: true })).status, 400)
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data: { ...data, issueDate: '2026-02-30' }, markReviewed: true })).status, 400)
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data, markReviewed: true })).status, 200)
    assert.equal(job.reviewStatus, 'reviewed')
    job.status = 'failed'
    assert.equal((await send('', 'PATCH', { updatedAt: job.updatedAt, data, markReviewed: true })).status, 409)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
