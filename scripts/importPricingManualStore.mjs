import 'dotenv/config'
import { closeSqlOcrStore, isSqlOcrStoreEnabled, upsertMonthlyProducerPricingRows } from '../server/sqlOcrStore.js'
import { listAllReferenceProducers, readPricingEntryManualStore } from '../server/excelService.js'

function monthKeyFromExcelKey(value) {
  const text = String(value || '').trim()
  const match = /^(\d{4})(\d{2})$/u.exec(text)
  return match ? `${match[1]}-${match[2]}` : ''
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function textOrNull(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function normalizeCode(value) {
  return String(value || '').trim().toLocaleLowerCase()
}

function normalizeMilkType(value) {
  const text = String(value || '').trim().toUpperCase()
  if (text === 'MILK-COW' || text === 'MILK-SHEEP' || text === 'MILK-GOAT' || text === 'MILK-BUFF') return text
  if (text.includes('BUFF') || text.includes('BIVOL')) return 'MILK-BUFF'
  if (text.includes('SHEEP') || text.includes('OAIE')) return 'MILK-SHEEP'
  if (text.includes('GOAT') || text.includes('CAPRA')) return 'MILK-GOAT'
  return text || 'MILK-COW'
}

function mapPricingRows(excelRows, referenceProducers) {
  const producersByCode = new Map(referenceProducers.map((producer) => [normalizeCode(producer.producerCode), producer]))
  const rows = []
  const skipped = []
  for (const row of excelRows) {
    const pricingKey = String(row.Pricing_Key || '').trim()
    const [rawMonth, rawProducerCode, rawMilkType] = pricingKey.split('|').map((part) => String(part || '').trim())
    const monthKey = monthKeyFromExcelKey(rawMonth)
    const producerCode = rawProducerCode
    const milkType = normalizeMilkType(rawMilkType)
    if (!monthKey || !producerCode || !milkType) {
      skipped.push({ pricingKey, reason: 'Invalid Pricing_Key' })
      continue
    }
    const producer = producersByCode.get(normalizeCode(producerCode))
    rows.push({
      monthKey,
      producerCode,
      milkType,
      producerName: producer?.producerName || null,
      centerCode: producer?.centerCode || null,
      centerName: producer?.centerName || null,
      responsiblePrice: numberOrNull(row.Responsible_Price),
      receiverCommission: numberOrNull(row.Receiver_Commission),
      electricity: numberOrNull(row.Electricity),
      responsibleComment: textOrNull(row.Responsible_Comment),
      pricingStatus: textOrNull(row.Pricing_Status) || 'DRAFT',
      lastSaved: textOrNull(row.Last_Saved),
    })
  }
  return { rows, skipped }
}

if (!isSqlOcrStoreEnabled()) {
  throw new Error('Set OCR_JOB_STORE=sql before importing pricing history.')
}

try {
  const [manualStore, referenceProducers] = await Promise.all([
    readPricingEntryManualStore(),
    listAllReferenceProducers(),
  ])
  const mapped = mapPricingRows(manualStore.rows, referenceProducers)
  const result = await upsertMonthlyProducerPricingRows(mapped.rows)
  const missingReferenceCount = mapped.rows.filter((row) => !row.producerName).length
  console.log(JSON.stringify({
    workbook: manualStore.workbook,
    tableName: manualStore.tableName,
    excelRows: manualStore.rows.length,
    importedRows: mapped.rows.length,
    skippedRows: mapped.skipped.length,
    missingReferenceCount,
    inserted: result.inserted,
    updated: result.updated,
  }, null, 2))
  if (mapped.skipped.length) {
    console.log('Skipped rows:')
    console.log(JSON.stringify(mapped.skipped.slice(0, 20), null, 2))
  }
} finally {
  await closeSqlOcrStore()
}
