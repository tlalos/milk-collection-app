import { userHasPermission } from './appSecurityStore.js'
import { ocrFileJobId, ocrPermissionsForRoute } from './ocrPermissions.js'

export function createPermissionMiddleware({ getSessionUser, sessionToken, getJob }) {
  function requirePermission(permission) {
    return async (request, response, next) => {
      try {
        const user = await getSessionUser(sessionToken(request))
        if (!user) return response.status(401).json({ error: 'Authentication required.' })
        const permissions = Array.isArray(permission) ? permission : [permission]
        if (!permissions.some(item => userHasPermission(user, item))) {
          return response.status(403).json({ error: 'You do not have access to this page or action.' })
        }
        request.authUser = user
        next()
      } catch (error) { next(error) }
    }
  }

  async function requireOcrPermission(request, response, next) {
    try {
      const user = await getSessionUser(sessionToken(request))
      if (!user) return response.status(401).json({ error: 'Authentication required.' })
      const fileJobId = ocrFileJobId(request.path)
      let documentCategory = ''
      if (fileJobId) {
        const job = await getJob(fileJobId)
        if (!job) return response.status(404).json({ error: 'OCR job not found.' })
        documentCategory = job.documentCategory || 'daily_routes'
      }
      const permissions = ocrPermissionsForRoute(request.path, documentCategory, request.method)
      if (!permissions.some(permission => userHasPermission(user, permission))) {
        return response.status(403).json({ error: 'You do not have access to this page or action.' })
      }
      request.authUser = user
      next()
    } catch (error) { next(error) }
  }

  return { requirePermission, requireOcrPermission }
}
