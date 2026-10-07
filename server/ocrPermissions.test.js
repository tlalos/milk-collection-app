import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_PERMISSIONS, userHasPermission } from './appSecurityStore.js'
import { ocrFileJobId, ocrPermissionsForRoute } from './ocrPermissions.js'

test('OCR tile endpoints use their own permissions', () => {
  assert.deepEqual(ocrPermissionsForRoute('/settings'), ['ocr_settings'])
  assert.deepEqual(ocrPermissionsForRoute('/daily-aviz/rows'), ['daily_aviz'])
  assert.deepEqual(ocrPermissionsForRoute('/monthly-reconciliation/rows'), ['monthly_reconciliation'])
  assert.deepEqual(ocrPermissionsForRoute('/monthly-reconciliation/aviz-center'), ['monthly_reconciliation'])
  assert.deepEqual(ocrPermissionsForRoute('/issues'), ['monthly_reconciliation'])
  assert.deepEqual(ocrPermissionsForRoute('/reference-suppliers'), ['ocr_documents', 'month_closure', 'monthly_reconciliation', 'exports'])
  assert.deepEqual(ocrPermissionsForRoute('/jobs'), ['ocr_documents'])
})

test('new pages have independent permissions, without inherited OCR access', () => {
  for (const [route, permission] of [
    ['/archive-history', 'backup_history'],
    ['/exports/apia-rows', 'exports'],
    ['/exports/producer-contracts', 'exports'],
    ['/exports/producer-herd-counts', 'exports'],
    ['/exports/reception-factors', 'exports'],
  ]) {
    assert.deepEqual(ocrPermissionsForRoute(route), [permission])
  }
  assert.deepEqual(ocrPermissionsForRoute('/reference-suppliers', '', 'POST'), ['ocr_documents'])
  const keys = APP_PERMISSIONS.map(item => item.key)
  for (const key of ['milk_collection', 'milk_reception', 'backup_history', 'exports', 'audit_log']) {
    assert.ok(keys.includes(key), key)
  }
  for (const key of ['customers', 'data_sync', 'journal', 'transport', 'apia_export', 'veterinary_export', 'bank_note', 'milk_factors']) assert.ok(!keys.includes(key))
  assert.equal(new Set(keys).size, keys.length)
})

test('daily reconciliation can read daily aviz files without general OCR access', () => {
  assert.equal(ocrFileJobId('/jobs/job-123/file'), 'job-123')
  assert.deepEqual(ocrPermissionsForRoute('/jobs/job-123/file', 'daily_routes'), [
    'ocr_documents', 'daily_aviz', 'daily_reconciliation', 'monthly_reconciliation',
  ])
  assert.deepEqual(ocrPermissionsForRoute('/jobs/job-123/file', 'journal_monthly_settlement'), [
    'ocr_documents', 'monthly_reconciliation',
  ])
  assert.deepEqual(ocrPermissionsForRoute('/jobs/job-123/file', 'unknown'), ['ocr_documents'])
  assert.deepEqual(ocrPermissionsForRoute('/jobs/job-123/reprocess'), ['ocr_documents'])
})

test('the standalone reconciliation grant does not allow OCR editing or monthly files', () => {
  const user = { permissions: ['daily_reconciliation'] }
  const canUse = (route, category) => ocrPermissionsForRoute(route, category)
    .some((permission) => userHasPermission(user, permission))

  assert.ok(APP_PERMISSIONS.some((permission) => permission.key === 'daily_reconciliation'))
  assert.equal(canUse('/jobs/job-123/file', 'daily_routes'), true)
  assert.equal(canUse('/jobs/job-123/file', 'journal_monthly_settlement'), false)
  assert.equal(canUse('/jobs/job-123/reprocess'), false)
  assert.equal(canUse('/daily-aviz/rows'), false)
})
