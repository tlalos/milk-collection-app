const receptionFields = [
  ['receptionDate', 'Date'],
  ['vehicleCategory', 'Truck type'],
  ['vehicleRegistration', 'Truck'],
  ['driverName', 'Driver'],
  ['routeId', 'Route'],
  ['milkTypeLabel', 'Milk type'],
  ['deliveryCategory', 'Reception type'],
  ['fullTruckWeightKg', 'Loaded kg'],
  ['fullTruckWeighedAt', 'Loaded weighing time'],
  ['emptyTruckWeightKg', 'Empty kg'],
  ['emptyTruckWeighedAt', 'Empty weighing time'],
  ['netQuantityKg', 'Net kg'],
  ['calculatedLiters', 'Liters'],
  ['densityFactor', 'Density'],
  ['dailyRoutesLiters', 'Daily routes liters'],
  ['differenceLiters', 'Difference liters'],
  ['comments', 'Comments'],
]

const qualityFields = [
  ['exteriorTemperatureC', 'Exterior temperature'],
  ['accessAt', 'Access time'],
  ['receptionAt', 'Reception time'],
  ['antibioticPccResult', 'Antibiotic result'],
  ['ph', 'pH'],
  ['productTemperatureC', 'Product temperature'],
  ['fatResult', 'Fat'],
  ['waterPercentage', 'Water'],
  ['proteinResult', 'Protein'],
  ['tankNumber', 'Tank'],
  ['conformityResult', 'Conformity'],
  ['productionEntryAt', 'Production entry'],
  ['productionExitAt', 'Production exit'],
  ['responsiblePerson', 'Responsible person'],
  ['pcc1Observations', 'Observations'],
]

const deliveryFields = [
  ['deliveryDate', 'Date'],
  ['deliveryTime', 'Time'],
  ['truckNumber', 'Truck'],
  ['tractorNumber', 'Tractor'],
  ['aviz', 'Aviz'],
  ['milkTypeLabel', 'Milk type'],
  ['deliveryCategory', 'Delivery type'],
  ['loadedWeightKg', 'Loaded kg'],
  ['loadedWeighedAt', 'Loaded weighing time'],
  ['emptyWeightKg', 'Empty kg'],
  ['emptyWeighedAt', 'Empty weighing time'],
  ['netQuantityKg', 'Net kg'],
  ['calculatedLiters', 'Liters'],
  ['densityFactor', 'Density'],
  ['departureComments', 'Departure comments'],
  ['greeceWeight', 'Greece weight'],
  ['invoiceNumber', 'Invoice number'],
  ['differenceAmount', 'Weight difference'],
  ['arrivalComments', 'Arrival comments'],
  ['status', 'Status'],
]

function parseSnapshot(value) {
  if (!value) return null
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizedValue(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return String(value).trim() || null
}

function fieldChanges(before, after, fields, mode) {
  return fields.flatMap(([key, label]) => {
    const from = normalizedValue(before?.[key])
    const to = normalizedValue(after?.[key])
    if (mode === 'create' && to === null) return []
    if (mode === 'delete' && from === null) return []
    if (mode === 'update' && from === to) return []
    return [{ field: label, before: from, after: to }]
  })
}

export function presentAuditActivity(row) {
  const base = {
    auditId: String(row.auditId),
    occurredAt: row.occurredAt,
    username: row.username || '',
    action: row.action,
    entityType: row.entityType || '',
    entityId: row.entityId || '',
    ipAddress: row.ipAddress || '',
    reason: row.action?.endsWith('.failed') ? parseSnapshot(row.metadataJson)?.reason || '' : '',
    changes: [],
  }
  const isReception = row.entityType === 'MilkReception'
  const isDelivery = row.entityType === 'MilkDelivery'
  if (!isReception && !isDelivery) return base

  const mode = row.action.endsWith('.create') ? 'create' : row.action.endsWith('.delete') ? 'delete' : row.action.endsWith('.update') ? 'update' : ''
  if (!mode) return base
  const before = parseSnapshot(row.beforeJson)
  const after = parseSnapshot(row.afterJson)
  const fields = isReception ? receptionFields : deliveryFields
  const changes = fieldChanges(before, after, fields, mode)
  if (isReception) {
    for (const detailType of ['ORIGINAL', 'CUSTOM']) {
      changes.push(...fieldChanges(before?.qualityDetails?.[detailType], after?.qualityDetails?.[detailType], qualityFields, mode)
        .map((change) => ({ ...change, field: `${detailType === 'ORIGINAL' ? 'Original' : 'Custom'}: ${change.field}` })))
    }
  }
  return { ...base, changes }
}
