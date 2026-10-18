import sql from 'mssql'
import { CmrDataSchema } from './cmrDocument.js'
import { initializeMilkReceptionStore } from './milkReceptionStore.js'

const textFields = ['supplier', 'recipient', 'transport', 'driver', 'truckNumber', 'deliveryLocation', 'loadingLocation', 'avizNumber', 'milkType']
const dateFields = ['deliveryDate', 'loadingDate', 'avizDate', 'issueDate', 'receiptDate']
const dateText = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)

export function normalizedCmrData(input) {
  const data = CmrDataSchema.parse(input)
  if (data.quantity === undefined) {
    data.quantity = data.kilos
    data.quantityUnit = 'kg'
  }
  data.kilos = data.quantityUnit === 'kg' ? data.quantity : null
  return data
}

export function cmrDataFromRow(row) {
  return normalizedCmrData({ documentType: 'cmr',
    ...Object.fromEntries(textFields.map(field => [field, row[field] || ''])),
    ...Object.fromEntries(dateFields.map(field => [field, dateText(row[field])])),
    date: dateText(row.documentDate), quantity: row.quantity == null ? null : Number(row.quantity),
    quantityUnit: row.quantityUnit, kilos: null,
  })
}

export function hydrateCmrJob(row) {
  const job = JSON.parse(row.jobJson)
  if (job.documentCategory !== 'cmr') return job
  if (!row.jobId) throw new Error(`Structured CMR data missing for ${job.id}.`)
  return { ...job, data: cmrDataFromRow(row) }
}

export async function writeCmrData(transaction, job, { insertOnly = false } = {}) {
  const data = normalizedCmrData(job.data)
  const request = new sql.Request(transaction)
    .input('jobId', sql.NVarChar(64), job.id)
    .input('documentDate', sql.Date, data.date || null)
    .input('quantity', sql.Float, data.quantity)
    .input('quantityUnit', sql.NVarChar(2), data.quantityUnit)
    .input('createdAt', sql.DateTimeOffset, new Date(job.createdAt))
    .input('updatedAt', sql.DateTimeOffset, new Date(job.updatedAt))
    .input('updatedBy', sql.NVarChar(160), job.updatedBy || '')
  for (const field of textFields) request.input(field, sql.NVarChar(300), data[field])
  for (const field of dateFields) request.input(field, sql.Date, data[field] || null)
  const fields = ['documentDate', ...textFields, ...dateFields, 'quantity', 'quantityUnit', 'updatedAt', 'updatedBy']
  await request.query(`
IF NOT EXISTS (SELECT 1 FROM dbo.CmrDocuments WITH (UPDLOCK,HOLDLOCK) WHERE jobId=@jobId)
  INSERT dbo.CmrDocuments (jobId,createdAt,${fields.join(',')}) VALUES (@jobId,@createdAt,${fields.map(field => `@${field}`).join(',')});
${insertOnly ? '' : `ELSE UPDATE dbo.CmrDocuments SET ${fields.map(field => `${field}=@${field}`).join(',')} WHERE jobId=@jobId;`}
`)
  return data
}

export async function initializeCmrSqlStore(pool) {
  await initializeMilkReceptionStore()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    await new sql.Request(tx).batch(`
DECLARE @lockResult INT;
EXEC @lockResult=sys.sp_getapplock @Resource=N'CmrSchema',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=30000;
IF @lockResult<0 THROW 51000,'Could not lock CMR migration.',1;
IF OBJECT_ID(N'dbo.CmrDocuments',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CmrDocuments (
    jobId NVARCHAR(64) NOT NULL CONSTRAINT PK_CmrDocuments PRIMARY KEY,
    documentDate DATE NULL,
    ${textFields.map(field => `${field} NVARCHAR(300) NOT NULL`).join(',\n    ')},
    ${dateFields.map(field => `${field} DATE NULL`).join(',\n    ')},
    quantity FLOAT NULL,
    quantityUnit NVARCHAR(2) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    updatedBy NVARCHAR(160) NOT NULL,
    rowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_CmrDocuments_Job FOREIGN KEY(jobId) REFERENCES dbo.OcrJobs(id) ON DELETE CASCADE,
    CONSTRAINT CK_CmrDocuments_Quantity CHECK(quantity IS NULL OR (quantity>=0 AND quantity<=999999999)),
    CONSTRAINT CK_CmrDocuments_Unit_V2 CHECK(quantityUnit IN (N'',N'kg',N'L')),
    CONSTRAINT CK_CmrDocuments_MilkType CHECK(milkType IN (N'',N'MILK-COW',N'MILK-SHEEP',N'MILK-GOAT',N'MILK-BUFF'))
  );
  CREATE INDEX IX_CmrDocuments_DateTruck ON dbo.CmrDocuments(documentDate,truckNumber);
END;
IF OBJECT_ID(N'dbo.CK_CmrDocuments_Unit',N'C') IS NOT NULL
  ALTER TABLE dbo.CmrDocuments DROP CONSTRAINT CK_CmrDocuments_Unit;
IF OBJECT_ID(N'dbo.CK_CmrDocuments_Unit_V2',N'C') IS NULL
  ALTER TABLE dbo.CmrDocuments ADD CONSTRAINT CK_CmrDocuments_Unit_V2 CHECK(quantityUnit IN (N'',N'kg',N'L'));
IF OBJECT_ID(N'dbo.CmrReceptionLinks',N'U') IS NULL
BEGIN
  CREATE TABLE dbo.CmrReceptionLinks (
    jobId NVARCHAR(64) NOT NULL CONSTRAINT PK_CmrReceptionLinks PRIMARY KEY,
    receptionId NVARCHAR(120) NOT NULL,
    status NVARCHAR(20) NOT NULL CONSTRAINT DF_CmrReceptionLinks_Status DEFAULT N'CONFIRMED',
    matchedDocumentDate DATE NOT NULL,
    matchedReceptionDate DATE NOT NULL,
    matchedTruckNumber NVARCHAR(300) NOT NULL,
    linkedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_CmrReceptionLinks_LinkedAt DEFAULT SYSDATETIMEOFFSET(),
    linkedBy NVARCHAR(160) NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_CmrReceptionLinks_UpdatedAt DEFAULT SYSDATETIMEOFFSET(),
    rowVersion ROWVERSION NOT NULL,
    CONSTRAINT FK_CmrReceptionLinks_Document FOREIGN KEY(jobId) REFERENCES dbo.CmrDocuments(jobId) ON DELETE CASCADE,
    CONSTRAINT FK_CmrReceptionLinks_Reception FOREIGN KEY(receptionId) REFERENCES dbo.MilkReceptions(receptionId),
    CONSTRAINT CK_CmrReceptionLinks_Status CHECK(status IN (N'CONFIRMED',N'NEEDS_REVIEW'))
  );
  CREATE INDEX IX_CmrReceptionLinks_Reception ON dbo.CmrReceptionLinks(receptionId);
END;
`)
    await new sql.Request(tx).batch(`CREATE OR ALTER TRIGGER dbo.TR_CmrReceptionLinks_Validate
ON dbo.CmrReceptionLinks AFTER INSERT,UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN dbo.MilkReceptions r ON r.receptionId=i.receptionId
   JOIN dbo.OcrJobs j ON j.id=i.jobId WHERE j.documentCategory<>N'cmr' OR (i.status=N'CONFIRMED' AND r.vehicleCategory<>N'OTHER'))
   THROW 51000,'CMR links require a CMR document and an Other reception.',1;
END;`)
    await new sql.Request(tx).batch(`CREATE OR ALTER TRIGGER dbo.TR_CmrDocuments_ReviewLink
ON dbo.CmrDocuments AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 UPDATE l SET status=N'NEEDS_REVIEW',updatedAt=SYSDATETIMEOFFSET()
 FROM dbo.CmrReceptionLinks l JOIN inserted i ON i.jobId=l.jobId JOIN deleted d ON d.jobId=i.jobId
 WHERE ISNULL(i.documentDate,'19000101')<>ISNULL(d.documentDate,'19000101') OR i.truckNumber<>d.truckNumber;
END;`)
    await new sql.Request(tx).batch(`CREATE OR ALTER TRIGGER dbo.TR_MilkReceptions_ReviewCmrLink
ON dbo.MilkReceptions AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 UPDATE l SET status=N'NEEDS_REVIEW',updatedAt=SYSDATETIMEOFFSET()
 FROM dbo.CmrReceptionLinks l JOIN inserted i ON i.receptionId=l.receptionId JOIN deleted d ON d.receptionId=i.receptionId
 WHERE i.receptionDate<>d.receptionDate OR i.vehicleRegistration<>d.vehicleRegistration OR i.vehicleCategory<>d.vehicleCategory;
END;`)
    const legacy = await new sql.Request(tx).query(`SELECT j.jobJson FROM dbo.OcrJobs j WITH (UPDLOCK,HOLDLOCK)
      WHERE j.documentCategory=N'cmr' AND NOT EXISTS (SELECT 1 FROM dbo.CmrDocuments c WHERE c.jobId=j.id);`)
    for (const row of legacy.recordset) {
      const job = JSON.parse(row.jobJson)
      try { await writeCmrData(tx, job, { insertOnly: true }) }
      catch (error) { throw new Error(`CMR migration stopped at ${job.id}; no CMR migration changes committed. ${error.message}`) }
    }
    await tx.commit()
    return legacy.recordset.length
  } catch (error) { await tx.rollback().catch(() => undefined); throw error }
}
