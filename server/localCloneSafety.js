export const localCloneEnabled = process.env.LOCAL_PRODUCTION_CLONE === 'true'
export const localCloneHerdEditsEnabled = localCloneEnabled && process.env.LOCAL_PRODUCTION_CLONE_HERD_EDITS === 'true'
  && ['localhost', '127.0.0.1', '::1'].includes(process.env.SQL_SERVER || process.env.MSSQL_SERVER || 'localhost')
export const localCloneMessage = 'Local production-data copy: changes and external integrations are disabled while testing.'
export const localCloneCsp = "connect-src 'self' ws://127.0.0.1:5173 ws://localhost:5173"

export function installLocalCloneNetworkGuard(enabled = localCloneEnabled, target = globalThis) {
  if (!enabled) return
  target.fetch = async () => { throw new Error(localCloneMessage) }
}

export function localCloneMiddleware(enabled = localCloneEnabled, allowHerdEdits = localCloneHerdEditsEnabled) {
  return (request, response, next) => {
    if (!enabled) return next()
    response.setHeader('Content-Security-Policy', localCloneCsp)
    response.setHeader('X-Milk-Local-Clone', allowHerdEdits ? 'animal-counts-only' : 'read-only')
    const auth = request.path === '/api/auth/login' || request.path === '/api/auth/logout'
    const herdEdit = allowHerdEdits && request.method === 'PUT' && request.path === '/api/ocr/exports/producer-herd-counts'
    if (request.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !auth && !herdEdit) {
      return response.status(423).json({ error: localCloneMessage })
    }
    next()
  }
}
