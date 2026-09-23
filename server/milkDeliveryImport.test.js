import assert from 'node:assert/strict'
import test from 'node:test'
import { mapPasterisationDeliveries } from './milkDeliveryImport.js'

const headers = [
  'Delivery Date', 'Delivery Time', 'Truck Number', 'Tractor Number', 'AVIZ',
  'Milk Type Delivered', 'Loaded Vehicle Weight (kg)', 'Empty Vehicle Weight (kg)',
  'Net Delivered Quantity (kg)', 'Calculated Delivered Liters', 'Delivery Category',
]

test('maps workbook values and Greece kg difference without inventing scale timestamps', () => {
  const { rows, warnings } = mapPasterisationDeliveries([
    headers,
    [46255, 1412, 'CV-12-EBA', 'CV-14-EBA', 'AVIZ 86', 'Lapte de vacă',
      39750, 13600, 26150, 26150 / 1.029, 'SALES', '', 26320, '399', 170, 'Delivered'],
  ])
  assert.equal(warnings.length, 0)
  assert.deepEqual(rows[0], {
    excelRowNumber: 2,
    deliveryId: 'EXCEL-PASTERISATION-ROW-2',
    deliveryDate: '2026-08-21',
    deliveryTime: '14:12',
    truckNumber: 'CV-12-EBA',
    tractorNumber: 'CV-14-EBA',
    aviz: 'AVIZ 86',
    milkType: 'MILK-COW',
    milkTypeLabel: 'Cow',
    densityFactor: 1.029,
    loadedWeightKg: 39750,
    emptyWeightKg: 13600,
    netQuantityKg: 26150,
    calculatedLiters: 25413.022,
    deliveryCategory: 'SALES',
    departureComments: '',
    greeceWeight: 26320,
    invoiceNumber: '399',
    differenceAmount: 170,
    arrivalComments: 'Delivered',
    status: 'COMPLETE',
  })
})

test('keeps missing truck and category visible as incomplete drafts', () => {
  const { rows, warnings } = mapPasterisationDeliveries([
    headers,
    [46282, '', 'Add New Truck', 'Add New Tractor', 'AVIZ 96', 'Lapte de vacă',
      39550, 14700, 24850, 24850 / 1.029, '', '', 24900, '409', 50, ''],
  ])
  assert.equal(rows[0].truckNumber, '')
  assert.equal(rows[0].tractorNumber, '')
  assert.equal(rows[0].deliveryCategory, 'UNSPECIFIED')
  assert.equal(rows[0].status, 'DRAFT')
  assert.equal(warnings.length, 4)
})

test('rejects a discrepancy between source weights and calculated cells', () => {
  assert.throws(() => mapPasterisationDeliveries([
    headers,
    [46255, '', 'CV-12-EBA', '', 'AVIZ 86', 'Lapte de vacă',
      39750, 13600, 26151, 26150 / 1.029, 'SALES', '', '', '', '', ''],
  ]), /net weight does not match/u)
})
