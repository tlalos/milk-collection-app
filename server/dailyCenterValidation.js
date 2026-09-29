const normalized = value => String(value || '').trim().replace(/\s+/gu, ' ').toUpperCase()

export function correctedCenterMatch(existingMatch, rowNumber, originalName, targetName, centers) {
  const candidates = (centers || []).filter(center => normalized(center.name) === normalized(targetName) && /^c/i.test(center.code || ''))
  const center = candidates.length === 1 ? candidates[0] : null
  return {
    ...(existingMatch || {}),
    rowNumber,
    originalName: existingMatch?.originalName || originalName || null,
    status: center ? 'confirmed' : 'unmatched',
    selectedCode: center ? String(center.code) : null,
    selectedName: center?.name || null,
    suggestions: candidates.map(item => ({ code: String(item.code), name: item.name, score: 1 })),
  }
}

export function validateDailyCenterMatches(rows, matches, centers) {
  for (const row of rows || []) {
    const match = matches?.find(item => Number(item.rowNumber) === Number(row.rowNumber))
    if (!match?.selectedCode) continue // Unmatched drafts can still be saved.
    const center = centers?.find(item => normalized(item.code) === normalized(match.selectedCode))
    if (!center || normalized(row.collectionCenter) !== normalized(center.name) || normalized(match.selectedName) !== normalized(center.name)) {
      return `Row ${row.rowNumber}: the center name and ERP selection do not agree. Select the correct ERP center again.`
    }
  }
  return null
}
