import sql from 'mssql'

let poolPromise = null
let initialized = false

export function isSqlOcrStoreEnabled() {
  return String(process.env.OCR_JOB_STORE || '').trim().toLowerCase() === 'sql'
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
    throw new Error('SQL OCR storage is enabled, but SQL_USER and SQL_PASSWORD are not configured.')
  }

  return {
    server,
    ...(port ? { port } : {}),
    database,
    user,
    password,
    options: {
      encrypt,
      trustServerCertificate,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  }
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(sqlConfig()).connect()
  }
  return poolPromise
}

export async function closeSqlOcrStore() {
  if (!poolPromise) return
  const pool = await poolPromise.catch(() => null)
  poolPromise = null
  initialized = false
  await pool?.close()
}

export async function initializeSqlOcrStore() {
  if (initialized) return
  const pool = await getPool()
  await pool.request().batch(`
IF OBJECT_ID(N'dbo.OcrJobRows', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.OcrJobRows (
    rowId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OcrJobRows PRIMARY KEY,
    jobId NVARCHAR(64) NOT NULL,
    documentCategory NVARCHAR(64) NOT NULL,
    rowNumber INT NOT NULL,
    centerName NVARCHAR(240) NULL,
    producerName NVARCHAR(240) NULL,
    milkType NVARCHAR(40) NULL,
    liters DECIMAL(18,3) NULL,
    fatPercent DECIMAL(18,4) NULL,
    density DECIMAL(18,4) NULL,
    water DECIMAL(18,4) NULL,
    temperature DECIMAL(18,4) NULL,
    noticeNumber NVARCHAR(80) NULL,
    confidence DECIMAL(9,6) NULL,
    rowJson NVARCHAR(MAX) NOT NULL
  );
END;

IF OBJECT_ID(N'dbo.OcrJobs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.OcrJobs (
    id NVARCHAR(64) NOT NULL CONSTRAINT PK_OcrJobs PRIMARY KEY,
    sourceFile NVARCHAR(260) NOT NULL,
    storedFilename NVARCHAR(260) NULL,
    mimeType NVARCHAR(120) NULL,
    size INT NULL,
    documentCategory NVARCHAR(64) NOT NULL,
    status NVARCHAR(40) NOT NULL,
    reviewStatus NVARCHAR(40) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    startedAt DATETIMEOFFSET NULL,
    completedAt DATETIMEOFFSET NULL,
    reviewedAt DATETIMEOFFSET NULL,
    dataDate DATE NULL,
    dataMonth INT NULL,
    route NVARCHAR(80) NULL,
    driverName NVARCHAR(200) NULL,
    vehicleRegistration NVARCHAR(80) NULL,
    headerCenterName NVARCHAR(240) NULL,
    totalLiters DECIMAL(18,3) NULL,
    jobJson NVARCHAR(MAX) NOT NULL
  );
END;

IF OBJECT_ID(N'dbo.OcrJobRows', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.OcrJobs', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_OcrJobRows_OcrJobs'
  )
BEGIN
  ALTER TABLE dbo.OcrJobRows
    ADD CONSTRAINT FK_OcrJobRows_OcrJobs
    FOREIGN KEY (jobId) REFERENCES dbo.OcrJobs(id) ON DELETE CASCADE;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OcrJobs_CategoryStatusDate' AND object_id = OBJECT_ID(N'dbo.OcrJobs'))
  CREATE INDEX IX_OcrJobs_CategoryStatusDate ON dbo.OcrJobs(documentCategory, reviewStatus, dataDate, createdAt);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OcrJobRows_JobRow' AND object_id = OBJECT_ID(N'dbo.OcrJobRows'))
  CREATE INDEX IX_OcrJobRows_JobRow ON dbo.OcrJobRows(jobId, rowNumber);
`)
  initialized = true
}

export async function saveSqlJob(job) {
  await initializeSqlOcrStore()
  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const summary = jobSummary(job)
    const jobJson = JSON.stringify(job)
    const request = new sql.Request(tx)
    bindJob(request, job, summary, jobJson)
    await request.query(`
IF EXISTS (SELECT 1 FROM dbo.OcrJobs WHERE id = @id)
BEGIN
  UPDATE dbo.OcrJobs SET
    sourceFile = @sourceFile,
    storedFilename = @storedFilename,
    mimeType = @mimeType,
    size = @size,
    documentCategory = @documentCategory,
    status = @status,
    reviewStatus = @reviewStatus,
    createdAt = @createdAt,
    updatedAt = @updatedAt,
    startedAt = @startedAt,
    completedAt = @completedAt,
    reviewedAt = @reviewedAt,
    dataDate = @dataDate,
    dataMonth = @dataMonth,
    route = @route,
    driverName = @driverName,
    vehicleRegistration = @vehicleRegistration,
    headerCenterName = @headerCenterName,
    totalLiters = @totalLiters,
    jobJson = @jobJson
  WHERE id = @id;
END
ELSE
BEGIN
  INSERT INTO dbo.OcrJobs (
    id, sourceFile, storedFilename, mimeType, size, documentCategory, status, reviewStatus,
    createdAt, updatedAt, startedAt, completedAt, reviewedAt, dataDate, dataMonth, route,
    driverName, vehicleRegistration, headerCenterName, totalLiters, jobJson
  ) VALUES (
    @id, @sourceFile, @storedFilename, @mimeType, @size, @documentCategory, @status, @reviewStatus,
    @createdAt, @updatedAt, @startedAt, @completedAt, @reviewedAt, @dataDate, @dataMonth, @route,
    @driverName, @vehicleRegistration, @headerCenterName, @totalLiters, @jobJson
  );
END;
`)

    await new sql.Request(tx)
      .input('jobId', sql.NVarChar(64), job.id)
      .query('DELETE FROM dbo.OcrJobRows WHERE jobId = @jobId;')

    for (const row of ocrRows(job)) {
      const rowRequest = new sql.Request(tx)
      bindRow(rowRequest, job, row)
      await rowRequest.query(`
INSERT INTO dbo.OcrJobRows (
  jobId, documentCategory, rowNumber, centerName, producerName, milkType, liters,
  fatPercent, density, water, temperature, noticeNumber, confidence, rowJson
) VALUES (
  @jobId, @documentCategory, @rowNumber, @centerName, @producerName, @milkType, @liters,
  @fatPercent, @density, @water, @temperature, @noticeNumber, @confidence, @rowJson
);
`)
    }

    await tx.commit()
    return job
  } catch (error) {
    await tx.rollback().catch(() => undefined)
    throw error
  }
}

export async function getSqlJob(id) {
  await initializeSqlOcrStore()
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.NVarChar(64), id)
    .query('SELECT jobJson FROM dbo.OcrJobs WHERE id = @id;')
  return result.recordset[0] ? JSON.parse(result.recordset[0].jobJson) : null
}

export async function listSqlJobs() {
  await initializeSqlOcrStore()
  const pool = await getPool()
  const result = await pool.request().query('SELECT jobJson FROM dbo.OcrJobs ORDER BY createdAt DESC;')
  return result.recordset.map((row) => JSON.parse(row.jobJson))
}

export async function deleteSqlJob(id) {
  await initializeSqlOcrStore()
  const pool = await getPool()
  const result = await pool.request()
    .input('id', sql.NVarChar(64), id)
    .query('DELETE FROM dbo.OcrJobs WHERE id = @id; SELECT @@ROWCOUNT AS deleted;')
  return Number(result.recordset[0]?.deleted || 0) > 0
}

function bindJob(request, job, summary, jobJson) {
  request
    .input('id', sql.NVarChar(64), job.id)
    .input('sourceFile', sql.NVarChar(260), job.sourceFile || '')
    .input('storedFilename', sql.NVarChar(260), job.storedFilename || null)
    .input('mimeType', sql.NVarChar(120), job.mimeType || null)
    .input('size', sql.Int, finiteNumber(job.size))
    .input('documentCategory', sql.NVarChar(64), job.documentCategory || 'daily_routes')
    .input('status', sql.NVarChar(40), job.status || 'queued')
    .input('reviewStatus', sql.NVarChar(40), job.reviewStatus || 'pending')
    .input('createdAt', sql.DateTimeOffset, dateValue(job.createdAt) || new Date())
    .input('updatedAt', sql.DateTimeOffset, dateValue(job.updatedAt) || new Date())
    .input('startedAt', sql.DateTimeOffset, dateValue(job.startedAt))
    .input('completedAt', sql.DateTimeOffset, dateValue(job.completedAt))
    .input('reviewedAt', sql.DateTimeOffset, dateValue(job.reviewedAt))
    .input('dataDate', sql.Date, isoDate(job.data?.date))
    .input('dataMonth', sql.Int, finiteNumber(job.data?.documentMonth))
    .input('route', sql.NVarChar(80), summary.route)
    .input('driverName', sql.NVarChar(200), summary.driverName)
    .input('vehicleRegistration', sql.NVarChar(80), summary.vehicleRegistration)
    .input('headerCenterName', sql.NVarChar(240), summary.headerCenterName)
    .input('totalLiters', sql.Decimal(18, 3), decimalValue(job.data?.totalLiters))
    .input('jobJson', sql.NVarChar(sql.MAX), jobJson)
}

function bindRow(request, job, row) {
  const isMonthly = (job.documentCategory || 'daily_routes') === 'journal_monthly_settlement'
  request
    .input('jobId', sql.NVarChar(64), job.id)
    .input('documentCategory', sql.NVarChar(64), job.documentCategory || 'daily_routes')
    .input('rowNumber', sql.Int, finiteNumber(row.rowNumber) || 0)
    .input('centerName', sql.NVarChar(240), isMonthly ? row.centerName || null : row.collectionCenter || null)
    .input('producerName', sql.NVarChar(240), isMonthly ? row.producer || null : null)
    .input('milkType', sql.NVarChar(40), row.milkType || job.data?.milkType || null)
    .input('liters', sql.Decimal(18, 3), decimalValue(row.liters))
    .input('fatPercent', sql.Decimal(18, 4), decimalValue(row.fatPercent ?? row.ugPercent))
    .input('density', sql.Decimal(18, 4), decimalValue(row.density ?? row.gValue))
    .input('water', sql.Decimal(18, 4), decimalValue(row.water))
    .input('temperature', sql.Decimal(18, 4), decimalValue(row.temperature))
    .input('noticeNumber', sql.NVarChar(80), row.noticeNumber == null ? null : String(row.noticeNumber))
    .input('confidence', sql.Decimal(9, 6), decimalValue(row.confidence))
    .input('rowJson', sql.NVarChar(sql.MAX), JSON.stringify(row))
}

function jobSummary(job) {
  return {
    route: textOrNull(job.data?.route),
    driverName: textOrNull(job.data?.driverName),
    vehicleRegistration: textOrNull(job.data?.vehicleRegistration),
    headerCenterName: textOrNull(job.data?.headerCenterName),
  }
}

function ocrRows(job) {
  return Array.isArray(job.data?.rows) ? job.data.rows : []
}

function textOrNull(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function decimalValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function dateValue(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isoDate(value) {
  const text = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : null
}
