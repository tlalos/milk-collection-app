const milkTypes = new Map([
  ['Lapte de vacă', { code: 'MILK-COW', label: 'Cow', densityFactor: 1.029 }],
  ['Lapte de oaie', { code: 'MILK-SHEEP', label: 'Sheep', densityFactor: 1.036 }],
  ['Lapte de vacă standardizat pentru Grecia', { code: 'MILK-COW-GREECE', label: 'Standardized', densityFactor: 1.037 }],
])

const expectedHeaders = [
  'Delivery Date', 'Delivery Time', 'Truck Number', 'Tractor Number', 'AVIZ',
  'Milk Type Delivered', 'Loaded Vehicle Weight (kg)', 'Empty Vehicle Weight (kg)',
  'Net Delivered Quantity (kg)', 'Calculated Delivered Liters', 'Delivery Category',
]

function cellText(value) {
  return String(value ?? '').trim()
}

function numberOrNull(value, rowNumber, field) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Excel row ${rowNumber}: invalid ${field}.`)
  return parsed
}

function excelDate(value, rowNumber) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Excel row ${rowNumber}: delivery date is not an Excel date.`)
  }
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000)
  const iso = date.toISOString().slice(0, 10)
  if (iso < '2020-01-01' || iso > '2100-12-31') throw new Error(`Excel row ${rowNumber}: delivery date is out of range.`)
  return iso
}

function excelTime(value, rowNumber) {
  if (value === '' || value === null || value === undefined) return ''
  if (typeof value === 'number' && value > 0 && value < 1) {
    const minutes = Math.round(value * 1440)
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  const text = cellText(value)
  const match = /^(\d{1,2}):?(\d{2})$/u.exec(text)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`Excel row ${rowNumber}: invalid delivery time.`)
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function sourceText(value, rowNumber, field, maxLength) {
  const result = cellText(value)
  if (result.length > maxLength) throw new Error(`Excel row ${rowNumber}: ${field} exceeds ${maxLength} characters.`)
  return result
}

function weight(value, rowNumber, field) {
  const parsed = numberOrNull(value, rowNumber, field)
  if (parsed === null || parsed <= 0) throw new Error(`Excel row ${rowNumber}: ${field} must be positive.`)
  return parsed
}

function nearlyEqual(actual, expected) {
  return Math.abs(actual - expected) <= 0.02
}

export function deliveryNaturalKey(row) {
  return [row.deliveryDate, String(row.truckNumber || '').toUpperCase(), String(row.aviz || '').toUpperCase(), row.milkType,
    Number(row.loadedWeightKg).toFixed(3), Number(row.emptyWeightKg).toFixed(3)].join('|')
}

export function mapPasterisationDeliveries(values) {
  const headers = values[0] || []
  for (const [index, expected] of expectedHeaders.entries()) {
    if (cellText(headers[index]) !== expected) throw new Error(`Milk Deliveries column ${index + 1} is not ${expected}.`)
  }

  const rows = []
  const warnings = []
  for (let index = 1; index < values.length; index += 1) {
    const cells = values[index] || []
    if (!cells.some((value) => value !== '' && value !== null && value !== undefined)) continue
    const rowNumber = index + 1
    const milk = milkTypes.get(cellText(cells[5]))
    if (!milk) throw new Error(`Excel row ${rowNumber}: unknown milk type ${cellText(cells[5])}.`)
    const loadedWeightKg = weight(cells[6], rowNumber, 'loaded weight')
    const emptyWeightKg = weight(cells[7], rowNumber, 'empty weight')
    if (emptyWeightKg > loadedWeightKg) throw new Error(`Excel row ${rowNumber}: empty weight exceeds loaded weight.`)
    const netQuantityKg = loadedWeightKg - emptyWeightKg
    const sourceNet = numberOrNull(cells[8], rowNumber, 'net weight')
    const sourceLiters = numberOrNull(cells[9], rowNumber, 'liters')
    if (sourceNet === null || !nearlyEqual(sourceNet, netQuantityKg)) throw new Error(`Excel row ${rowNumber}: net weight does not match the weights.`)
    if (sourceLiters === null || !nearlyEqual(sourceLiters, netQuantityKg / milk.densityFactor)) {
      throw new Error(`Excel row ${rowNumber}: liters do not match the milk density factor.`)
    }

    let truckNumber = sourceText(cells[2], rowNumber, 'truck number', 80)
    let tractorNumber = sourceText(cells[3], rowNumber, 'tractor number', 80)
    if (/^Add New Truck$/iu.test(truckNumber)) { truckNumber = ''; warnings.push(`Row ${rowNumber}: truck placeholder treated as missing.`) }
    if (/^Add New Tractor$/iu.test(tractorNumber)) { tractorNumber = ''; warnings.push(`Row ${rowNumber}: tractor placeholder treated as missing.`) }
    const category = sourceText(cells[10], rowNumber, 'category', 40).toUpperCase()
    if (category && category !== 'SALES' && category !== 'OTHERS') throw new Error(`Excel row ${rowNumber}: unknown category ${category}.`)
    if (!category) warnings.push(`Row ${rowNumber}: category is unspecified.`)
    if (!truckNumber) warnings.push(`Row ${rowNumber}: truck number is missing.`)
    const greeceWeight = numberOrNull(cells[12], rowNumber, 'Greece weight')
    if (greeceWeight !== null && greeceWeight <= 0) throw new Error(`Excel row ${rowNumber}: Greece weight must be positive.`)
    const differenceAmount = numberOrNull(cells[14], rowNumber, 'difference')
    if (greeceWeight === null && differenceAmount !== null) throw new Error(`Excel row ${rowNumber}: difference has no Greece weight.`)
    if (greeceWeight !== null && (differenceAmount === null || !nearlyEqual(differenceAmount, greeceWeight - netQuantityKg))) {
      throw new Error(`Excel row ${rowNumber}: difference does not match Greece kg minus net kg.`)
    }
    const aviz = sourceText(cells[4], rowNumber, 'AVIZ', 120)
    if (!aviz) warnings.push(`Row ${rowNumber}: AVIZ is missing.`)
    const invoiceNumber = sourceText(cells[13], rowNumber, 'invoice number', 160)
    const status = !truckNumber || !aviz || !category ? 'DRAFT'
      : greeceWeight !== null && invoiceNumber ? 'COMPLETE' : 'AWAITING_GREECE'
    rows.push({
      excelRowNumber: rowNumber,
      deliveryId: `EXCEL-PASTERISATION-ROW-${rowNumber}`,
      deliveryDate: excelDate(cells[0], rowNumber),
      deliveryTime: excelTime(cells[1], rowNumber),
      truckNumber,
      tractorNumber,
      aviz,
      milkType: milk.code,
      milkTypeLabel: milk.label,
      densityFactor: milk.densityFactor,
      loadedWeightKg,
      emptyWeightKg,
      netQuantityKg,
      calculatedLiters: Math.round((netQuantityKg / milk.densityFactor) * 1000) / 1000,
      deliveryCategory: category || 'UNSPECIFIED',
      departureComments: sourceText(cells[11], rowNumber, 'departure comments', 1200),
      greeceWeight,
      invoiceNumber,
      differenceAmount: greeceWeight === null ? null : Math.round((greeceWeight - netQuantityKg) * 1000) / 1000,
      arrivalComments: sourceText(cells[15], rowNumber, 'arrival comments', 1200),
      status,
    })
  }

  const seen = new Map()
  for (const row of rows) {
    const key = deliveryNaturalKey(row)
    if (seen.has(key)) throw new Error(`Excel rows ${seen.get(key)} and ${row.excelRowNumber} describe the same delivery.`)
    seen.set(key, row.excelRowNumber)
  }
  return { rows, warnings }
}
