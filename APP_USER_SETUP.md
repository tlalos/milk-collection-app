# Web User Setup

This is the current manual procedure for **Web users** until the Admin screen is added.

Web users are separate from ERP users:
- **Web users** control access to tiles/pages and create the activity history.
- **ERP users** are the older ERP/AppCenter users used for ERP sign-in and ERP sync.

Important:
- Run the updated app once before creating Web users. The app creates the SQL tables automatically.
- Do not save real passwords in this file.
- Generate a new password hash for every user.
- After the app has restarted once with the latest version, timestamp columns such as `createdAt`, `updatedAt`, and `occurredAt` can be left blank when inserting rows manually; SQL will fill them with `SYSDATETIMEOFFSET()`.

## 1. Generate Password Salt And Hash

On a computer with Node.js installed, run this in Command Prompt or PowerShell:

```powershell
node -e "const {randomBytes,scryptSync}=require('node:crypto'); const password=process.argv[1]; const salt=randomBytes(16).toString('hex'); const hash=scryptSync(String(password), Buffer.from(salt,'hex'), 64).toString('hex'); console.log('passwordSalt=' + salt); console.log('passwordHash=' + hash);" "PUT_USER_PASSWORD_HERE"
```

Copy the two output values:

```text
passwordSalt=...
passwordHash=...
```

## 2. Available Web User Permissions

Use these permission keys in roles:

| Tile / Page | Permission key |
| --- | --- |
| Milk collection | `milk_collection` |
| Customers | `customers` |
| Data sync | `data_sync` |
| Journal | `journal` |
| Transport | `transport` |
| Milk Reception | `milk_reception` |
| OCR documents / OCR upload / OCR review | `ocr_documents` |
| Daily Aviz | `daily_aviz` |
| Monthly Reconciliation | `monthly_reconciliation` |
| Month Closure & Payments | `month_closure` |
| OCR Settings | `ocr_settings` |
| App administration | `app_admin` |
| Audit history | `audit_log` |

To give a Web user access to a tile, add that permission key to one of the Web user's roles in `dbo.AppRolePermissions`.

Important:
- The Home screen will eventually use these permissions to show/hide tiles.
- The server already uses these permissions for protected API/page access.
- A Web user can have one role or many roles.
- A role can contain one permission or many permissions.

## 2A. Give A Role Access To One Specific Tile

Example: give the `reception` role access to the Milk Reception tile/page.

```sql
IF NOT EXISTS (
  SELECT 1
  FROM dbo.AppRolePermissions
  WHERE roleKey = N'reception'
    AND permissionKey = N'milk_reception'
)
BEGIN
  INSERT INTO dbo.AppRolePermissions (roleKey, permissionKey, createdAt)
  VALUES (N'reception', N'milk_reception', SYSDATETIMEOFFSET());
END;
```

## 2B. Give A Role Access To Several Tiles

Example: give an accounting role access to Daily Aviz, Monthly Reconciliation, and Month Closure.

```sql
DECLARE @RoleKey NVARCHAR(80) = N'accounting';

IF NOT EXISTS (SELECT 1 FROM dbo.AppRoles WHERE roleKey = @RoleKey)
BEGIN
  INSERT INTO dbo.AppRoles (roleKey, roleName, description, createdAt, updatedAt)
  VALUES (@RoleKey, N'Accounting', N'Accounting and reconciliation access', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());
END;

MERGE dbo.AppRolePermissions AS target
USING (VALUES
  (@RoleKey, N'daily_aviz'),
  (@RoleKey, N'monthly_reconciliation'),
  (@RoleKey, N'month_closure')
) AS source(roleKey, permissionKey)
ON target.roleKey = source.roleKey AND target.permissionKey = source.permissionKey
WHEN NOT MATCHED THEN
  INSERT (roleKey, permissionKey, createdAt)
  VALUES (source.roleKey, source.permissionKey, SYSDATETIMEOFFSET());
```

## 2C. Assign An Existing Role To A User

Example: assign the `accounting` role to user `maria`.

```sql
INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt)
SELECT userId, N'accounting', SYSDATETIMEOFFSET()
FROM dbo.AppUsers
WHERE username = N'maria'
  AND NOT EXISTS (
    SELECT 1
    FROM dbo.AppUserRoles
    WHERE AppUserRoles.userId = AppUsers.userId
      AND AppUserRoles.roleKey = N'accounting'
  );
```

## 2D. Remove Access To A Tile From A Role

Example: remove Month Closure access from the `accounting` role.

```sql
DELETE FROM dbo.AppRolePermissions
WHERE roleKey = N'accounting'
  AND permissionKey = N'month_closure';
```

This removes the permission from everyone who has the `accounting` role.

## 2E. See What A User Can Access

```sql
SELECT
  u.username,
  u.fullName,
  r.roleKey,
  r.roleName,
  rp.permissionKey
FROM dbo.AppUsers u
LEFT JOIN dbo.AppUserRoles ur ON ur.userId = u.userId
LEFT JOIN dbo.AppRoles r ON r.roleKey = ur.roleKey
LEFT JOIN dbo.AppRolePermissions rp ON rp.roleKey = r.roleKey
WHERE u.username = N'reception1'
ORDER BY r.roleKey, rp.permissionKey;
```

## 3. Example: Create Reception User

This creates a user who can only access Milk Reception.

Replace:
- `reception1`
- `Reception User`
- `PASTE_SALT_HERE`
- `PASTE_HASH_HERE`

```sql
DECLARE @UserId NVARCHAR(64) = CONVERT(NVARCHAR(64), NEWID());
DECLARE @Username NVARCHAR(160) = N'reception1';
DECLARE @FullName NVARCHAR(240) = N'Reception User';
DECLARE @PasswordSalt NVARCHAR(128) = N'PASTE_SALT_HERE';
DECLARE @PasswordHash NVARCHAR(256) = N'PASTE_HASH_HERE';
DECLARE @RoleKey NVARCHAR(80) = N'reception';

IF NOT EXISTS (SELECT 1 FROM dbo.AppRoles WHERE roleKey = @RoleKey)
BEGIN
  INSERT INTO dbo.AppRoles (roleKey, roleName, description, createdAt, updatedAt)
  VALUES (@RoleKey, N'Reception', N'Milk Reception access', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());
END;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.AppRolePermissions
  WHERE roleKey = @RoleKey AND permissionKey = N'milk_reception'
)
BEGIN
  INSERT INTO dbo.AppRolePermissions (roleKey, permissionKey, createdAt)
VALUES (@RoleKey, N'milk_reception', SYSDATETIMEOFFSET());
END;

INSERT INTO dbo.AppUsers (
  userId, username, fullName, passwordSalt, passwordHash, isActive, isAdmin, createdAt, updatedAt
) VALUES (
  @UserId, @Username, @FullName, @PasswordSalt, @PasswordHash, 1, 0, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
);

INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt)
VALUES (@UserId, @RoleKey, SYSDATETIMEOFFSET());
```

If you are using **Edit Top 200 Rows** manually, you can leave these timestamp columns blank after the app has restarted with the latest version:

- `AppUsers.createdAt`
- `AppUsers.updatedAt`
- `AppRoles.createdAt`
- `AppRoles.updatedAt`
- `AppUserRoles.createdAt`
- `AppRolePermissions.createdAt`

SQL will fill them automatically.

## 4. Example: Create OCR User

This creates a user who can use OCR upload/review plus Daily Aviz.

```sql
DECLARE @UserId NVARCHAR(64) = CONVERT(NVARCHAR(64), NEWID());
DECLARE @Username NVARCHAR(160) = N'ocr1';
DECLARE @FullName NVARCHAR(240) = N'OCR User';
DECLARE @PasswordSalt NVARCHAR(128) = N'PASTE_SALT_HERE';
DECLARE @PasswordHash NVARCHAR(256) = N'PASTE_HASH_HERE';
DECLARE @RoleKey NVARCHAR(80) = N'ocr_operator';

IF NOT EXISTS (SELECT 1 FROM dbo.AppRoles WHERE roleKey = @RoleKey)
BEGIN
  INSERT INTO dbo.AppRoles (roleKey, roleName, description, createdAt, updatedAt)
  VALUES (@RoleKey, N'OCR Operator', N'OCR documents and Daily Aviz access', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());
END;

MERGE dbo.AppRolePermissions AS target
USING (VALUES
  (@RoleKey, N'ocr_documents'),
  (@RoleKey, N'daily_aviz')
) AS source(roleKey, permissionKey)
ON target.roleKey = source.roleKey AND target.permissionKey = source.permissionKey
WHEN NOT MATCHED THEN
  INSERT (roleKey, permissionKey, createdAt)
  VALUES (source.roleKey, source.permissionKey, SYSDATETIMEOFFSET());

INSERT INTO dbo.AppUsers (
  userId, username, fullName, passwordSalt, passwordHash, isActive, isAdmin, createdAt, updatedAt
) VALUES (
  @UserId, @Username, @FullName, @PasswordSalt, @PasswordHash, 1, 0, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET()
);

INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt)
VALUES (@UserId, @RoleKey, SYSDATETIMEOFFSET());
```

## 5. Disable A User

Do this instead of deleting the user:

```sql
UPDATE dbo.AppUsers
SET isActive = 0, updatedAt = SYSDATETIMEOFFSET()
WHERE username = N'reception1';
```

## 6. Make A User Admin

Only do this for trusted users.

```sql
UPDATE dbo.AppUsers
SET isAdmin = 1, updatedAt = SYSDATETIMEOFFSET()
WHERE username = N'some_username';

IF NOT EXISTS (
  SELECT 1
  FROM dbo.AppUserRoles ur
  JOIN dbo.AppUsers u ON u.userId = ur.userId
  WHERE u.username = N'some_username'
    AND ur.roleKey = N'admin'
)
BEGIN
  INSERT INTO dbo.AppUserRoles (userId, roleKey, createdAt)
  SELECT userId, N'admin', SYSDATETIMEOFFSET()
  FROM dbo.AppUsers
  WHERE username = N'some_username';
END;
```

## 7. View Audit History

```sql
SELECT TOP (100)
  occurredAt,
  username,
  action,
  entityType,
  entityId,
  beforeJson,
  afterJson,
  metadataJson,
  ipAddress
FROM dbo.AppAuditLog
ORDER BY occurredAt DESC;
```
