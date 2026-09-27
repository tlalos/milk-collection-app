export const deliveryColumns = [
  'deliveryId', 'deliveryDate', 'deliveryTime', 'truckNumber', 'tractorNumber', 'aviz',
  'milkType', 'milkTypeLabel', 'densityFactor', 'loadedWeightKg', 'loadedWeighedAt',
  'emptyWeightKg', 'emptyWeighedAt', 'netQuantityKg', 'calculatedLiters',
  'deliveryCategory', 'departureComments', 'greeceFullWeightKg', 'greeceEmptyWeightKg',
  'greeceWeight', 'invoiceNumber', 'differenceAmount', 'arrivalComments', 'status',
  'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
]

const dataColumns = deliveryColumns.filter((column) => !['createdAt', 'updatedAt', 'createdBy', 'updatedBy'].includes(column))

function comparable(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

function naturalKey(row) {
  return [row.deliveryDate, row.truckNumber || '', row.aviz || '', row.milkType,
    Number(row.loadedWeightKg).toFixed(3), Number(row.emptyWeightKg).toFixed(3)].join('|')
}

export function validateMilkDeliverySnapshot(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The delivery snapshot contains no rows.')
  const ids = new Set()
  const keys = new Set()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !deliveryColumns.every((column) => Object.hasOwn(row, column))) {
      throw new Error('The delivery snapshot is missing required columns.')
    }
    if (!row.deliveryId || !/^\d{4}-\d{2}-\d{2}$/u.test(row.deliveryDate) ||
      !['DRAFT', 'AWAITING_GREECE', 'COMPLETE'].includes(row.status)) {
      throw new Error(`Invalid delivery in snapshot: ${row.deliveryId || '(missing id)'}.`)
    }
    if (ids.has(row.deliveryId)) throw new Error(`Duplicate delivery ID in snapshot: ${row.deliveryId}.`)
    const key = naturalKey(row)
    if (keys.has(key)) throw new Error(`Duplicate delivery details in snapshot: ${row.deliveryId}.`)
    ids.add(row.deliveryId)
    keys.add(key)
  }
}

export function planMilkDeliveryImport(sourceRows, targetRows) {
  const byId = new Map(targetRows.map((row) => [row.deliveryId, row]))
  const byKey = new Map(targetRows.map((row) => [naturalKey(row), row.deliveryId]))
  const insert = []
  const unchanged = []
  const conflicts = []
  for (const row of sourceRows) {
    const existing = byId.get(row.deliveryId)
    if (existing) {
      const changedFields = dataColumns.filter((column) => comparable(existing[column]) !== comparable(row[column]))
      if (changedFields.length) conflicts.push({ deliveryId: row.deliveryId, changedFields })
      else unchanged.push(row.deliveryId)
      continue
    }
    const matchingId = byKey.get(naturalKey(row))
    if (matchingId) conflicts.push({ deliveryId: row.deliveryId, matchingId })
    else insert.push(row)
  }
  return { insert, unchanged, conflicts }
}
