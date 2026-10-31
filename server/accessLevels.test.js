import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAccess, normalizeRolePermissions, userHasPermission, userCanOperate } from './accessLevels.js'
import { APP_PERMISSIONS } from './appSecurityStore.js'

test('every menu supports view-only and existing grants retain full access', () => {
  for (const { key } of APP_PERMISSIONS) {
    const viewer = resolveAccess([`${key}:view`])
    assert.equal(userHasPermission(viewer, key), true, key)
    assert.equal(userCanOperate(viewer, key), false, key)
    assert.equal(userCanOperate(resolveAccess([key]), key), true, key)
    assert.equal(userCanOperate({ permissions: [key] }, key), true, key)
    assert.equal(userHasPermission(resolveAccess([]), key), false, key)
    assert.equal(userCanOperate({ isAdmin: true }, key), true, key)
  }
})

test('multiple roles resolve to the strongest grant without crossing menu boundaries', () => {
  const user = resolveAccess(['ocr_documents:view', 'ocr_documents', 'month_closure:view', 'ocr_documents:view'])
  assert.deepEqual(user.permissions, ['ocr_documents', 'month_closure'])
  assert.deepEqual(user.writePermissions, ['ocr_documents'])
  assert.equal(userCanOperate(user, 'month_closure'), false)
  assert.equal(userHasPermission(user, 'app_admin'), false)
})

test('explicit empty write permissions override the legacy full-access fallback', () => {
  assert.equal(userCanOperate({ permissions: ['month_closure'], writePermissions: [] }, 'month_closure'), false)
  assert.equal(userCanOperate({ permissions: ['month_closure:view'] }, 'month_closure'), false)
  assert.equal(userCanOperate(null, 'month_closure'), false)
})

test('role saves accept view grants, deduplicate and discard unknown permissions', () => {
  assert.deepEqual(normalizeRolePermissions(['ocr_documents:view', 'ocr_documents:view', 'fake:view'], APP_PERMISSIONS), ['ocr_documents:view'])
  assert.deepEqual(normalizeRolePermissions(['ocr_documents:view', 'ocr_documents'], APP_PERMISSIONS), ['ocr_documents'])
  assert.deepEqual(normalizeRolePermissions(null, APP_PERMISSIONS), [])
})
