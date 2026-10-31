export interface AccessUser { isAdmin?: boolean; permissions?: string[]; writePermissions?: string[] }
export function resolveAccess(keys?: string[]): { permissions: string[]; writePermissions: string[] }
export function userHasPermission(user: AccessUser | null | undefined, permission: string): boolean
export function userCanOperate(user: AccessUser | null | undefined, permission: string): boolean
export function normalizeRolePermissions(keys: unknown, definitions: { key: string }[]): string[]
