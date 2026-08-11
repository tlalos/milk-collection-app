const automatedWarningPattern = /\b(driver|vehicle|registration|truck|route|fat|density|densitate|u\.?g\.?|water|temperature|notice|aviz)\b/iu

export function rebuildVerificationWarnings(data, context = {}) {
  const warnings = (data.warnings || []).filter((warning) => !automatedWarningPattern.test(warning))
  const { driverMatch, vehicleMatch, routeMatch, rowValueSources = [] } = context

  if (driverMatch?.status === 'auto_replaced' && data.driverName === driverMatch.selectedName) {
    warnings.push(`Driver replaced from Excel: “${driverMatch.originalName || '—'}” → “${driverMatch.selectedName}”. Verify the replacement.`)
  } else if (driverMatch?.status === 'unmatched') {
    warnings.push(`Driver “${data.driverName || 'empty'}” was not matched in Excel and requires verification.`)
  }
  if (vehicleMatch?.status === 'auto_replaced' && data.vehicleRegistration === vehicleMatch.selectedValue) {
    warnings.push(`Vehicle replaced from Excel: “${vehicleMatch.originalValue || '—'}” → “${vehicleMatch.selectedValue}”. Verify the replacement.`)
  } else if (vehicleMatch?.status === 'unmatched') {
    warnings.push(`Vehicle “${data.vehicleRegistration || 'empty'}” was not matched in Excel and requires verification.`)
  }
  if (routeMatch?.status === 'resolved' && data.route === routeMatch.selectedRoute) {
    warnings.push(`Route “${routeMatch.selectedRoute}” was retrieved from Excel using the date and vehicle. Verify the selected route.`)
  } else if (routeMatch?.status === 'unmatched') {
    warnings.push(`Route “${data.route || 'empty'}” could not be retrieved from Excel and requires verification.`)
  }

  const activeSources = rowValueSources.flatMap((entry) => Object.entries(entry.fields || {}).flatMap(([field, source]) => {
    const row = data.rows.find((item) => item.rowNumber === entry.rowNumber)
    return row && String(row[field] ?? '') === String(source.value ?? '') ? [{ field, source }] : []
  }))
  const currentInvoiceCount = activeSources.filter((item) => item.source.source === 'current_invoice').length
  const previousDayCount = activeSources.filter((item) => item.source.source === 'previous_day').length
  const generatedAvizCount = activeSources.filter((item) => item.source.source === 'invoice_date').length
  if (currentInvoiceCount) warnings.push(`${currentInvoiceCount} row value${currentInvoiceCount === 1 ? ' was' : 's were'} copied from the last available value in this invoice. Verify the highlighted fields.`)
  if (previousDayCount) warnings.push(`${previousDayCount} row value${previousDayCount === 1 ? ' was' : 's were'} retrieved from the previous Excel date. Verify the highlighted fields.`)
  if (generatedAvizCount) warnings.push(`${generatedAvizCount} Aviz value${generatedAvizCount === 1 ? ' was' : 's were'} generated from the document date. Verify the highlighted fields.`)

  const missingLabels = [
    ['fatPercent', 'Fat'],
    ['density', 'U.G.'],
    ['water', 'Water'],
    ['temperature', 'Temperature'],
    ['noticeNumber', 'Aviz'],
  ].flatMap(([field, label]) => data.rows.some((row) => row[field] === null || row[field] === undefined || row[field] === '') ? [label] : [])
  if (missingLabels.length) warnings.push(`Missing row values still require review: ${missingLabels.join(', ')}.`)
  return [...new Set(warnings)]
}
