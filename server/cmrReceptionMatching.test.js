import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { isCmrReceptionCandidate, cmrReconciliationDocuments } from './cmrReceptionMatching.js'
import { registerCmrRoutes } from './cmrDocument.js'
import { ocrPermissionsForRoute } from './ocrPermissions.js'

test('CMR candidates require Others, exact calendar date and normalized nonempty truck', () => {
  const doc = { documentDate: '2026-10-17', truckNumber: 'cj 34-gdg' }
  const row = { receptionDate: new Date('2026-10-17T00:00:00Z'), vehicleRegistration: 'CJ34GDG', vehicleCategory: 'OTHER' }
  assert.equal(isCmrReceptionCandidate(doc, row), true)
  for (const change of [{ vehicleCategory: 'COLLECTION' }, { vehicleCategory: null }, { receptionDate: '2026-10-16' }, { vehicleRegistration: 'CJ35GDG' }, { vehicleRegistration: '' }]) {
    assert.equal(isCmrReceptionCandidate(doc, { ...row, ...change }), false)
  }
  assert.equal(isCmrReceptionCandidate({ ...doc, documentDate: null }, row), false)
  assert.equal(isCmrReceptionCandidate({ ...doc, truckNumber: '---' }, { ...row, vehicleRegistration: '---' }), false)
})

test('monthly CMR payload is limited to the month and links to its receptions, without exposing full job metadata', () => {
  const job = (id, date, category = 'cmr') => ({ id, documentCategory: category, sourceFile: 'cmr.jpeg', status: 'completed', reviewStatus: 'reviewed', createdAt: '2026-09-01T12:00:00Z',
    privateMetadata: 'not-public', data: { date, truckNumber: 'MS33MRN', quantity: null, kilos: 999, quantityUnit: 'L' } })
  const jobs = [job('in', '2026-09-23'), job('missing', ''), job('out', '2026-10-01'), job('linked', '2026-08-01'), job('daily', '2026-09-23', 'daily_routes')]
  const result = cmrReconciliationDocuments(jobs, [{ jobId: 'linked', receptionId: 'r1' }], [{ receptionId: 'r1' }], '2026-09')
  assert.deepEqual(result.map(doc => doc.id), ['in', 'missing', 'linked'])
  assert.equal(result[0].quantity, null)
  assert.equal(result[0].privateMetadata, undefined)
  assert.equal(result[0].data, undefined)
})

test('CMR matching routes forward authenticated identity and preserve conflict errors', async () => {
  const app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.authUser = { id: 'user', username: 'reviewer' }; next() })
  let saved
  registerCmrRoutes(app, {
    getCmrReceptionMatch: async id => ({ id, candidates: [], link: null }),
    saveCmrReceptionMatch: async (id, body, user) => {
      if (body.stale) throw Object.assign(new Error('Changed'), { status: 409 })
      saved = { id, body, user }; return { link: { receptionId: body.receptionId } }
    },
  })
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/ocr/cmr/test/reception-match`
    const result = await fetch(url)
    assert.equal(result.headers.get('cache-control'), 'no-store')
    assert.equal((await result.json()).id, 'test')
    const put = body => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await put({ receptionId: 'reception' })).status, 200)
    assert.deepEqual(saved.user, { id: 'user', username: 'reviewer' })
    assert.equal((await put({ stale: true })).status, 409)
    for (const method of ['GET', 'PUT']) assert.deepEqual(ocrPermissionsForRoute('/cmr/test/reception-match', '', method), ['ocr_documents'])
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
