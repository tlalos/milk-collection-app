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

export async function listMonthlyInvoices(month) {
  invoiceIdentity(month, 'p-validation', `${month}-01`)
  await initializeMonthlyInvoices()
  const pool = await getMilkReceptionPool()
  return (await pool.request().input('month', sql.Char(7), month).query(`
SELECT invoiceId,monthKey,producerCode,milkType,CONVERT(VARCHAR(10),invoiceDate,23) AS invoiceDate,status,series,erpId,erpNumber
FROM dbo.MonthlyInvoices WHERE monthKey=@month ORDER BY producerCode`)).recordset
}

// Internal only: a future sender must build and validate this snapshot from server data.
// No HTTP endpoint accepts client-supplied payloads or marks invoices as sent.
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

export async function unlockVerifiedAbsentInvoice({ invoiceId, attemptId, user }) {
  const verifiedBy = actor(user)
  return transaction(async tx => {
    const request = new sql.Request(tx).input('id', sql.UniqueIdentifier, invoiceId)
      .input('attempt', sql.UniqueIdentifier, attemptId).input('user', sql.NVarChar(120), verifiedBy)
    await request.query(`
IF NOT EXISTS (SELECT 1 FROM dbo.MonthlyInvoices WITH (UPDLOCK,HOLDLOCK) WHERE invoiceId=@id AND status='UNCONFIRMED' AND erpId IS NULL)
  THROW 50001, 'Only unconfirmed invoices without an ERP ID can be unlocked.', 1;
IF NOT EXISTS (SELECT 1 FROM dbo.MonthlyInvoiceAttempts WITH (UPDLOCK,HOLDLOCK) WHERE invoiceId=@id AND attemptId=@attempt AND status='UNCONFIRMED' AND finishedAt IS NOT NULL)
  THROW 50001, 'Attempt is not an unconfirmed completed request.', 1;
IF EXISTS (SELECT 1 FROM dbo.MonthlyInvoiceAttempts WHERE invoiceId=@id AND attemptId<>@attempt AND (status<>'UNCONFIRMED' OR verifiedAbsentAt IS NULL))
  THROW 50001, 'Other attempts require verification.', 1;
UPDATE dbo.MonthlyInvoiceAttempts SET verifiedAbsentAt=SYSDATETIMEOFFSET(),verifiedAbsentBy=@user WHERE attemptId=@attempt;
UPDATE dbo.MonthlyInvoices SET status='DRAFT',updatedAt=SYSDATETIMEOFFSET() WHERE invoiceId=@id;
`)
  })
}
