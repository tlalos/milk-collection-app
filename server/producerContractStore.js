import sql from 'mssql'

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
`)
  })().catch(error => { initializationPromise = null; throw error })
  return initializationPromise
}

export const selectProducerContractsSql = `SELECT contractId, producerCode, milkType, contractNumber,
  CONVERT(char(10), contractStartDate, 23) AS contractStartDate,
  CONVERT(char(10), contractEndDate, 23) AS contractEndDate, contractedKg
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
