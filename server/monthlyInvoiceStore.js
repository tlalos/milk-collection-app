import { randomUUID } from 'node:crypto'
import sql from 'mssql'
import { getMilkReceptionPool } from './milkReceptionStore.js'

let initialization
export function initializeMonthlyInvoices() {
  initialization ??= (async () => {
    const pool = await getMilkReceptionPool()
    await pool.request().batch(`
IF OBJECT_ID(N'dbo.MonthlyInvoices', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MonthlyInvoices (
    invoiceId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    monthKey CHAR(7) NOT NULL,
    producerCode NVARCHAR(80) NOT NULL,
    invoiceDate DATE NOT NULL,
    series INT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    erpId NVARCHAR(120) NULL,
    erpNumber NVARCHAR(120) NULL,
    createdBy NVARCHAR(120) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    updatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT UQ_MonthlyInvoices_ProducerMonth UNIQUE(monthKey, producerCode),
    CONSTRAINT CK_MonthlyInvoices_Month CHECK (TRY_CONVERT(DATE, monthKey + '-01', 23) IS NOT NULL),
    CONSTRAINT CK_MonthlyInvoices_Series CHECK (series IN (5105,5106)),
    CONSTRAINT CK_MonthlyInvoices_Status CHECK (status IN ('DRAFT','SENDING','SENT','UNCONFIRMED')),
    CONSTRAINT CK_MonthlyInvoices_Sent CHECK (status <> 'SENT' OR erpId IS NOT NULL)
  );
END;
IF COL_LENGTH('dbo.MonthlyInvoices','milkType') IS NULL
BEGIN
  ALTER TABLE dbo.MonthlyInvoices ADD milkType NVARCHAR(40) NOT NULL CONSTRAINT DF_MonthlyInvoices_MilkType DEFAULT '';
  ALTER TABLE dbo.MonthlyInvoices DROP CONSTRAINT UQ_MonthlyInvoices_ProducerMonth;
END;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.MonthlyInvoices') AND name='UQ_MonthlyInvoices_ProducerMilkMonth')
  EXEC('CREATE UNIQUE INDEX UQ_MonthlyInvoices_ProducerMilkMonth ON dbo.MonthlyInvoices(monthKey,producerCode,milkType)');
IF OBJECT_ID(N'dbo.MonthlyInvoiceLines', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MonthlyInvoiceLines (
    invoiceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.MonthlyInvoices(invoiceId),
    lineNumber INT NOT NULL,
    snapshotJson NVARCHAR(MAX) NOT NULL CHECK (ISJSON(snapshotJson)=1),
    PRIMARY KEY(invoiceId,lineNumber)
  );
END;
IF OBJECT_ID(N'dbo.MonthlyInvoiceAttempts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MonthlyInvoiceAttempts (
    attemptId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    invoiceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.MonthlyInvoices(invoiceId),
    status VARCHAR(20) NOT NULL CHECK (status IN ('SENDING','SENT','UNCONFIRMED')),
    payloadJson NVARCHAR(MAX) NOT NULL CHECK (ISJSON(payloadJson)=1),
    responseJson NVARCHAR(MAX) NULL,
    error NVARCHAR(MAX) NULL,
    attemptedBy NVARCHAR(120) NOT NULL,
    startedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    finishedAt DATETIMEOFFSET NULL
  );
  CREATE INDEX IX_MonthlyInvoiceAttempts_Invoice ON dbo.MonthlyInvoiceAttempts(invoiceId,startedAt);
END;
IF COL_LENGTH('dbo.MonthlyInvoiceAttempts','verifiedAbsentAt') IS NULL
  ALTER TABLE dbo.MonthlyInvoiceAttempts ADD verifiedAbsentAt DATETIMEOFFSET NULL, verifiedAbsentBy NVARCHAR(120) NULL;
IF COL_LENGTH('dbo.MonthlyInvoiceAttempts','snapshotJson') IS NULL
  ALTER TABLE dbo.MonthlyInvoiceAttempts ADD snapshotJson NVARCHAR(MAX) NULL;
IF OBJECT_ID(N'dbo.MonthlyInvoiceResolutions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MonthlyInvoiceResolutions (
    resolutionId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    invoiceId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.MonthlyInvoices(invoiceId),
    attemptId UNIQUEIDENTIFIER NOT NULL UNIQUE REFERENCES dbo.MonthlyInvoiceAttempts(attemptId),
    outcome VARCHAR(10) NOT NULL CHECK (outcome IN ('FOUND','ABSENT')),
    reason NVARCHAR(1000) NOT NULL,
    erpId NVARCHAR(120) NULL,
    erpNumber NVARCHAR(120) NULL,
    resolvedBy NVARCHAR(120) NOT NULL,
    resolvedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END;
`)
  })().catch(error => { initialization = undefined; throw error })
  return initialization
}

export function invoiceIdentity(month, producerCode, date) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new Error('Invalid collection month.')
  const producer = String(producerCode || '').trim().toLowerCase()
  if (!/^p\S+$/.test(producer) || producer.length > 80) throw new Error('Invalid producer code.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid invoice date.')
  return { month, producerCode: producer, date }
}

function actor(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('An authenticated user is required.')
  return value.trim()
}

async function transaction(work) {
  await initializeMonthlyInvoices()
  const tx = new sql.Transaction(await getMilkReceptionPool())
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try { const result = await work(tx); await tx.commit(); return result }
  catch (error) { await tx.rollback().catch(() => {}); throw error }
}

// Date edits never modify submitted invoices, even if two users edit concurrently.
export async function saveMonthlyInvoiceDate({ month, producerCode, milkType, invoiceDate, user }) {
  if (!['MILK-COW', 'MILK-BUFF', 'MILK-SHEEP', 'MILK-GOAT'].includes(milkType)) throw new Error('Invalid invoice milk type.')
  const identity = invoiceIdentity(month, producerCode, invoiceDate)
  const username = actor(user)
  return transaction(async tx => {
    const request = new sql.Request(tx)
      .input('month', sql.Char(7), identity.month).input('producer', sql.NVarChar(80), identity.producerCode)
      .input('milk', sql.NVarChar(40), milkType)
      .input('date', sql.Date, identity.date).input('user', sql.NVarChar(120), username)
      .input('id', sql.UniqueIdentifier, randomUUID())
    const result = await request.query(`
IF EXISTS (SELECT 1 FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month AND producerCode=@producer AND milkType IN (@milk,'') AND status <> 'DRAFT')
  THROW 50001, 'Submitted invoice dates are locked.', 1;
IF EXISTS (SELECT 1 FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE monthKey=@month AND producerCode=@producer AND milkType=@milk)
  UPDATE dbo.MonthlyInvoices SET invoiceDate=@date, updatedAt=SYSDATETIMEOFFSET() WHERE monthKey=@month AND producerCode=@producer AND milkType=@milk;
ELSE
  INSERT dbo.MonthlyInvoices(invoiceId,monthKey,producerCode,milkType,invoiceDate,createdBy) VALUES(@id,@month,@producer,@milk,@date,@user);
SELECT invoiceId,monthKey,producerCode,milkType,CONVERT(VARCHAR(10),invoiceDate,23) AS invoiceDate,status,series,erpId,erpNumber
FROM dbo.MonthlyInvoices WHERE monthKey=@month AND producerCode=@producer AND milkType=@milk;`)
    return result.recordset[0]
  })
}

export async function saveMonthlyInvoiceDates({ month, rows, invoiceDate, user }) {
  invoiceIdentity(month, 'p-validation', invoiceDate)
  const username = actor(user)
  const unique = new Map()
  for (const row of rows) {
    const identity = invoiceIdentity(month, row.producerCode, invoiceDate)
    if (!['MILK-COW', 'MILK-BUFF', 'MILK-SHEEP', 'MILK-GOAT'].includes(row.milkType)) throw new Error('Invalid invoice milk type.')
    unique.set(`${identity.producerCode}:${row.milkType}`, { producerCode: identity.producerCode, milkType: row.milkType })
  }
  return transaction(async tx => {
    const result = await new sql.Request(tx)
      .input('month', sql.Char(7), month).input('date', sql.Date, invoiceDate)
      .input('user', sql.NVarChar(120), username)
      .input('rows', sql.NVarChar(sql.MAX), JSON.stringify([...unique.values()]))
      .query(`
DECLARE @targets TABLE(producerCode NVARCHAR(80), milkType NVARCHAR(40), PRIMARY KEY(producerCode,milkType));
INSERT INTO @targets SELECT producerCode,milkType FROM OPENJSON(@rows)
WITH(producerCode NVARCHAR(80),milkType NVARCHAR(40));
DELETE t FROM @targets t WHERE EXISTS (
  SELECT 1 FROM dbo.MonthlyInvoices i WITH (UPDLOCK,HOLDLOCK)
  WHERE i.monthKey=@month AND i.producerCode=t.producerCode AND i.milkType IN (t.milkType,'') AND i.status<>'DRAFT'
);
UPDATE i SET invoiceDate=@date,updatedAt=SYSDATETIMEOFFSET()
FROM dbo.MonthlyInvoices i JOIN @targets t ON i.producerCode=t.producerCode AND i.milkType=t.milkType
WHERE i.monthKey=@month AND i.status='DRAFT';
INSERT INTO dbo.MonthlyInvoices(invoiceId,monthKey,producerCode,milkType,invoiceDate,createdBy)
SELECT NEWID(),@month,t.producerCode,t.milkType,@date,@user FROM @targets t
WHERE NOT EXISTS (SELECT 1 FROM dbo.MonthlyInvoices i WITH (UPDLOCK,HOLDLOCK)
  WHERE i.monthKey=@month AND i.producerCode=t.producerCode AND i.milkType=t.milkType);
SELECT i.producerCode,i.milkType,CONVERT(VARCHAR(10),i.invoiceDate,23) AS invoiceDate
FROM dbo.MonthlyInvoices i JOIN @targets t ON i.producerCode=t.producerCode AND i.milkType=t.milkType
WHERE i.monthKey=@month;`)
    return result.recordset
  })
}

export async function listMonthlyInvoices(month) {
  invoiceIdentity(month, 'p-validation', `${month}-01`)
  await initializeMonthlyInvoices()
  const pool = await getMilkReceptionPool()
  return (await pool.request().input('month', sql.Char(7), month).query(`
SELECT invoiceId,monthKey,producerCode,milkType,CONVERT(VARCHAR(10),invoiceDate,23) AS invoiceDate,status,series,erpId,erpNumber,
  (SELECT COUNT(*) FROM dbo.MonthlyInvoiceAttempts a WHERE a.invoiceId=i.invoiceId) AS attemptCount
FROM dbo.MonthlyInvoices i WHERE monthKey=@month ORDER BY producerCode`)).recordset
}

// Sending always uses a validated server-built snapshot, never a client payload.
export async function claimMonthlyInvoice({ invoiceId, invoiceDate, series, lines, payload, user }) {
  if (![5105, 5106].includes(series) || !Array.isArray(lines) || lines.length !== 1 || !Array.isArray(payload) || payload.length !== 1) throw new Error('A single validated invoice line is required.')
  const username = actor(user)
  const attemptId = randomUUID()
  return transaction(async tx => {
    const result = await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId)
      .query('SELECT * FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE invoiceId=@id')
    const invoice = result.recordset[0]
    if (!invoice || invoice.status !== 'DRAFT') throw new Error('Invoice already submitted. Verify ERP before retrying.')
    if (!invoice.milkType) throw new Error('Legacy grouped drafts cannot be sent. Save the individual invoice first.')
    const history = await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).query('SELECT status,verifiedAbsentAt FROM dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id')
    if (history.recordset.some(attempt => attempt.status !== 'UNCONFIRMED' || !attempt.verifiedAbsentAt)) throw new Error('Verify all prior ERP attempts before retrying.')
    const savedDate = invoice.invoiceDate.toISOString().slice(0, 10)
    if (savedDate !== invoiceDate) throw new Error('Invoice date changed. Reload before sending.')
    for (const [index, line] of lines.entries()) {
      const existing = await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).input('line', sql.Int, index + 1)
        .query('SELECT snapshotJson FROM dbo.MonthlyInvoiceLines WHERE invoiceId=@id AND lineNumber=@line')
      if (existing.recordset.length) {
        // Keep the original lines immutable; each verified retry records its own snapshot.
        continue
      }
      await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).input('line', sql.Int, index + 1)
        .input('json', sql.NVarChar(sql.MAX), JSON.stringify(line))
        .query('INSERT dbo.MonthlyInvoiceLines(invoiceId,lineNumber,snapshotJson) VALUES(@id,@line,@json)')
    }
    await new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId).input('attempt', sql.UniqueIdentifier, attemptId)
      .input('series', sql.Int, series).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
      .input('snapshot', sql.NVarChar(sql.MAX), JSON.stringify({ invoiceDate, series, lines }))
      .input('user', sql.NVarChar(120), username).query(`
UPDATE dbo.MonthlyInvoices SET series=@series,status='SENDING',updatedAt=SYSDATETIMEOFFSET() WHERE invoiceId=@id;
INSERT dbo.MonthlyInvoiceAttempts(attemptId,invoiceId,status,payloadJson,snapshotJson,attemptedBy) VALUES(@attempt,@id,'SENDING',@payload,@snapshot,@user);`)
    return { invoiceId, attemptId }
  })
}

export async function finishMonthlyInvoiceAttempt({ attemptId, erpId, erpNumber, response, error }) {
  const sent = erpId !== null && erpId !== undefined && String(erpId).trim() !== '' && !error
  return transaction(async tx => {
    const request = new sql.Request(tx).input('attempt', sql.UniqueIdentifier, attemptId)
    const result = await request.query(`SELECT a.invoiceId FROM dbo.MonthlyInvoiceAttempts a WITH (UPDLOCK,HOLDLOCK)
JOIN dbo.MonthlyInvoices i WITH (UPDLOCK,HOLDLOCK) ON i.invoiceId=a.invoiceId
WHERE a.attemptId=@attempt AND a.status='SENDING' AND i.status='SENDING'`)
    if (!result.recordset.length) throw new Error('Attempt already finalized or unavailable.')
    await request.input('status', sql.VarChar(20), sent ? 'SENT' : 'UNCONFIRMED')
      .input('erpId', sql.NVarChar(120), sent ? String(erpId) : null)
      .input('number', sql.NVarChar(120), sent && erpNumber != null ? String(erpNumber) : null)
      .input('response', sql.NVarChar(sql.MAX), response == null ? null : JSON.stringify(response))
      .input('error', sql.NVarChar(sql.MAX), error ? String(error) : null).query(`
UPDATE dbo.MonthlyInvoiceAttempts SET status=@status,responseJson=@response,error=@error,finishedAt=SYSDATETIMEOFFSET() WHERE attemptId=@attempt;
UPDATE dbo.MonthlyInvoices SET status=@status,erpId=@erpId,erpNumber=@number,updatedAt=SYSDATETIMEOFFSET()
WHERE invoiceId=(SELECT invoiceId FROM dbo.MonthlyInvoiceAttempts WHERE attemptId=@attempt);`)
  })
}

export async function getMonthlyInvoiceHistory(invoiceId) {
  validateInvoiceId(invoiceId)
  await initializeMonthlyInvoices()
  const result = await (await getMilkReceptionPool()).request().input('id', sql.UniqueIdentifier, invoiceId).query(`
SELECT invoiceId,monthKey,producerCode,milkType,CONVERT(VARCHAR(10),invoiceDate,23) AS invoiceDate,status,series,erpId,erpNumber
FROM dbo.MonthlyInvoices WHERE invoiceId=@id;
SELECT a.attemptId,a.status,a.startedAt,a.finishedAt,a.attemptedBy,a.error,a.verifiedAbsentAt,a.verifiedAbsentBy,
  r.outcome,r.reason,r.erpId,r.erpNumber,r.resolvedBy,r.resolvedAt
FROM dbo.MonthlyInvoiceAttempts a LEFT JOIN dbo.MonthlyInvoiceResolutions r ON r.attemptId=a.attemptId
WHERE a.invoiceId=@id ORDER BY a.startedAt DESC,a.attemptId DESC;`)
  return result.recordsets[0][0] ? { invoice: result.recordsets[0][0], attempts: result.recordsets[1] } : null
}

function validateInvoiceId(id) {
  if (typeof id !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new Error('Invalid invoice or attempt ID.')
}

export function validateInvoiceResolution({ invoiceId, attemptId, outcome, reason, erpId, erpNumber, confirmed, user }) {
  validateInvoiceId(invoiceId)
  validateInvoiceId(attemptId)
  if (!['FOUND', 'ABSENT'].includes(outcome)) throw new Error('Choose found or not found in ERP.')
  if (confirmed !== true) throw new Error('Confirm that you checked ERP for this invoice.')
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw new Error('A verification reason of up to 1000 characters is required.')
  if (outcome === 'FOUND' && (typeof erpId !== 'string' || !erpId.trim() || erpId.trim().length > 120)) throw new Error('An ERP document ID of up to 120 characters is required.')
  if (erpNumber != null && (typeof erpNumber !== 'string' || erpNumber.trim().length > 120)) throw new Error('Invalid ERP document number.')
  return { invoiceId, attemptId, outcome, reason: reason.trim(), erpId: outcome === 'FOUND' ? erpId.trim() : null,
    erpNumber: outcome === 'FOUND' ? erpNumber?.trim() || null : null, user: actor(user) }
}

export async function resolveMonthlyInvoice(input) {
  const { invoiceId, attemptId, outcome, reason, erpId, erpNumber, user } = validateInvoiceResolution(input)
  return transaction(async tx => {
    const request = new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId)
      .input('attempt', sql.UniqueIdentifier, attemptId).input('user', sql.NVarChar(120), user)
      .input('resolution', sql.UniqueIdentifier, randomUUID()).input('outcome', sql.VarChar(10), outcome)
      .input('reason', sql.NVarChar(1000), reason).input('erpId', sql.NVarChar(120), erpId)
      .input('number', sql.NVarChar(120), erpNumber)
    await request.query(`
IF NOT EXISTS (SELECT 1 FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE invoiceId=@id AND status='UNCONFIRMED' AND erpId IS NULL)
  THROW 50001, 'Only unconfirmed invoices without an ERP ID can be resolved. Refresh the status.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.MonthlyInvoiceAttempts WITH (UPDLOCK,HOLDLOCK) WHERE invoiceId=@id AND attemptId=@attempt AND status='UNCONFIRMED' AND finishedAt IS NOT NULL AND verifiedAbsentAt IS NULL)
  THROW 50001, 'Attempt is no longer awaiting verification. Refresh the status.', 1;
IF EXISTS (SELECT 1 FROM dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id AND attemptId<>@attempt AND (status<>'UNCONFIRMED' OR verifiedAbsentAt IS NULL))
  THROW 50001, 'Other attempts require verification.', 1;
IF EXISTS (SELECT 1 FROM dbo.MonthlyInvoiceResolutions WHERE attemptId=@attempt)
  THROW 50001, 'Attempt has already been resolved.', 1;
IF @outcome='FOUND' AND EXISTS (SELECT 1 FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE erpId=@erpId AND invoiceId<>@id)
  THROW 50001, 'This ERP document ID is already linked to another invoice.', 1;
INSERT dbo.MonthlyInvoiceResolutions(resolutionId,invoiceId,attemptId,outcome,reason,erpId,erpNumber,resolvedBy)
VALUES(@resolution,@id,@attempt,@outcome,@reason,@erpId,@number,@user);
IF @outcome='ABSENT'
  UPDATE dbo.MonthlyInvoiceAttempts SET verifiedAbsentAt=SYSDATETIMEOFFSET(),verifiedAbsentBy=@user WHERE attemptId=@attempt;
UPDATE dbo.MonthlyInvoices SET status=CASE WHEN @outcome='FOUND' THEN 'SENT' ELSE 'DRAFT' END,
  erpId=@erpId,erpNumber=@number,updatedAt=SYSDATETIMEOFFSET() WHERE invoiceId=@id;
`)
    return { status: outcome === 'FOUND' ? 'SENT' : 'DRAFT', erpId }
  })
}

export async function unlockVerifiedAbsentInvoice(input) {
  return resolveMonthlyInvoice({ ...input, outcome: 'ABSENT' })
}
