import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createPermissionMiddleware } from './permissionMiddleware.js'

async function check(user, path, { method = 'GET', permission, mode, category = 'daily_routes' } = {}) {
  let result = 200
  let nextCalled = false
  const request = { path, method, headers: { cookie: 'test-session' } }
  const middleware = createPermissionMiddleware({
    getSessionUser: async token => { assert.equal(token, 'test-session'); return user },
    sessionToken: req => req.headers.cookie,
    getJob: async () => category ? { documentCategory: category } : null,
  })
  const response = { status(code) { result = code; return this }, json() { return this } }
  await (permission ? middleware.requirePermission(permission, mode) : middleware.requireOcrPermission)(request, response, error => {
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

test('view-only grants allow reads and reject every write method across all menus', async () => {
  const keys = ['milk_collection', 'milk_reception', 'ocr_documents', 'backup_history', 'daily_aviz', 'daily_reconciliation', 'monthly_reconciliation', 'month_closure', 'bank_note', 'exports', 'invoice_resolution', 'ocr_settings', 'app_admin', 'audit_log']
  for (const permission of keys) {
    const user = { permissions: [permission], writePermissions: [] }
    for (const method of ['GET', 'HEAD']) assert.equal(await check(user, '/', { permission, method }), 200, `${permission} ${method}`)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(await check(user, '/', { permission, method }), 403, `${permission} ${method}`)
  }
})

test('OCR read-only covers daily, monthly, CMR, settings and export editing endpoints', async () => {
  const permissions = ['ocr_documents', 'ocr_settings', 'exports', 'monthly_reconciliation']
  const viewer = { permissions, writePermissions: [] }
  for (const path of ['/jobs', '/jobs/id', '/jobs/id/file', '/cmr', '/cmr/id/reception-match', '/exports/producer-contracts', '/settings']) {
    assert.equal(await check(viewer, path), 200, path)
  }
  for (const [path, method] of [
    ['/jobs', 'POST'], ['/jobs/id', 'PATCH'], ['/jobs/id/review', 'PATCH'], ['/jobs/id', 'DELETE'],
    ['/jobs/id/reprocess', 'POST'], ['/jobs/id/erp-send-row', 'POST'], ['/jobs/id/erp-recovery', 'POST'],
    ['/cmr/id', 'PATCH'], ['/cmr/id/recognize', 'POST'], ['/cmr/id/reception-match', 'PUT'],
    ['/exports/producer-contracts', 'PUT'], ['/exports/producer-herd-counts', 'PUT'], ['/settings', 'PATCH'],
    ['/monthly-reconciliation/aviz-center', 'PATCH'], ['/reference-suppliers', 'POST'],
  ]) assert.equal(await check(viewer, path, { method }), 403, path)
  // An edit grant for a different menu must not turn an OCR viewer into an operator.
  assert.equal(await check({ ...viewer, writePermissions: ['exports'] }, '/cmr/id', { method: 'PATCH' }), 403)
})

test('explicit operation mode protects GET downloads and scale reads; telemetry remains allowed', async () => {
  const user = { permissions: ['bank_note', 'milk_reception'], writePermissions: [] }
  assert.equal(await check(user, '/id/file', { permission: 'bank_note', mode: 'write' }), 403)
  assert.equal(await check(user, '/current-weight', { permission: 'milk_reception', mode: 'write' }), 403)
  assert.equal(await check(user, '/api/activity/page-open', { permission: 'milk_reception', mode: 'read', method: 'POST' }), 200)
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

test('contract editing requires the shared Exports permission', async () => {
  assert.equal(await check({ permissions: ['exports'] }, '/exports/producer-contracts', { method: 'PUT' }), 200)
  assert.equal(await check(null, '/exports/producer-contracts', { method: 'PUT' }), 401)
  assert.equal(await check({ permissions: ['ocr_documents'] }, '/exports/producer-contracts', { method: 'PUT' }), 403)
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
    assert.ok(source.includes(`app.get('/api/month-closure/${route}', requirePermission(['month_closure', 'bank_note'])`))
  }
  assert.ok(source.includes("app.use('/api/bank-exports', requirePermission('bank_note')"))
  assert.ok(source.includes("app.get('/api/bank-exports/:id/file', requirePermission('bank_note', 'write')"))
  assert.ok(source.includes("app.get('/api/milk-factors', requirePermission('milk_reception')"))
})

test('Bank note access is independent from Month Closure, including mixed read/write roles', async () => {
  const bankViewer = { permissions: ['bank_note'], writePermissions: [] }
  const bankEditor = { permissions: ['bank_note'], writePermissions: ['bank_note'] }
  const closureEditor = { permissions: ['month_closure'], writePermissions: ['month_closure'] }
  for (const user of [bankViewer, bankEditor]) {
    assert.equal(await check(user, '/reference-suppliers'), 200)
    assert.equal(await check(user, '/reference-suppliers', { method: 'POST' }), 403)
    assert.equal(await check(user, '/', { permission: ['month_closure', 'bank_note'] }), 200)
    assert.equal(await check(user, '/', { permission: 'month_closure', method: 'POST' }), 403)
  }
  assert.equal(await check(closureEditor, '/', { permission: 'bank_note' }), 403)
  assert.equal(await check(closureEditor, '/', { permission: 'bank_note', method: 'POST' }), 403)
  assert.equal(await check(bankEditor, '/', { permission: 'bank_note', method: 'POST' }), 200)
  assert.equal(await check(bankEditor, '/id/file', { permission: 'bank_note', mode: 'write' }), 200)
  const mixed = { permissions: ['bank_note', 'month_closure'], writePermissions: ['month_closure'] }
  assert.equal(await check(mixed, '/', { permission: 'bank_note', method: 'POST' }), 403)
  assert.equal(await check(mixed, '/id/file', { permission: 'bank_note', mode: 'write' }), 403)
  assert.equal(await check(mixed, '/', { permission: 'month_closure', method: 'POST' }), 200)
})
