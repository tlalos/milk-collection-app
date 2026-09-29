const weightFields = [
  { kind: 'LOADED', weight: 'loadedWeightKg', source: 'loadedWeightSource', weighedAt: 'loadedWeighedAt', captureId: 'loadedScaleCaptureId' },
  { kind: 'EMPTY', weight: 'emptyWeightKg', source: 'emptyWeightSource', weighedAt: 'emptyWeighedAt', captureId: 'emptyScaleCaptureId' },
]

export function deliveryWeightEvents(before, after, input = {}) {
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
