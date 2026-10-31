import sql from 'mssql'
import { createHash, randomUUID } from 'node:crypto'
import { getMilkReceptionPool } from './milkReceptionStore.js'
import { BANK_PAYER_IBAN, createBankExportDownload } from './bankExportFile.js'
import { bankExportError, validateBankExportInput, validateBankExportMonth } from './bankExportSnapshot.js'

const fields = 'batchId,monthKey,exportNumber,createdAt,createdBy,status,paymentCount,totalAmount,totalLiters,currency,payerIban,filename,mimeType,sha256,cancelledAt,cancelledBy,cancelReason'
const hash = value => createHash('sha256').update(value).digest('hex')
const batchView = row => ({ ...row, month: row.monthKey })
const uuid = id => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) throw bankExportError('Invalid export identifier.', 400)
  return id
}

export function createBankExportStore(getPool = getMilkReceptionPool) {
  let initialization
  async function initialize() {
    initialization ??= (async () => {
      await (await getPool()).request().batch(`
IF OBJECT_ID(N'dbo.BankExportBatches',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.BankExportBatches(
  batchId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  requestKey UNIQUEIDENTIFIER NOT NULL UNIQUE, requestHash CHAR(64) NOT NULL,
  monthKey CHAR(7) NOT NULL, exportNumber INT NOT NULL,
  createdAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(), createdBy NVARCHAR(160) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'EXPORTED' CHECK(status IN ('EXPORTED','CANCELLED')),
  paymentCount INT NOT NULL, totalAmount DECIMAL(18,2) NOT NULL, totalLiters DECIMAL(18,3) NOT NULL,
  currency VARCHAR(3) NOT NULL, payerIban NVARCHAR(80) NOT NULL,
  filename NVARCHAR(240) NOT NULL, mimeType VARCHAR(100) NOT NULL, sha256 CHAR(64) NOT NULL, fileData VARBINARY(MAX) NOT NULL,
  cancelledAt DATETIMEOFFSET NULL, cancelledBy NVARCHAR(160) NULL, cancelReason NVARCHAR(1000) NULL,
  CONSTRAINT UQ_BankExportNumber UNIQUE(monthKey,exportNumber)
 );
END;
IF OBJECT_ID(N'dbo.BankExportLines',N'U') IS NULL
BEGIN
 CREATE TABLE dbo.BankExportLines(
  batchId UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.BankExportBatches(batchId), lineNumber INT NOT NULL,
  monthKey CHAR(7) NOT NULL, sourceRowId NVARCHAR(400) NOT NULL, active BIT NOT NULL DEFAULT 1,
  snapshotJson NVARCHAR(MAX) NOT NULL CHECK(ISJSON(snapshotJson)=1),
  CONSTRAINT PK_BankExportLines PRIMARY KEY(batchId,lineNumber)
 );
 CREATE UNIQUE INDEX UX_BankExportActivePayment ON dbo.BankExportLines(monthKey,sourceRowId) WHERE active=1;
END;`)
    })().catch(error => { initialization = undefined; throw error })
    await initialization
  }
  async function list(month) {
    validateBankExportMonth(month)
    await initialize()
    const result = await (await getPool()).request().input('month',sql.Char(7),month).query(`
SELECT ${fields} FROM dbo.BankExportBatches WHERE monthKey=@month ORDER BY exportNumber DESC;
SELECT l.sourceRowId,l.snapshotJson,b.batchId,b.exportNumber,b.createdAt FROM dbo.BankExportLines l
JOIN dbo.BankExportBatches b ON b.batchId=l.batchId WHERE l.monthKey=@month AND l.active=1;`)
    return { batches: result.recordsets[0].map(batchView), payments: result.recordsets[1].map(row => ({
      id: row.sourceRowId, batchId: row.batchId, exportNumber: row.exportNumber, createdAt: row.createdAt,
      amount: JSON.parse(row.snapshotJson).amount, totalLiters: JSON.parse(row.snapshotJson).totalLiters,
    })) }
  }
  async function get(id, file = false) {
    await initialize()
    const result = await (await getPool()).request().input('id',sql.UniqueIdentifier,uuid(id)).query(`
SELECT ${fields}${file ? ',fileData' : ''} FROM dbo.BankExportBatches WHERE batchId=@id;
${file ? '' : 'SELECT lineNumber,snapshotJson FROM dbo.BankExportLines WHERE batchId=@id ORDER BY lineNumber;'}`)
    if (!result.recordsets[0][0]) throw bankExportError('Export not found.',404)
    return { ...batchView(result.recordsets[0][0]), ...(file ? {} : { lines: result.recordsets[1].map(row => ({ ...JSON.parse(row.snapshotJson), lineNumber: row.lineNumber })) }) }
  }
  async function create(input, user, buildSnapshot) {
    validateBankExportInput(input)
    if (!user?.username) throw bankExportError('Authentication required.',401)
    // An identical retry retrieves the same batch, even if its source data has since changed.
    const fingerprint = hash(JSON.stringify({ month:input.month, rows:input.rows }))
    await initialize()
    const tx = new sql.Transaction(await getPool())
    await tx.begin()
    try {
      const request = new sql.Request(tx).input('month',sql.Char(7),input.month)
        .input('key',sql.UniqueIdentifier,input.requestKey).input('resource',sql.NVarChar(255),`BankExport:${input.month}`)
      await request.query(`DECLARE @lock INT; EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=15000;
IF @lock<0 THROW 50001,'Another bank export is being saved. Try again shortly.',1;`)
      const previous = (await request.query('SELECT batchId,requestHash FROM dbo.BankExportBatches WHERE requestKey=@key')).recordset[0]
      if (previous) {
        if (previous.requestHash !== fingerprint) throw bankExportError('This export request was already saved with different contents. Reopen the export review.')
        await tx.commit()
        return get(previous.batchId)
      }
      const existing = (await request.query('SELECT sourceRowId FROM dbo.BankExportLines WHERE monthKey=@month AND active=1')).recordset
      if (existing.some(row => input.rows.some(selected => selected.id === row.sourceRowId))) throw bankExportError('One or more payments already belong to an active export. Refresh the bank note.')
      const rows = await buildSnapshot(input)
      const download = await createBankExportDownload(input.month, rows)
      const data = Buffer.from(download.data), batchId = randomUUID()
      const number = (await request.query('SELECT ISNULL(MAX(exportNumber),0)+1 AS nextNumber FROM dbo.BankExportBatches WHERE monthKey=@month')).recordset[0].nextNumber
      const filename = download.filename.replace(`bank-note-${input.month}`,`bank-note-${input.month}-export-${number}`)
      await request.input('id',sql.UniqueIdentifier,batchId).input('number',sql.Int,number).input('hash',sql.Char(64),fingerprint)
        .input('user',sql.NVarChar(160),user.username).input('count',sql.Int,rows.length)
        .input('amount',sql.Decimal(18,2),rows.reduce((sum,row) => sum + Math.round(row.amount*100),0)/100)
        .input('liters',sql.Decimal(18,3),rows.reduce((sum,row) => sum + row.totalLiters,0))
        .input('payer',sql.NVarChar(80),BANK_PAYER_IBAN).input('filename',sql.NVarChar(240),filename)
        .input('mime',sql.VarChar(100),download.mimeType).input('sha',sql.Char(64),hash(data)).input('data',sql.VarBinary(sql.MAX),data)
        .query(`INSERT dbo.BankExportBatches(batchId,requestKey,requestHash,monthKey,exportNumber,createdBy,paymentCount,totalAmount,totalLiters,currency,payerIban,filename,mimeType,sha256,fileData)
VALUES(@id,@key,@hash,@month,@number,@user,@count,@amount,@liters,'RON',@payer,@filename,@mime,@sha,@data);`)
      // OPENJSON keeps large batches to one insert; the file and all lines commit together.
      await new sql.Request(tx).input('id',sql.UniqueIdentifier,batchId).input('month',sql.Char(7),input.month)
        .input('rows',sql.NVarChar(sql.MAX),JSON.stringify(rows)).query(`INSERT dbo.BankExportLines(batchId,lineNumber,monthKey,sourceRowId,snapshotJson)
SELECT @id,CONVERT(INT,[key])+1,@month,JSON_VALUE(value,'$.id'),value FROM OPENJSON(@rows);`)
      await tx.commit()
      return get(batchId)
    } catch(error) { await tx.rollback().catch(()=>{}); throw error }
  }
  async function cancel(id, reason, user) {
    if (user?.isAdmin !== true) throw bankExportError('Only an administrator can cancel an export.',403)
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw bankExportError('Enter a cancellation reason (up to 1,000 characters).',400)
    const batch = await get(id)
    const tx = new sql.Transaction(await getPool())
    await tx.begin()
    try {
      const request = new sql.Request(tx).input('id',sql.UniqueIdentifier,uuid(id)).input('user',sql.NVarChar(160),user.username)
        .input('reason',sql.NVarChar(1000),reason.trim()).input('resource',sql.NVarChar(255),`BankExport:${batch.month}`)
      await request.query(`DECLARE @lock INT; EXEC @lock=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=15000;
IF @lock<0 THROW 50001,'Another bank export is being saved. Try again shortly.',1;
IF EXISTS(SELECT 1 FROM dbo.BankExportBatches WHERE batchId=@id AND status='EXPORTED')
BEGIN
 UPDATE dbo.BankExportBatches SET status='CANCELLED',cancelledAt=SYSDATETIMEOFFSET(),cancelledBy=@user,cancelReason=@reason WHERE batchId=@id;
 UPDATE dbo.BankExportLines SET active=0 WHERE batchId=@id;
END;`)
      await tx.commit()
      return get(id)
    } catch(error) { await tx.rollback().catch(()=>{}); throw error }
  }
  return { initialize, list, get, create, cancel }
}
export const bankExportStore = createBankExportStore()
