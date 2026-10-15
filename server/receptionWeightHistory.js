const weightFields = [
  { kind: 'FULL', weight: 'fullTruckWeightKg', source: 'fullTruckWeightSource', weighedAt: 'fullTruckWeighedAt', captureId: 'fullTruckScaleCaptureId' },
  { kind: 'EMPTY', weight: 'emptyTruckWeightKg', source: 'emptyTruckWeightSource', weighedAt: 'emptyTruckWeighedAt', captureId: 'emptyTruckScaleCaptureId' },
]

export function assertScaleOnlyReceptionWeights(before, after, input = {}) {
  for (const field of weightFields) {
    const changed = (before?.[field.weight] ?? null) !== (after[field.weight] ?? null)
      || (before?.[field.source] || null) !== (after[field.source] || null)
      || (before?.[field.weighedAt] || null) !== (after[field.weighedAt] || null)
    if (!changed) continue
    const captureId = typeof input[field.captureId] === 'string' ? input[field.captureId].trim() : ''
    if (after[field.weight] == null || after[field.source] !== 'SCALE'
      || !after[field.weighedAt] || !captureId || captureId.length > 100) {
      const label = field.kind === 'FULL' ? 'Full truck weight' : 'Empty truck weight'
      const error = new Error(`${label} can only be changed using the scale button.`)
      error.status = 400
      throw error
    }
  }
}

export function receptionWeightEvents(before, after, input = {}) {
  return weightFields.flatMap((field) => {
    const previousWeight = before?.[field.weight] ?? null
    const nextWeight = after[field.weight] ?? null
    const previousSource = before?.[field.source] || null
    const nextSource = after[field.source] || null
    const previousTime = before?.[field.weighedAt] || null
    const nextTime = after[field.weighedAt] || null
    const captureId = nextSource === 'SCALE' ? String(input[field.captureId] || '').trim() || null : null
    const changed = before
      ? previousWeight !== nextWeight || previousSource !== nextSource || previousTime !== nextTime || Boolean(captureId)
      : nextWeight !== null
    if (!changed) return []
    return [{
      weightKind: field.kind,
      source: nextSource === 'SCALE' ? 'SCALE' : 'MANUAL',
      weightKg: nextWeight,
      previousWeightKg: previousWeight,
      previousSource,
      scaleCapturedAt: nextSource === 'SCALE' ? nextTime : null,
      captureId,
    }]
  })
}
