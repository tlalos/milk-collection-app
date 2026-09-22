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
      console.error('[ERP reference] request failed before response', {
        url,
        error: error?.message,
        causeCode: error?.cause?.code,
        causeMessage: error?.cause?.message,
      })
      throw new Error(`ERP request failed before a response: ${url}${cause ? ` (${cause})` : ''}`)
    }
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      console.error('[ERP reference] request returned error response', {
        url,
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 300),
      })
      if (response.status === 404) throw new Error(`ERP endpoint not found (404): ${url}`)
      throw new Error(`ERP request failed (${response.status}): ${text || response.statusText}`)
    }
    const contentType = response.headers.get('content-type') || ''
    const normalized = text.trim().toLowerCase()
    if (contentType.toLowerCase().includes('text/html') || normalized.startsWith('<!doctype html') || normalized.startsWith('<html')) {
      console.error('[ERP reference] request returned HTML instead of API data', {
        url,
        status: response.status,
        contentType,
        bodyPreview: text.slice(0, 300),
      })
      throw new Error('ERP server returned a web page instead of API data.')
    }
    return parseApiJson(text)
  } finally {
    clearTimeout(timer)
  }
}

function requireOcrErpSettings(settings, accessToken = '') {
  const serverUrl = String(settings?.serverUrl || '').trim()
  const apiUsername = String(settings?.apiUsername || '').trim()
  const apiPassword = String(settings?.apiPassword || '')
  const defaultFiscalYear = String(settings?.defaultFiscalYear || new Date().getFullYear()).trim()
  const requestTimeoutMs = Math.max(1000, Number(settings?.requestTimeoutMs) || 15000)
  if (!serverUrl || !apiUsername || (!apiPassword && !accessToken)) {
    throw new Error('OCR ERP settings are incomplete. Open OCR connection settings and save the API URL, username, and password.')
  }
  return { serverUrl, apiUsername, apiPassword, defaultFiscalYear, requestTimeoutMs, accessToken }
}

function valueFrom(source, ...keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  const normalizedEntries = Object.entries(source || {}).map(([key, value]) => [
    String(key).toLowerCase().replace(/[^a-z0-9]/gu, ''),
    value,
  ])
  for (const key of keys) {
    const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/gu, '')
    const match = normalizedEntries.find(([entryKey]) => entryKey === normalizedKey)
    const value = match?.[1]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function vatStatusNameFrom(supplier) {
  const name = valueFrom(
    supplier,
    'sup_vatstatus_name',
    'sup_vatstatusname',
    'supVatStatusName',
    'supVatstatusName',
    'vat status',
    'vat_status',
    'vatStatusName',
  )
  if (name) return name

  const code = valueFrom(supplier, 'sup_vatsts', 'supVatsts', 'vatsts', 'vat_status_code', 'vatStatus')
  if (code === '0') return 'is exempted'
  if (code === '1') return 'regular'
  if (code === '2') return 'reduced'
  return ''
}

function flagFrom(source, ...keys) {
  const value = valueFrom(source, ...keys)
  const normalized = value.toLowerCase()
  if (['1', 'true', 'yes'].includes(normalized)) return '1'
  if (['0', 'false', 'no'].includes(normalized)) return '0'
  return value
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

export async function fetchErpReferenceSuppliers(settings, accessToken = '') {
  const resolved = requireOcrErpSettings(settings, String(accessToken || '').trim())
  let token = resolved.accessToken
  if (!token) {
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
    token = login?.access_token
    if (!token) throw new Error('ERP login succeeded but no access token was returned.')
  }

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
      primaryAddress: valueFrom(supplier, 'sup_address', 'Primary_Address', 'primary_address', 'address'),
      zip: valueFrom(supplier, 'sup_zip', 'Zip', 'zip'),
      city: valueFrom(supplier, 'sup_district', 'City', 'city', 'sup_city'),
      primaryPhone: valueFrom(supplier, 'sup_phone01', 'Primary_Phone', 'primary_phone', 'phone'),
      exploitationCode: valueFrom(supplier, 'sup_elogak', 'Cod Exploatatie', 'cod_exploatatie', 'exploitation_code'),
      active: valueFrom(supplier, 'sup_isactive', 'Active', 'active'),
      vatStatusName: vatStatusNameFrom(supplier),
      bankCode: valueFrom(supplier, 'sup_bankcode', 'bank code', 'bank_code', 'bankCode'),
      iban: valueFrom(supplier, 'sup_iban', 'iban', 'IBAN'),
      extra: flagFrom(supplier, 'sup_bool01', 'sup_bool1', 'supBool01', 'supBool1', 'extra'),
      bool2: flagFrom(supplier, 'sup_bool02', 'sup_bool2', 'supBool02', 'supBool2', 'bool2'),
    }))
    .filter((producer) => producer.producerCode && producer.producerName)

  return { centers, producers }
}

export async function fetchErpReferenceCenters(settings) {
  const { centers } = await fetchErpReferenceSuppliers(settings)
  return centers
}
