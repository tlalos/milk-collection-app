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

function buildApiUrl(serverUrl: string, path: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function looksLikeHtmlResponse(text: string, contentType: string | null): boolean {
  const normalized = text.trim().toLowerCase()
  return contentType?.toLowerCase().includes('text/html') === true
    || normalized.startsWith('<!doctype html')
    || normalized.startsWith('<html')
}

function parseApiResponse<TResponse>(text: string, contentType: string | null): TResponse {
  if (looksLikeHtmlResponse(text, contentType)) {
    throw new ApiError(0, 'The server URL returned a web page instead of API data. Check the Server URL in Settings.')
  }
  const parsed = text ? (JSON.parse(text) as TResponse | string) : undefined
  return (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as TResponse
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

  const resolvedToken = options.token ?? (options.authorized ? getToken() : null)
  if (resolvedToken) {
    headers['Authorization'] = `Bearer ${resolvedToken}`
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
  return parseApiResponse<TResponse>(text, res.headers.get('Content-Type'))
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

  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: options.signal,
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text || res.statusText)
  }

  const text = await res.text()
  // Server may double-encode: Ok(JsonConvert.SerializeObject(...)) → JSON string
  return parseApiResponse<TResponse>(text, res.headers.get('Content-Type'))
}

/** Probe a real API endpoint instead of the bare base URL, which may return 404. */
export async function testConnection(serverUrl: string): Promise<boolean> {
  const url = buildApiUrl(serverUrl, 'Accounts/Login')
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Username: '__test__', Password: '__test__', fiscalyear: new Date().getFullYear().toString() }),
      signal: ac.signal,
    })
    const text = await res.text().catch(() => '')
    clearTimeout(timer)
    return res.status >= 200
      && res.status < 500
      && res.status !== 404
      && !looksLikeHtmlResponse(text, res.headers.get('Content-Type'))
  } catch {
    return false
  }
}
