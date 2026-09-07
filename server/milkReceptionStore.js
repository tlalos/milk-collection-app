import sql from 'mssql'

let poolPromise = null
let initialized = false
const TRUCK_ONLY_ROUTE = '__TRUCK_ONLY__'
const QUALITY_DETAIL_TYPES = ['ORIGINAL', 'CUSTOM']

export const milkReceptionOptions = {
  milkTypes: [
    { code: 'MILK-COW', label: 'Lapte de vacă', displayName: 'Cow milk', densityFactor: 1.03 },
    { code: 'MILK-SHEEP', label: 'Lapte de oaie', displayName: 'Sheep milk', densityFactor: 1.036 },
    { code: 'MILK-GOAT', label: 'Lapte de capră', displayName: 'Goat milk', densityFactor: 1.03 },
    { code: 'MILK-BUFF', label: 'Lapte de bivoliță', displayName: 'Buffalo milk', densityFactor: 1.04 },
  ],
  categories: ['COLLECTION', 'OTHERS'],
  vehicleCategories: ['COLLECTION', 'OTHER'],
  antibioticResults: ['Negative / Pass', 'Positive / Fail', 'Pending', 'Not Tested'],
  conformityResults: ['Conforming', 'Non-Conforming', 'Pending', 'Conditionally Accepted'],
  tanks: ['1', '2', '3', '4', '5', '6'],
  drivers: [],
}

function sqlConfig() {
  const server = process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost'
  const portValue = process.env.SQL_PORT || process.env.MSSQL_PORT || ''
  const port = portValue ? Number(portValue) : undefined
  const database = process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection'
  const user = process.env.SQL_USER || process.env.MSSQL_USER
  const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
  const encrypt = String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true'
  const trustServerCertificate = String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false'

  if (!user || !password) {
    throw new Error('SQL storage is required for milk reception, but SQL_USER and SQL_PASSWORD are not configured.')
  }

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

export async function closeMilkReceptionStore() {
  if (!poolPromise) return
  const pool = await poolPromise.catch(() => null)
  poolPromise = null
  initialized = false
  await pool?.close()
}

export async function initializeMilkReceptionStore() {
  if (initialized) return
  const pool = await getPool()
  await pool.request().batch(`
IF OBJECT_ID(N'dbo.MilkReceptions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkReceptions (
    receptionId NVARCHAR(120) NOT NULL CONSTRAINT PK_MilkReceptions PRIMARY KEY,
    receptionDate DATE NOT NULL,
    vehicleRegistration NVARCHAR(80) NOT NULL,
    vehicleCategory NVARCHAR(40) NOT NULL,
    routeId NVARCHAR(40) NOT NULL,
    milkType NVARCHAR(40) NOT NULL,
    milkTypeLabel NVARCHAR(120) NULL,
    driverName NVARCHAR(160) NULL,
    densityFactor DECIMAL(18,6) NOT NULL,
    fullTruckWeightKg DECIMAL(18,3) NULL,
    emptyTruckWeightKg DECIMAL(18,3) NULL,
    netQuantityKg DECIMAL(18,3) NULL,
    calculatedLiters DECIMAL(18,3) NULL,
    deliveryCategory NVARCHAR(40) NOT NULL,
    comments NVARCHAR(1000) NULL,
    dailyRoutesLiters DECIMAL(18,3) NULL,
    differenceLiters DECIMAL(18,3) NULL,
    vehicleCountSource INT NULL,
    routeCountSource INT NULL,
    combinationDiagnosis NVARCHAR(120) NOT NULL,
    exteriorTemperatureC DECIMAL(18,3) NULL,
    accessTime NVARCHAR(12) NULL,
    receptionTime NVARCHAR(12) NULL,
    antibioticPccResult NVARCHAR(40) NULL,
    ph DECIMAL(18,4) NULL,
    productTemperatureC DECIMAL(18,3) NULL,
    fatResult DECIMAL(18,4) NULL,
    waterPercentage DECIMAL(18,4) NULL,
    proteinResult DECIMAL(18,4) NULL,
    tankNumber NVARCHAR(20) NULL,
    conformityResult NVARCHAR(60) NOT NULL,
    productionEntryAt DATETIME2 NULL,
    productionExitAt DATETIME2 NULL,
    responsiblePerson NVARCHAR(160) NULL,
    pcc1Observations NVARCHAR(1500) NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    createdBy NVARCHAR(160) NULL,
    updatedBy NVARCHAR(160) NULL
  );
END;

IF OBJECT_ID(N'dbo.MilkReceptionDrivers', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkReceptionDrivers (
    driverId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MilkReceptionDrivers PRIMARY KEY,
    driverName NVARCHAR(160) NOT NULL,
    sortOrder INT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    createdBy NVARCHAR(160) NULL,
    updatedBy NVARCHAR(160) NULL
  );
END;

IF OBJECT_ID(N'dbo.MilkReceptionQualityDetails', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkReceptionQualityDetails (
    detailId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MilkReceptionQualityDetails PRIMARY KEY,
    receptionId NVARCHAR(120) NOT NULL,
    detailType NVARCHAR(20) NOT NULL,
    exteriorTemperatureC DECIMAL(18,3) NULL,
    accessAt DATETIME2 NULL,
    receptionAt DATETIME2 NULL,
    antibioticPccResult NVARCHAR(40) NULL,
    ph DECIMAL(18,4) NULL,
    productTemperatureC DECIMAL(18,3) NULL,
    fatResult DECIMAL(18,4) NULL,
    waterPercentage DECIMAL(18,4) NULL,
    proteinResult DECIMAL(18,4) NULL,
    tankNumber NVARCHAR(20) NULL,
    conformityResult NVARCHAR(60) NULL,
    productionEntryAt DATETIME2 NULL,
    productionExitAt DATETIME2 NULL,
    responsiblePerson NVARCHAR(160) NULL,
    pcc1Observations NVARCHAR(1500) NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    createdBy NVARCHAR(160) NULL,
    updatedBy NVARCHAR(160) NULL,
    CONSTRAINT FK_MilkReceptionQualityDetails_Reception FOREIGN KEY (receptionId) REFERENCES dbo.MilkReceptions(receptionId) ON DELETE CASCADE,
    CONSTRAINT CK_MilkReceptionQualityDetails_Type CHECK (detailType IN (N'ORIGINAL', N'CUSTOM'))
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkReceptions_DateVehicleRoute' AND object_id = OBJECT_ID(N'dbo.MilkReceptions'))
  CREATE INDEX IX_MilkReceptions_DateVehicleRoute ON dbo.MilkReceptions(receptionDate, vehicleRegistration, routeId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkReceptions_Status' AND object_id = OBJECT_ID(N'dbo.MilkReceptions'))
  CREATE INDEX IX_MilkReceptions_Status ON dbo.MilkReceptions(combinationDiagnosis, conformityResult);

IF OBJECT_ID(N'dbo.MilkReceptionRouteSettings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkReceptionRouteSettings (
    settingId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MilkReceptionRouteSettings PRIMARY KEY,
    vehicleRegistration NVARCHAR(80) NOT NULL,
    vehicleCategory NVARCHAR(40) NOT NULL,
    routeId NVARCHAR(40) NOT NULL,
    routeOrder INT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    createdBy NVARCHAR(160) NULL,
    updatedBy NVARCHAR(160) NULL
  );
END;

IF COL_LENGTH(N'dbo.MilkReceptions', N'vehicleCategory') IS NULL
  ALTER TABLE dbo.MilkReceptions ADD vehicleCategory NVARCHAR(40) NOT NULL CONSTRAINT DF_MilkReceptions_VehicleCategory DEFAULT N'COLLECTION';

IF COL_LENGTH(N'dbo.MilkReceptions', N'driverName') IS NULL
  ALTER TABLE dbo.MilkReceptions ADD driverName NVARCHAR(160) NULL;

IF COL_LENGTH(N'dbo.MilkReceptionRouteSettings', N'vehicleCategory') IS NULL
  ALTER TABLE dbo.MilkReceptionRouteSettings ADD vehicleCategory NVARCHAR(40) NOT NULL CONSTRAINT DF_MilkReceptionRouteSettings_VehicleCategory DEFAULT N'COLLECTION';

EXEC sp_executesql
  N'UPDATE dbo.MilkReceptionRouteSettings
    SET vehicleCategory = N''OTHER''
    WHERE routeId = @truckOnlyRoute AND vehicleCategory = N''COLLECTION''',
  N'@truckOnlyRoute NVARCHAR(40)',
  @truckOnlyRoute = N'${TRUCK_ONLY_ROUTE}';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MilkReceptionRouteSettings_VehicleRoute' AND object_id = OBJECT_ID(N'dbo.MilkReceptionRouteSettings'))
  CREATE UNIQUE INDEX UX_MilkReceptionRouteSettings_VehicleRoute ON dbo.MilkReceptionRouteSettings(vehicleRegistration, routeId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkReceptionRouteSettings_Route' AND object_id = OBJECT_ID(N'dbo.MilkReceptionRouteSettings'))
  CREATE INDEX IX_MilkReceptionRouteSettings_Route ON dbo.MilkReceptionRouteSettings(routeId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MilkReceptionDrivers_Name' AND object_id = OBJECT_ID(N'dbo.MilkReceptionDrivers'))
  CREATE UNIQUE INDEX UX_MilkReceptionDrivers_Name ON dbo.MilkReceptionDrivers(driverName);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_MilkReceptionQualityDetails_ReceptionType' AND object_id = OBJECT_ID(N'dbo.MilkReceptionQualityDetails'))
  CREATE UNIQUE INDEX UX_MilkReceptionQualityDetails_ReceptionType ON dbo.MilkReceptionQualityDetails(receptionId, detailType);
`)
  initialized = true
}

export async function listMilkReceptionDrivers() {
  await initializeMilkReceptionStore()
  const result = await (await getPool()).request().query(`
SELECT driverId, driverName, sortOrder, createdAt, updatedAt, createdBy, updatedBy
FROM dbo.MilkReceptionDrivers
ORDER BY ISNULL(sortOrder, 999999), driverName;
`)
  return result.recordset.map(rowToDriverSetting)
}

export async function upsertMilkReceptionDriver(input, username = '') {
  await initializeMilkReceptionStore()
  const driverName = normalizeDriverName(input?.driverName || input?.name || input)
  if (!driverName) throw new Error('Driver name is required.')
  const sortOrder = integerValue(input?.sortOrder)
  const now = new Date()
  const result = await (await getPool()).request()
    .input('driverName', sql.NVarChar(160), driverName)
    .input('sortOrder', sql.Int, sortOrder)
    .input('now', sql.DateTimeOffset, now)
    .input('username', sql.NVarChar(160), username || null)
    .query(`
IF EXISTS (SELECT 1 FROM dbo.MilkReceptionDrivers WHERE driverName = @driverName)
BEGIN
  UPDATE dbo.MilkReceptionDrivers
  SET sortOrder = @sortOrder,
      updatedAt = @now,
      updatedBy = @username
  WHERE driverName = @driverName;
END
ELSE
BEGIN
  INSERT INTO dbo.MilkReceptionDrivers (driverName, sortOrder, createdAt, updatedAt, createdBy, updatedBy)
  VALUES (@driverName, @sortOrder, @now, @now, @username, @username);
END;

SELECT TOP (1) driverId, driverName, sortOrder, createdAt, updatedAt, createdBy, updatedBy
FROM dbo.MilkReceptionDrivers
WHERE driverName = @driverName;
`)
  return rowToDriverSetting(result.recordset[0])
}

export async function deleteMilkReceptionDriver(id) {
  await initializeMilkReceptionStore()
  const result = await (await getPool()).request()
    .input('driverId', sql.BigInt, Number(id))
    .query('DELETE FROM dbo.MilkReceptionDrivers WHERE driverId = @driverId; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

export async function importMilkReceptionDrivers(drivers, username = '') {
  await initializeMilkReceptionStore()
  let imported = 0
  let skipped = 0
  const names = uniqueSorted(Array.isArray(drivers) ? drivers : [])
  for (let index = 0; index < names.length; index += 1) {
    try {
      await upsertMilkReceptionDriver({ driverName: names[index], sortOrder: index + 1 }, username)
      imported += 1
    } catch {
      skipped += 1
    }
  }
  return { imported, skipped, total: names.length }
}

export async function listMilkReceptionRouteSettings() {
  await initializeMilkReceptionStore()
  const result = await (await getPool()).request().query(`
SELECT settingId, vehicleRegistration, vehicleCategory, routeId, routeOrder, createdAt, updatedAt, createdBy, updatedBy
FROM dbo.MilkReceptionRouteSettings
ORDER BY vehicleRegistration, ISNULL(routeOrder, 999999), routeId;
`)
  return routeSettingsResponse(result.recordset)
}

export async function upsertMilkReceptionRouteSetting(input, username = '') {
  await initializeMilkReceptionStore()
  const record = normalizeRouteSetting(input)
  const now = new Date()
  const request = (await getPool()).request()
    .input('vehicleRegistration', sql.NVarChar(80), record.vehicleRegistration)
    .input('vehicleCategory', sql.NVarChar(40), record.vehicleCategory)
    .input('routeId', sql.NVarChar(40), record.routeId)
    .input('routeOrder', sql.Int, record.routeOrder)
    .input('now', sql.DateTimeOffset, now)
    .input('username', sql.NVarChar(160), username || null)

  const result = await request.query(`
IF EXISTS (
  SELECT 1 FROM dbo.MilkReceptionRouteSettings
  WHERE vehicleRegistration = @vehicleRegistration AND routeId = @routeId
)
BEGIN
  UPDATE dbo.MilkReceptionRouteSettings
  SET vehicleCategory = @vehicleCategory,
      routeOrder = @routeOrder,
      updatedAt = @now,
      updatedBy = @username
  WHERE vehicleRegistration = @vehicleRegistration AND routeId = @routeId;
END
ELSE
BEGIN
  INSERT INTO dbo.MilkReceptionRouteSettings (
    vehicleRegistration, vehicleCategory, routeId, routeOrder, createdAt, updatedAt, createdBy, updatedBy
  )
  VALUES (
    @vehicleRegistration, @vehicleCategory, @routeId, @routeOrder, @now, @now, @username, @username
  );
END;

SELECT TOP (1) settingId, vehicleRegistration, vehicleCategory, routeId, routeOrder, createdAt, updatedAt, createdBy, updatedBy
FROM dbo.MilkReceptionRouteSettings
WHERE vehicleRegistration = @vehicleRegistration AND routeId = @routeId;
`)
  return rowToRouteSetting(result.recordset[0])
}

export async function deleteMilkReceptionRouteSetting(id) {
  await initializeMilkReceptionStore()
  const result = await (await getPool()).request()
    .input('settingId', sql.BigInt, Number(id))
    .query('DELETE FROM dbo.MilkReceptionRouteSettings WHERE settingId = @settingId; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

export async function replaceMilkReceptionTruckRoutes(vehicleRegistration, routes, vehicleCategory = '', username = '') {
  await initializeMilkReceptionStore()
  const vehicle = String(vehicleRegistration || '').trim().toUpperCase()
  if (!vehicle) throw new Error('Truck number is required.')
  const category = normalizeVehicleCategory(vehicleCategory || (routesTextHasValues(routes) ? 'COLLECTION' : 'OTHER'))
  const normalizedRoutes = uniqueInOrder(Array.isArray(routes) ? routes : splitRoutes(routes))
  const rowsToInsert = normalizedRoutes.length ? normalizedRoutes : [TRUCK_ONLY_ROUTE]

  const pool = await getPool()
  const transaction = new sql.Transaction(pool)
  await transaction.begin()
  try {
    await new sql.Request(transaction)
      .input('vehicleRegistration', sql.NVarChar(80), vehicle)
      .query('DELETE FROM dbo.MilkReceptionRouteSettings WHERE vehicleRegistration = @vehicleRegistration;')

    const now = new Date()
    for (let index = 0; index < rowsToInsert.length; index += 1) {
      await new sql.Request(transaction)
        .input('vehicleRegistration', sql.NVarChar(80), vehicle)
        .input('vehicleCategory', sql.NVarChar(40), category)
        .input('routeId', sql.NVarChar(40), rowsToInsert[index])
        .input('routeOrder', sql.Int, index + 1)
        .input('now', sql.DateTimeOffset, now)
        .input('username', sql.NVarChar(160), username || null)
        .query(`
INSERT INTO dbo.MilkReceptionRouteSettings (
  vehicleRegistration, vehicleCategory, routeId, routeOrder, createdAt, updatedAt, createdBy, updatedBy
)
VALUES (
  @vehicleRegistration, @vehicleCategory, @routeId, @routeOrder, @now, @now, @username, @username
);
`)
    }
    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  }

  return listMilkReceptionRouteSettings()
}

export async function deleteMilkReceptionTruckRoutes(vehicleRegistration) {
  await initializeMilkReceptionStore()
  const vehicle = String(vehicleRegistration || '').trim().toUpperCase()
  if (!vehicle) throw new Error('Truck number is required.')
  const result = await (await getPool()).request()
    .input('vehicleRegistration', sql.NVarChar(80), vehicle)
    .query('DELETE FROM dbo.MilkReceptionRouteSettings WHERE vehicleRegistration = @vehicleRegistration; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

export async function importMilkReceptionRouteSettings(vehicleRoutes, username = '') {
  await initializeMilkReceptionStore()
  let imported = 0
  let skipped = 0
  const pairs = []
  for (const group of Array.isArray(vehicleRoutes) ? vehicleRoutes : []) {
    const vehicleRegistration = String(group.vehicle || group.vehicleRegistration || '').trim()
    const routes = Array.isArray(group.routes) ? group.routes : []
    const vehicleCategory = normalizeVehicleCategory(group.vehicleCategory || (routes.length ? 'COLLECTION' : 'OTHER'))
    const routeValues = routes.length ? routes : [TRUCK_ONLY_ROUTE]
    routeValues.forEach((routeId, index) => {
      pairs.push({ vehicleRegistration, vehicleCategory, routeId, routeOrder: index + 1 })
    })
  }

  for (const pair of pairs) {
    try {
      await upsertMilkReceptionRouteSetting(pair, username)
      imported += 1
    } catch {
      skipped += 1
    }
  }

  return { imported, skipped, total: pairs.length }
}

export async function listMilkReceptions({ date = '', search = '' } = {}) {
  await initializeMilkReceptionStore()
  const pool = await getPool()
  const result = await pool.request()
    .input('date', sql.Date, isoDateValue(date))
    .input('search', sql.NVarChar(200), `%${String(search || '').trim()}%`)
    .query(`
SELECT TOP (500) *
FROM dbo.MilkReceptions
WHERE (@date IS NULL OR receptionDate = @date)
  AND (
    @search = N'%%'
    OR receptionId LIKE @search
     OR vehicleRegistration LIKE @search
     OR vehicleCategory LIKE @search
     OR driverName LIKE @search
     OR routeId LIKE @search
    OR milkTypeLabel LIKE @search
    OR combinationDiagnosis LIKE @search
    OR conformityResult LIKE @search
  )
ORDER BY receptionDate DESC, updatedAt DESC;
`)
  const detailsByReceptionId = await fetchQualityDetailsForIds(pool, result.recordset.map((row) => row.receptionId))
  return result.recordset.map((row) => rowToRecord(row, detailsByReceptionId.get(row.receptionId)))
}

export async function createMilkReception(input, username = '') {
  await initializeMilkReceptionStore()
  const pool = await getPool()
  const record = normalizeReception(input)
  record.receptionId = await nextReceptionId(pool, record)
  const now = new Date()
  const request = pool.request()
  bindReception(request, record)
  request
    .input('createdAt', sql.DateTimeOffset, now)
    .input('updatedAt', sql.DateTimeOffset, now)
    .input('createdBy', sql.NVarChar(160), username || null)
    .input('updatedBy', sql.NVarChar(160), username || null)
  await request.query(insertSql())
  await saveQualityDetails(pool, record.receptionId, record.qualityDetails, username)
  return getMilkReception(record.receptionId)
}

export async function updateMilkReception(id, input, username = '') {
  await initializeMilkReceptionStore()
  const existing = await getMilkReception(id)
  if (!existing) return null
  const record = normalizeReception({ ...existing, ...input, receptionId: id })
  const request = (await getPool()).request()
  bindReception(request, record)
  request
    .input('updatedAt', sql.DateTimeOffset, new Date())
    .input('updatedBy', sql.NVarChar(160), username || null)
  await request.query(updateSql())
  await saveQualityDetails(await getPool(), id, record.qualityDetails, username)
  return getMilkReception(id)
}

export async function deleteMilkReception(id) {
  await initializeMilkReceptionStore()
  const result = await (await getPool()).request()
    .input('receptionId', sql.NVarChar(120), id)
    .query('DELETE FROM dbo.MilkReceptions WHERE receptionId = @receptionId; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

export async function getMilkReception(id) {
  await initializeMilkReceptionStore()
  const pool = await getPool()
  const result = await pool.request()
    .input('receptionId', sql.NVarChar(120), id)
    .query('SELECT * FROM dbo.MilkReceptions WHERE receptionId = @receptionId;')
  if (!result.recordset[0]) return null
  const detailsByReceptionId = await fetchQualityDetailsForIds(pool, [id])
  return rowToRecord(result.recordset[0], detailsByReceptionId.get(id))
}

async function fetchQualityDetailsForIds(pool, receptionIds) {
  const ids = [...new Set(receptionIds.map((id) => String(id || '').trim()).filter(Boolean))]
  const detailsByReceptionId = new Map()
  if (!ids.length) return detailsByReceptionId
  const request = pool.request()
  const params = ids.map((id, index) => {
    const param = `receptionId${index}`
    request.input(param, sql.NVarChar(120), id)
    return `@${param}`
  })
  const result = await request.query(`
SELECT *
FROM dbo.MilkReceptionQualityDetails
WHERE receptionId IN (${params.join(', ')})
ORDER BY receptionId, detailType;
`)
  for (const row of result.recordset) {
    if (!detailsByReceptionId.has(row.receptionId)) detailsByReceptionId.set(row.receptionId, [])
    detailsByReceptionId.get(row.receptionId).push(row)
  }
  return detailsByReceptionId
}

async function saveQualityDetails(pool, receptionId, qualityDetails, username = '') {
  const normalized = normalizeQualityDetails(qualityDetails)
  const now = new Date()
  for (const detailType of QUALITY_DETAIL_TYPES) {
    const detail = normalized[detailType]
    const request = pool.request()
    bindQualityDetail(request, receptionId, detailType, detail, now, username)
    await request.query(`
IF EXISTS (
  SELECT 1 FROM dbo.MilkReceptionQualityDetails
  WHERE receptionId = @receptionId AND detailType = @detailType
)
BEGIN
  UPDATE dbo.MilkReceptionQualityDetails
  SET exteriorTemperatureC = @exteriorTemperatureC,
      accessAt = @accessAt,
      receptionAt = @receptionAt,
      antibioticPccResult = @antibioticPccResult,
      ph = @ph,
      productTemperatureC = @productTemperatureC,
      fatResult = @fatResult,
      waterPercentage = @waterPercentage,
      proteinResult = @proteinResult,
      tankNumber = @tankNumber,
      conformityResult = @conformityResult,
      productionEntryAt = @productionEntryAt,
      productionExitAt = @productionExitAt,
      responsiblePerson = @responsiblePerson,
      pcc1Observations = @pcc1Observations,
      updatedAt = @now,
      updatedBy = @username
  WHERE receptionId = @receptionId AND detailType = @detailType;
END
ELSE
BEGIN
  INSERT INTO dbo.MilkReceptionQualityDetails (
    receptionId, detailType, exteriorTemperatureC, accessAt, receptionAt, antibioticPccResult,
    ph, productTemperatureC, fatResult, waterPercentage, proteinResult, tankNumber,
    conformityResult, productionEntryAt, productionExitAt, responsiblePerson, pcc1Observations,
    createdAt, updatedAt, createdBy, updatedBy
  )
  VALUES (
    @receptionId, @detailType, @exteriorTemperatureC, @accessAt, @receptionAt, @antibioticPccResult,
    @ph, @productTemperatureC, @fatResult, @waterPercentage, @proteinResult, @tankNumber,
    @conformityResult, @productionEntryAt, @productionExitAt, @responsiblePerson, @pcc1Observations,
    @now, @now, @username, @username
  );
END;
`)
  }
}

function bindQualityDetail(request, receptionId, detailType, detail, now, username) {
  request
    .input('receptionId', sql.NVarChar(120), receptionId)
    .input('detailType', sql.NVarChar(20), detailType)
    .input('exteriorTemperatureC', sql.Decimal(18, 3), detail.exteriorTemperatureC)
    .input('accessAt', sql.DateTime2, detail.accessAt)
    .input('receptionAt', sql.DateTime2, detail.receptionAt)
    .input('antibioticPccResult', sql.NVarChar(40), detail.antibioticPccResult)
    .input('ph', sql.Decimal(18, 4), detail.ph)
    .input('productTemperatureC', sql.Decimal(18, 3), detail.productTemperatureC)
    .input('fatResult', sql.Decimal(18, 4), detail.fatResult)
    .input('waterPercentage', sql.Decimal(18, 4), detail.waterPercentage)
    .input('proteinResult', sql.Decimal(18, 4), detail.proteinResult)
    .input('tankNumber', sql.NVarChar(20), detail.tankNumber)
    .input('conformityResult', sql.NVarChar(60), detail.conformityResult)
    .input('productionEntryAt', sql.DateTime2, detail.productionEntryAt)
    .input('productionExitAt', sql.DateTime2, detail.productionExitAt)
    .input('responsiblePerson', sql.NVarChar(160), detail.responsiblePerson)
    .input('pcc1Observations', sql.NVarChar(1500), detail.pcc1Observations)
    .input('now', sql.DateTimeOffset, now)
    .input('username', sql.NVarChar(160), username || null)
}

async function nextReceptionId(pool, record) {
  const result = await pool.request()
    .input('date', sql.Date, isoDateValue(record.receptionDate))
    .input('vehicleRegistration', sql.NVarChar(80), record.vehicleRegistration)
    .input('routeId', sql.NVarChar(40), record.routeId)
    .query(`
SELECT receptionId
FROM dbo.MilkReceptions
WHERE receptionDate = @date AND vehicleRegistration = @vehicleRegistration AND routeId = @routeId;
`)
  const maxSequence = result.recordset.reduce((max, row) => {
    const match = String(row.receptionId || '').match(/-(\d{3})$/u)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `PCC1-${compactDate(record.receptionDate)}-${idPart(record.vehicleRegistration)}-${idPart(record.routeId)}-${String(maxSequence + 1).padStart(3, '0')}`
}

function normalizeReception(input) {
  const milkType = String(input.milkType || 'MILK-COW').trim()
  const milkOption = milkReceptionOptions.milkTypes.find((item) => item.code === milkType) || milkReceptionOptions.milkTypes[0]
  const densityFactor = positiveNumber(input.densityFactor) || milkOption.densityFactor
  const qualityDetails = normalizeQualityDetails(input.qualityDetails, input)
  const customDetails = qualityDetails.CUSTOM
  const fullTruckWeightKg = decimalValue(input.fullTruckWeightKg)
  const emptyTruckWeightKg = decimalValue(input.emptyTruckWeightKg)
  const netQuantityKg = fullTruckWeightKg != null && emptyTruckWeightKg != null && emptyTruckWeightKg <= fullTruckWeightKg
    ? round(fullTruckWeightKg - emptyTruckWeightKg, 3)
    : null
  const calculatedLiters = netQuantityKg != null && densityFactor > 0 ? round(netQuantityKg / densityFactor, 3) : null
  const dailyRoutesLiters = decimalValue(input.dailyRoutesLiters)
  const differenceLiters = calculatedLiters != null && dailyRoutesLiters != null ? round(calculatedLiters - dailyRoutesLiters, 3) : null

  return {
    receptionId: input.receptionId || '',
    receptionDate: isoDateString(input.receptionDate) || isoDateString(new Date()),
    vehicleRegistration: String(input.vehicleRegistration || '').trim().toUpperCase(),
    vehicleCategory: normalizeVehicleCategory(input.vehicleCategory),
    routeId: String(input.routeId || '').trim().toUpperCase(),
    milkType,
    milkTypeLabel: String(input.milkTypeLabel || milkOption.label).trim(),
    driverName: normalizeDriverName(input.driverName),
    densityFactor,
    fullTruckWeightKg,
    emptyTruckWeightKg,
    netQuantityKg,
    calculatedLiters,
    deliveryCategory: String(input.deliveryCategory || 'COLLECTION').trim().toUpperCase(),
    comments: nullableText(input.comments),
    dailyRoutesLiters,
    differenceLiters,
    vehicleCountSource: integerValue(input.vehicleCountSource),
    routeCountSource: integerValue(input.routeCountSource),
    combinationDiagnosis: diagnosis(input, { fullTruckWeightKg, emptyTruckWeightKg, netQuantityKg, dailyRoutesLiters }),
    exteriorTemperatureC: customDetails.exteriorTemperatureC,
    accessTime: nullableText(input.accessTime),
    receptionTime: nullableText(input.receptionTime),
    antibioticPccResult: customDetails.antibioticPccResult,
    ph: customDetails.ph,
    productTemperatureC: customDetails.productTemperatureC,
    fatResult: customDetails.fatResult,
    waterPercentage: customDetails.waterPercentage,
    proteinResult: customDetails.proteinResult,
    tankNumber: customDetails.tankNumber,
    conformityResult: customDetails.conformityResult || conformity(input),
    productionEntryAt: customDetails.productionEntryAt,
    productionExitAt: customDetails.productionExitAt,
    responsiblePerson: customDetails.responsiblePerson,
    pcc1Observations: customDetails.pcc1Observations,
    qualityDetails,
  }
}

function normalizeQualityDetails(inputDetails = {}, legacyInput = {}) {
  const details = inputDetails || {}
  return {
    ORIGINAL: normalizeQualityDetail(details.ORIGINAL || details.original || {}, 'ORIGINAL'),
    CUSTOM: normalizeQualityDetail(details.CUSTOM || details.custom || legacyInput || {}, 'CUSTOM'),
  }
}

function normalizeQualityDetail(input = {}, detailType = 'CUSTOM') {
  return {
    detailType: QUALITY_DETAIL_TYPES.includes(detailType) ? detailType : 'CUSTOM',
    exteriorTemperatureC: decimalValue(input.exteriorTemperatureC),
    accessAt: dateTimeValue(input.accessAt),
    receptionAt: dateTimeValue(input.receptionAt),
    antibioticPccResult: nullableText(input.antibioticPccResult),
    ph: decimalValue(input.ph),
    productTemperatureC: decimalValue(input.productTemperatureC),
    fatResult: decimalValue(input.fatResult),
    waterPercentage: decimalValue(input.waterPercentage),
    proteinResult: decimalValue(input.proteinResult),
    tankNumber: nullableText(input.tankNumber),
    conformityResult: nullableText(input.conformityResult),
    productionEntryAt: dateTimeValue(input.productionEntryAt),
    productionExitAt: dateTimeValue(input.productionExitAt),
    responsiblePerson: nullableText(input.responsiblePerson),
    pcc1Observations: nullableText(input.pcc1Observations),
  }
}

function qualityDetailsFromRows(rows = [], legacyRow = {}) {
  const output = {
    ORIGINAL: emptyQualityDetail('ORIGINAL'),
    CUSTOM: legacyQualityDetail(legacyRow),
  }
  for (const row of rows) {
    const detailType = QUALITY_DETAIL_TYPES.includes(row.detailType) ? row.detailType : 'CUSTOM'
    output[detailType] = rowToQualityDetail(row)
  }
  return output
}

function emptyQualityDetail(detailType) {
  return {
    detailType,
    exteriorTemperatureC: null,
    accessAt: '',
    receptionAt: '',
    antibioticPccResult: '',
    ph: null,
    productTemperatureC: null,
    fatResult: null,
    waterPercentage: null,
    proteinResult: null,
    tankNumber: '',
    conformityResult: '',
    productionEntryAt: '',
    productionExitAt: '',
    responsiblePerson: '',
    pcc1Observations: '',
  }
}

function legacyQualityDetail(row) {
  return {
    detailType: 'CUSTOM',
    exteriorTemperatureC: numberOrNull(row.exteriorTemperatureC),
    accessAt: '',
    receptionAt: '',
    antibioticPccResult: row.antibioticPccResult || '',
    ph: numberOrNull(row.ph),
    productTemperatureC: numberOrNull(row.productTemperatureC),
    fatResult: numberOrNull(row.fatResult),
    waterPercentage: numberOrNull(row.waterPercentage),
    proteinResult: numberOrNull(row.proteinResult),
    tankNumber: row.tankNumber || '',
    conformityResult: row.conformityResult || '',
    productionEntryAt: dateTimeString(row.productionEntryAt),
    productionExitAt: dateTimeString(row.productionExitAt),
    responsiblePerson: row.responsiblePerson || '',
    pcc1Observations: row.pcc1Observations || '',
  }
}

function diagnosis(input, calculated) {
  const vehicleCategory = normalizeVehicleCategory(input.vehicleCategory)
  if (!input.receptionDate || !input.vehicleRegistration || (vehicleCategory === 'COLLECTION' && !input.routeId) || !input.milkType) return 'Incomplete information'
  if (calculated.fullTruckWeightKg == null || calculated.emptyTruckWeightKg == null) return 'Incomplete information'
  if (calculated.emptyTruckWeightKg > calculated.fullTruckWeightKg) return 'Empty weight exceeds full weight'
  if (calculated.netQuantityKg === 0) return 'Zero kilograms'
  return 'OK'
}

function conformity(input) {
  if (input.conformityResult) return String(input.conformityResult)
  if (String(input.antibioticPccResult || '').toLowerCase().includes('positive')) return 'Non-Conforming'
  return 'Pending'
}

function bindReception(request, record) {
  request
    .input('receptionId', sql.NVarChar(120), record.receptionId)
    .input('receptionDate', sql.Date, isoDateValue(record.receptionDate))
    .input('vehicleRegistration', sql.NVarChar(80), record.vehicleRegistration)
    .input('vehicleCategory', sql.NVarChar(40), record.vehicleCategory)
    .input('routeId', sql.NVarChar(40), record.routeId)
    .input('milkType', sql.NVarChar(40), record.milkType)
    .input('milkTypeLabel', sql.NVarChar(120), record.milkTypeLabel)
    .input('driverName', sql.NVarChar(160), record.driverName)
    .input('densityFactor', sql.Decimal(18, 6), record.densityFactor)
    .input('fullTruckWeightKg', sql.Decimal(18, 3), record.fullTruckWeightKg)
    .input('emptyTruckWeightKg', sql.Decimal(18, 3), record.emptyTruckWeightKg)
    .input('netQuantityKg', sql.Decimal(18, 3), record.netQuantityKg)
    .input('calculatedLiters', sql.Decimal(18, 3), record.calculatedLiters)
    .input('deliveryCategory', sql.NVarChar(40), record.deliveryCategory)
    .input('comments', sql.NVarChar(1000), record.comments)
    .input('dailyRoutesLiters', sql.Decimal(18, 3), record.dailyRoutesLiters)
    .input('differenceLiters', sql.Decimal(18, 3), record.differenceLiters)
    .input('vehicleCountSource', sql.Int, record.vehicleCountSource)
    .input('routeCountSource', sql.Int, record.routeCountSource)
    .input('combinationDiagnosis', sql.NVarChar(120), record.combinationDiagnosis)
    .input('exteriorTemperatureC', sql.Decimal(18, 3), record.exteriorTemperatureC)
    .input('accessTime', sql.NVarChar(12), record.accessTime)
    .input('receptionTime', sql.NVarChar(12), record.receptionTime)
    .input('antibioticPccResult', sql.NVarChar(40), record.antibioticPccResult)
    .input('ph', sql.Decimal(18, 4), record.ph)
    .input('productTemperatureC', sql.Decimal(18, 3), record.productTemperatureC)
    .input('fatResult', sql.Decimal(18, 4), record.fatResult)
    .input('waterPercentage', sql.Decimal(18, 4), record.waterPercentage)
    .input('proteinResult', sql.Decimal(18, 4), record.proteinResult)
    .input('tankNumber', sql.NVarChar(20), record.tankNumber)
    .input('conformityResult', sql.NVarChar(60), record.conformityResult)
    .input('productionEntryAt', sql.DateTime2, record.productionEntryAt)
    .input('productionExitAt', sql.DateTime2, record.productionExitAt)
    .input('responsiblePerson', sql.NVarChar(160), record.responsiblePerson)
    .input('pcc1Observations', sql.NVarChar(1500), record.pcc1Observations)
}

function insertSql() {
  return `
INSERT INTO dbo.MilkReceptions (
  receptionId, receptionDate, vehicleRegistration, vehicleCategory, routeId, milkType, milkTypeLabel, driverName, densityFactor,
  fullTruckWeightKg, emptyTruckWeightKg, netQuantityKg, calculatedLiters, deliveryCategory, comments,
  dailyRoutesLiters, differenceLiters, vehicleCountSource, routeCountSource, combinationDiagnosis,
  exteriorTemperatureC, accessTime, receptionTime, antibioticPccResult, ph, productTemperatureC,
  fatResult, waterPercentage, proteinResult, tankNumber, conformityResult, productionEntryAt,
  productionExitAt, responsiblePerson, pcc1Observations, createdAt, updatedAt, createdBy, updatedBy
) VALUES (
  @receptionId, @receptionDate, @vehicleRegistration, @vehicleCategory, @routeId, @milkType, @milkTypeLabel, @driverName, @densityFactor,
  @fullTruckWeightKg, @emptyTruckWeightKg, @netQuantityKg, @calculatedLiters, @deliveryCategory, @comments,
  @dailyRoutesLiters, @differenceLiters, @vehicleCountSource, @routeCountSource, @combinationDiagnosis,
  @exteriorTemperatureC, @accessTime, @receptionTime, @antibioticPccResult, @ph, @productTemperatureC,
  @fatResult, @waterPercentage, @proteinResult, @tankNumber, @conformityResult, @productionEntryAt,
  @productionExitAt, @responsiblePerson, @pcc1Observations, @createdAt, @updatedAt, @createdBy, @updatedBy
);`
}

function updateSql() {
  return `
UPDATE dbo.MilkReceptions SET
  receptionDate = @receptionDate,
  vehicleRegistration = @vehicleRegistration,
  vehicleCategory = @vehicleCategory,
  routeId = @routeId,
  milkType = @milkType,
  milkTypeLabel = @milkTypeLabel,
  driverName = @driverName,
  densityFactor = @densityFactor,
  fullTruckWeightKg = @fullTruckWeightKg,
  emptyTruckWeightKg = @emptyTruckWeightKg,
  netQuantityKg = @netQuantityKg,
  calculatedLiters = @calculatedLiters,
  deliveryCategory = @deliveryCategory,
  comments = @comments,
  dailyRoutesLiters = @dailyRoutesLiters,
  differenceLiters = @differenceLiters,
  vehicleCountSource = @vehicleCountSource,
  routeCountSource = @routeCountSource,
  combinationDiagnosis = @combinationDiagnosis,
  exteriorTemperatureC = @exteriorTemperatureC,
  accessTime = @accessTime,
  receptionTime = @receptionTime,
  antibioticPccResult = @antibioticPccResult,
  ph = @ph,
  productTemperatureC = @productTemperatureC,
  fatResult = @fatResult,
  waterPercentage = @waterPercentage,
  proteinResult = @proteinResult,
  tankNumber = @tankNumber,
  conformityResult = @conformityResult,
  productionEntryAt = @productionEntryAt,
  productionExitAt = @productionExitAt,
  responsiblePerson = @responsiblePerson,
  pcc1Observations = @pcc1Observations,
  updatedAt = @updatedAt,
  updatedBy = @updatedBy
WHERE receptionId = @receptionId;`
}

function rowToRecord(row, qualityDetailsRows = []) {
  return {
    receptionId: row.receptionId,
    receptionDate: isoDateString(row.receptionDate),
    vehicleRegistration: row.vehicleRegistration,
    vehicleCategory: row.vehicleCategory || 'COLLECTION',
    routeId: row.routeId,
    milkType: row.milkType,
    milkTypeLabel: row.milkTypeLabel,
    driverName: row.driverName || '',
    densityFactor: numberOrNull(row.densityFactor),
    fullTruckWeightKg: numberOrNull(row.fullTruckWeightKg),
    emptyTruckWeightKg: numberOrNull(row.emptyTruckWeightKg),
    netQuantityKg: numberOrNull(row.netQuantityKg),
    calculatedLiters: numberOrNull(row.calculatedLiters),
    deliveryCategory: row.deliveryCategory,
    comments: row.comments || '',
    dailyRoutesLiters: numberOrNull(row.dailyRoutesLiters),
    differenceLiters: numberOrNull(row.differenceLiters),
    vehicleCountSource: numberOrNull(row.vehicleCountSource),
    routeCountSource: numberOrNull(row.routeCountSource),
    combinationDiagnosis: row.combinationDiagnosis,
    exteriorTemperatureC: numberOrNull(row.exteriorTemperatureC),
    accessTime: row.accessTime || '',
    receptionTime: row.receptionTime || '',
    antibioticPccResult: row.antibioticPccResult || '',
    ph: numberOrNull(row.ph),
    productTemperatureC: numberOrNull(row.productTemperatureC),
    fatResult: numberOrNull(row.fatResult),
    waterPercentage: numberOrNull(row.waterPercentage),
    proteinResult: numberOrNull(row.proteinResult),
    tankNumber: row.tankNumber || '',
    conformityResult: row.conformityResult,
    productionEntryAt: dateTimeString(row.productionEntryAt),
    productionExitAt: dateTimeString(row.productionExitAt),
    responsiblePerson: row.responsiblePerson || '',
    pcc1Observations: row.pcc1Observations || '',
    createdAt: dateTimeString(row.createdAt),
    updatedAt: dateTimeString(row.updatedAt),
    createdBy: row.createdBy || '',
    updatedBy: row.updatedBy || '',
    qualityDetails: qualityDetailsFromRows(qualityDetailsRows, row),
  }
}

function routeSettingsResponse(rows) {
  const rawSettings = rows.map(rowToRouteSetting).filter(Boolean)
  const settings = rawSettings.filter((setting) => setting.routeId !== TRUCK_ONLY_ROUTE)
  const grouped = new Map()
  for (const setting of rawSettings) {
    if (!grouped.has(setting.vehicleRegistration)) grouped.set(setting.vehicleRegistration, { vehicleCategory: setting.vehicleCategory, routes: [] })
    const group = grouped.get(setting.vehicleRegistration)
    if (group.vehicleCategory !== 'COLLECTION' && setting.vehicleCategory === 'COLLECTION') group.vehicleCategory = 'COLLECTION'
    if (setting.routeId !== TRUCK_ONLY_ROUTE) group.routes.push(setting.routeId)
  }
  const vehicleRoutes = [...grouped.entries()].map(([vehicle, group]) => ({ vehicle, vehicleCategory: group.vehicleCategory, routes: uniqueSorted(group.routes) }))
  const vehicles = uniqueSorted(rawSettings.map((setting) => setting.vehicleRegistration))
  const routes = uniqueSorted(settings.map((setting) => setting.routeId))
  return { settings, vehicleRoutes, vehicles, routes }
}

function rowToRouteSetting(row) {
  if (!row) return null
  return {
    settingId: String(row.settingId),
    vehicleRegistration: row.vehicleRegistration || '',
    vehicleCategory: normalizeVehicleCategory(row.vehicleCategory),
    routeId: row.routeId || '',
    routeOrder: numberOrNull(row.routeOrder),
    createdAt: dateTimeString(row.createdAt),
    updatedAt: dateTimeString(row.updatedAt),
    createdBy: row.createdBy || '',
    updatedBy: row.updatedBy || '',
  }
}

function rowToDriverSetting(row) {
  if (!row) return null
  return {
    driverId: String(row.driverId),
    driverName: row.driverName || '',
    sortOrder: numberOrNull(row.sortOrder),
    createdAt: dateTimeString(row.createdAt),
    updatedAt: dateTimeString(row.updatedAt),
    createdBy: row.createdBy || '',
    updatedBy: row.updatedBy || '',
  }
}

function rowToQualityDetail(row) {
  return {
    detailType: row.detailType,
    exteriorTemperatureC: numberOrNull(row.exteriorTemperatureC),
    accessAt: dateTimeString(row.accessAt),
    receptionAt: dateTimeString(row.receptionAt),
    antibioticPccResult: row.antibioticPccResult || '',
    ph: numberOrNull(row.ph),
    productTemperatureC: numberOrNull(row.productTemperatureC),
    fatResult: numberOrNull(row.fatResult),
    waterPercentage: numberOrNull(row.waterPercentage),
    proteinResult: numberOrNull(row.proteinResult),
    tankNumber: row.tankNumber || '',
    conformityResult: row.conformityResult || '',
    productionEntryAt: dateTimeString(row.productionEntryAt),
    productionExitAt: dateTimeString(row.productionExitAt),
    responsiblePerson: row.responsiblePerson || '',
    pcc1Observations: row.pcc1Observations || '',
    createdAt: dateTimeString(row.createdAt),
    updatedAt: dateTimeString(row.updatedAt),
    createdBy: row.createdBy || '',
    updatedBy: row.updatedBy || '',
  }
}

function normalizeRouteSetting(input) {
  const vehicleRegistration = String(input?.vehicleRegistration || input?.vehicle || '').trim().toUpperCase()
  const routeId = String(input?.routeId || input?.route || '').trim().toUpperCase()
  if (!vehicleRegistration) throw new Error('Truck number is required.')
  if (!routeId) throw new Error('Route is required.')
  return {
    vehicleRegistration,
    vehicleCategory: normalizeVehicleCategory(input?.vehicleCategory),
    routeId,
    routeOrder: integerValue(input?.routeOrder),
  }
}

function normalizeVehicleCategory(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'OTHER' || normalized === 'OTHERS' ? 'OTHER' : 'COLLECTION'
}

function normalizeDriverName(value) {
  return String(value || '').trim().replace(/\s+/gu, ' ')
}

function routesTextHasValues(value) {
  return Array.isArray(value) ? value.some((item) => String(item || '').trim()) : splitRoutes(value).length > 0
}

function splitRoutes(value) {
  return String(value || '')
    .split(/[,;\n]+/u)
    .map((route) => route.trim())
    .filter(Boolean)
}

function uniqueInOrder(values) {
  const seen = new Set()
  const output = []
  for (const value of values) {
    const route = String(value || '').trim().toUpperCase()
    if (!route || seen.has(route)) continue
    seen.add(route)
    output.push(route)
  }
  return output
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

function decimalValue(value) {
  if (value === '' || value === null || value === undefined) return null
  const normalized = Number(String(value).replace(',', '.'))
  return Number.isFinite(normalized) ? normalized : null
}

function positiveNumber(value) {
  const number = decimalValue(value)
  return number && number > 0 ? number : null
}

function integerValue(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nullableText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function isoDateValue(value) {
  const iso = isoDateString(value)
  if (!iso) return null
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function isoDateString(value) {
  if (!value) return ''
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const two = (part) => String(part).padStart(2, '0')
    return `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`
  }
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) return ''
  const two = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

function dateTimeValue(value) {
  if (!value) return null
  const text = String(value).trim()
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?$/u.exec(text)
  if (match) {
    const [, month, day, year, hour = '0', minute = '0'] = match
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function dateTimeString(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ''
}

function compactDate(value) {
  return isoDateString(value).replace(/-/gu, '')
}

function idPart(value) {
  return String(value || 'NA').toUpperCase().replace(/[^A-Z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'NA'
}

function round(value, decimals) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
