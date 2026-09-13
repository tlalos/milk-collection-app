import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sql from 'mssql'
import dotenv from 'dotenv'

dotenv.config()

function sqlConfig() {
  const portValue = process.env.SQL_PORT || process.env.MSSQL_PORT || ''
  return {
    server: process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost',
    ...(portValue ? { port: Number(portValue) } : {}),
    database: process.env.SQL_DATABASE || process.env.MSSQL_DATABASE || 'milkcollection',
    user: process.env.SQL_USER || process.env.MSSQL_USER,
    password: process.env.SQL_PASSWORD || process.env.MSSQL_PASSWORD,
    options: {
      encrypt: String(process.env.SQL_ENCRYPT || process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: String(process.env.SQL_TRUST_SERVER_CERTIFICATE || process.env.MSSQL_TRUST_SERVER_CERTIFICATE || 'true').toLowerCase() !== 'false',
    },
  }
}

function sqlText(value) {
  if (value == null) return 'NULL'
  return `N'${String(value).replace(/'/gu, "''")}'`
}

function sqlBit(value) {
  return value ? '1' : '0'
}

function timestampForName() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const pool = await sql.connect(sqlConfig())
const [users, roles, userRoles, rolePermissions] = await Promise.all([
  pool.request().query('SELECT userId, username, fullName, passwordSalt, passwordHash, isActive, isAdmin FROM dbo.AppUsers ORDER BY username;'),
  pool.request().query('SELECT roleKey, roleName, description FROM dbo.AppRoles ORDER BY roleKey;'),
  pool.request().query('SELECT userId, roleKey FROM dbo.AppUserRoles ORDER BY userId, roleKey;'),
  pool.request().query('SELECT roleKey, permissionKey FROM dbo.AppRolePermissions ORDER BY roleKey, permissionKey;'),
])
await pool.close()

const nowSql = 'SYSDATETIMEOFFSET()'
const lines = [
  '-- Milk Collection Web users seed data',
  `-- Generated from local development SQL on ${new Date().toISOString()}`,
  '-- Run this after deploying/restarting the app once so the App* tables exist.',
  '-- This imports users, roles, role permissions, and user-role assignments.',
  '-- It does not import AppSessions or AppAuditLog.',
  '',
  'SET XACT_ABORT ON;',
  'BEGIN TRAN;',
  '',
]

for (const role of roles.recordset) {
  lines.push(`IF EXISTS (SELECT 1 FROM dbo.AppRoles WHERE roleKey = ${sqlText(role.roleKey)})`)
  lines.push(`  UPDATE dbo.AppRoles SET roleName = ${sqlText(role.roleName)}, description = ${sqlText(role.description)}, updatedAt = ${nowSql} WHERE roleKey = ${sqlText(role.roleKey)};`)
  lines.push('ELSE')
  lines.push(`  INSERT INTO dbo.AppRoles (roleKey, roleName, description, createdAt, updatedAt) VALUES (${sqlText(role.roleKey)}, ${sqlText(role.roleName)}, ${sqlText(role.description)}, ${nowSql}, ${nowSql});`)
  lines.push('')
}

for (const user of users.recordset) {
  lines.push(`IF EXISTS (SELECT 1 FROM dbo.AppUsers WHERE userId = ${sqlText(user.userId)})`)
  lines.push(`  UPDATE dbo.AppUsers SET username = ${sqlText(user.username)}, fullName = ${sqlText(user.fullName)}, passwordSalt = ${sqlText(user.passwordSalt)}, passwordHash = ${sqlText(user.passwordHash)}, isActive = ${sqlBit(user.isActive)}, isAdmin = ${sqlBit(user.isAdmin)}, updatedAt = ${nowSql} WHERE userId = ${sqlText(user.userId)};`)
  lines.push('ELSE')
  lines.push(`  INSERT INTO dbo.AppUsers (userId, username, fullName, passwordSalt, passwordHash, isActive, isAdmin, createdAt, updatedAt) VALUES (${sqlText(user.userId)}, ${sqlText(user.username)}, ${sqlText(user.fullName)}, ${sqlText(user.passwordSalt)}, ${sqlText(user.passwordHash)}, ${sqlBit(user.isActive)}, ${sqlBit(user.isAdmin)}, ${nowSql}, ${nowSql});`)
  lines.push('')
}

for (const roleKey of [...new Set(rolePermissions.recordset.map((row) => row.roleKey))]) {
  lines.push(`DELETE FROM dbo.AppRolePermissions WHERE roleKey = ${sqlText(roleKey)};`)
  for (const permission of rolePermissions.recordset.filter((row) => row.roleKey === roleKey)) {
    lines.push(`INSERT INTO dbo.AppRolePermissions (roleKey, permissionKey, createdAt) VALUES (${sqlText(permission.roleKey)}, ${sqlText(permission.permissionKey)}, ${nowSql});`)
  }
  lines.push('')
}

for (const userId of [...new Set(userRoles.recordset.map((row) => row.userId))]) {
  lines.push(`DELETE FROM dbo.AppUserRoles WHERE userId = ${sqlText(userId)};`)
  for (const userRole of userRoles.recordset.filter((row) => row.userId === userId)) {
    lines.push(`INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt) VALUES (${sqlText(userRole.userId)}, ${sqlText(userRole.roleKey)}, ${nowSql});`)
  }
  lines.push('')
}

lines.push('COMMIT;')
lines.push('')
lines.push(`-- Exported rows: ${users.recordset.length} users, ${roles.recordset.length} roles, ${rolePermissions.recordset.length} role permissions, ${userRoles.recordset.length} user-role links.`)

const packageName = `web-users-seed-${timestampForName()}`
const packageDir = path.resolve(packageName)
const zipPath = path.resolve(`${packageName}.zip`)

mkdirSync(packageDir, { recursive: true })
writeFileSync(path.join(packageDir, 'import-web-users.sql'), lines.join('\r\n'), 'utf8')
writeFileSync(path.join(packageDir, 'README.txt'), [
  'Web users import',
  '',
  '1. Deploy the app zip to the production server.',
  '2. Restart/recycle the IIS app once so the App* tables are created.',
  '3. In SQL Server Management Studio, open import-web-users.sql against the production milk database.',
  '4. Run the script.',
  '',
  'This imports Web users, roles, role permissions, and user-role links.',
  'It intentionally does not import login sessions or audit history.',
  'The script includes password hashes, so keep this zip private.',
  '',
].join('\r\n'), 'utf8')

execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `if (Test-Path -LiteralPath '${zipPath}') { Remove-Item -LiteralPath '${zipPath}' -Force; }`,
    `[System.IO.Compression.ZipFile]::CreateFromDirectory('${packageDir}', '${zipPath}');`,
  ].join(' '),
])

console.log(zipPath)
console.log(`users=${users.recordset.length}`)
console.log(`roles=${roles.recordset.length}`)
console.log(`rolePermissions=${rolePermissions.recordset.length}`)
console.log(`userRoles=${userRoles.recordset.length}`)
