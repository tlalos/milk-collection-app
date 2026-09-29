const normalized = value => String(value || '').trim().replace(/\s+/gu, ' ').toUpperCase()

export function matchingMonthlyHeader(headerName, match) {
  if (!match || normalized(headerName) === normalized(match.selectedName)) return match
  return { ...match, selectedCode: null, selectedName: null, status: 'unmatched' }
}

export function reconcileMonthlyHeader(headerName, match, centers) {
  const candidates = (centers || []).filter(center => /^c/i.test(center.code || '') && normalized(center.name) === normalized(headerName))
  const center = candidates.length === 1 ? candidates[0] : null
  return { ...(match || {}), originalName: match?.originalName ?? headerName,
    selectedName: center?.name || null, selectedCode: center?.code || null,
    status: center ? 'confirmed' : 'unmatched', suggestions: match?.suggestions || [] }
}

export function monthlyPricingProducerWarning(row, references) {
  if (!/^p\S+$/iu.test(String(row.producerCode || '').trim())) return 'No ERP match'
  return monthlyProducerWarning(row, references)
}

export function monthlyProducerWarning(row, references) {
  if (!references) return 'ERP list unavailable'
  const candidates = references.producers.filter(producer => row.producerCode
    ? normalized(producer.producerCode) === normalized(row.producerCode)
    : normalized(producer.producerName) === normalized(row.producer))
  if (candidates.length !== 1 || normalized(candidates[0].producerName) !== normalized(row.producer)) return 'No ERP match'
  const producer = candidates[0]
  const centers = references.centers.filter(center => normalized(center.name) === normalized(row.centerName))
  if (centers.length === 1) {
    if (normalized(producer.centerCode) !== normalized(centers[0].code)) return 'Wrong center'
  } else if (!row.centerName || normalized(producer.centerName) !== normalized(row.centerName)) return 'Wrong center'
  return null
}

export function matchingMonthlyProducer(row, match) {
  if (!match?.selectedCode) return match
  const reference = match.suggestions?.find(item => normalized(item.code) === normalized(match.selectedCode))
  const selectedName = match.selectedName || reference?.name
  if (selectedName && normalized(row.producer || row.centerName) === normalized(selectedName)) return match
  return { ...match, selectedCode: null, selectedName: null, status: 'unmatched' }
}

export function reconcileMonthlyProducerMatches(rows, matches) {
  return matches.flatMap(match => {
    const row = rows.find(row => Number(row.rowNumber) === Number(match.rowNumber))
    return row ? [matchingMonthlyProducer(row, match)] : []
  })
}
