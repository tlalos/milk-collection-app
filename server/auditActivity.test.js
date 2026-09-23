import test from 'node:test'
import assert from 'node:assert/strict'
import { presentAuditActivity } from './auditActivity.js'

test('reception update shows changed fields, including quality details, without unchanged fields', () => {
  const activity = presentAuditActivity({
    auditId: 12,
    action: 'milk_reception.update',
    entityType: 'MilkReception',
    beforeJson: JSON.stringify({ vehicleRegistration: 'AB-12', routeId: 'R01', netQuantityKg: 1200, qualityDetails: { CUSTOM: { fatResult: 3.5 } } }),
    afterJson: JSON.stringify({ vehicleRegistration: 'AB-12', routeId: 'R02', netQuantityKg: 1250, qualityDetails: { CUSTOM: { fatResult: 3.7 } } }),
  })
  assert.deepEqual(activity.changes, [
    { field: 'Route', before: 'R01', after: 'R02' },
    { field: 'Net kg', before: 1200, after: 1250 },
    { field: 'Custom: Fat', before: 3.5, after: 3.7 },
  ])
})

test('delivery create and delete show stored values', () => {
  const snapshot = JSON.stringify({ truckNumber: 'TR-1', aviz: 'A-10', status: 'AWAITING_GREECE' })
  const created = presentAuditActivity({ auditId: 1, action: 'milk_delivery.create', entityType: 'MilkDelivery', afterJson: snapshot })
  const deleted = presentAuditActivity({ auditId: 2, action: 'milk_delivery.delete', entityType: 'MilkDelivery', beforeJson: snapshot })
  assert.equal(created.changes.find((change) => change.field === 'Truck')?.after, 'TR-1')
  assert.equal(deleted.changes.find((change) => change.field === 'Truck')?.before, 'TR-1')
})

test('other actions and malformed old snapshots remain readable', () => {
  assert.deepEqual(presentAuditActivity({ auditId: 3, action: 'auth.logout', entityType: 'AppSession' }).changes, [])
  assert.deepEqual(presentAuditActivity({ auditId: 4, action: 'milk_reception.update', entityType: 'MilkReception', beforeJson: '{invalid', afterJson: null }).changes, [])
  assert.equal(presentAuditActivity({ auditId: 5, action: 'milk_delivery.update.failed', entityType: 'MilkDelivery', metadataJson: '{"reason":"Invalid weight"}' }).reason, 'Invalid weight')
})
