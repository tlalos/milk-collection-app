import sql from 'mssql'
import { createHash } from 'node:crypto'
import { getProducerContractPool } from './producerContractStore.js'

export const producerHerdSchemaSql = `
IF OBJECT_ID(N'dbo.ProducerHerdCounts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProducerHerdCounts (
    herdCountId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProducerHerdCounts PRIMARY KEY,
    producerCode NVARCHAR(80) NOT NULL,
    effectiveMonth DATE NOT NULL,
    cowCount INT NULL,
    buffaloCount INT NULL,
    sheepGoatCount INT NULL,
    sourceFile NVARCHAR(260) NOT NULL,
    sourceSheet NVARCHAR(80) NOT NULL,
    sourceRows NVARCHAR(1000) NOT NULL,
    sourceSha256 CHAR(64) NOT NULL,
    importedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_ProducerHerdCounts_Imported DEFAULT SYSDATETIMEOFFSET(),
    importedBy NVARCHAR(120) NOT NULL,
    CONSTRAINT UQ_ProducerHerdCounts_Period UNIQUE (producerCode, effectiveMonth),
    CONSTRAINT CK_ProducerHerdCounts_Month CHECK (DAY(effectiveMonth) = 1),
    CONSTRAINT CK_ProducerHerdCounts_Values CHECK (
      (cowCount IS NULL OR cowCount >= 0) AND (buffaloCount IS NULL OR buffaloCount >= 0)
      AND (sheepGoatCount IS NULL OR sheepGoatCount >= 0)
      AND (cowCount IS NOT NULL OR buffaloCount IS NOT NULL OR sheepGoatCount IS NOT NULL))
  );
END;
IF COL_LENGTH(N'dbo.ProducerHerdCounts', N'rowVersion') IS NULL
  ALTER TABLE dbo.ProducerHerdCounts ADD rowVersion ROWVERSION NOT NULL;
IF COL_LENGTH(N'dbo.ProducerHerdCounts', N'updatedAt') IS NULL
  ALTER TABLE dbo.ProducerHerdCounts ADD updatedAt DATETIMEOFFSET NULL, updatedBy NVARCHAR(160) NULL;
`

export const selectProducerHerdCountsSql = `SELECT producerCode, CONVERT(char(7), effectiveMonth, 126) AS effectiveMonth,
  cowCount, buffaloCount, sheepGoatCount, CONVERT(varchar(18),CONVERT(binary(8),rowVersion),1) AS version FROM dbo.ProducerHerdCounts`

export async function initializeProducerHerdCounts() {
  await (await getProducerContractPool()).request().batch(producerHerdSchemaSql)
}

export async function listProducerHerdCounts() {
  return (await (await getProducerContractPool()).request().query(`${selectProducerHerdCountsSql} ORDER BY producerCode,effectiveMonth;`)).recordset
}

function herdError(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

export function validateHerdCountEdit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw herdError('Invalid animal counts.')
  const producerCode = typeof input.producerCode === 'string' ? input.producerCode.trim().toLowerCase() : ''
  if (!/^p[^\s|]+$/.test(producerCode) || producerCode.length > 80) throw herdError('A matched ERP producer is required.')
  if (typeof input.effectiveMonth !== 'string' || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(input.effectiveMonth)) throw herdError('Select a valid effective month.')
  const fields = ['cowCount', 'buffaloCount', 'sheepGoatCount']
  if (fields.some(field => input[field] !== null && (!Number.isInteger(input[field]) || input[field] < 0 || input[field] > 2147483647))) throw herdError('Counts must be whole numbers of zero or more, or blank.')
  if (fields.every(field => input[field] === null)) throw herdError('Enter at least one animal count.')
  if (input.expectedVersion !== null && (typeof input.expectedVersion !== 'string' || !/^0x[a-f0-9]{16}$/i.test(input.expectedVersion))) throw herdError('Reload the animal counts before saving.')
  return { producerCode, effectiveMonth: input.effectiveMonth, cowCount: input.cowCount, buffaloCount: input.buffaloCount, sheepGoatCount: input.sheepGoatCount, expectedVersion: input.expectedVersion }
}

export function checkHerdCountVersion(edit, current) {
  if ((current?.version || null)?.toLowerCase() !== edit.expectedVersion?.toLowerCase()) throw herdError('Animal counts changed since this page was loaded. Refresh and review before saving.', 409)
}

export async function saveProducerHerdCounts(input, user) {
  const edit = validateHerdCountEdit(input)
  const pool = await getProducerContractPool()
  const transaction = new sql.Transaction(pool)
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    const snapshot = (await new sql.Request(transaction).query("SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey=N'suppliers';")).recordset[0]
    const producers = JSON.parse(snapshot?.producersJson || '[]')
    if (!producers.some(producer => String(producer.producerCode || '').trim().toLowerCase() === edit.producerCode)) throw herdError('Producer is not in the saved ERP list. Match the journal producer first.')
    const request = () => new sql.Request(transaction)
      .input('code', sql.NVarChar(80), edit.producerCode)
      .input('month', sql.Date, `${edit.effectiveMonth}-01`)
    const current = (await request().query(`${selectProducerHerdCountsSql} WITH (UPDLOCK,HOLDLOCK)
      WHERE producerCode=@code AND effectiveMonth<=@month ORDER BY effectiveMonth DESC;`)).recordset[0] || null
    checkHerdCountVersion(edit, current)
    const values = request()
      .input('cow', sql.Int, edit.cowCount).input('buffalo', sql.Int, edit.buffaloCount).input('sheepGoat', sql.Int, edit.sheepGoatCount)
      .input('user', sql.NVarChar(160), user.username)
    if (current?.effectiveMonth === edit.effectiveMonth) {
      await values.query(`UPDATE dbo.ProducerHerdCounts SET cowCount=@cow,buffaloCount=@buffalo,sheepGoatCount=@sheepGoat,
        updatedAt=SYSDATETIMEOFFSET(),updatedBy=@user WHERE producerCode=@code AND effectiveMonth=@month;`)
    } else {
      await values.input('hash', sql.Char(64), createHash('sha256').update(JSON.stringify(edit)).digest('hex'))
        .query(`INSERT INTO dbo.ProducerHerdCounts
          (producerCode,effectiveMonth,cowCount,buffaloCount,sheepGoatCount,sourceFile,sourceSheet,sourceRows,sourceSha256,importedBy,updatedAt,updatedBy)
          VALUES (@code,@month,@cow,@buffalo,@sheepGoat,N'manual-entry',N'Animal counts',N'[]',@hash,LEFT(@user,120),SYSDATETIMEOFFSET(),@user);`)
    }
    const saved = (await request().query(`${selectProducerHerdCountsSql} WHERE producerCode=@code AND effectiveMonth=@month;`)).recordset[0]
    // Keep the count change and its audit trail in the same transaction.
    await new sql.Request(transaction)
      .input('userId', sql.NVarChar(64), user.id || null).input('username', sql.NVarChar(160), user.username)
      .input('entity', sql.NVarChar(240), `${edit.producerCode}|${edit.effectiveMonth}`)
      .input('before', sql.NVarChar(sql.MAX), current ? JSON.stringify(current) : null)
      .input('after', sql.NVarChar(sql.MAX), JSON.stringify(saved))
      .query(`INSERT INTO dbo.AppAuditLog (occurredAt,userId,username,action,entityType,entityId,beforeJson,afterJson)
        VALUES (SYSDATETIMEOFFSET(),@userId,@username,N'veterinary.herd_counts.save',N'ProducerHerdCounts',@entity,@before,@after);`)
    await transaction.commit()
    return saved
  } catch (error) {
    await transaction.rollback().catch(() => undefined)
    throw error
  }
}

export function planProducerHerdCounts(rows, existing) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('No herd counts to import.')
  const plan = { insert: [], unchanged: [], conflicts: [] }
  const seen = new Set()
  for (const row of rows) {
    if (!/^p[^\s|]+$/i.test(row.producerCode || '') || row.producerCode.length > 80 ||
      !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(row.effectiveMonth || '')) throw new Error('Invalid herd producer code or effective month.')
    const counts = [row.cowCount, row.buffaloCount, row.sheepGoatCount]
    if (counts.every(value => value == null) || counts.some(value => value != null && (!Number.isInteger(value) || value < 0 || value > 2147483647))) throw new Error('Invalid animal count.')
    if (!Array.isArray(row.sourceRows) || !row.sourceRows.length || row.sourceRows.some(value => !Number.isInteger(value) || value < 2) || JSON.stringify(row.sourceRows).length > 1000) throw new Error('Invalid source rows.')
    const normalized = { ...row, producerCode: row.producerCode.toLowerCase() }
    const key = `${normalized.producerCode}|${row.effectiveMonth}`
    if (seen.has(key)) throw new Error('Duplicate producer and effective month.')
    seen.add(key)
    const previous = existing.find(value => value.producerCode.toLowerCase() === normalized.producerCode && value.effectiveMonth === row.effectiveMonth)
    if (!previous) plan.insert.push(normalized)
    else if (['cowCount', 'buffaloCount', 'sheepGoatCount'].every(field => (previous[field] ?? null) === (row[field] ?? null))) plan.unchanged.push(normalized)
    else plan.conflicts.push({ producerCode: row.producerCode, effectiveMonth: row.effectiveMonth, reason: 'Different counts already exist for this month. No overwrite performed.' })
  }
  return plan
}

export async function insertProducerHerdCount(transaction, row, source) {
  await new sql.Request(transaction)
    .input('code', sql.NVarChar(80), row.producerCode)
    .input('month', sql.Date, `${row.effectiveMonth}-01`)
    .input('cow', sql.Int, row.cowCount ?? null)
    .input('buffalo', sql.Int, row.buffaloCount ?? null)
    .input('sheepGoat', sql.Int, row.sheepGoatCount ?? null)
    .input('file', sql.NVarChar(260), source.file)
    .input('sheet', sql.NVarChar(80), source.sheet)
    .input('rows', sql.NVarChar(1000), JSON.stringify(row.sourceRows))
    .input('hash', sql.Char(64), source.sha256)
    .query(`INSERT INTO dbo.ProducerHerdCounts
      (producerCode,effectiveMonth,cowCount,buffaloCount,sheepGoatCount,sourceFile,sourceSheet,sourceRows,sourceSha256,importedBy)
      VALUES (@code,@month,@cow,@buffalo,@sheepGoat,@file,@sheet,@rows,@hash,N'veterinary-workbook-import');`)
}
