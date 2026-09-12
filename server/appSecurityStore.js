import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import sql from 'mssql'

const scrypt = promisify(scryptCallback)

const seedUser = {
  id: 'lactea',
  username: 'lactea',
  fullName: 'Lactea Admin',
  passwordSalt: '41d4e80886e20bdfbee46e463becc0b5',
  passwordHash: '39449d4f3c921620ce3bfe4ec9967d3394597b0bcfe21c33d495edbb6e386b0cd6077862e0f8c4eab7b8ce41ef8e0ae5882dafd9e224644d478ad155222089b2',
}

export const APP_PERMISSIONS = [
  { key: 'milk_collection', label: 'Milk collection' },
  { key: 'customers', label: 'Customers' },
  { key: 'data_sync', label: 'Data sync' },
  { key: 'journal', label: 'Journal' },
  { key: 'transport', label: 'Transport' },
  { key: 'milk_reception', label: 'Milk reception' },
  { key: 'ocr_documents', label: 'OCR documents' },
  { key: 'daily_aviz', label: 'Daily aviz' },
  { key: 'monthly_reconciliation', label: 'Monthly reconciliation' },
  { key: 'month_closure', label: 'Month closure and payments' },
  { key: 'ocr_settings', label: 'OCR settings' },
  { key: 'app_admin', label: 'Application administration' },
  { key: 'audit_log', label: 'Audit log' },
]

let poolPromise = null
let initialized = false

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
    throw new Error('SQL storage is required for app security, but SQL_USER and SQL_PASSWORD are not configured.')
  }

  return {
    server,
    ...(port ? { port } : {}),
    database,
    user,
    password,
    options: { encrypt, trustServerCertificate },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  }
}

function getPool() {
  if (!poolPromise) poolPromise = new sql.ConnectionPool(sqlConfig()).connect()
  return poolPromise
}

function tokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex')
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(String(password || ''), Buffer.from(salt, 'hex'), 64)
  return { passwordSalt: salt, passwordHash: hash.toString('hex') }
}

function sqlText(value) {
  return `N'${String(value || '').replace(/'/gu, "''")}'`
}

function permissionValuesSql() {
  return APP_PERMISSIONS
    .map((permission) => `('admin', ${sqlText(permission.key)})`)
    .join(',\n    ')
}

function normalizeRoleKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
}

export async function initializeAuthStore() {
  if (initialized) return
  const pool = await getPool()
  await pool.request().batch(`
IF OBJECT_ID(N'dbo.AppUsers', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppUsers (
    userId NVARCHAR(64) NOT NULL CONSTRAINT PK_AppUsers PRIMARY KEY,
    username NVARCHAR(160) NOT NULL,
    fullName NVARCHAR(240) NULL,
    passwordSalt NVARCHAR(128) NOT NULL,
    passwordHash NVARCHAR(256) NOT NULL,
    isActive BIT NOT NULL CONSTRAINT DF_AppUsers_IsActive DEFAULT 1,
    isAdmin BIT NOT NULL CONSTRAINT DF_AppUsers_IsAdmin DEFAULT 0,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL
  );
END;

IF OBJECT_ID(N'dbo.AppRoles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppRoles (
    roleKey NVARCHAR(80) NOT NULL CONSTRAINT PK_AppRoles PRIMARY KEY,
    roleName NVARCHAR(160) NOT NULL,
    description NVARCHAR(500) NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    updatedAt DATETIMEOFFSET NOT NULL
  );
END;

IF OBJECT_ID(N'dbo.AppUserRoles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppUserRoles (
    userId NVARCHAR(64) NOT NULL,
    roleKey NVARCHAR(80) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    CONSTRAINT PK_AppUserRoles PRIMARY KEY (userId, roleKey)
  );
END;

IF OBJECT_ID(N'dbo.AppRolePermissions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppRolePermissions (
    roleKey NVARCHAR(80) NOT NULL,
    permissionKey NVARCHAR(120) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL CONSTRAINT DF_AppRolePermissions_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT PK_AppRolePermissions PRIMARY KEY (roleKey, permissionKey)
  );
END;

IF OBJECT_ID(N'dbo.AppSessions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppSessions (
    tokenHash CHAR(64) NOT NULL CONSTRAINT PK_AppSessions PRIMARY KEY,
    userId NVARCHAR(64) NOT NULL,
    createdAt DATETIMEOFFSET NOT NULL,
    expiresAt DATETIMEOFFSET NOT NULL
  );
END;

IF OBJECT_ID(N'dbo.AppAuditLog', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AppAuditLog (
    auditId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppAuditLog PRIMARY KEY,
    occurredAt DATETIMEOFFSET NOT NULL,
    userId NVARCHAR(64) NULL,
    username NVARCHAR(160) NULL,
    action NVARCHAR(160) NOT NULL,
    entityType NVARCHAR(120) NULL,
    entityId NVARCHAR(240) NULL,
    beforeJson NVARCHAR(MAX) NULL,
    afterJson NVARCHAR(MAX) NULL,
    metadataJson NVARCHAR(MAX) NULL,
    ipAddress NVARCHAR(120) NULL,
    userAgent NVARCHAR(500) NULL
  );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_AppUsers_Username' AND object_id = OBJECT_ID(N'dbo.AppUsers'))
  CREATE UNIQUE INDEX UX_AppUsers_Username ON dbo.AppUsers(username);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AppSessions_UserExpires' AND object_id = OBJECT_ID(N'dbo.AppSessions'))
  CREATE INDEX IX_AppSessions_UserExpires ON dbo.AppSessions(userId, expiresAt);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AppAuditLog_OccurredAt' AND object_id = OBJECT_ID(N'dbo.AppAuditLog'))
  CREATE INDEX IX_AppAuditLog_OccurredAt ON dbo.AppAuditLog(occurredAt DESC);

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppUsers') AND c.name = N'createdAt')
  ALTER TABLE dbo.AppUsers ADD CONSTRAINT DF_AppUsers_CreatedAt DEFAULT SYSDATETIMEOFFSET() FOR createdAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppUsers') AND c.name = N'updatedAt')
  ALTER TABLE dbo.AppUsers ADD CONSTRAINT DF_AppUsers_UpdatedAt DEFAULT SYSDATETIMEOFFSET() FOR updatedAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppRoles') AND c.name = N'createdAt')
  ALTER TABLE dbo.AppRoles ADD CONSTRAINT DF_AppRoles_CreatedAt DEFAULT SYSDATETIMEOFFSET() FOR createdAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppRoles') AND c.name = N'updatedAt')
  ALTER TABLE dbo.AppRoles ADD CONSTRAINT DF_AppRoles_UpdatedAt DEFAULT SYSDATETIMEOFFSET() FOR updatedAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppUserRoles') AND c.name = N'createdAt')
  ALTER TABLE dbo.AppUserRoles ADD CONSTRAINT DF_AppUserRoles_CreatedAt DEFAULT SYSDATETIMEOFFSET() FOR createdAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppRolePermissions') AND c.name = N'createdAt')
  ALTER TABLE dbo.AppRolePermissions ADD CONSTRAINT DF_AppRolePermissions_CreatedAt DEFAULT SYSDATETIMEOFFSET() FOR createdAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppSessions') AND c.name = N'createdAt')
  ALTER TABLE dbo.AppSessions ADD CONSTRAINT DF_AppSessions_CreatedAt DEFAULT SYSDATETIMEOFFSET() FOR createdAt;

IF NOT EXISTS (SELECT 1 FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE dc.parent_object_id = OBJECT_ID(N'dbo.AppAuditLog') AND c.name = N'occurredAt')
  ALTER TABLE dbo.AppAuditLog ADD CONSTRAINT DF_AppAuditLog_OccurredAt DEFAULT SYSDATETIMEOFFSET() FOR occurredAt;

IF NOT EXISTS (SELECT 1 FROM dbo.AppRoles WHERE roleKey = N'admin')
  INSERT INTO dbo.AppRoles (roleKey, roleName, description, createdAt, updatedAt)
  VALUES (N'admin', N'Administrator', N'Full application access', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());

IF NOT EXISTS (SELECT 1 FROM dbo.AppUsers WHERE username = ${sqlText(seedUser.username)})
  INSERT INTO dbo.AppUsers (userId, username, fullName, passwordSalt, passwordHash, isActive, isAdmin, createdAt, updatedAt)
  VALUES (${sqlText(seedUser.id)}, ${sqlText(seedUser.username)}, ${sqlText(seedUser.fullName)}, ${sqlText(seedUser.passwordSalt)}, ${sqlText(seedUser.passwordHash)}, 1, 1, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());

UPDATE dbo.AppUsers
SET isAdmin = 1, isActive = 1, updatedAt = SYSDATETIMEOFFSET()
WHERE username = ${sqlText(seedUser.username)};

IF NOT EXISTS (SELECT 1 FROM dbo.AppUserRoles WHERE userId = ${sqlText(seedUser.id)} AND roleKey = N'admin')
  INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt)
  VALUES (${sqlText(seedUser.id)}, N'admin', SYSDATETIMEOFFSET());

MERGE dbo.AppRolePermissions AS target
USING (VALUES
    ${permissionValuesSql()}
) AS source(roleKey, permissionKey)
ON target.roleKey = source.roleKey AND target.permissionKey = source.permissionKey
WHEN NOT MATCHED THEN
  INSERT (roleKey, permissionKey, createdAt)
  VALUES (source.roleKey, source.permissionKey, SYSDATETIMEOFFSET());
`)
  initialized = true
}

async function loadAccessForUser(pool, userId, isAdmin) {
  const rolesResult = await pool.request()
    .input('userId', sql.NVarChar(64), userId)
    .query(`
SELECT r.roleKey, r.roleName
FROM dbo.AppUserRoles ur
JOIN dbo.AppRoles r ON r.roleKey = ur.roleKey
WHERE ur.userId = @userId
ORDER BY r.roleName;
`)
  if (isAdmin) {
    return {
      roles: rolesResult.recordset.map((role) => ({ key: role.roleKey, name: role.roleName })),
      permissions: APP_PERMISSIONS.map((permission) => permission.key),
    }
  }
  const permissionsResult = await pool.request()
    .input('userId', sql.NVarChar(64), userId)
    .query(`
SELECT DISTINCT rp.permissionKey
FROM dbo.AppUserRoles ur
JOIN dbo.AppRolePermissions rp ON rp.roleKey = ur.roleKey
WHERE ur.userId = @userId
ORDER BY rp.permissionKey;
`)
  return {
    roles: rolesResult.recordset.map((role) => ({ key: role.roleKey, name: role.roleName })),
    permissions: permissionsResult.recordset.map((row) => row.permissionKey),
  }
}

async function publicUser(pool, row) {
  const isAdmin = Boolean(row.isAdmin)
  const access = await loadAccessForUser(pool, row.userId, isAdmin)
  return {
    id: row.userId,
    username: row.username,
    fullName: row.fullName || row.username,
    isAdmin,
    roles: access.roles,
    permissions: access.permissions,
  }
}

export async function login(username, password, sessionDays = 30) {
  await initializeAuthStore()
  const pool = await getPool()
  const result = await pool.request()
    .input('username', sql.NVarChar(160), String(username || '').trim())
    .query(`
SELECT TOP (1) *
FROM dbo.AppUsers
WHERE username = @username AND isActive = 1;
`)
  const user = result.recordset[0]
  if (!user) return null

  const candidate = await scrypt(String(password || ''), Buffer.from(user.passwordSalt, 'hex'), 64)
  const expected = Buffer.from(user.passwordHash, 'hex')
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + sessionDays * 86400000)
  await pool.request()
    .input('now', sql.DateTimeOffset, now)
    .input('tokenHash', sql.Char(64), tokenHash(token))
    .input('userId', sql.NVarChar(64), user.userId)
    .input('expiresAt', sql.DateTimeOffset, expiresAt)
    .query(`
DELETE FROM dbo.AppSessions WHERE expiresAt <= @now;
INSERT INTO dbo.AppSessions (tokenHash, userId, createdAt, expiresAt)
VALUES (@tokenHash, @userId, @now, @expiresAt);
`)
  return { token, expiresAt: expiresAt.toISOString(), user: await publicUser(pool, user) }
}

export async function getSessionUser(token) {
  if (!token) return null
  await initializeAuthStore()
  const pool = await getPool()
  const result = await pool.request()
    .input('tokenHash', sql.Char(64), tokenHash(token))
    .input('now', sql.DateTimeOffset, new Date())
    .query(`
SELECT TOP (1) u.*
FROM dbo.AppSessions s
JOIN dbo.AppUsers u ON u.userId = s.userId
WHERE s.tokenHash = @tokenHash
  AND s.expiresAt > @now
  AND u.isActive = 1;
`)
  return result.recordset[0] ? publicUser(pool, result.recordset[0]) : null
}

export async function logout(token) {
  if (!token) return
  await initializeAuthStore()
  await (await getPool()).request()
    .input('tokenHash', sql.Char(64), tokenHash(token))
    .query('DELETE FROM dbo.AppSessions WHERE tokenHash = @tokenHash;')
}

export async function listWebUserAdminData() {
  await initializeAuthStore()
  const pool = await getPool()
  const [usersResult, rolesResult, userRolesResult, rolePermissionsResult, auditResult] = await Promise.all([
    pool.request().query(`
SELECT userId, username, fullName, isActive, isAdmin, createdAt, updatedAt
FROM dbo.AppUsers
ORDER BY username;
`),
    pool.request().query(`
SELECT roleKey, roleName, description, createdAt, updatedAt
FROM dbo.AppRoles
ORDER BY roleName;
`),
    pool.request().query(`
SELECT userId, roleKey
FROM dbo.AppUserRoles
ORDER BY userId, roleKey;
`),
    pool.request().query(`
SELECT roleKey, permissionKey
FROM dbo.AppRolePermissions
ORDER BY roleKey, permissionKey;
`),
    pool.request().query(`
SELECT TOP (100) auditId, occurredAt, username, action, entityType, entityId, ipAddress
FROM dbo.AppAuditLog
ORDER BY occurredAt DESC;
`),
  ])

  const rolesByUser = new Map()
  for (const row of userRolesResult.recordset) {
    if (!rolesByUser.has(row.userId)) rolesByUser.set(row.userId, [])
    rolesByUser.get(row.userId).push(row.roleKey)
  }
  const permissionsByRole = new Map()
  for (const row of rolePermissionsResult.recordset) {
    if (!permissionsByRole.has(row.roleKey)) permissionsByRole.set(row.roleKey, [])
    permissionsByRole.get(row.roleKey).push(row.permissionKey)
  }

  return {
    users: usersResult.recordset.map((row) => ({
      userId: row.userId,
      username: row.username,
      fullName: row.fullName || '',
      isActive: Boolean(row.isActive),
      isAdmin: Boolean(row.isAdmin),
      roleKeys: rolesByUser.get(row.userId) || [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    roles: rolesResult.recordset.map((row) => ({
      roleKey: row.roleKey,
      roleName: row.roleName,
      description: row.description || '',
      permissionKeys: permissionsByRole.get(row.roleKey) || [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    permissions: APP_PERMISSIONS,
    auditLog: auditResult.recordset.map((row) => ({
      auditId: String(row.auditId),
      occurredAt: row.occurredAt,
      username: row.username || '',
      action: row.action,
      entityType: row.entityType || '',
      entityId: row.entityId || '',
      ipAddress: row.ipAddress || '',
    })),
  }
}

export async function saveWebUser(input = {}) {
  await initializeAuthStore()
  const pool = await getPool()
  const userId = String(input.userId || '').trim() || randomUUID()
  const username = String(input.username || '').trim()
  const fullName = String(input.fullName || '').trim()
  const roleKeys = Array.isArray(input.roleKeys) ? input.roleKeys.map(normalizeRoleKey).filter(Boolean) : []
  const password = String(input.password || '')
  const isNew = !String(input.userId || '').trim()

  if (!username) throw new Error('Username is required.')
  if (isNew && !password) throw new Error('Password is required for a new Web user.')

  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const now = new Date()
    const passwordFields = password ? await hashPassword(password) : null
    const request = new sql.Request(tx)
      .input('userId', sql.NVarChar(64), userId)
      .input('username', sql.NVarChar(160), username)
      .input('fullName', sql.NVarChar(240), fullName || null)
      .input('isActive', sql.Bit, input.isActive !== false)
      .input('isAdmin', sql.Bit, Boolean(input.isAdmin))
      .input('now', sql.DateTimeOffset, now)

    if (passwordFields) {
      request
        .input('passwordSalt', sql.NVarChar(128), passwordFields.passwordSalt)
        .input('passwordHash', sql.NVarChar(256), passwordFields.passwordHash)
    }

    if (isNew) {
      await request.query(`
INSERT INTO dbo.AppUsers (userId, username, fullName, passwordSalt, passwordHash, isActive, isAdmin, createdAt, updatedAt)
VALUES (@userId, @username, @fullName, @passwordSalt, @passwordHash, @isActive, @isAdmin, @now, @now);
`)
    } else {
      await request.query(`
UPDATE dbo.AppUsers
SET username = @username,
    fullName = @fullName,
    isActive = @isActive,
    isAdmin = @isAdmin,
    updatedAt = @now
    ${passwordFields ? ', passwordSalt = @passwordSalt, passwordHash = @passwordHash' : ''}
WHERE userId = @userId;
`)
    }

    await new sql.Request(tx)
      .input('userId', sql.NVarChar(64), userId)
      .query('DELETE FROM dbo.AppUserRoles WHERE userId = @userId;')

    for (const roleKey of roleKeys) {
      await new sql.Request(tx)
        .input('userId', sql.NVarChar(64), userId)
        .input('roleKey', sql.NVarChar(80), roleKey)
        .input('now', sql.DateTimeOffset, now)
        .query(`
IF EXISTS (SELECT 1 FROM dbo.AppRoles WHERE roleKey = @roleKey)
  INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt)
  VALUES (@userId, @roleKey, @now);
`)
    }

    await tx.commit()
    return { userId, username, fullName, isActive: input.isActive !== false, isAdmin: Boolean(input.isAdmin), roleKeys }
  } catch (error) {
    await tx.rollback().catch(() => undefined)
    throw error
  }
}

export async function saveWebRole(input = {}) {
  await initializeAuthStore()
  const roleKey = normalizeRoleKey(input.roleKey)
  const roleName = String(input.roleName || '').trim()
  const description = String(input.description || '').trim()
  const permissionKeys = Array.isArray(input.permissionKeys)
    ? input.permissionKeys.map((key) => String(key || '').trim()).filter((key) => APP_PERMISSIONS.some((permission) => permission.key === key))
    : []
  if (!roleKey) throw new Error('Role key is required.')
  if (!roleName) throw new Error('Role name is required.')
  if (roleKey === 'admin') throw new Error('The built-in admin role cannot be edited here.')

  const pool = await getPool()
  const tx = new sql.Transaction(pool)
  await tx.begin()
  try {
    const now = new Date()
    await new sql.Request(tx)
      .input('roleKey', sql.NVarChar(80), roleKey)
      .input('roleName', sql.NVarChar(160), roleName)
      .input('description', sql.NVarChar(500), description || null)
      .input('now', sql.DateTimeOffset, now)
      .query(`
MERGE dbo.AppRoles AS target
USING (SELECT @roleKey AS roleKey) AS source
ON target.roleKey = source.roleKey
WHEN MATCHED THEN
  UPDATE SET roleName = @roleName, description = @description, updatedAt = @now
WHEN NOT MATCHED THEN
  INSERT (roleKey, roleName, description, createdAt, updatedAt)
  VALUES (@roleKey, @roleName, @description, @now, @now);
`)
    await new sql.Request(tx)
      .input('roleKey', sql.NVarChar(80), roleKey)
      .query('DELETE FROM dbo.AppRolePermissions WHERE roleKey = @roleKey;')

    for (const permissionKey of permissionKeys) {
      await new sql.Request(tx)
        .input('roleKey', sql.NVarChar(80), roleKey)
        .input('permissionKey', sql.NVarChar(120), permissionKey)
        .input('now', sql.DateTimeOffset, now)
        .query(`
INSERT INTO dbo.AppRolePermissions (roleKey, permissionKey, createdAt)
VALUES (@roleKey, @permissionKey, @now);
`)
    }
    await tx.commit()
    return { roleKey, roleName, description, permissionKeys }
  } catch (error) {
    await tx.rollback().catch(() => undefined)
    throw error
  }
}

export function userHasPermission(user, permission) {
  if (!permission) return true
  if (!user) return false
  if (user.isAdmin) return true
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

function jsonOrNull(value) {
  if (value == null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ unserializable: true })
  }
}

function requestIp(request) {
  const forwarded = String(request?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || request?.socket?.remoteAddress || request?.ip || ''
}

export async function auditAction({ request = null, user = null, action, entityType = '', entityId = '', before = null, after = null, metadata = null } = {}) {
  if (!action) return
  try {
    await initializeAuthStore()
    await (await getPool()).request()
      .input('occurredAt', sql.DateTimeOffset, new Date())
      .input('userId', sql.NVarChar(64), user?.id || null)
      .input('username', sql.NVarChar(160), user?.username || null)
      .input('action', sql.NVarChar(160), action)
      .input('entityType', sql.NVarChar(120), entityType || null)
      .input('entityId', sql.NVarChar(240), entityId ? String(entityId) : null)
      .input('beforeJson', sql.NVarChar(sql.MAX), jsonOrNull(before))
      .input('afterJson', sql.NVarChar(sql.MAX), jsonOrNull(after))
      .input('metadataJson', sql.NVarChar(sql.MAX), jsonOrNull(metadata))
      .input('ipAddress', sql.NVarChar(120), requestIp(request) || null)
      .input('userAgent', sql.NVarChar(500), request?.headers?.['user-agent'] || null)
      .query(`
INSERT INTO dbo.AppAuditLog (
  occurredAt, userId, username, action, entityType, entityId, beforeJson, afterJson, metadataJson, ipAddress, userAgent
) VALUES (
  @occurredAt, @userId, @username, @action, @entityType, @entityId, @beforeJson, @afterJson, @metadataJson, @ipAddress, @userAgent
);
`)
  } catch (error) {
    console.warn('Audit log failed:', error instanceof Error ? error.message : error)
  }
}
