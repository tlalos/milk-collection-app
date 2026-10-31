// Existing bare permission keys retain full access; :view grants never imply writes.
export function resolveAccess(permissionKeys = []) {
  const writePermissions = [...new Set(permissionKeys.filter(key => !key.endsWith(':view')))]
  const permissions = [...new Set(permissionKeys.map(key => key.replace(/:view$/u, '')))]
  return { permissions, writePermissions }
}

export function userHasPermission(user, permission) {
  if (!permission) return true
  return Boolean(user && (user.isAdmin || user.permissions?.includes(permission) || user.permissions?.includes(`${permission}:view`)))
}

export function userCanOperate(user, permission) {
  if (!user) return false
  if (user.isAdmin) return true
  return (user.writePermissions ?? user.permissions ?? []).includes(permission)
}

export function normalizeRolePermissions(keys, definitions) {
  const values = new Set(Array.isArray(keys) ? keys.map(key => String(key || '').trim()) : [])
  return definitions.flatMap(({ key }) => values.has(key) ? [key] : values.has(`${key}:view`) ? [`${key}:view`] : [])
}
