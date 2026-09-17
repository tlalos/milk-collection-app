function buildApiUrl(serverUrl, pathname) {
  return `${String(serverUrl || '').trim().replace(/\/+$/u, '')}/${String(pathname || '').replace(/^\/+/u, '')}`
}

function parseApiJson(text) {
  const parsed = text ? JSON.parse(text) : null
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetch(url, { ...options, signal: controller.signal })
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`ERP request timed out after ${timeoutMs} ms: ${url}`)
      const cause = error?.cause?.message || error?.cause?.code || ''
      throw new Error(`ERP request failed before a response: ${url}${cause ? ` (${cause})` : ''}`)
    }
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      if (response.status === 404) throw new Error(`ERP endpoint not found (404): ${url}`)
      throw new Error(`ERP request failed (${response.status}): ${text || response.statusText}`)
    }
    const contentType = response.headers.get('content-type') || ''
    const normalized = text.trim().toLowerCase()
    if (contentType.toLowerCase().includes('text/html') || normalized.startsWith('<!doctype html') || normalized.startsWith('<html')) {
      throw new Error('ERP server returned a web page instead of API data.')
    }
    return parseApiJson(text)
  } finally {
    clearTimeout(timer)
  }
}

function requireOcrErpSettings(settings) {
  const serverUrl = String(settings?.serverUrl || '').trim()
  const apiUsername = String(settings?.apiUsername || '').trim()
  const apiPassword = String(settings?.apiPassword || '')
  const defaultFiscalYear = String(settings?.defaultFiscalYear || new Date().getFullYear()).trim()
  const requestTimeoutMs = Math.max(1000, Number(settings?.requestTimeoutMs) || 15000)
  if (!serverUrl || !apiUsername || !apiPassword) {
    throw new Error('OCR ERP settings are incomplete. Open OCR connection settings and save the API URL, username, and password.')
  }
  return { serverUrl, apiUsername, apiPassword, defaultFiscalYear, requestTimeoutMs }
}

function valueFrom(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function supplierCode(supplier) {
  return valueFrom(supplier, 'sup_code', 'Producer_Code', 'producer_code', 'code')
}

function supplierName(supplier) {
  return valueFrom(supplier, 'sup_name', 'Producer_Name', 'producer_name', 'name')
}

function supplierCodeStartsWith(supplier, prefix) {
  return supplierCode(supplier).toLowerCase().startsWith(prefix)
}

function uniqueByCode(items) {
  const seen = new Set()
  return items.filter((item) => {
    const code = String(item.code || item.producerCode || '').trim().toLowerCase()
    if (!code || seen.has(code)) return false
    seen.add(code)
    return true
  })
}

export async function fetchErpReferenceSuppliers(settings) {
  const resolved = requireOcrErpSettings(settings)
  const login = await fetchJson(
    buildApiUrl(resolved.serverUrl, 'Accounts/Login'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Username: resolved.apiUsername,
        Password: resolved.apiPassword,
        fiscalyear: resolved.defaultFiscalYear,
      }),
    },
    resolved.requestTimeoutMs,
  )
  const token = login?.access_token
  if (!token) throw new Error('ERP login succeeded but no access token was returned.')

  const params = new URLSearchParams({ mode: 'ALL', username: resolved.apiUsername })
  const suppliers = await fetchJson(
    `${buildApiUrl(resolved.serverUrl, 'WMS/ERP_RomSuppliersList')}?${params.toString()}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
    resolved.requestTimeoutMs,
  )

  if (!Array.isArray(suppliers)) throw new Error('ERP supplier list response was not an array.')
  const centers = uniqueByCode(suppliers
    .filter((supplier) => supplierCodeStartsWith(supplier, 'c'))
    .map((supplier) => ({
      code: supplierCode(supplier),
      name: supplierName(supplier),
    }))
    .filter((center) => center.code && center.name))

  const producers = suppliers
    .filter((supplier) => supplierCodeStartsWith(supplier, 'p'))
    .map((supplier) => ({
      producerCode: supplierCode(supplier),
      producerName: supplierName(supplier),
      centerCode: valueFrom(supplier, 'sup_central_code', 'Center_Code', 'center_code', 'sup_relatedsupcode'),
      centerName: valueFrom(supplier, 'sup_central_name', 'Center_Name', 'center_name', 'sup_relatedsupname'),
      trn: valueFrom(supplier, 'sup_afm', 'sup_irsdata', 'TRN', 'trn'),
    }))
    .filter((producer) => producer.producerCode && producer.producerName)

  return { centers, producers }
}

export async function fetchErpReferenceCenters(settings) {
  const { centers } = await fetchErpReferenceSuppliers(settings)
  return centers
}
