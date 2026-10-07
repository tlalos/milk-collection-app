import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createPermissionMiddleware } from './permissionMiddleware.js'

async function check(user, path, { method = 'GET', permission, category = 'daily_routes' } = {}) {
  let result = 200
  let nextCalled = false
  const request = { path, method, headers: { cookie: 'test-session' } }
  const middleware = createPermissionMiddleware({
    getSessionUser: async token => { assert.equal(token, 'test-session'); return user },
    sessionToken: req => req.headers.cookie,
    getJob: async () => category ? { documentCategory: category } : null,
  })
  const response = { status(code) { result = code; return this }, json() { return this } }
  await (permission ? middleware.requirePermission(permission) : middleware.requireOcrPermission)(request, response, error => {
    assert.ifError(error)
    nextCalled = true
  })
  if (result === 200) { assert.equal(request.authUser, user); assert.ok(nextCalled) }
  else assert.equal(nextCalled, false)
  return result
}

test('Exports-only user can load all report data but cannot edit OCR or reconciliation', async () => {
  const user = { permissions: ['exports'] }
  for (const path of ['/exports/apia-rows', '/exports/producer-contracts', '/exports/reception-factors', '/reference-suppliers']) {
    assert.equal(await check(user, path), 200, path)
    assert.equal(await check(null, path), 401, path)
    assert.equal(await check({ permissions: [] }, path), 403, path)
  }
  for (const [path, method] of [
    ['/monthly-reconciliation/rows', 'GET'], ['/monthly-reconciliation/aviz-center', 'PATCH'],
    ['/jobs/job-1', 'PATCH'], ['/jobs/job-1/erp-send-row', 'POST'], ['/reference-suppliers', 'POST'],
  ]) assert.equal(await check(user, path, { method }), 403, path)
})

test('backup history permission does not grant OCR access, and OCR no longer grants history', async () => {
  assert.equal(await check({ permissions: ['backup_history'] }, '/archive-history'), 200)
  assert.equal(await check({ permissions: ['backup_history'] }, '/jobs'), 403)
  assert.equal(await check({ permissions: ['ocr_documents'] }, '/archive-history'), 403)
})

test('herd-count editing requires the shared Exports permission', async () => {
  assert.equal(await check({ permissions: ['exports'] }, '/exports/producer-herd-counts', { method: 'PUT' }), 200)
  assert.equal(await check(null, '/exports/producer-herd-counts', { method: 'PUT' }), 401)
  assert.equal(await check({ permissions: ['ocr_documents'] }, '/exports/producer-herd-counts', { method: 'PUT' }), 403)
})

test('subpage data uses its parent permission and rejects unrelated grants', async () => {
  assert.equal(await check({ permissions: ['month_closure'] }, '/reference-suppliers'), 200)
  assert.equal(await check({ permissions: ['month_closure'] }, '/', { permission: 'month_closure' }), 200)
  assert.equal(await check({ permissions: ['milk_reception'] }, '/', { permission: 'milk_reception' }), 200)
  assert.equal(await check({ permissions: ['exports'] }, '/', { permission: 'month_closure' }), 403)
  assert.equal(await check({ permissions: ['exports'] }, '/', { permission: 'milk_reception' }), 403)
})

test('history, administration and collection grants are independent; admins keep full access', async () => {
  for (const permission of ['audit_log', 'app_admin', 'milk_collection', 'milk_reception']) {
    assert.equal(await check({ permissions: [permission] }, '/', { permission }), 200)
    assert.equal(await check(null, '/', { permission }), 401)
    assert.equal(await check({ permissions: [] }, '/', { permission }), 403)
    assert.equal(await check({ isAdmin: true }, '/', { permission }), 200)
  }
  assert.equal(await check({ permissions: ['audit_log'] }, '/', { permission: 'app_admin' }), 403)
  assert.equal(await check({ permissions: ['app_admin'] }, '/', { permission: 'audit_log' }), 403)
  assert.equal(await check({ isAdmin: true }, '/exports/producer-contracts'), 200)
})

test('source document checks retain category restrictions and missing-file handling', async () => {
  const user = { permissions: ['daily_aviz'] }
  assert.equal(await check(user, '/jobs/id/file'), 200)
  assert.equal(await check(user, '/jobs/id/file', { category: 'journal_monthly_settlement' }), 403)
  assert.equal(await check(user, '/jobs/id/file', { category: '' }), 404)
})

test('server wiring protects references before handlers and keeps write grants separate', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8')
  const guard = source.indexOf("app.use('/api/ocr', requireOcrPermission)")
  assert.ok(guard > 0)
  for (const method of ['get', 'post']) {
    assert.ok(guard < source.indexOf(`app.${method}('/api/ocr/reference-suppliers'`))
  }
  for (const route of ['activity-users', 'activity', 'weight-history', 'delivery-weight-history']) {
    assert.ok(source.includes(`app.get('/api/web-users/${route}', requirePermission('audit_log')`))
  }
  for (const route of ['pricing-rows', 'invoice-send', 'invoice-date', 'invoice-dates']) {
    assert.ok(source.includes(`app.post('/api/month-closure/${route}', requirePermission('month_closure')`))
  }
  for (const route of ['pricing-rows', 'invoices']) {
    assert.ok(source.includes(`app.get('/api/month-closure/${route}', requirePermission('month_closure')`))
  }
  assert.ok(source.includes("app.get('/api/milk-factors', requirePermission('milk_reception')"))
})
