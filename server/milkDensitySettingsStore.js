import sql from 'mssql'

export const defaultMilkDensitySettings = {
  RECEPTION: [
    { code: 'MILK-COW', label: 'Cow', densityFactor: 1.03 },
    { code: 'MILK-SHEEP', label: 'Sheep', densityFactor: 1.036 },
    { code: 'MILK-GOAT', label: 'Goat', densityFactor: 1.03 },
    { code: 'MILK-BUFF', label: 'Buff', densityFactor: 1.04 },
  ],
  DELIVERIES: [
    { code: 'MILK-COW', label: 'Cow', densityFactor: 1.029 },
    { code: 'MILK-SHEEP', label: 'Sheep', densityFactor: 1.036 },
    { code: 'MILK-COW-GREECE', label: 'Standardized', densityFactor: 1.037 },
  ],
}

let poolPromise
let initializationPromise

function sqlConfig() {
  const server = process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost'
  const portValue = process.env.SQL_PORT || process.env.MSSQL_PORT || ''
  const database = process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection'
  const user = process.env.SQL_USER || process.env.MSSQL_USER
  const password = process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD
  if (!user || !password) throw new Error('SQL storage is required for milk density settings, but SQL_USER and SQL_PASSWORD are not configured.')
  return {
    server,
    ...(portValue ? { port: Number(portValue) } : {}),
    database,
    user,
    password,
    options: {
      encrypt: String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false',
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  }
}

async function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(sqlConfig()).connect()
  return poolPromise
}

export async function initializeMilkDensitySettingsStore() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const pool = await getPool()
      await pool.request().batch(`
IF OBJECT_ID(N'dbo.MilkDensitySettings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.MilkDensitySettings (
    workflow NVARCHAR(20) NOT NULL,
    milkType NVARCHAR(60) NOT NULL,
    densityFactor DECIMAL(9,6) NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL,
    updatedBy NVARCHAR(160) NULL,
    CONSTRAINT PK_MilkDensitySettings PRIMARY KEY (workflow, milkType)
  );
END;
`)
      for (const [workflow, entries] of Object.entries(defaultMilkDensitySettings)) {
        for (const entry of entries) {
          await pool.request()
            .input('workflow', sql.NVarChar(20), workflow)
            .input('milkType', sql.NVarChar(60), entry.code)
            .input('densityFactor', sql.Decimal(9, 6), entry.densityFactor)
            .query(`
IF NOT EXISTS (SELECT 1 FROM dbo.MilkDensitySettings WHERE workflow = @workflow AND milkType = @milkType)
  INSERT INTO dbo.MilkDensitySettings (workflow, milkType, densityFactor, updatedAt)
  VALUES (@workflow, @milkType, @densityFactor, SYSDATETIMEOFFSET());
`)
        }
      }
    })().catch((error) => {
      initializationPromise = null
      throw error
    })
  }
  return initializationPromise
}

export function validateMilkDensitySettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid factor settings.')
  const expectedWorkflows = Object.keys(defaultMilkDensitySettings)
  if (Object.keys(input).length !== expectedWorkflows.length || Object.keys(input).some((key) => !expectedWorkflows.includes(key))) {
    throw new Error('Both Reception and Deliveries factors are required.')
  }
  return Object.fromEntries(expectedWorkflows.map((workflow) => {
    const entries = input[workflow]
    const defaults = defaultMilkDensitySettings[workflow]
    if (!Array.isArray(entries) || entries.length !== defaults.length) throw new Error(`All ${workflow.toLowerCase()} factors are required.`)
    const values = entries.map((entry) => {
      const defaultEntry = defaults.find((item) => item.code === entry?.code)
      const factor = Number(entry?.densityFactor)
      if (!defaultEntry || !Number.isFinite(factor) || factor < 0.9 || factor > 1.2 || Math.round(factor * 1e6) / 1e6 !== factor) {
        throw new Error(`Invalid density factor for ${entry?.code || workflow}. Enter a value from 0.9 to 1.2 with up to 6 decimals.`)
      }
      return { code: entry.code, densityFactor: factor }
    })
    if (new Set(values.map((entry) => entry.code)).size !== defaults.length) throw new Error(`Duplicate ${workflow.toLowerCase()} milk type.`)
    return [workflow, values]
  }))
}

export async function getMilkDensitySettings() {
  await initializeMilkDensitySettingsStore()
  const result = await (await getPool()).request().query('SELECT workflow, milkType, densityFactor, updatedAt, updatedBy FROM dbo.MilkDensitySettings;')
  return Object.fromEntries(Object.entries(defaultMilkDensitySettings).map(([workflow, defaults]) => [
    workflow,
    defaults.map((entry) => {
      const row = result.recordset.find((item) => item.workflow === workflow && item.milkType === entry.code)
      return { ...entry, densityFactor: Number(row?.densityFactor ?? entry.densityFactor), updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || '' }
    }),
  ]))
}

export async function getMilkDensityFactor(workflow, milkType) {
  const settings = await getMilkDensitySettings()
  const match = settings[workflow]?.find((item) => item.code === milkType)
  if (!match) throw new Error(`Unsupported milk type for ${workflow.toLowerCase()}: ${milkType}`)
  return match
}

export async function saveMilkDensitySettings(input, username = '') {
  const settings = validateMilkDensitySettings(input)
  await initializeMilkDensitySettingsStore()
  const transaction = new sql.Transaction(await getPool())
  await transaction.begin()
  try {
    for (const [workflow, entries] of Object.entries(settings)) {
      for (const entry of entries) {
        await new sql.Request(transaction)
          .input('workflow', sql.NVarChar(20), workflow)
          .input('milkType', sql.NVarChar(60), entry.code)
          .input('densityFactor', sql.Decimal(9, 6), entry.densityFactor)
          .input('updatedBy', sql.NVarChar(160), username || null)
          .query(`
UPDATE dbo.MilkDensitySettings
SET densityFactor = @densityFactor, updatedAt = SYSDATETIMEOFFSET(), updatedBy = @updatedBy
WHERE workflow = @workflow AND milkType = @milkType AND densityFactor <> @densityFactor;
`)
      }
    }
    await transaction.commit()
  } catch (error) {
    await transaction.rollback().catch(() => undefined)
    throw error
  }
  return getMilkDensitySettings()
}
