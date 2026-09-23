export function resolveReceptionWeightSource(weight, weighedAt, source, existing = null) {
  if (weight == null) return { source: null, weighedAt: null }

  const changedWeight = existing && weight !== existing.weight
  const unchangedTimestamp = existing && weighedAt === existing.weighedAt
  if (changedWeight && unchangedTimestamp) return { source: 'MANUAL', weighedAt: null }
  if (source === 'MANUAL') return { source: 'MANUAL', weighedAt: null }
  if (source === 'SCALE' && weighedAt) return { source: 'SCALE', weighedAt }
  if (existing && !changedWeight) return { source: null, weighedAt }
  return { source: 'MANUAL', weighedAt: null }
}
