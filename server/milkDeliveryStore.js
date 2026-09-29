import { randomUUID } from 'node:crypto'
import sql from 'mssql'
import { deliveryWeightEvents } from './deliveryWeightHistory.js'
import { resolveReceptionWeightSource } from './receptionWeightSource.js'
import { getMilkDensityFactor } from './milkDensitySettingsStore.js'

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
    loadedWeightSource NVARCHAR(10) NULL,
    emptyWeightKg DECIMAL(18,3) NULL,
    emptyWeighedAt DATETIME2 NULL,
    emptyWeightSource NVARCHAR(10) NULL,
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

IF COL_LENGTH(N'dbo.MilkDeliveries', N'loadedWeightSource') IS NULL
  ALTER TABLE dbo.MilkDeliveries ADD loadedWeightSource NVARCHAR(10) NULL;

IF COL_LENGTH(N'dbo.MilkDeliveries', N'emptyWeightSource') IS NULL
  ALTER TABLE dbo.MilkDeliveries ADD emptyWeightSource NVARCHAR(10) NULL;

IF COL_LENGTH(N'dbo.MilkDeliveries', N'greeceFullWeightKg') IS NULL
  ALTER TABLE dbo.MilkDeliveries ADD greeceFullWeightKg DECIMAL(18,3) NULL;

IF COL_LENGTH(N'dbo.MilkDeliveries', N'greeceEmptyWeightKg') IS NULL
  ALTER TABLE dbo.MilkDeliveries ADD greeceEmptyWeightKg DECIMAL(18,3) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkDeliveries_DateStatus' AND object_id = OBJECT_ID(N'dbo.MilkDeliveries'))
  CREATE INDEX IX_MilkDeliveries_DateStatus ON dbo.MilkDeliveries(deliveryDate, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkDeliveries_Aviz' AND object_id = OBJECT_ID(N'dbo.MilkDeliveries'))
  CREATE INDEX IX_MilkDeliveries_Aviz ON dbo.MilkDeliveries(aviz);

IF OBJECT_ID(N'dbo.MilkDeliveryWeightEvents', N'U') IS NULL
BEGIN
  -- Keep weight history even if the delivery row is deleted.
  CREATE TABLE dbo.MilkDeliveryWeightEvents (
    eventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MilkDeliveryWeightEvents PRIMARY KEY,
    deliveryId NVARCHAR(120) NOT NULL,
    weightKind NVARCHAR(10) NOT NULL,
    source NVARCHAR(10) NOT NULL,
    weightKg DECIMAL(18,3) NULL,
    previousWeightKg DECIMAL(18,3) NULL,
    previousSource NVARCHAR(10) NULL,
    scaleCapturedAt DATETIME2 NULL,
    recordedAt DATETIMEOFFSET NOT NULL,
    username NVARCHAR(160) NULL,
    captureId NVARCHAR(100) NULL,
    CONSTRAINT CK_MilkDeliveryWeightEvents_Kind CHECK (weightKind IN (N'LOADED', N'EMPTY')),
    CONSTRAINT CK_MilkDeliveryWeightEvents_Source CHECK (source IN (N'SCALE', N'MANUAL'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkDeliveryWeightEvents_Delivery' AND object_id = OBJECT_ID(N'dbo.MilkDeliveryWeightEvents'))
  CREATE INDEX IX_MilkDeliveryWeightEvents_Delivery ON dbo.MilkDeliveryWeightEvents(deliveryId, eventId DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MilkDeliveryWeightEvents_Capture' AND object_id = OBJECT_ID(N'dbo.MilkDeliveryWeightEvents'))
  CREATE UNIQUE INDEX UX_MilkDeliveryWeightEvents_Capture ON dbo.MilkDeliveryWeightEvents(captureId) WHERE captureId IS NOT NULL;
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
  const milk = await getMilkDensityFactor('DELIVERIES', input.milkType || 'MILK-COW')
  const record = normalizeDelivery({ ...input, densityFactor: milk.densityFactor, milkTypeLabel: milk.label })
  record.deliveryId = `DEL-${record.deliveryDate.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`
  validateDelivery(record)
  const now = new Date()
  const pool = await getPool()
  const transaction = new sql.Transaction(pool)
  await transaction.begin()
  const request = new sql.Request(transaction)
  bindDelivery(request, record)
  request
    .input('createdAt', sql.DateTimeOffset, now)
    .input('updatedAt', sql.DateTimeOffset, now)
    .input('createdBy', sql.NVarChar(160), username || null)
    .input('updatedBy', sql.NVarChar(160), username || null)
  try {
    await request.query(`
INSERT INTO dbo.MilkDeliveries (
  deliveryId, deliveryDate, deliveryTime, truckNumber, tractorNumber, aviz, milkType, milkTypeLabel, densityFactor,
  loadedWeightKg, loadedWeighedAt, loadedWeightSource, emptyWeightKg, emptyWeighedAt, emptyWeightSource, netQuantityKg, calculatedLiters,
  deliveryCategory, departureComments, greeceWeight, invoiceNumber, differenceAmount, arrivalComments, status,
  createdAt, updatedAt, createdBy, updatedBy
) VALUES (
  @deliveryId, @deliveryDate, CONVERT(time(0), @deliveryTime), @truckNumber, @tractorNumber, @aviz, @milkType, @milkTypeLabel, @densityFactor,
  @loadedWeightKg, CONVERT(datetime2, @loadedWeighedAt, 126), @loadedWeightSource, @emptyWeightKg, CONVERT(datetime2, @emptyWeighedAt, 126), @emptyWeightSource, @netQuantityKg, @calculatedLiters,
  @deliveryCategory, @departureComments, @greeceWeight, @invoiceNumber, @differenceAmount, @arrivalComments, @status,
  @createdAt, @updatedAt, @createdBy, @updatedBy
);`)
    await saveDeliveryWeightEvents(transaction, record.deliveryId, null, record, input, username, now)
    await transaction.commit()
  } catch (error) {
    await transaction.rollback().catch(() => undefined)
    throw error
  }
  return getMilkDelivery(record.deliveryId)
}

export async function updateMilkDelivery(id, input, username = '') {
  await initializeMilkDeliveryStore()
  const existing = await getMilkDelivery(id)
  if (!existing) return null
  const milkType = input.milkType || existing.milkType
  const milk = milkType !== existing.milkType ? await getMilkDensityFactor('DELIVERIES', milkType) : null
  const record = normalizeDelivery({
    ...existing, ...input, deliveryId: id,
    densityFactor: milk ? milk.densityFactor : existing.densityFactor,
    milkTypeLabel: milk ? milk.label : existing.milkTypeLabel,
  }, existing)
  validateDelivery(record)
  const pool = await getPool()
  const transaction = new sql.Transaction(pool)
  await transaction.begin()
  const request = new sql.Request(transaction)
  const now = new Date()
  bindDelivery(request, record)
  request
    .input('updatedAt', sql.DateTimeOffset, now)
    .input('updatedBy', sql.NVarChar(160), username || null)
  try {
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
  loadedWeightSource = @loadedWeightSource,
  emptyWeightKg = @emptyWeightKg,
  emptyWeighedAt = CONVERT(datetime2, @emptyWeighedAt, 126),
  emptyWeightSource = @emptyWeightSource,
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
    await saveDeliveryWeightEvents(transaction, id, existing, record, input, username, now)
    await transaction.commit()
  } catch (error) {
    await transaction.rollback().catch(() => undefined)
    throw error
  }
  return getMilkDelivery(id)
}

async function saveDeliveryWeightEvents(transaction, deliveryId, before, after, input, username, recordedAt) {
  for (const event of deliveryWeightEvents(before, after, input)) {
    await new sql.Request(transaction)
      .input('deliveryId', sql.NVarChar(120), deliveryId)
      .input('weightKind', sql.NVarChar(10), event.weightKind)
      .input('source', sql.NVarChar(10), event.source)
      .input('weightKg', sql.Decimal(18, 3), event.weightKg)
      .input('previousWeightKg', sql.Decimal(18, 3), event.previousWeightKg)
      .input('previousSource', sql.NVarChar(10), event.previousSource)
      .input('scaleCapturedAt', sql.NVarChar(40), event.scaleCapturedAt)
      .input('recordedAt', sql.DateTimeOffset, recordedAt)
      .input('username', sql.NVarChar(160), username || null)
      .input('captureId', sql.NVarChar(100), event.captureId)
      .query(`
IF @captureId IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.MilkDeliveryWeightEvents WHERE captureId = @captureId)
  INSERT INTO dbo.MilkDeliveryWeightEvents (
    deliveryId, weightKind, source, weightKg, previousWeightKg, previousSource,
    scaleCapturedAt, recordedAt, username, captureId
  ) VALUES (
    @deliveryId, @weightKind, @source, @weightKg, @previousWeightKg, @previousSource,
    CONVERT(datetime2, @scaleCapturedAt, 126), @recordedAt, @username, @captureId
  );
`)
  }
}

export async function listMilkDeliveryWeightHistoryForAdmin({ username = '', deliveryId = '', source = '', weightKind = '', beforeId = null } = {}) {
  await initializeMilkDeliveryStore()
  const result = await (await getPool()).request()
    .input('username', sql.NVarChar(160), username)
    .input('deliveryId', sql.NVarChar(120), deliveryId)
    .input('source', sql.NVarChar(10), source)
    .input('weightKind', sql.NVarChar(10), weightKind)
    .input('beforeId', sql.BigInt, beforeId)
    .query(`
SELECT TOP (51) eventId, deliveryId, weightKind, source, weightKg, previousWeightKg, previousSource, scaleCapturedAt, recordedAt, username
FROM dbo.MilkDeliveryWeightEvents
WHERE (@username = N'' OR username = @username)
  AND (@deliveryId = N'' OR CHARINDEX(@deliveryId, deliveryId) > 0)
  AND (@source = N'' OR source = @source)
  AND (@weightKind = N'' OR weightKind = @weightKind)
  AND (@beforeId IS NULL OR eventId < @beforeId)
ORDER BY eventId DESC;
`)
  const hasMore = result.recordset.length > 50
  const entries = result.recordset.slice(0, 50).map(weightEventToClient)
  return { entries, nextBeforeId: hasMore ? entries.at(-1).eventId : null }
}

function weightEventToClient(row) {
  return {
    eventId: String(row.eventId),
    deliveryId: row.deliveryId,
    weightKind: row.weightKind,
    source: row.source,
    weightKg: numberOrNull(row.weightKg),
    previousWeightKg: numberOrNull(row.previousWeightKg),
    previousSource: row.previousSource || null,
    scaleCapturedAt: dateTimeSqlLocalString(row.scaleCapturedAt),
    recordedAt: dateTimeString(row.recordedAt),
    username: row.username || '',
  }
}

export async function deleteMilkDelivery(id) {
  await initializeMilkDeliveryStore()
  const result = await (await getPool()).request()
    .input('deliveryId', sql.NVarChar(120), id)
    .query('DELETE FROM dbo.MilkDeliveries WHERE deliveryId = @deliveryId; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

function normalizeDelivery(input, existing = null) {
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
  const loadedWeight = resolveReceptionWeightSource(
    loadedWeightKg, dateTimeLocalText(input.loadedWeighedAt), input.loadedWeightSource,
    existing && { weight: existing.loadedWeightKg, weighedAt: existing.loadedWeighedAt },
  )
  const emptyWeight = resolveReceptionWeightSource(
    emptyWeightKg, dateTimeLocalText(input.emptyWeighedAt), input.emptyWeightSource,
    existing && { weight: existing.emptyWeightKg, weighedAt: existing.emptyWeighedAt },
  )
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
    loadedWeighedAt: loadedWeight.weighedAt,
    loadedWeightSource: loadedWeight.source,
    emptyWeightKg,
    emptyWeighedAt: emptyWeight.weighedAt,
    emptyWeightSource: emptyWeight.source,
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
    .input('loadedWeightSource', sql.NVarChar(10), record.loadedWeightSource)
    .input('emptyWeightKg', sql.Decimal(18, 3), record.emptyWeightKg)
    .input('emptyWeighedAt', sql.NVarChar(40), record.emptyWeighedAt || null)
    .input('emptyWeightSource', sql.NVarChar(10), record.emptyWeightSource)
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
    loadedWeighedAt: dateTimeSqlLocalString(row.loadedWeighedAt),
    loadedWeightSource: row.loadedWeightSource || null,
    emptyWeightKg: numberOrNull(row.emptyWeightKg),
    emptyWeighedAt: dateTimeSqlLocalString(row.emptyWeighedAt),
    emptyWeightSource: row.emptyWeightSource || null,
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

function dateTimeLocalText(value) {
  if (!value) return null
  const text = String(value).trim()
  const localMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,7})?)?$/u.exec(text)
  if (localMatch) return `${localMatch[1]}:${localMatch[2] || '00'}`
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return null
  const two = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}

function dateTimeString(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function dateTimeSqlLocalString(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const two = (part) => String(part).padStart(2, '0')
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}T${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}`
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
