import { userCanOperate, type AccessUser } from '../../server/accessLevels.js'
import { appPath } from '../ocrPaths'

// Check the current server session before the legacy browser-to-ERP workflow.
export async function requireWebOperation(permission: string, signal?: AbortSignal) {
  const response = await fetch(appPath('/api/auth/session'), { cache: 'no-store', signal })
  if (!response.ok) throw new Error('Sign in to continue. Your access could not be verified.')
  const payload = await response.json() as { user?: AccessUser }
  if (!userCanOperate(payload.user, permission)) throw new Error('You do not have edit / operate access to this menu.')
}
