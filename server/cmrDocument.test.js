import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import express from 'express'
import { CmrDataSchema, emptyCmrData, registerCmrRoutes } from './cmrDocument.js'
import { ocrPermissionsForRoute } from './ocrPermissions.js'

test('CMR fields allow incomplete drafts, preserve aviz leading zeros, and reject invalid quantities and dates', () => {
  assert.deepEqual(CmrDataSchema.parse(emptyCmrData()), emptyCmrData())
  const value = { ...emptyCmrData(), supplier: ' Supplier ', transport: 'Truck', kilos: 1234.5, date: '2026-10-16', avizNumber: '00123' }
  assert.equal(CmrDataSchema.parse(value).avizNumber, '00123')
  assert.equal(CmrDataSchema.parse(value).supplier, 'Supplier')
  assert.equal(CmrDataSchema.parse({ ...value, driver: ' Vlad ' }).driver, 'Vlad')
  assert.equal(CmrDataSchema.parse({ ...value, truckNumber: ' CJ 34 GDG ' }).truckNumber, 'CJ 34 GDG')
  const { driver: _driver, truckNumber: _truck, ...legacy } = value
  assert.equal(CmrDataSchema.parse(legacy).driver, '')
  assert.equal(CmrDataSchema.parse(legacy).truckNumber, '')
  assert.equal(CmrDataSchema.safeParse({ ...value, truckNumber: 'x'.repeat(301) }).success, false)
  assert.equal(CmrDataSchema.safeParse({ ...value, driver: 'x'.repeat(301) }).success, false)
  for (const patch of [{ kilos: -1 }, { kilos: Infinity }, { kilos: 'abc' }, { date: '2026-02-30' }, { date: 'x' }, { supplier: 'x'.repeat(301) }, { documentType: 'daily_driver_statement' }, { rows: [] }]) {
    assert.equal(CmrDataSchema.safeParse({ ...value, ...patch }).success, false)
  }
})

test('CMR CRUD is separate, validates data, detects stale saves and blocks generic OCR/ERP mutations', async () => {
  const jobs = new Map([
    ['cmr1', { id: 'cmr1', documentCategory: 'cmr', updatedAt: 'v1', data: emptyCmrData(), status: 'completed', reviewStatus: 'pending' }],
    ['daily1', { id: 'daily1', documentCategory: 'daily_routes', updatedAt: 'v1' }],
  ])
  const audits = []
  const app = express(); app.use(express.json())
  app.use((_req, _res, next) => next())
  registerCmrRoutes(app, {
    listMilkReceptions: async options => {
      assert.deepEqual(options, { date: '2026-10-16', month: '2026-10', includeQualityDetails: false })
      return [
        { receptionDate: '2026-10-16', vehicleCategory: 'OTHER', vehicleRegistration: 'CJ 34 GDG', driverName: ' Vlad ' },
        { receptionDate: '2026-10-16', vehicleCategory: 'OTHER', vehicleRegistration: 'cj-34-gdg', driverName: 'VLAD' },
        { receptionDate: '2026-10-16', vehicleCategory: 'COLLECTION', vehicleRegistration: 'COLLECTION', driverName: 'Excluded collection' },
        { receptionDate: '2026-10-15', vehicleCategory: 'OTHER', vehicleRegistration: 'WRONG DATE', driverName: 'Excluded date' },
        { receptionDate: '2026-10-16', vehicleCategory: 'OTHER', vehicleRegistration: ' ', driverName: 'Miron' },
        { receptionDate: '2026-10-16', vehicleCategory: 'OTHER', vehicleRegistration: '', driverName: ' ' },
      ]
    },
    getJob: async id => jobs.get(id), listJobs: async () => [...jobs.values()],
    updateJob: async (id, patch) => { const job = { ...jobs.get(id), ...patch, updatedAt: 'v2' }; jobs.set(id, job); return job },
    deleteJob: async id => jobs.delete(id), toPublicJob: job => job,
    auditAction: async action => audits.push(action),
  })
  app.all('/api/ocr/jobs/:id/*rest', (_req, res) => res.json({ allowed: true }))
  app.get('/api/ocr/jobs/:id', (_req, res) => res.json({ allowed: true }))
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const send = (path, method = 'GET', body) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  try {
    for (const query of ['', '?date=2026-02-30', '?date=bad', '?date=2026-10-16&date=2026-10-15']) {
      assert.equal((await send('/api/ocr/cmr/truck-options' + query)).status, 400)
    }
    assert.deepEqual(await (await send('/api/ocr/cmr/truck-options?date=2026-10-16')).json(), { trucks: ['CJ 34 GDG'], drivers: ['Miron', 'Vlad'] })
    assert.equal((await (await send('/api/ocr/cmr')).json()).jobs.length, 1)
    const data = { ...emptyCmrData(), supplier: 'Supplier', driver: 'Vlad', truckNumber: 'CJ 34 GDG', kilos: 10, quantity: 10, avizNumber: '001',
      recipient: 'Recipient', deliveryLocation: 'Delivery town', deliveryDate: '2026-10-16', loadingLocation: 'Loading town', loadingDate: '2026-10-15',
      avizDate: '2026-10-15', issueDate: '2026-10-15', receiptDate: '2026-10-16', milkType: 'MILK-COW' }
    assert.equal((await send('/api/ocr/cmr/daily1', 'PATCH', { data, updatedAt: 'v1' })).status, 404)
    assert.equal((await send('/api/ocr/cmr/cmr1', 'PATCH', { data: { ...data, kilos: -1 }, updatedAt: 'v1' })).status, 400)
    assert.equal((await send('/api/ocr/cmr/cmr1', 'PATCH', { data, updatedAt: 'old' })).status, 409)
    const saved = await send('/api/ocr/cmr/cmr1', 'PATCH', { data, updatedAt: 'v1' })
    assert.equal(saved.status, 200)
    assert.deepEqual((await saved.json()).job.data, data)
    assert.equal(jobs.get('cmr1').reviewStatus, 'pending')
    for (const field of ['deliveryDate', 'loadingDate', 'avizDate', 'issueDate', 'receiptDate']) {
      assert.equal((await send('/api/ocr/cmr/cmr1', 'PATCH', { data: { ...data, [field]: '2026-02-30' }, updatedAt: 'v2' })).status, 400)
    }
    for (const change of [{ quantity: -1 }, { quantityUnit: 'unknown' }, { milkType: 'unknown' }]) {
      assert.equal((await send('/api/ocr/cmr/cmr1', 'PATCH', { data: { ...data, ...change }, updatedAt: 'v2' })).status, 400)
    }
    const liters = await send('/api/ocr/cmr/cmr1', 'PATCH', { data: { ...data, quantity: 4400, quantityUnit: 'L' }, updatedAt: 'v2' })
    assert.equal(liters.status, 200)
    const literData = (await liters.json()).job.data
    assert.equal(literData.quantity, 4400)
    assert.equal(literData.kilos, null)
    const { quantity: _quantity, quantityUnit: _unit, ...oldClientData } = data
    assert.equal((await send('/api/ocr/cmr/cmr1', 'PATCH', { data: oldClientData, updatedAt: 'v2' })).status, 409)
    for (const [path, method] of [['', 'PATCH'], ['', 'DELETE'], ['/reprocess', 'POST'], ['/review', 'PATCH'], ['/excel/retry', 'POST'], ['/erp-send-row', 'POST'], ['/centers/match', 'POST']]) {
      assert.equal((await send('/api/ocr/jobs/cmr1' + path, method, {})).status, 400)
    }
    assert.equal((await send('/api/ocr/jobs/cmr1')).status, 200)
    assert.equal((await send('/api/ocr/jobs/cmr1/file')).status, 200)
    assert.equal((await send('/api/ocr/jobs/daily1/reprocess', 'POST', {})).status, 200)
    assert.equal((await send('/api/ocr/cmr/cmr1', 'DELETE')).status, 200)
    assert.equal(jobs.has('cmr1'), false)
    assert.deepEqual(audits.map(a => a.action), ['cmr.update', 'cmr.update', 'cmr.delete'])
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('CMR, daily and monthly uploads all validate the OCR provider and queue recognition', async () => {
  const source = await readFile(new URL('index.js', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('index.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const route = ast.statements.find(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.expression.name?.text === 'post' && s.expression.arguments[0]?.text === '/api/ocr/jobs')
  for (const category of ['cmr', 'daily_routes', 'journal_monthly_settlement']) {
    let handler, settingsRead = 0, queued = 0, responseBody
    const context = {
      app: { post: (_path, _upload, callback) => { handler = callback } }, upload: { array: () => {} },
      getOcrSettings: async () => { settingsRead++; return { provider: 'openai' } }, OCR_PROVIDERS: { openai: {} }, isOcrProviderConfigured: () => true,
      createJob: async (_file, type) => ({ id: 'test', documentCategory: type, data: emptyCmrData() }),
      toPublicJob: job => job, enqueueOcrJob: () => { queued++ }, auditAction: async () => {},
    }
    vm.runInNewContext(route.getText(ast), context)
    const response = { status() { return this }, json(body) { responseBody = body } }
    await handler({ body: { documentCategory: category }, files: [{}], authUser: { username: 'test' } }, response, error => { throw error })
    assert.equal(responseBody.jobs.length, 1)
    assert.equal(settingsRead, 1)
    assert.equal(queued, 1)
  }
  assert.ok(source.indexOf("app.use('/api/ocr', requireOcrPermission)") < source.indexOf('registerCmrRoutes(app,'))
  assert.deepEqual(ocrPermissionsForRoute('/cmr'), ['ocr_documents'])
  assert.deepEqual(ocrPermissionsForRoute('/cmr/truck-options'), ['ocr_documents'])
  assert.deepEqual(ocrPermissionsForRoute('/cmr/test', 'cmr', 'PATCH'), ['ocr_documents'])
  assert.deepEqual(ocrPermissionsForRoute('/jobs/test/file', 'cmr'), ['ocr_documents'])
})

test('CMR is queued with empty editable fields and pending review', async () => {
  const source = await readFile(new URL('jobStore.js', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('jobStore.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'createJob').getText(ast).replace(/^export /u, '')
  const context = { randomUUID: () => 'id', extensions: new Map([['image/jpeg', '.jpg']]), path: { join: (...parts) => parts.join('/') }, filesDir: '/tmp', writeFile: async () => {}, writeJob: async job => job, emptyCmrData, rm: async () => {} }
  vm.createContext(context); vm.runInContext(fn, context)
  const job = await context.createJob({ mimetype: 'image/jpeg', originalname: 'cmr.jpg', buffer: Buffer.from('test'), size: 4 }, 'cmr')
  assert.equal(job.status, 'queued'); assert.equal(job.reviewStatus, 'pending')
  assert.equal(job.openai, null); assert.deepEqual(job.data, emptyCmrData())
})
