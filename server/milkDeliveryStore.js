import { randomUUID } from 'node:crypto'
import sql from 'mssql'

let poolPromise = null
let initialized = false

function sqlConfig() {
  const server = process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost'
  const portValue = process.env.SQL_PORT || process.env.MSSQL_PORT || ''
  const port = portValue ? Number(portValue) : undefined
  const database = process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection'
  const user = process.env.SQL_USER || process.env.MSSQL_USER
  const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
  const encrypt = String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true'
  const trustServerCertificate = String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false'

  if (!user || !password) throw new Error('SQL storage is required for milk deliveries, but SQL_USER and SQL_PASSWORD are not configured.')

  return {
    server,
    ...(port ? { port } : {}),
    database,
    user,
    password,
    options: { encrypt, trustServerCertificate },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  }
}

async function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(sqlConfig()).connect()
  return poolPromise
}

export async function initializeMilkDeliveryStore() {
  if (initialized) return
  const pool = await getPool()
  await pool.request().batch(`
IF OBJECT_ID(N'dbo.MilkDeliveries', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkDeliveries (
    deliveryId NVARCHAR(120) NOT NULL CONSTRAINT PK_MilkDeliveries PRIMARY KEY,
    deliveryDate DATE NOT NULL,
    deliveryTime TIME(0) NULL,
    truckNumber NVARCHAR(80) NULL,
    tractorNumber NVARCHAR(80) NULL,
    aviz NVARCHAR(120) NULL,
    milkType NVARCHAR(60) NOT NULL,
    milkTypeLabel NVARCHAR(160) NOT NULL,
    densityFactor DECIMAL(18,6) NOT NULL,
    loadedWeightKg DECIMAL(18,3) NULL,
    loadedWeighedAt DATETIME2 NULL,
    emptyWeightKg DECIMAL(18,3) NULL,
    emptyWeighedAt DATETIME2 NULL,
    netQuantityKg DECIMAL(18,3) NULL,
    calculatedLiters DECIMAL(18,3) NULL,
    deliveryCategory NVARCHAR(40) NOT NULL,
    departureComments NVARCHAR(1200) NULL,
    greeceFullWeightKg DECIMAL(18,3) NULL,
    greeceEmptyWeightKg DECIMAL(18,3) NULL,
    greeceWeight DECIMAL(18,3) NULL,
    invoiceNumber NVARCHAR(160) NULL,
    differenceAmount DECIMAL(18,3) NULL,
    arrivalComments NVARCHAR(1200) NULL,
    status NVARCHAR(40) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    createdBy NVARCHAR(160) NULL,
    updatedBy NVARCHAR(160) NULL,
    CONSTRAINT CK_MilkDeliveries_Status CHECK (status IN (N'DRAFT', N'AWAITING_GREECE', N'COMPLETE'))
  );
END;

IF COL_LENGTH(N'dbo.MilkDeliveries', N'greeceFullWeightKg') IS NULL
  ALTER TABLE dbo.MilkDeliveries ADD greeceFullWeightKg DECIMAL(18,3) NULL;

IF COL_LENGTH(N'dbo.MilkDeliveries', N'greeceEmptyWeightKg') IS NULL
  ALTER TABLE dbo.MilkDeliveries ADD greeceEmptyWeightKg DECIMAL(18,3) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkDeliveries_DateStatus' AND object_id = OBJECT_ID(N'dbo.MilkDeliveries'))
  CREATE INDEX IX_MilkDeliveries_DateStatus ON dbo.MilkDeliveries(deliveryDate, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkDeliveries_Aviz' AND object_id = OBJECT_ID(N'dbo.MilkDeliveries'))
  CREATE INDEX IX_MilkDeliveries_Aviz ON dbo.MilkDeliveries(aviz);
`)
  initialized = true
}

export async function listMilkDeliveries({ date = '', search = '', status = '' } = {}) {
  await initializeMilkDeliveryStore()
  const result = await (await getPool()).request()
    .input('date', sql.Date, isoDateValue(date))
    .input('search', sql.NVarChar(240), `%${String(search || '').trim()}%`)
    .input('status', sql.NVarChar(40), normalizeFilterStatus(status))
    .query(`
SELECT TOP (1000) *, CONVERT(varchar(5), deliveryTime, 108) AS deliveryTimeText
FROM dbo.MilkDeliveries
WHERE (@date IS NULL OR deliveryDate = @date)
  AND (@status = N'' OR status = @status)
  AND (
    @search = N'%%'
    OR deliveryId LIKE @search
    OR aviz LIKE @search
    OR truckNumber LIKE @search
    OR tractorNumber LIKE @search
    OR milkTypeLabel LIKE @search
    OR invoiceNumber LIKE @search
    OR arrivalComments LIKE @search
  )
ORDER BY deliveryDate DESC, deliveryTime DESC, updatedAt DESC;
`)
  return result.recordset.map(rowToDelivery)
}

export async function getMilkDelivery(id) {
  await initializeMilkDeliveryStore()
  const result = await (await getPool()).request()
    .input('deliveryId', sql.NVarChar(120), id)
    .query('SELECT *, CONVERT(varchar(5), deliveryTime, 108) AS deliveryTimeText FROM dbo.MilkDeliveries WHERE deliveryId = @deliveryId;')
  return result.recordset[0] ? rowToDelivery(result.recordset[0]) : null
}

export async function createMilkDelivery(input, username = '') {
  await initializeMilkDeliveryStore()
  const record = normalizeDelivery(input)
  record.deliveryId = `DEL-${record.deliveryDate.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`
  validateDelivery(record)
  const now = new Date()
  const request = (await getPool()).request()
  bindDelivery(request, record)
  request
    .input('createdAt', sql.DateTimeOffset, now)
    .input('updatedAt', sql.DateTimeOffset, now)
    .input('createdBy', sql.NVarChar(160), username || null)
    .input('updatedBy', sql.NVarChar(160), username || null)
  await request.query(`
INSERT INTO dbo.MilkDeliveries (
  deliveryId, deliveryDate, deliveryTime, truckNumber, tractorNumber, aviz, milkType, milkTypeLabel, densityFactor,
  loadedWeightKg, loadedWeighedAt, emptyWeightKg, emptyWeighedAt, netQuantityKg, calculatedLiters,
  deliveryCategory, departureComments, greeceWeight, invoiceNumber, differenceAmount, arrivalComments, status,
  createdAt, updatedAt, createdBy, updatedBy
) VALUES (
  @deliveryId, @deliveryDate, CONVERT(time(0), @deliveryTime), @truckNumber, @tractorNumber, @aviz, @milkType, @milkTypeLabel, @densityFactor,
  @loadedWeightKg, CONVERT(datetime2, @loadedWeighedAt, 126), @emptyWeightKg, CONVERT(datetime2, @emptyWeighedAt, 126), @netQuantityKg, @calculatedLiters,
  @deliveryCategory, @departureComments, @greeceWeight, @invoiceNumber, @differenceAmount, @arrivalComments, @status,
  @createdAt, @updatedAt, @createdBy, @updatedBy
);`)
  return getMilkDelivery(record.deliveryId)
}

export async function updateMilkDelivery(id, input, username = '') {
  await initializeMilkDeliveryStore()
  const existing = await getMilkDelivery(id)
  if (!existing) return null
  const record = normalizeDelivery({ ...existing, ...input, deliveryId: id })
  validateDelivery(record)
  const request = (await getPool()).request()
  bindDelivery(request, record)
  request
    .input('updatedAt', sql.DateTimeOffset, new Date())
    .input('updatedBy', sql.NVarChar(160), username || null)
  await request.query(`
UPDATE dbo.MilkDeliveries SET
  deliveryDate = @deliveryDate,
  deliveryTime = CONVERT(time(0), @deliveryTime),
  truckNumber = @truckNumber,
  tractorNumber = @tractorNumber,
  aviz = @aviz,
  milkType = @milkType,
  milkTypeLabel = @milkTypeLabel,
  densityFactor = @densityFactor,
  loadedWeightKg = @loadedWeightKg,
  loadedWeighedAt = CONVERT(datetime2, @loadedWeighedAt, 126),
  emptyWeightKg = @emptyWeightKg,
  emptyWeighedAt = CONVERT(datetime2, @emptyWeighedAt, 126),
  netQuantityKg = @netQuantityKg,
  calculatedLiters = @calculatedLiters,
  deliveryCategory = @deliveryCategory,
  departureComments = @departureComments,
  greeceWeight = @greeceWeight,
  invoiceNumber = @invoiceNumber,
  differenceAmount = @differenceAmount,
  arrivalComments = @arrivalComments,
  status = @status,
  updatedAt = @updatedAt,
  updatedBy = @updatedBy
WHERE deliveryId = @deliveryId;`)
  return getMilkDelivery(id)
}

export async function deleteMilkDelivery(id) {
  await initializeMilkDeliveryStore()
  const result = await (await getPool()).request()
    .input('deliveryId', sql.NVarChar(120), id)
    .query('DELETE FROM dbo.MilkDeliveries WHERE deliveryId = @deliveryId; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

function normalizeDelivery(input) {
  const densityFactor = positiveNumber(input.densityFactor) || 1.029
  const loadedWeightKg = decimalValue(input.loadedWeightKg)
  const emptyWeightKg = decimalValue(input.emptyWeightKg)
  const netQuantityKg = loadedWeightKg !== null && emptyWeightKg !== null && emptyWeightKg <= loadedWeightKg
    ? round(loadedWeightKg - emptyWeightKg, 3)
    : null
  const calculatedLiters = netQuantityKg !== null ? round(netQuantityKg / densityFactor, 3) : null
  const greeceWeight = decimalValue(input.greeceWeight)
  const differenceAmount = netQuantityKg !== null && greeceWeight !== null ? round(greeceWeight - netQuantityKg, 3) : null
  const milkType = text(input.milkType) || 'MILK-COW'
  return {
    deliveryId: text(input.deliveryId || input.id),
    deliveryDate: isoDateString(input.deliveryDate) || isoDateString(new Date()),
    deliveryTime: timeString(input.deliveryTime),
    truckNumber: upperText(input.truckNumber),
    tractorNumber: upperText(input.tractorNumber),
    aviz: upperText(input.aviz),
    milkType,
    milkTypeLabel: text(input.milkTypeLabel) || milkType,
    densityFactor,
    loadedWeightKg,
    loadedWeighedAt: dateTimeText(input.loadedWeighedAt),
    emptyWeightKg,
    emptyWeighedAt: dateTimeText(input.emptyWeighedAt),
    netQuantityKg,
    calculatedLiters,
    deliveryCategory: upperText(input.deliveryCategory || input.category) || 'SALES',
    departureComments: text(input.departureComments),
    greeceWeight,
    invoiceNumber: upperText(input.invoiceNumber),
    differenceAmount,
    arrivalComments: text(input.arrivalComments),
    status: normalizeStatus(input.status),
  }
}

function validateDelivery(record) {
  if (record.status === 'DRAFT') return
  if (record.deliveryCategory === 'UNSPECIFIED') throw validationError('Delivery category is required before marking the delivery as sent.')
  if (!record.truckNumber) throw validationError('Truck number is required before marking the delivery as sent.')
  if (!record.aviz) throw validationError('AVIZ is required before marking the delivery as sent.')
  if (record.loadedWeightKg === null || record.loadedWeightKg <= 0) throw validationError('Loaded vehicle weight must be a positive number.')
  if (record.emptyWeightKg === null || record.emptyWeightKg <= 0) throw validationError('Empty vehicle weight must be a positive number.')
  if (record.emptyWeightKg > record.loadedWeightKg) throw validationError('Empty vehicle weight cannot exceed loaded vehicle weight.')
  if (record.status === 'COMPLETE' && (record.greeceWeight === null || record.greeceWeight <= 0)) throw validationError('Weight from Greece is required before completing the delivery.')
  if (record.status === 'COMPLETE' && !record.invoiceNumber) throw validationError('Invoice number is required before completing the delivery.')
}

function validationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function bindDelivery(request, record) {
  request
    .input('deliveryId', sql.NVarChar(120), record.deliveryId)
    .input('deliveryDate', sql.Date, record.deliveryDate)
    .input('deliveryTime', sql.NVarChar(8), record.deliveryTime || null)
    .input('truckNumber', sql.NVarChar(80), record.truckNumber || null)
    .input('tractorNumber', sql.NVarChar(80), record.tractorNumber || null)
    .input('aviz', sql.NVarChar(120), record.aviz || null)
    .input('milkType', sql.NVarChar(60), record.milkType)
    .input('milkTypeLabel', sql.NVarChar(160), record.milkTypeLabel)
    .input('densityFactor', sql.Decimal(18, 6), record.densityFactor)
    .input('loadedWeightKg', sql.Decimal(18, 3), record.loadedWeightKg)
    .input('loadedWeighedAt', sql.NVarChar(40), record.loadedWeighedAt || null)
    .input('emptyWeightKg', sql.Decimal(18, 3), record.emptyWeightKg)
    .input('emptyWeighedAt', sql.NVarChar(40), record.emptyWeighedAt || null)
    .input('netQuantityKg', sql.Decimal(18, 3), record.netQuantityKg)
    .input('calculatedLiters', sql.Decimal(18, 3), record.calculatedLiters)
    .input('deliveryCategory', sql.NVarChar(40), record.deliveryCategory)
    .input('departureComments', sql.NVarChar(1200), record.departureComments || null)
    .input('greeceWeight', sql.Decimal(18, 3), record.greeceWeight)
    .input('invoiceNumber', sql.NVarChar(160), record.invoiceNumber || null)
    .input('differenceAmount', sql.Decimal(18, 3), record.differenceAmount)
    .input('arrivalComments', sql.NVarChar(1200), record.arrivalComments || null)
    .input('status', sql.NVarChar(40), record.status)
}

function rowToDelivery(row) {
  return {
    id: row.deliveryId,
    deliveryId: row.deliveryId,
    deliveryDate: isoDateString(row.deliveryDate),
    deliveryTime: row.deliveryTimeText || '',
    truckNumber: row.truckNumber || '',
    tractorNumber: row.tractorNumber || '',
    aviz: row.aviz || '',
    milkType: row.milkType,
    milkTypeLabel: row.milkTypeLabel,
    densityFactor: numberOrNull(row.densityFactor),
    loadedWeightKg: numberOrNull(row.loadedWeightKg),
    loadedWeighedAt: dateTimeString(row.loadedWeighedAt),
    emptyWeightKg: numberOrNull(row.emptyWeightKg),
    emptyWeighedAt: dateTimeString(row.emptyWeighedAt),
    netQuantityKg: numberOrNull(row.netQuantityKg),
    calculatedLiters: numberOrNull(row.calculatedLiters),
    deliveryCategory: row.deliveryCategory,
    departureComments: row.departureComments || '',
    greeceWeight: numberOrNull(row.greeceWeight),
    invoiceNumber: row.invoiceNumber || '',
    differenceAmount: numberOrNull(row.differenceAmount),
    arrivalComments: row.arrivalComments || '',
    status: row.status,
    createdAt: dateTimeString(row.createdAt),
    updatedAt: dateTimeString(row.updatedAt),
    createdBy: row.createdBy || '',
    updatedBy: row.updatedBy || '',
  }
}

function normalizeStatus(value) {
  const status = upperText(value)
  return ['DRAFT', 'AWAITING_GREECE', 'COMPLETE'].includes(status) ? status : 'DRAFT'
}

function normalizeFilterStatus(value) {
  const status = upperText(value)
  return ['DRAFT', 'AWAITING_GREECE', 'COMPLETE'].includes(status) ? status : ''
}

function decimalValue(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function positiveNumber(value) {
  const parsed = decimalValue(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function text(value) {
  return String(value || '').trim()
}

function upperText(value) {
  return text(value).toUpperCase()
}

function timeString(value) {
  const match = /^(\d{2}):(\d{2})/u.exec(text(value))
  return match ? `${match[1]}:${match[2]}` : ''
}

function isoDateValue(value) {
  const normalized = isoDateString(value)
  return normalized || null
}

function isoDateString(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value)
    if (match) return `${match[1]}-${match[2]}-${match[3]}`
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateTimeText(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 19)
}

function dateTimeString(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
