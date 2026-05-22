import { settingsStore } from '../store/settingsStore'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function getToken(): string | null {
  return localStorage.getItem('auth_token')
}

function getBaseUrl(): string {
  return settingsStore.getServerUrl().replace(/\/+$/, '')
}

interface RequestOptions {
  authorized?: boolean
  signal?: AbortSignal
  /** Explicit Bearer token — takes precedence over the token stored in localStorage. */
  token?: string
}

export async function apiPost<TBody, TResponse>(
  path: string,
  body: TBody,
  options: RequestOptions = {},
): Promise<TResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (options.authorized) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${getBaseUrl()}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text || res.statusText)
  }

  // 201 / 204 responses may have no body
  const text = await res.text()
  return text ? (JSON.parse(text) as TResponse) : (undefined as TResponse)
}

export async function apiGet<TResponse>(
  path: string,
  params: Record<string, string> = {},
  options: RequestOptions = {},
): Promise<TResponse> {
  const headers: Record<string, string> = {}

  const resolvedToken = options.token ?? (options.authorized !== false ? getToken() : null)
  if (resolvedToken) headers['Authorization'] = `Bearer ${resolvedToken}`

  const qs = new URLSearchParams(params).toString()
  const url = `${getBaseUrl()}/${path}${qs ? `?${qs}` : ''}`

  const res = await fetch(url, { method: 'GET', headers, signal: options.signal })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text || res.statusText)
  }

  const text = await res.text()
  // Server may double-encode: Ok(JsonConvert.SerializeObject(...)) → JSON string
  const parsed = text ? (JSON.parse(text) as TResponse | string) : undefined
  return (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as TResponse
}

/** Probe the server — resolves true if any HTTP response is received. */
export async function testConnection(serverUrl: string): Promise<boolean> {
  const url = serverUrl.replace(/\/+$/, '')
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8000)
    const res = await fetch(url, { method: 'HEAD', signal: ac.signal })
    clearTimeout(timer)
    return res.status < 600
  } catch {
    return false
  }
}
