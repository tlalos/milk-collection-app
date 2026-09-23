import sql from 'mssql'
import { listJobs } from './jobStore.js'
import { getMilkReceptionPool } from './milkReceptionStore.js'
import { desiredDailyAvizLinks, reconciliationDate } from './dailyReconciliationMatch.js'

let initializePromise = null
let refreshQueue = Promise.resolve()

export async function initializeDailyReconciliationLinks() {
  if (!initializePromise) {
    initializePromise = (async () => {
      const pool = await getMilkReceptionPool()
      await pool.request().batch(`
IF OBJECT_ID(N'dbo.MilkReceptionAvizLinks', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkReceptionAvizLinks (
    jobId NVARCHAR(64) NOT NULL,
    rowIndex INT NOT NULL,
    rowNumber INT NULL,
    receptionId NVARCHAR(120) NOT NULL,
    documentDate DATE NOT NULL,
    linkedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_MilkReceptionAvizLinks_LinkedAt DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT PK_MilkReceptionAvizLinks PRIMARY KEY (jobId, rowIndex),
    CONSTRAINT FK_MilkReceptionAvizLinks_Reception FOREIGN KEY (receptionId)
      REFERENCES dbo.MilkReceptions(receptionId) ON DELETE CASCADE
  );
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkReceptionAvizLinks_Date' AND object_id = OBJECT_ID(N'dbo.MilkReceptionAvizLinks'))
  CREATE INDEX IX_MilkReceptionAvizLinks_Date ON dbo.MilkReceptionAvizLinks(documentDate, receptionId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MilkReceptionAvizLinks_Reception' AND object_id = OBJECT_ID(N'dbo.MilkReceptionAvizLinks'))
  CREATE INDEX IX_MilkReceptionAvizLinks_Reception ON dbo.MilkReceptionAvizLinks(receptionId);
`)
    })().catch((error) => {
      initializePromise = null
      throw error
    })
  }
  return initializePromise
}

function dateParameters(request, dates) {
  return dates.map((date, index) => {
    const name = `date${index}`
    request.input(name, sql.Date, date)
    return `@${name}`
  }).join(', ')
}

async function refreshChunk(pool, jobs, dates) {
  const transaction = new sql.Transaction(pool)
  await transaction.begin()
  try {
    await new sql.Request(transaction).query(`
DECLARE @lockResult INT;
EXEC @lockResult = sp_getapplock
  @Resource = N'MilkReceptionAvizLinks', @LockMode = N'Exclusive',
  @LockOwner = N'Transaction', @LockTimeout = 30000;
IF @lockResult < 0 THROW 51000, 'Could not lock daily reconciliation links.', 1;
`)

    const receptionsRequest = new sql.Request(transaction)
    const receptionDates = dateParameters(receptionsRequest, dates)
    const receptions = (await receptionsRequest.query(`
SELECT receptionId, receptionDate, vehicleRegistration, vehicleCategory, routeId
FROM dbo.MilkReceptions
WHERE vehicleCategory = N'COLLECTION' AND receptionDate IN (${receptionDates});
`)).recordset
    const desired = desiredDailyAvizLinks(receptions, jobs, dates)

    await new sql.Request(transaction).batch(`
CREATE TABLE #DesiredAvizLinks (
  jobId NVARCHAR(64) NOT NULL,
  rowIndex INT NOT NULL,
  rowNumber INT NULL,
  receptionId NVARCHAR(120) NOT NULL,
  documentDate DATE NOT NULL,
  PRIMARY KEY (jobId, rowIndex)
);
`)

    for (let offset = 0; offset < desired.length; offset += 200) {
      const batch = desired.slice(offset, offset + 200)
      const request = new sql.Request(transaction)
      const values = batch.map((link, index) => {
        request.input(`job${index}`, sql.NVarChar(64), link.jobId)
        request.input(`index${index}`, sql.Int, link.rowIndex)
        request.input(`row${index}`, sql.Int, link.rowNumber)
        request.input(`reception${index}`, sql.NVarChar(120), link.receptionId)
        request.input(`day${index}`, sql.Date, link.documentDate)
        return `(@job${index}, @index${index}, @row${index}, @reception${index}, @day${index})`
      }).join(', ')
      await request.query(`
INSERT INTO #DesiredAvizLinks (jobId, rowIndex, rowNumber, receptionId, documentDate)
VALUES ${values};
`)
    }

    const deleteRequest = new sql.Request(transaction)
    const deleteDates = dateParameters(deleteRequest, dates)
    await deleteRequest.query(`
DELETE link
FROM dbo.MilkReceptionAvizLinks AS link
WHERE link.documentDate IN (${deleteDates})
  AND NOT EXISTS (
    SELECT 1 FROM #DesiredAvizLinks AS desired
    WHERE desired.jobId = link.jobId AND desired.rowIndex = link.rowIndex
  );
`)

    await new sql.Request(transaction).query(`
UPDATE link SET
  receptionId = desired.receptionId,
  documentDate = desired.documentDate,
  rowNumber = desired.rowNumber,
  linkedAt = SYSDATETIMEOFFSET()
FROM dbo.MilkReceptionAvizLinks AS link
JOIN #DesiredAvizLinks AS desired ON desired.jobId = link.jobId AND desired.rowIndex = link.rowIndex
WHERE link.receptionId <> desired.receptionId
   OR link.documentDate <> desired.documentDate
   OR (link.rowNumber <> desired.rowNumber)
   OR (link.rowNumber IS NULL AND desired.rowNumber IS NOT NULL)
   OR (link.rowNumber IS NOT NULL AND desired.rowNumber IS NULL);

INSERT INTO dbo.MilkReceptionAvizLinks (jobId, rowIndex, rowNumber, receptionId, documentDate)
SELECT desired.jobId, desired.rowIndex, desired.rowNumber, desired.receptionId, desired.documentDate
FROM #DesiredAvizLinks AS desired
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.MilkReceptionAvizLinks AS link
  WHERE link.jobId = desired.jobId AND link.rowIndex = desired.rowIndex
);
`)

    await transaction.commit()
    return desired.length
  } catch (error) {
    await transaction.rollback().catch(() => undefined)
    throw error
  }
}

export function refreshDailyReconciliationLinksForDates(inputDates, knownJobs = null) {
  const dates = [...new Set(inputDates.map(reconciliationDate).filter(Boolean))].sort()
  if (!dates.length) return Promise.resolve(0)
  const run = refreshQueue.catch(() => undefined).then(async () => {
    await initializeDailyReconciliationLinks()
    const jobs = knownJobs || await listJobs()
    const pool = await getMilkReceptionPool()
    let matchedLines = 0
    for (let offset = 0; offset < dates.length; offset += 100) {
      matchedLines += await refreshChunk(pool, jobs, dates.slice(offset, offset + 100))
    }
    return matchedLines
  })
  refreshQueue = run
  return run
}

export async function reconcileAllDailyReconciliationLinks() {
  await initializeDailyReconciliationLinks()
  const pool = await getMilkReceptionPool()
  const result = await pool.request().query('SELECT DISTINCT documentDate FROM dbo.MilkReceptionAvizLinks;')
  const jobs = await listJobs()
  const dates = [
    ...result.recordset.map((row) => reconciliationDate(row.documentDate)),
    ...jobs.filter((job) => (job.documentCategory || 'daily_routes') === 'daily_routes')
      .map((job) => reconciliationDate(job.data?.date)),
  ].filter(Boolean)
  return refreshDailyReconciliationLinksForDates(dates, jobs)
}

export async function listDailyReconciliationLinks(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) throw new Error('Choose a valid month.')
  await initializeDailyReconciliationLinks()
  const pool = await getMilkReceptionPool()
  const result = await pool.request()
    .input('start', sql.Date, `${month}-01`)
    .query(`
SELECT jobId, rowIndex, rowNumber, receptionId, documentDate, linkedAt
FROM dbo.MilkReceptionAvizLinks
WHERE documentDate >= @start AND documentDate < DATEADD(MONTH, 1, @start)
ORDER BY documentDate DESC, jobId, rowIndex;
`)
  return result.recordset.map((row) => ({
    jobId: row.jobId,
    rowIndex: row.rowIndex,
    rowNumber: row.rowNumber,
    receptionId: row.receptionId,
    documentDate: reconciliationDate(row.documentDate),
    linkedAt: row.linkedAt?.toISOString?.() || null,
  }))
}
