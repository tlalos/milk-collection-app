import sql from 'mssql'
import { createHash } from 'node:crypto'

let poolPromise
let initializationPromise

export async function getProducerContractPool() {
  if (!poolPromise) {
    const user = process.env.SQL_USER || process.env.MSSQL_USER
    const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
    if (!user || !password) throw new Error('SQL_USER and SQL_PASSWORD are required for producer contracts.')
    const port = process.env.SQL_PORT || process.env.MSSQL_PORT
    poolPromise = new sql.ConnectionPool({
      server: process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost',
      database: process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection',
      user, password, ...(port ? { port: Number(port) } : {}),
      options: {
        encrypt: String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false',
      },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    }).connect().catch(error => { poolPromise = null; throw error })
  }
  return poolPromise
}

export async function closeProducerContractStore() {
  const pool = await poolPromise?.catch(() => null)
  poolPromise = null
  initializationPromise = null
  await pool?.close()
}

export async function initializeProducerContracts() {
  if (!initializationPromise) initializationPromise = (async () => {
    await (await getProducerContractPool()).request().batch(`
IF OBJECT_ID(N'dbo.ProducerContracts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProducerContracts (
    contractId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProducerContracts PRIMARY KEY,
    producerCode NVARCHAR(80) NOT NULL,
    milkType NVARCHAR(40) NOT NULL,
    contractNumber NVARCHAR(100) NOT NULL,
    contractStartDate DATE NOT NULL,
    contractEndDate DATE NOT NULL,
    contractedKg DECIMAL(18,3) NOT NULL,
    sourceFile NVARCHAR(260) NOT NULL,
    sourceSheet NVARCHAR(80) NOT NULL,
    sourceRow INT NOT NULL,
    sourceSha256 CHAR(64) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_ProducerContracts_Created DEFAULT SYSDATETIMEOFFSET(),
    updatedAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_ProducerContracts_Updated DEFAULT SYSDATETIMEOFFSET(),
    updatedBy NVARCHAR(120) NOT NULL,
    CONSTRAINT UQ_ProducerContracts_Period UNIQUE (producerCode, milkType, contractStartDate),
    CONSTRAINT CK_ProducerContracts_Dates CHECK (contractEndDate >= contractStartDate),
    CONSTRAINT CK_ProducerContracts_Quantity CHECK (contractedKg > 0),
    CONSTRAINT CK_ProducerContracts_SourceRow CHECK (sourceRow >= 2)
  );
END;
IF COL_LENGTH(N'dbo.ProducerContracts', N'rowVersion') IS NULL
  ALTER TABLE dbo.ProducerContracts ADD rowVersion ROWVERSION NOT NULL;
`)
  })().catch(error => { initializationPromise = null; throw error })
  return initializationPromise
}

export const selectProducerContractsSql = `SELECT contractId, producerCode, milkType, contractNumber,
  CONVERT(char(10), contractStartDate, 23) AS contractStartDate,
  CONVERT(char(10), contractEndDate, 23) AS contractEndDate, contractedKg,
  CONVERT(varchar(18),CONVERT(binary(8),rowVersion),1) AS version
FROM dbo.ProducerContracts`

export async function listProducerContracts() {
  await initializeProducerContracts()
  return (await (await getProducerContractPool()).request().query(`${selectProducerContractsSql} ORDER BY producerCode, milkType, contractStartDate;`)).recordset
}

const code = value => String(value || '').trim().toLowerCase()
const identity = row => `${code(row.producerCode)}|${row.milkType}`
const dateIsValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

export function validateProducerContracts(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('No contracts to import.')
  const seen = new Set()
  return rows.map(row => {
    const label = `Excel row ${row.sourceRow || '?'} (${row.producerCode || 'no code'})`
    if (!/^p[^\s|]+$/i.test(String(row.producerCode || '')) || row.producerCode.length > 80) throw new Error(`${label}: invalid producer code.`)
    if (!['MILK-COW', 'MILK-SHEEP', 'MILK-GOAT', 'MILK-BUFF'].includes(row.milkType)) throw new Error(`${label}: invalid milk type.`)
    if (typeof row.contractNumber !== 'string' || !row.contractNumber.trim() || row.contractNumber.length > 100) throw new Error(`${label}: invalid contract number.`)
    if (!dateIsValid(row.contractStartDate) || !dateIsValid(row.contractEndDate) || row.contractEndDate < row.contractStartDate) throw new Error(`${label}: invalid contract dates.`)
    if (typeof row.contractedKg !== 'number' || !Number.isFinite(row.contractedKg) || row.contractedKg <= 0 || row.contractedKg > 999999999999 ||
      Math.abs(row.contractedKg * 1000 - Math.round(row.contractedKg * 1000)) > 0.0001) throw new Error(`${label}: invalid contracted kilograms (maximum 3 decimals).`)
    if (!Number.isInteger(row.sourceRow) || row.sourceRow < 2) throw new Error(`${label}: invalid source row.`)
    const normalized = { ...row, producerCode: code(row.producerCode), contractNumber: row.contractNumber.trim() }
    const key = `${identity(normalized)}|${row.contractStartDate}`
    if (seen.has(key)) throw new Error(`${label}: duplicate contract.`)
    seen.add(key)
    return normalized
  })
}

export function planProducerContractImport(rows, existing, producers) {
  const incoming = validateProducerContracts(rows)
  const known = new Set(producers.map(row => code(row.producerCode)))
  const plan = { insert: [], unchanged: [], conflicts: [] }
  const checked = [...existing]
  for (const row of incoming) {
    if (!known.has(row.producerCode)) {
      plan.conflicts.push({ producerCode: row.producerCode, sourceRow: row.sourceRow, reason: 'Producer code is not in the saved ERP list.' })
      continue
    }
    const overlaps = checked.filter(other => identity(other) === identity(row) && other.contractStartDate <= row.contractEndDate && other.contractEndDate >= row.contractStartDate)
    const same = other => other.contractNumber === row.contractNumber && other.contractStartDate === row.contractStartDate && other.contractEndDate === row.contractEndDate && Number(other.contractedKg) === row.contractedKg
    if (overlaps.length === 1 && same(overlaps[0])) plan.unchanged.push(row)
    else if (overlaps.length) plan.conflicts.push({ producerCode: row.producerCode, sourceRow: row.sourceRow, reason: 'A different or overlapping contract already exists.' })
    else { plan.insert.push(row); checked.push(row) }
  }
  return plan
}

export async function insertProducerContract(transaction, row, source, username) {
  await new sql.Request(transaction)
    .input('producerCode', sql.NVarChar(80), row.producerCode)
    .input('milkType', sql.NVarChar(40), row.milkType)
    .input('contractNumber', sql.NVarChar(100), row.contractNumber)
    .input('start', sql.Date, row.contractStartDate)
    .input('end', sql.Date, row.contractEndDate)
    .input('kg', sql.Decimal(18, 3), row.contractedKg)
    .input('file', sql.NVarChar(260), source.file)
    .input('sheet', sql.NVarChar(80), source.sheet)
    .input('row', sql.Int, row.sourceRow)
    .input('hash', sql.Char(64), source.sha256)
    .input('user', sql.NVarChar(120), username)
    .query(`INSERT INTO dbo.ProducerContracts
      (producerCode,milkType,contractNumber,contractStartDate,contractEndDate,contractedKg,sourceFile,sourceSheet,sourceRow,sourceSha256,updatedBy)
      VALUES (@producerCode,@milkType,@contractNumber,@start,@end,@kg,@file,@sheet,@row,@hash,@user);`)
}

const editError = (message, status = 400) => Object.assign(new Error(message), { status })

export function validateProducerContractEdit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw editError('Invalid contract.')
  const contractId = input.contractId == null ? null : String(input.contractId)
  if (contractId !== null && !/^[1-9]\d{0,17}$/u.test(contractId)) throw editError('Invalid contract ID.')
  if (contractId === null ? input.expectedVersion !== null : typeof input.expectedVersion !== 'string' || !/^0x[0-9a-f]{16}$/iu.test(input.expectedVersion)) throw editError('Reload the contracts before saving.')
  let row
  try {
    row = validateProducerContracts([{ producerCode: input.producerCode, milkType: input.milkType,
      contractNumber: input.contractNumber, contractStartDate: input.contractStartDate,
      contractEndDate: input.contractEndDate, contractedKg: input.contractedKg, sourceRow: 2 }])[0]
  } catch (error) { throw editError(error.message.replace(/^Excel row .*?: /u, '')) }
  return { ...row, contractId, expectedVersion: input.expectedVersion }
}

export function checkProducerContractEdit(edit, existing) {
  const current = edit.contractId === null ? null : existing.find(row => String(row.contractId) === edit.contractId)
  if (edit.contractId !== null && !current) throw editError('Contract no longer exists for this producer and milk type. Refresh the list.', 409)
  if (current && (current.version?.toLowerCase() !== edit.expectedVersion.toLowerCase()
    || code(current.producerCode) !== edit.producerCode || current.milkType !== edit.milkType)) throw editError('Contract changed since this page was loaded. Refresh and review before saving.', 409)
  if (existing.some(row => String(row.contractId) !== edit.contractId && identity(row) === identity(edit)
    && row.contractStartDate <= edit.contractEndDate && row.contractEndDate >= edit.contractStartDate)) throw editError('These dates overlap another contract for this producer and milk type.', 409)
  return current
}

export async function saveProducerContract(input, user) {
  const edit = validateProducerContractEdit(input)
  await initializeProducerContracts()
  const transaction = new sql.Transaction(await getProducerContractPool())
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    const request = () => new sql.Request(transaction)
      .input('code', sql.NVarChar(80), edit.producerCode).input('milk', sql.NVarChar(40), edit.milkType)
    const existing = (await request().query(`${selectProducerContractsSql} WITH (UPDLOCK,HOLDLOCK)
      WHERE producerCode=@code AND milkType=@milk;`)).recordset
    const before = checkProducerContractEdit(edit, existing)
    if (!before) {
      const snapshot = (await new sql.Request(transaction).query("SELECT producersJson FROM dbo.OcrErpReferenceSnapshot WHERE snapshotKey=N'suppliers';")).recordset[0]
      const producers = JSON.parse(snapshot?.producersJson || '[]')
      if (!producers.some(producer => code(producer.producerCode) === edit.producerCode)) throw editError('Choose a producer from the saved ERP list.')
      // The legacy source row is required; manual provenance is explicit in the file and sheet fields.
      await insertProducerContract(transaction, edit, { file: 'manual-entry', sheet: 'APIA contract editor', sha256: createHash('sha256').update(JSON.stringify(edit)).digest('hex') }, user.username)
    } else {
      await request().input('id', sql.BigInt, edit.contractId)
        .input('number', sql.NVarChar(100), edit.contractNumber)
        .input('start', sql.Date, edit.contractStartDate).input('end', sql.Date, edit.contractEndDate)
        .input('kg', sql.Decimal(18, 3), edit.contractedKg).input('user', sql.NVarChar(120), user.username)
        .query(`UPDATE dbo.ProducerContracts SET contractNumber=@number,contractStartDate=@start,
          contractEndDate=@end,contractedKg=@kg,updatedAt=SYSDATETIMEOFFSET(),updatedBy=@user
          WHERE contractId=@id AND producerCode=@code AND milkType=@milk;`)
    }
    const saved = (await request().input('start', sql.Date, edit.contractStartDate)
      .query(`${selectProducerContractsSql} WHERE producerCode=@code AND milkType=@milk AND contractStartDate=@start;`)).recordset[0]
    await new sql.Request(transaction)
      .input('userId', sql.NVarChar(64), user.id || null).input('username', sql.NVarChar(160), user.username)
      .input('entity', sql.NVarChar(240), String(saved.contractId))
      .input('before', sql.NVarChar(sql.MAX), before ? JSON.stringify(before) : null)
      .input('after', sql.NVarChar(sql.MAX), JSON.stringify(saved))
      .query(`INSERT INTO dbo.AppAuditLog (occurredAt,userId,username,action,entityType,entityId,beforeJson,afterJson)
        VALUES (SYSDATETIMEOFFSET(),@userId,@username,N'apia.contract.save',N'ProducerContracts',@entity,@before,@after);`)
    await transaction.commit()
    return saved
  } catch (error) {
    await transaction.rollback().catch(() => undefined)
    throw error
  }
}
